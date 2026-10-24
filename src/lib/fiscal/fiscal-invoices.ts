import "server-only";

import crypto from "node:crypto";
import type Stripe from "stripe";

import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";
import {
  buildInvoiceRequest,
  businessYear,
  computeZoi,
  readInvoiceAnswer,
} from "@/lib/fiscal/furs-protocol";
import { getFursCredentials, sendToFurs, type FursCredentials } from "@/lib/fiscal/furs-client";
import {
  invoiceQrPng,
  invoiceTitle,
  renderInvoiceHtml,
  renderInvoiceText,
  type InvoiceDocumentInput,
} from "@/lib/fiscal/invoice-document";
import { captureBackgroundError } from "@/lib/monitoring";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Issues the fiscal invoice for a Stripe payment, and the fiscal credit note for a Stripe refund.
 *
 * The order is the law's (ZDavPR art. 7, 9): take the next number, compute the ZOI, send the
 * invoice to FURS, and give the customer the invoice with FURS's EOR on it. When FURS cannot be
 * reached or refuses the invoice, the customer still gets it at once, with the ZOI but without an
 * EOR, and the cron route sends it again with SubsequentSubmit until FURS confirms it (the law
 * allows two working days). An EOR that arrives later is kept here, never added to the customer's
 * copy.
 *
 * Every step is safe to repeat: Stripe redelivers webhooks, and the cron retries whatever is left.
 */

/** Labels from the internal act (interni akt): the s.p.'s seat as the premise, the server as the device. */
export const FISCAL_PREMISE_ID = "P1";
export const FISCAL_DEVICE_ID = "SPLET";
export const FISCAL_OPERATOR_LABEL = "SPLET";

type FiscalInvoiceRow = {
  id: string;
  kind: "invoice" | "credit_note";
  business_year: number;
  premise_id: string;
  device_id: string;
  invoice_number: number;
  issued_at: string;
  amount_cents: number;
  description: string;
  operator_label: string;
  tax_number: number;
  zoi: string | null;
  eor: string | null;
  status: "pending" | "confirmed";
  delivered_without_eor: boolean;
  send_attempts: number;
  emailed_at: string | null;
  email_to: string | null;
  reference_invoice_id: string | null;
  special_notes: string | null;
};

const db = () => createSupabaseServiceRoleClient();

type IssueParams = {
  kind: "invoice" | "credit_note";
  amountCents: number;
  description: string;
  emailTo: string | null;
  userId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeRefundId?: string | null;
  referenceInvoiceId?: string | null;
};

async function allocate(credentials: FursCredentials, params: IssueParams) {
  const issuedAt = new Date();
  const { data, error } = await db().rpc("allocate_fiscal_invoice" as never, {
    p_kind: params.kind,
    p_business_year: businessYear(issuedAt),
    p_premise_id: FISCAL_PREMISE_ID,
    p_device_id: FISCAL_DEVICE_ID,
    p_issued_at: issuedAt.toISOString(),
    p_amount_cents: params.amountCents,
    p_description: params.description,
    p_operator_label: FISCAL_OPERATOR_LABEL,
    p_tax_number: credentials.taxNumber,
    p_email_to: params.emailTo,
    p_user_id: params.userId,
    p_stripe_payment_intent_id: params.stripePaymentIntentId,
    p_stripe_invoice_id: params.stripeInvoiceId ?? null,
    p_stripe_checkout_session_id: params.stripeCheckoutSessionId ?? null,
    p_stripe_refund_id: params.stripeRefundId ?? null,
    p_reference_invoice_id: params.referenceInvoiceId ?? null,
    p_special_notes: null,
  } as never);

  if (error) {
    throw new Error(`Could not allocate a fiscal invoice number: ${error.message}`);
  }

  return data as unknown as FiscalInvoiceRow;
}

