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
  furs_environment: "test" | "production";
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
  email_attempts: number;
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

async function allocate(credentials: FursCredentials, params: IssueParams, issuedAt: Date) {
  const { data, error } = await db().rpc("allocate_fiscal_invoice" as never, {
    p_furs_environment: credentials.environment,
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

  const { data, error } = await db()
    .from("fiscal_invoices" as never)
    .select("premise_id, device_id, invoice_number, issued_at")
    .eq("id", row.reference_invoice_id)
    .single();

  // A credit note sent without its reference would be a free-standing negative invoice.
  if (error) {
    throw new Error(`Could not read the invoice credit note ${row.id} refers to: ${error.message}`);
  }

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

  const logged = await db()
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

  if (logged.error) {
    captureBackgroundError(new Error(`Could not log a FURS exchange: ${logged.error.message}`), {
      operation: "fiscal-invoice-submit",
      tags: { fiscal_invoice_id: row.id },
      extra: { eor, requestToken: exchange.requestToken, responseToken: exchange.responseToken },
    });
  }

  const now = new Date().toISOString();
  const update = eor
    ? { status: "confirmed", eor, confirmed_at: now, last_error: null }
    : { last_error: failure ?? "FURS gave no EOR." };

  const stored = await db()
    .from("fiscal_invoices" as never)
    .update({ ...update, send_attempts: row.send_attempts + 1, last_attempt_at: now } as never)
    .eq("id", row.id)
    .eq("status", "pending");

  // An EOR FURS gave but this row never recorded would make the cron register the invoice again.
  if (stored.error) {
    throw new Error(`FURS answered (EOR ${eor ?? "none"}) but fiscal invoice ${row.id} was not updated: ${stored.error.message}`);
  }

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

  // FURS's test system confirms nothing real: a customer must never receive a test invoice.
  if (row.furs_environment === "test") {
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
      // The body changes once the EOR is in, and Resend refuses a reused key with another body.
      "Idempotency-Key": `fiscal-invoice-${row.id}-${row.status === "confirmed" ? "eor" : "zoi"}`,
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
    await db()
      .from("fiscal_invoices" as never)
      .update({ email_attempts: row.email_attempts + 1, last_email_attempt_at: new Date().toISOString() } as never)
      .eq("id", row.id);
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

  if (withZoi.status === "pending" && withZoi.send_attempts < MAX_SEND_ATTEMPTS) {
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

  const issuedAt = new Date();
  const row = await allocate(credentials, params, issuedAt);

  // A redelivered webhook gets the existing row back. Whoever created it may still be sending it
  // to FURS, and a second send would get a second EOR, so an existing row is left to the cron.
  if (new Date(row.issued_at).getTime() !== issuedAt.getTime()) {
    return row;
  }

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

  const { data, error } = await db()
    .from("fiscal_invoices" as never)
    .select("id, description, email_to, user_id")
    .eq("kind", "invoice")
    .eq("furs_environment", getFursCredentials()?.environment ?? "")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  // Thrown, not swallowed: the webhook then fails and Stripe delivers the refund again.
  if (error) {
    throw new Error(`Could not look up the invoice for refunded charge ${charge.id}: ${error.message}`);
  }
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

/** FURS sends per invoice stop after this many; then it needs a person (Sentry has every failure). */
const MAX_SEND_ATTEMPTS = 20;
const MAX_EMAIL_ATTEMPTS = 10;
const BATCH = 20;

/**
 * The cron's job: every invoice FURS has not confirmed yet is sent again (with SubsequentSubmit
 * once the customer has it), and every invoice the customer has not received is emailed. Rows
 * rotate by their last attempt, so a few that keep failing cannot starve newer ones, and the run
 * stops well inside the function's time limit rather than being cut off mid-send.
 */
export async function retryPendingFiscalInvoices(budgetMs = 80_000) {
  const credentials = getFursCredentials();

  if (!credentials) {
    return { configured: false, processed: 0, confirmed: 0 };
  }

  const startedAt = Date.now();
  // Rows the webhook is still working on are left alone: sending one invoice twice makes FURS
  // issue two EORs for it.
  const settled = new Date(startedAt - 2 * 60 * 1000).toISOString();

  const unconfirmed = await db()
    .from("fiscal_invoices" as never)
    .select("*")
    .eq("furs_environment", credentials.environment)
    .eq("status", "pending")
    .lt("created_at", settled)
    .lt("send_attempts", MAX_SEND_ATTEMPTS)
    .order("last_attempt_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  const undelivered = await db()
    .from("fiscal_invoices" as never)
    .select("*")
    .eq("furs_environment", credentials.environment)
    .is("emailed_at", null)
    .not("email_to", "is", null)
    .lt("created_at", settled)
    .lt("email_attempts", MAX_EMAIL_ATTEMPTS)
    .order("last_email_attempt_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

  if (unconfirmed.error || undelivered.error) {
    throw new Error(`Could not read pending fiscal invoices: ${(unconfirmed.error ?? undelivered.error)?.message}`);
  }

  const rows = new Map<string, FiscalInvoiceRow>();
  for (const row of [...(unconfirmed.data ?? []), ...(undelivered.data ?? [])] as unknown as FiscalInvoiceRow[]) {
    rows.set(row.id, row);
  }

  let processed = 0;
  let confirmed = 0;

  for (const row of rows.values()) {
    if (Date.now() - startedAt > budgetMs) {
      break;
    }

    const result = await advance(credentials, row);
    processed += 1;

    if (result.status === "confirmed" && row.status === "pending") {
      confirmed += 1;
    }
  }

  return { configured: true, processed, confirmed };
}
