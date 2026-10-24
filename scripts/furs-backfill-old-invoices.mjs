import crypto from "node:crypto";
import { parseArgs } from "node:util";
import Stripe from "stripe";

import {
  buildInvoiceRequest,
  businessYear,
  computeZoi,
  formatAmount,
  fursDateTime,
  readInvoiceAnswer,
} from "../src/lib/fiscal/furs-protocol.ts";
import { fursScriptClient } from "./lib/furs-script-client.mjs";

/**
 * Sends FURS the invoices for Stripe payments that were taken before fiscal verification was
 * switched on. FURS answered (zadeva 0920-15932/2026) that every card payment through Stripe must
 * be verified "od dneva registracije dejavnosti dalje", i.e. from 3. 9. 2026; payments before the
 * s.p. existed are not affected.
 *
 * FURS's only published procedure for this is FAQ Q304 ("Po 2. januarju 2016 smo izdajali
 * gotovinske račune iz elektronske naprave, ki ni omogočala davčnega potrjevanja računov…"):
 *   - the invoice keeps the date and time it was issued (here: when Stripe took the payment);
 *   - a technical number under the registered premise and a device label used ONLY for
 *     back-filing (here P1-STARI-n, restarting each year), which the internal act must name
 *     before anything is sent;
 *   - SubsequentSubmit true, SpecialNotes exactly "#OLDINV;", the s.p.'s own tax number as operator;
 *   - nothing is sent to the customer: "Račun ostane takšen kot je bil izdan kupcu."
 * Refunds of these payments get credit notes in the same series, referencing the original.
 *
 *   node --experimental-strip-types scripts/furs-backfill-old-invoices.mjs \
 *     --from 2026-09-03 --until <ISO instant fiscal verification went live> [--send]
 *
 * Dry run by default: reads Stripe and prints what would be sent, writes nothing. With --send it
 * also needs the FURS_* variables (docs/fiscal-verification.md) and NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY, records every document in fiscal_invoices (so a re-run skips what is
 * done and a payment can never get a second invoice), and sends them in time order.
 */

const DEVICE_ID = "STARI";
const PREMISE_ID = "P1";
const OPERATOR_LABEL = "SPLET";
const SPECIAL_NOTES = "#OLDINV;";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    until: { type: "string" },
    send: { type: "boolean", default: false },
  },
});

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

if (!values.from || !values.until) {
  throw new Error("--from (YYYY-MM-DD, Ljubljana) and --until (ISO instant) are required.");
}

const from = new Date(`${values.from}T00:00:00+02:00`);
const until = new Date(values.until);

if (Number.isNaN(from.getTime()) || Number.isNaN(until.getTime()) || until <= from) {
  throw new Error("--from and --until must be valid and in order.");
}

const stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"));

/** Every succeeded charge in the window and every succeeded refund of those charges. */
async function collectDocuments() {
  const documents = [];

  for await (const charge of stripe.charges.list({
    created: { gte: Math.floor(from.getTime() / 1000), lt: Math.floor(until.getTime() / 1000) },
    limit: 100,
  })) {
    if (charge.status !== "succeeded" || !charge.paid || charge.amount <= 0) continue;

    if (charge.currency !== "eur") {
      throw new Error(`Charge ${charge.id} is in ${charge.currency}; FURS takes EUR only.`);
    }

    const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;

    if (!paymentIntentId) throw new Error(`Charge ${charge.id} has no payment intent to key its invoice on.`);

    const description = charge.description?.startsWith("Subscription") ? "Naročnina Memo AI" : "Memo AI";
    documents.push({
      kind: "invoice",
      issuedAt: new Date(charge.created * 1000),
      amountCents: charge.amount,
      description,
      paymentIntentId,
      chargeId: charge.id,
      refundId: null,
    });

    if (charge.amount_refunded > 0) {
      for await (const refund of stripe.refunds.list({ charge: charge.id, limit: 100 })) {
        if (refund.status !== "succeeded" || refund.amount <= 0) continue;
        // A refund made after the switch-over is handled by the live webhook only if the payment
        // had a live invoice; these payments do not, so their refunds belong here whenever made.
        documents.push({
          kind: "credit_note",
          issuedAt: new Date(refund.created * 1000),
          amountCents: -refund.amount,
          description: `Vračilo: ${description}`,
          paymentIntentId,
          chargeId: charge.id,
          refundId: refund.id,
        });
      }
    }
  }

  return documents.sort((a, b) => a.issuedAt - b.issuedAt || (a.kind === "invoice" ? -1 : 1));
}

const documents = await collectDocuments();
const invoices = documents.filter((doc) => doc.kind === "invoice");
const creditNotes = documents.filter((doc) => doc.kind === "credit_note");
const sum = (list) => list.reduce((total, doc) => total + doc.amountCents, 0);

console.log(`Window: ${fursDateTime(from)} – ${fursDateTime(until)} (Ljubljana)`);
console.log(`Invoices: ${invoices.length}, total ${formatAmount(sum(invoices))} EUR`);
console.log(`Credit notes: ${creditNotes.length}, total ${formatAmount(sum(creditNotes))} EUR`);
console.log("First documents:");
for (const doc of documents.slice(0, 5)) {
  console.log(`  ${fursDateTime(doc.issuedAt)}  ${doc.kind.padEnd(11)} ${formatAmount(doc.amountCents).padStart(8)}  ${doc.chargeId}`);
}