/** The ZOI is computed once the number exists; a crash before it was stored is repaired here. */
async function ensureZoi(credentials: FursCredentials, row: FiscalInvoiceRow) {
  if (row.zoi) {
    return row;
  }

  const zoi = computeZoi(
    {
      taxNumber: row.tax_number,
      issuedAt: new Date(row.issued_at),
      invoiceNumber: row.invoice_number,
      premiseId: row.premise_id,
      deviceId: row.device_id,
      amountCents: row.amount_cents,
    },
    credentials.privateKey,
  );

  const { error } = await db()
    .from("fiscal_invoices" as never)
    .update({ zoi } as never)
    .eq("id", row.id)
    .is("zoi", null);

  if (error) {
    throw new Error(`Could not store the ZOI of fiscal invoice ${row.id}: ${error.message}`);
  }

  return { ...row, zoi };
}

async function loadReference(row: FiscalInvoiceRow) {
  if (!row.reference_invoice_id) {
    return null;
  }

  const { data } = await db()
    .from("fiscal_invoices" as never)
    .select("premise_id, device_id, invoice_number, issued_at")
    .eq("id", row.reference_invoice_id)
    .single();
  const reference = data as unknown as Pick<
    FiscalInvoiceRow,
    "premise_id" | "device_id" | "invoice_number" | "issued_at"
  > | null;

  return reference
    ? {
        premiseId: reference.premise_id,
        deviceId: reference.device_id,
        invoiceNumber: reference.invoice_number,
        issuedAt: new Date(reference.issued_at),
      }
    : null;
}

/** One send to FURS. Every message and answer is logged, whatever happens. */
async function submit(credentials: FursCredentials, row: FiscalInvoiceRow & { zoi: string }) {
  const messageId = crypto.randomUUID();
  const subsequentSubmit = row.delivered_without_eor;
  const payload = buildInvoiceRequest({
    messageId,
    sentAt: new Date(),
    taxNumber: row.tax_number,
    issuedAt: new Date(row.issued_at),
    invoiceNumber: row.invoice_number,
    premiseId: row.premise_id,
    deviceId: row.device_id,
    amountCents: row.amount_cents,
    zoi: row.zoi,
    operatorTaxNumber: row.tax_number,
    subsequentSubmit,
    reference: await loadReference(row),
    specialNotes: row.special_notes,
  });

  const exchange = await sendToFurs(credentials, "invoice", payload);
  const answer = exchange.payload ? readInvoiceAnswer(exchange.payload) : null;
  const eor = answer?.ok ? answer.eor : null;
  const failure = exchange.transportError ?? (answer && !answer.ok ? `${answer.errorCode} ${answer.errorMessage}` : null);

  await db()
    .from("fiscal_invoice_messages" as never)
    .insert({
      fiscal_invoice_id: row.id,
      message_kind: "invoice",
      message_id: messageId,
      subsequent_submit: subsequentSubmit,
      request_token: exchange.requestToken,
      response_token: exchange.responseToken,
      response_status: exchange.status,
      error_code: answer && !answer.ok ? answer.errorCode : exchange.transportError ? "TRANSPORT" : null,
      error_message: failure,
      eor,
    } as never);

  const now = new Date().toISOString();
  const update = eor
    ? { status: "confirmed", eor, confirmed_at: now, last_error: null }
    : { last_error: failure ?? "FURS gave no EOR." };

  await db()
    .from("fiscal_invoices" as never)
    .update({ ...update, send_attempts: row.send_attempts + 1, last_attempt_at: now } as never)
    .eq("id", row.id)
    .eq("status", "pending");

  if (!eor) {
    captureBackgroundError(new Error(`FURS did not confirm fiscal invoice: ${failure}`), {
      operation: "fiscal-invoice-submit",
      tags: { fiscal_invoice_id: row.id },
      extra: { attempt: row.send_attempts + 1, subsequentSubmit },
    });
  }

  return { ...row, eor, status: eor ? ("confirmed" as const) : row.status };
}

/**
 * Hands the invoice to the customer by email, through Resend (as the creator emails are). If it
 * goes out before FURS confirmed it, the row is marked so every later send carries SubsequentSubmit.
 */
