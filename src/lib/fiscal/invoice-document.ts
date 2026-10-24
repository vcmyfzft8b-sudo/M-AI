import QRCode from "qrcode";

import {
  formatAmount,
  printedDateTime,
  printedInvoiceNumber,
  qrPayload,
} from "./furs-protocol.ts";

/**
 * The fiscal invoice as the customer receives it. It is a legal document of a Slovenian s.p., so
 * it is written in Slovenian whatever language the app is in, like the Stripe invoice footer.
 * ZDavPR adds to the VAT-law minimum: the time of issue, the operator label, the three-part number,
 * `EOR`, and `ZOI` both as text and as a QR code printed under it.
 */

export const SELLER = {
  name: "Memo AI, Nace Valenčič s.p., poslovno svetovanje",
  address: "Zgoša 87, 4275 Begunje na Gorenjskem, Slovenija",
  registration: "Matična številka: 7578474000 · Davčna številka: 52958248",
  // The wording FURS recommends for a small taxpayer outside the VAT system.
  vatClause: "Oproščeno plačila DDV po prvem odstavku 94. člena ZDDV-1.",
} as const;

export type InvoiceDocumentInput = {
  kind: "invoice" | "credit_note";
  premiseId: string;
  deviceId: string;
  invoiceNumber: number;
  issuedAt: Date;
  amountCents: number;
  description: string;
  operatorLabel: string;
  taxNumber: number;
  zoi: string;
  /** Null when the invoice goes out before FURS confirmed it; it is never added afterwards. */
  eor: string | null;
  customerEmail: string | null;
  reference?: { premiseId: string; deviceId: string; invoiceNumber: number; issuedAt: Date } | null;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const euros = (cents: number) => `${formatAmount(cents).replace(".", ",")} €`;

/**
 * The QR code FURS prescribes: the 60-digit payload in numeric mode, version 2 (25×25 modules),
 * error correction M, a quiet zone of 4 modules. Rendered as a PNG large enough that the printed
 * symbol is at least 12 mm wide.
 */
export async function invoiceQrPng(zoi: string, taxNumber: number, issuedAt: Date) {
  return QRCode.toBuffer([{ data: qrPayload(zoi, taxNumber, issuedAt), mode: "numeric" }], {
    version: 2,
    errorCorrectionLevel: "M",
    margin: 4,
    scale: 8,
    type: "png",
  });
}

export function invoiceTitle(input: Pick<InvoiceDocumentInput, "kind" | "premiseId" | "deviceId" | "invoiceNumber">) {
  const number = printedInvoiceNumber(input.premiseId, input.deviceId, input.invoiceNumber);
  return input.kind === "credit_note" ? `Dobropis št. ${number}` : `Račun št. ${number}`;
}

/** The invoice as HTML. `qrSrc` is where the QR image lives: a `cid:` in email, a data URL elsewhere. */
export function renderInvoiceHtml(input: InvoiceDocumentInput, qrSrc: string) {
  const title = invoiceTitle(input);
  const rows: Array<[string, string]> = [
    ["Datum in čas izdaje", printedDateTime(input.issuedAt)],
    ["Kraj izdaje", "Begunje na Gorenjskem"],
    ["Oznaka operaterja", input.operatorLabel],
  ];

  if (input.reference) {
    rows.push([
      "K računu",
      `${printedInvoiceNumber(input.reference.premiseId, input.reference.deviceId, input.reference.invoiceNumber)} z dne ${printedDateTime(input.reference.issuedAt)}`,
    ]);
  }

  if (input.customerEmail) {
    rows.push(["Kupec", input.customerEmail]);
  }

  const paidNote =
    input.kind === "credit_note"
      ? "Znesek je bil vrnjen na plačilno kartico."
      : "Plačano s plačilno kartico (Stripe).";

  return `<!doctype html>
<html lang="sl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5">
<div style="max-width:560px;margin:0 auto">
<p style="margin:0 0 16px"><strong>${escapeHtml(SELLER.name)}</strong><br>${escapeHtml(SELLER.address)}<br>${escapeHtml(SELLER.registration)}</p>
<h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>
<table style="border-collapse:collapse;width:100%;margin:0 0 16px">
${rows.map(([label, value]) => `<tr><td style="padding:2px 12px 2px 0;color:#555555;white-space:nowrap">${escapeHtml(label)}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`).join("\n")}
</table>
<table style="border-collapse:collapse;width:100%;margin:0 0 8px">
<tr><th style="text-align:left;border-bottom:1px solid #cccccc;padding:4px 0">Storitev</th><th style="text-align:right;border-bottom:1px solid #cccccc;padding:4px 0">Znesek</th></tr>
<tr><td style="padding:6px 0">${escapeHtml(input.description)}</td><td style="text-align:right;padding:6px 0">${euros(input.amountCents)}</td></tr>
<tr><td style="padding:6px 0;border-top:1px solid #cccccc"><strong>Skupaj</strong></td><td style="text-align:right;padding:6px 0;border-top:1px solid #cccccc"><strong>${euros(input.amountCents)}</strong></td></tr>
</table>
<p style="margin:0 0 4px">${escapeHtml(paidNote)}</p>
<p style="margin:0 0 16px">${escapeHtml(SELLER.vatClause)}</p>
${input.eor ? `<p style="margin:0;font-family:Menlo,monospace;font-size:12px">EOR: ${escapeHtml(input.eor)}</p>` : ""}
<p style="margin:0 0 8px;font-family:Menlo,monospace;font-size:12px">ZOI: ${escapeHtml(input.zoi)}</p>
<img src="${escapeHtml(qrSrc)}" alt="QR koda ZOI" width="200" height="200" style="display:block;width:200px;height:200px">
</div>
</body></html>`;
}

/** Plain-text twin of the HTML, for mail clients that show text only. */
export function renderInvoiceText(input: InvoiceDocumentInput) {
  const lines = [
    SELLER.name,
    SELLER.address,
    SELLER.registration,
    "",
    invoiceTitle(input),
    `Datum in čas izdaje: ${printedDateTime(input.issuedAt)}`,
    "Kraj izdaje: Begunje na Gorenjskem",
    `Oznaka operaterja: ${input.operatorLabel}`,
  ];

  if (input.reference) {
    lines.push(
      `K računu: ${printedInvoiceNumber(input.reference.premiseId, input.reference.deviceId, input.reference.invoiceNumber)} z dne ${printedDateTime(input.reference.issuedAt)}`,
    );
  }

  lines.push(
    "",
    `${input.description}: ${euros(input.amountCents)}`,
    `Skupaj: ${euros(input.amountCents)}`,
    input.kind === "credit_note" ? "Znesek je bil vrnjen na plačilno kartico." : "Plačano s plačilno kartico (Stripe).",
    SELLER.vatClause,
    "",
  );

  if (input.eor) {
    lines.push(`EOR: ${input.eor}`);
  }

  lines.push(`ZOI: ${input.zoi}`);
  return lines.join("\n");
}