if (!values.send) {
  console.log("\nDry run: nothing written, nothing sent. Add --send once the internal act names device STARI.");
  process.exit(0);
}

const furs = fursScriptClient();
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

async function rest(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${path} answered ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** The row for an invoice, by payment intent: the reference a credit note points at. */
async function originalFor(paymentIntentId) {
  const rows = await rest(
    `fiscal_invoices?kind=eq.invoice&stripe_payment_intent_id=eq.${encodeURIComponent(paymentIntentId)}&select=*`,
  );
  return rows[0] ?? null;
}

let confirmed = 0;
let failed = 0;

for (const doc of documents) {
  const reference = doc.kind === "credit_note" ? await originalFor(doc.paymentIntentId) : null;

  if (doc.kind === "credit_note" && !reference) {
    throw new Error(`Refund ${doc.refundId} has no back-filed invoice to reference; stopping so numbering stays in order.`);
  }

  const row = await rest("rpc/allocate_fiscal_invoice", {
    method: "POST",
    body: JSON.stringify({
      p_kind: doc.kind,
      p_business_year: businessYear(doc.issuedAt),
      p_premise_id: PREMISE_ID,
      p_device_id: DEVICE_ID,
      p_issued_at: doc.issuedAt.toISOString(),
      p_amount_cents: doc.amountCents,
      p_description: doc.description,
      p_operator_label: OPERATOR_LABEL,
      p_tax_number: furs.taxNumber,
      // No email: a back-filed invoice is never sent to the customer again.
      p_email_to: null,
      p_user_id: null,
      p_stripe_payment_intent_id: doc.paymentIntentId,
      p_stripe_invoice_id: null,
      p_stripe_checkout_session_id: null,
      p_stripe_refund_id: doc.refundId,
      p_reference_invoice_id: reference?.id ?? null,
      p_special_notes: SPECIAL_NOTES,
    }),
  });

  if (row.status === "confirmed") continue;

  if (row.device_id !== DEVICE_ID) {
    // The payment already has a live invoice (it was taken after the switch-over).
    continue;
  }

  const zoi =
    row.zoi ??
    computeZoi(
      {
        taxNumber: row.tax_number,
        issuedAt: new Date(row.issued_at),
        invoiceNumber: Number(row.invoice_number),
        premiseId: row.premise_id,
        deviceId: row.device_id,
        amountCents: Number(row.amount_cents),
      },
      furs.privateKey,
    );

  await rest(`fiscal_invoices?id=eq.${row.id}`, {
    method: "PATCH",
    body: JSON.stringify({ zoi, delivered_without_eor: true }),
  });

  const messageId = crypto.randomUUID();
  const payload = buildInvoiceRequest({
    messageId,
    sentAt: new Date(),
    taxNumber: row.tax_number,
    issuedAt: new Date(row.issued_at),
    invoiceNumber: Number(row.invoice_number),
    premiseId: row.premise_id,
    deviceId: row.device_id,
    amountCents: Number(row.amount_cents),
    zoi,
    operatorTaxNumber: row.tax_number,
    subsequentSubmit: true,
    reference: reference
      ? {
          premiseId: reference.premise_id,
          deviceId: reference.device_id,
          invoiceNumber: Number(reference.invoice_number),
          issuedAt: new Date(reference.issued_at),
        }
      : null,
    specialNotes: SPECIAL_NOTES,
  });

  let exchange;
  let answer;

  try {
    exchange = await furs.send("invoice", payload);
    answer = readInvoiceAnswer(exchange.payload);
  } catch (error) {
    exchange = { requestToken: null, status: null, responseToken: null };
    answer = { ok: false, errorCode: "TRANSPORT", errorMessage: error instanceof Error ? error.message : String(error) };
  }

  await rest("fiscal_invoice_messages", {
    method: "POST",
    body: JSON.stringify({
      fiscal_invoice_id: row.id,
      message_kind: "invoice",
      message_id: messageId,
      subsequent_submit: true,
      request_token: exchange.requestToken ?? "",
      response_token: exchange.responseToken,
      response_status: exchange.status,
      error_code: answer.ok ? null : answer.errorCode,
      error_message: answer.ok ? null : answer.errorMessage,
      eor: answer.ok ? answer.eor : null,
    }),
  });

  const now = new Date().toISOString();
  await rest(`fiscal_invoices?id=eq.${row.id}`, {
    method: "PATCH",
    body: JSON.stringify(
      answer.ok
        ? { status: "confirmed", eor: answer.eor, confirmed_at: now, last_error: null, send_attempts: row.send_attempts + 1, last_attempt_at: now }
        : { last_error: `${answer.errorCode} ${answer.errorMessage}`, send_attempts: row.send_attempts + 1, last_attempt_at: now },
    ),
  });

  if (answer.ok) {
    confirmed += 1;
  } else {
    failed += 1;
    console.error(`P1-${DEVICE_ID}-${row.invoice_number}: ${answer.errorCode} ${answer.errorMessage}`);
  }
}

console.log(`\nConfirmed by FURS: ${confirmed}. Failed: ${failed}. Re-run to retry the failed ones.`);
process.exit(failed ? 1 : 0);