async function deliver(row: FiscalInvoiceRow & { zoi: string }) {
  if (row.emailed_at || !row.email_to) {
    return row;
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    captureBackgroundError(new Error("RESEND_API_KEY is not set; a fiscal invoice was not emailed."), {
      operation: "fiscal-invoice-email",
      tags: { fiscal_invoice_id: row.id },
    });
    return row;
  }

  const document: InvoiceDocumentInput = {
    kind: row.kind,
    premiseId: row.premise_id,
    deviceId: row.device_id,
    invoiceNumber: row.invoice_number,
    issuedAt: new Date(row.issued_at),
    amountCents: row.amount_cents,
    description: row.description,
    operatorLabel: row.operator_label,
    taxNumber: row.tax_number,
    zoi: row.zoi,
    eor: row.status === "confirmed" ? row.eor : null,
    customerEmail: row.email_to,
    reference: await loadReference(row),
  };
  const qr = await invoiceQrPng(row.zoi, row.tax_number, document.issuedAt);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `fiscal-invoice-${row.id}`,
    },
    body: JSON.stringify({
      from: process.env.FISCAL_EMAIL_FROM?.trim() || "Memo AI <racuni@memoai.eu>",
      to: [row.email_to],
      reply_to: BRAND_SUPPORT_EMAIL,
      subject: `${invoiceTitle(document)} · Memo AI`,
      html: renderInvoiceHtml(document, "cid:zoi-qr"),
      text: renderInvoiceText(document),
      attachments: [{ filename: "zoi-qr.png", content: qr.toString("base64"), content_id: "zoi-qr" }],
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch((error: unknown) => error);

  if (!(response instanceof Response) || !response.ok) {
    const detail =
      response instanceof Response
        ? `Resend answered ${response.status}: ${(await response.text().catch(() => "")).slice(0, 300)}`
        : String(response);
    captureBackgroundError(new Error(`Fiscal invoice email failed: ${detail}`), {
      operation: "fiscal-invoice-email",
      tags: { fiscal_invoice_id: row.id },
    });
    return row;
  }

  const deliveredWithoutEor = row.status !== "confirmed";
  await db()
    .from("fiscal_invoices" as never)
    .update({ emailed_at: new Date().toISOString(), delivered_without_eor: deliveredWithoutEor } as never)
    .eq("id", row.id);

  return { ...row, emailed_at: new Date().toISOString(), delivered_without_eor: deliveredWithoutEor };
}

/** Takes a row as far as it can go: ZOI, FURS, email. Used by the webhook and by the cron. */
async function advance(credentials: FursCredentials, row: FiscalInvoiceRow) {
  let current = await ensureZoi(credentials, row);
  const withZoi = current as FiscalInvoiceRow & { zoi: string };

  if (withZoi.status === "pending") {
    current = await submit(credentials, withZoi);
  }

  return deliver(current as FiscalInvoiceRow & { zoi: string });
}

async function issue(params: IssueParams) {
  const credentials = getFursCredentials();

  if (!credentials) {
    return null;
  }

  if (params.amountCents === 0) {
    return null;
  }

  const row = await allocate(credentials, params);
  return advance(credentials, row);
}

async function userIdForCustomer(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null) {
  const customerId = typeof customer === "string" ? customer : customer?.id;

  if (!customerId) {
    return null;
  }

  const { data } = await db()
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}

function eurCents(amount: number, currency: string, context: string) {
  if (currency.toLowerCase() !== "eur") {
    // FURS takes euros only; Memo prices are all in euros, so anything else is a configuration bug.
    throw new Error(`${context} is in ${currency}, but fiscal invoices are issued in EUR only.`);
  }

  return amount;
}

const ljubljanaDate = (seconds: number) =>
  new Intl.DateTimeFormat("sl-SI", { timeZone: "Europe/Ljubljana", day: "numeric", month: "numeric", year: "numeric" }).format(
    new Date(seconds * 1000),
  );

/** A paid subscription invoice (first payment, renewal, upgrade). €0 trial invoices are skipped. */
export async function issueFiscalInvoiceForStripeInvoice(stripe: Stripe, invoice: Stripe.Invoice) {
  if (!getFursCredentials() || invoice.amount_paid <= 0 || !invoice.id) {
    return null;
  }

  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: "paid", limit: 10 });
  const paymentIntent = payments.data
    .map((payment) => payment.payment.payment_intent)
    .find((intent) => intent);
  const paymentIntentId = typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null;
  const line = invoice.lines?.data?.[0];
  const period = line?.period ? ` (${ljubljanaDate(line.period.start)} – ${ljubljanaDate(line.period.end)})` : "";

  return issue({
    kind: "invoice",
    amountCents: eurCents(invoice.amount_paid, invoice.currency, `Stripe invoice ${invoice.id}`),
    description: `Naročnina Memo AI${period}`,
    emailTo: invoice.customer_email ?? null,
    userId: await userIdForCustomer(invoice.customer),
    stripePaymentIntentId: paymentIntentId,
    stripeInvoiceId: invoice.id,
  });
}

/** A one-off Checkout payment (tutor minutes), which has no Stripe invoice. */
export async function issueFiscalInvoiceForCheckoutSession(session: Stripe.Checkout.Session) {
  if (!getFursCredentials() || session.mode !== "payment" || session.payment_status !== "paid") {
    return null;
  }

  const amount = session.amount_total ?? 0;

  if (amount <= 0) {
    return null;
  }

  const paymentIntent = session.payment_intent;

  return issue({
    kind: "invoice",
    amountCents: eurCents(amount, session.currency ?? "", `Checkout session ${session.id}`),
    description: "Dodatni čas AI tutorja Memo AI",
    emailTo: session.customer_details?.email ?? session.customer_email ?? null,
    userId: session.metadata?.userId ?? (await userIdForCustomer(session.customer)),
    stripePaymentIntentId: typeof paymentIntent === "string" ? paymentIntent : paymentIntent?.id ?? null,
    stripeCheckoutSessionId: session.id,
  });
}

/**
 * A refund is a credit note: a new, negative invoice in the same number series that references
 * the original. Only payments that have a fiscal invoice get one; a refund of a payment from
 * before fiscal verification started has nothing to reference.
 */
export async function issueFiscalCreditNotesForCharge(stripe: Stripe, charge: Stripe.Charge) {
  if (!getFursCredentials()) {
    return [];
  }

  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;

  if (!paymentIntentId) {
    return [];
  }

  const { data } = await db()
    .from("fiscal_invoices" as never)
    .select("id, description, email_to, user_id")
    .eq("kind", "invoice")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  const original = data as unknown as { id: string; description: string; email_to: string | null; user_id: string | null } | null;

  if (!original) {
    return [];
  }

  const refunds = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  const issued = [];

  for (const refund of refunds.data) {
    if (refund.status !== "succeeded" || refund.amount <= 0) {
      continue;
    }

    issued.push(
      await issue({
        kind: "credit_note",
        amountCents: -eurCents(refund.amount, refund.currency, `Refund ${refund.id}`),
        description: `Vračilo: ${original.description}`,
        emailTo: original.email_to,
        userId: original.user_id,
        stripePaymentIntentId: paymentIntentId,
        stripeRefundId: refund.id,
        referenceInvoiceId: original.id,
      }),
    );
  }

  return issued;
}

/**
 * The cron's job: every invoice FURS has not confirmed yet is sent again (with SubsequentSubmit
 * once the customer has it), and every confirmed one that was never emailed is emailed.
 */
export async function retryPendingFiscalInvoices(limit = 50) {
  const credentials = getFursCredentials();

  if (!credentials) {
    return { configured: false, processed: 0, confirmed: 0 };
  }

  const { data, error } = await db()
    .from("fiscal_invoices" as never)
    .select("*")
    .or("status.eq.pending,and(emailed_at.is.null,email_to.not.is.null)")
    .order("issued_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Could not read pending fiscal invoices: ${error.message}`);
  }

  let confirmed = 0;
  const rows = (data ?? []) as unknown as FiscalInvoiceRow[];

  for (const row of rows) {
    const result = await advance(credentials, row);

    if (result.status === "confirmed" && row.status === "pending") {
      confirmed += 1;
    }
  }

  return { configured: true, processed: rows.length, confirmed };
}
