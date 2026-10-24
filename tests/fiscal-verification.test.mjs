import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import QRCode from "qrcode";

import {
  amountNumber,
  buildBusinessPremiseRequest,
  buildInvoiceRequest,
  businessYear,
  computeZoi,
  formatAmount,
  fursDateTime,
  jwsHeader,
  printedDateTime,
  qrPayload,
  readBusinessPremiseAnswer,
  readInvoiceAnswer,
  rfc2253Name,
  signJws,
  zoiDateTime,
  zoiInput,
} from "../src/lib/fiscal/furs-protocol.ts";
import { renderInvoiceHtml, renderInvoiceText } from "../src/lib/fiscal/invoice-document.ts";

// FURS answered on 2026-10-06 (zadeva 0920-15932/2026) that card payments through Stripe count as
// cash, so every payment needs an invoice FURS has confirmed. These pin what FURS's technical
// specification (v3.2) fixes byte for byte, since FURS stores only the MD5 of the ZOI and would
// never notice a wrong one: a mistake here would only surface in an audit.

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

test("amounts use a dot and always two decimals, negatives included", () => {
  assert.equal(formatAmount(2000), "20.00");
  assert.equal(formatAmount(1299), "12.99");
  assert.equal(formatAmount(5), "0.05");
  assert.equal(formatAmount(-1425), "-14.25");
  assert.equal(formatAmount(-5), "-0.05");
  assert.equal(amountNumber(12999), 129.99);
  assert.throws(() => formatAmount(12.5));
});

test("times are Ljubljana local time, summer and winter", () => {
  const summer = new Date("2026-10-24T12:03:11Z");
  assert.equal(fursDateTime(summer), "2026-10-24T14:03:11");
  assert.equal(zoiDateTime(summer), "24.10.2026 14:03:11");
  assert.equal(printedDateTime(summer), "24. 10. 2026 ob 14:03");

  const winter = new Date("2026-12-31T23:30:00Z");
  assert.equal(fursDateTime(winter), "2027-01-01T00:30:00");
  assert.equal(businessYear(winter), 2027, "the business year follows Slovenian time, not UTC");
});

test("the ZOI signs tax number, time, sequence, premise, device and amount with nothing between", () => {
  const identity = {
    taxNumber: 12345678,
    issuedAt: new Date("2026-10-24T12:03:11Z"),
    invoiceNumber: 57,
    premiseId: "P1",
    deviceId: "SPLET",
    amountCents: 2000,
  };

  assert.equal(zoiInput(identity), "1234567824.10.2026 14:03:1157P1SPLET20.00");
  assert.equal(
    zoiInput({ ...identity, amountCents: -2000 }),
    "1234567824.10.2026 14:03:1157P1SPLET-20.00",
  );
});

test("the ZOI is MD5 over a PKCS#1 v1.5 SHA-256 signature, so it is reproducible", () => {
  const identity = {
    taxNumber: 12345678,
    issuedAt: new Date("2026-10-24T12:03:11Z"),
    invoiceNumber: 57,
    premiseId: "P1",
    deviceId: "SPLET",
    amountCents: 2000,
  };
  const zoi = computeZoi(identity, privateKey);

  assert.match(zoi, /^[0-9a-f]{32}$/);
  assert.equal(computeZoi(identity, privateKey), zoi, "the same invoice must always give the same ZOI");

  const signature = crypto.createSign("RSA-SHA256").update(zoiInput(identity), "utf8").sign(privateKey);
  assert.equal(crypto.createHash("md5").update(signature).digest("hex"), zoi);
  assert.notEqual(computeZoi({ ...identity, invoiceNumber: 58 }, privateKey), zoi);
});

test("the QR payload matches both official FURS test vectors", () => {
  // SPEC §11: issued 15. 8. 2015 at 10:13:32 (Slovenian summer time).
  const issuedAt = new Date("2015-08-15T10:13:32+02:00");

  assert.equal(
    qrPayload("a7e5f55e1dbb48b799268e1a6d8618a3", 12345678, issuedAt),
    "223175087923687075112234402528973166755123456781508151013321",
  );
  // A ZOI whose decimal form has 38 digits gets one leading zero.
  assert.equal(
    qrPayload("3024e56bf1ddd2e7eeb5715c6859a913", 12345678, issuedAt),
    "063994519708649896901260100447252359443123456781508151013320",
  );
});

test("the QR code is version 2 (25×25), error correction M, numeric", () => {
  const payload = qrPayload("a7e5f55e1dbb48b799268e1a6d8618a3", 12345678, new Date("2015-08-15T10:13:32+02:00"));
  const code = QRCode.create([{ data: payload, mode: "numeric" }], { version: 2, errorCorrectionLevel: "M" });

  assert.equal(code.modules.size, 25);
  assert.equal(code.segments[0].mode.id, "Numeric");
});

test("a small taxpayer's invoice carries only ExemptVATTaxableAmount, never VAT lines", () => {
  const request = buildInvoiceRequest({
    messageId: "0b5e3a6e-7f7e-4a8e-9c1e-2f7d3f1b9a11",
    sentAt: new Date("2026-10-24T12:03:12Z"),
    taxNumber: 12345678,
    issuedAt: new Date("2026-10-24T12:03:11Z"),
    invoiceNumber: 57,
    premiseId: "P1",
    deviceId: "SPLET",
    amountCents: 2000,
    zoi: "a7e5f55e1dbb48b799268e1a6d8618a3",
    operatorTaxNumber: 12345678,
    subsequentSubmit: false,
  });

  assert.deepEqual(request, {
    InvoiceRequest: {
      Header: { MessageID: "0b5e3a6e-7f7e-4a8e-9c1e-2f7d3f1b9a11", DateTime: "2026-10-24T14:03:12" },
      Invoice: {
        TaxNumber: 12345678,
        IssueDateTime: "2026-10-24T14:03:11",
        NumberingStructure: "B",
        InvoiceIdentifier: { BusinessPremiseID: "P1", ElectronicDeviceID: "SPLET", InvoiceNumber: "57" },
        InvoiceAmount: 20,
        PaymentAmount: 20,
        TaxesPerSeller: [{ ExemptVATTaxableAmount: 20 }],
        OperatorTaxNumber: 12345678,
        ProtectedID: "a7e5f55e1dbb48b799268e1a6d8618a3",
      },
    },
  });
});

test("a credit note is negative, references the original, and a late send says so", () => {
  const request = buildInvoiceRequest({
    messageId: "2378cd77-e411-4c39-999e-5625e4fceb0f",
    sentAt: new Date("2026-10-30T08:12:05Z"),
    taxNumber: 12345678,
    issuedAt: new Date("2026-10-30T08:12:04Z"),
    invoiceNumber: 63,
    premiseId: "P1",
    deviceId: "SPLET",
    amountCents: -2000,
    zoi: "3024e56bf1ddd2e7eeb5715c6859a913",
    operatorTaxNumber: 12345678,
    subsequentSubmit: true,
    reference: { premiseId: "P1", deviceId: "SPLET", invoiceNumber: 57, issuedAt: new Date("2026-10-24T12:03:11Z") },
  });
  const invoice = request.InvoiceRequest.Invoice;

  assert.equal(invoice.InvoiceAmount, -20);
  assert.deepEqual(invoice.TaxesPerSeller, [{ ExemptVATTaxableAmount: -20 }]);
  assert.equal(invoice.SubsequentSubmit, true);
  assert.deepEqual(invoice.ReferenceInvoice, [
    {
      ReferenceInvoiceIdentifier: { BusinessPremiseID: "P1", ElectronicDeviceID: "SPLET", InvoiceNumber: "57" },
      ReferenceInvoiceIssueDateTime: "2026-10-24T14:03:11",
    },
  ]);
});

test("the premise is the seat as an immovable premise, with no empty optional fields", () => {
  const request = buildBusinessPremiseRequest({
    messageId: "5f3c1a2b-9d8e-4f70-8a61-3b2c1d0e9f87",
    sentAt: new Date("2026-10-26T09:00:00Z"),
    taxNumber: 12345678,
    premiseId: "P1",
    cadastralNumber: 2150,
    buildingNumber: 123,
    buildingSectionNumber: 1,
    street: "Zgoša",
    houseNumber: "87",
    houseNumberAdditional: "",
    community: "Zgoša",
    city: "Begunje na Gorenjskem",
    postalCode: "4275",
    validityDate: "2026-10-26",
    softwareSupplierTaxNumber: 12345678,
  });
  const premise = request.BusinessPremiseRequest.BusinessPremise;

  assert.equal("HouseNumberAdditional" in premise.BPIdentifier.RealEstateBP.Address, false);
  assert.equal("ClosingTag" in premise, false);
  assert.deepEqual(premise.SoftwareSupplier, [{ TaxNumber: 12345678 }]);
});

test("the JWS header keeps a certificate serial above 2^53 exact", () => {
  // 2575988469811686647 is the serial in FURS's own sample header (SPEC §9.1).
  const header = jwsHeader("CN=TEST,C=SI", "CN=Tax CA Test,O=state-institutions,C=SI", (2575988469811686647n).toString(16));

  assert.match(header, /"serial":2575988469811686647}$/);
  assert.equal(Number.isSafeInteger(2575988469811686647), false, "a Number would have rounded it");
});

test("a signed request is a compact RS256 JWS that verifies with the certificate's key", () => {
  const header = jwsHeader("CN=TEST,C=SI", "CN=CA,C=SI", "1f");
  const token = signJws(header, { EchoRequest: "furs" }, privateKey);
  const [h, p, s] = token.split(".");

  assert.equal(Buffer.from(h, "base64url").toString("utf8"), header);
  assert.deepEqual(JSON.parse(Buffer.from(p, "base64url").toString("utf8")), { EchoRequest: "furs" });
  assert.equal(crypto.verify("sha256", Buffer.from(`${h}.${p}`, "ascii"), publicKey, Buffer.from(s, "base64url")), true);
});

test("FURS's answers: the EOR, or the error code in any case", () => {
  assert.deepEqual(
    readInvoiceAnswer({
      InvoiceResponse: {
        Header: { MessageID: "a6c84d3c-5c76-411a-9f96-93433c081a76", DateTime: "2020-06-15T15:12:41" },
        UniqueInvoiceID: "8EBAFF4A-8E9A-4714-94A0-198AEEE37404",
      },
    }),
    { ok: true, eor: "8ebaff4a-8e9a-4714-94a0-198aeee37404", messageId: "a6c84d3c-5c76-411a-9f96-93433c081a76" },
  );
  assert.deepEqual(
    readInvoiceAnswer({ InvoiceResponse: { Header: {}, Error: { ErrorCode: "s006", ErrorMessage: "Poslovni prostor ni registriran" } } }),
    { ok: false, errorCode: "S006", errorMessage: "Poslovni prostor ni registriran" },
  );
  assert.equal(readInvoiceAnswer({ InvoiceResponse: { Header: {} } }).ok, false);
  assert.deepEqual(readBusinessPremiseAnswer({ BusinessPremiseResponse: { Header: {} } }), { ok: true });
  assert.equal(readBusinessPremiseAnswer({}).ok, false);
});

test("certificate names are written most specific first, escaped once, serialNumber as its OID", () => {
  // A real certificate whose name has a comma, like the s.p.'s own ("MEMO AI, NACE VALENČIČ S.P.").
  const certificate = new crypto.X509Certificate(readFileSync(new URL("./fixtures/fiscal/test-certificate.pem", import.meta.url)));

  assert.equal(
    rfc2253Name(certificate.subject),
    "CN=MEMO AI\\, NACE VALENČIČ S.P.,2.5.4.5=#130131,OU=12345678,OU=DavPotRacTEST,O=state-institutions,C=SI",
  );
  assert.match(jwsHeader(rfc2253Name(certificate.subject), "CN=CA", certificate.serialNumber), /"serial":2575988469811686647}$/);
});

test("the Stripe webhook issues fiscal documents for payments and refunds", () => {
  const route = readFileSync(new URL("../src/app/api/stripe/webhook/route.ts", import.meta.url), "utf8");

  assert.match(route, /event\.type === "invoice\.paid"[\s\S]*issueFiscalInvoiceForStripeInvoice/);
  assert.match(route, /issueFiscalInvoiceForCheckoutSession/);
  assert.match(route, /event\.type === "charge\.refunded"[\s\S]*issueFiscalCreditNotesForCharge/);
});

test("the customer's invoice shows the number, time, operator, ZOI with its QR code, and the EOR only once FURS gave one", () => {
  const invoice = {
    kind: "invoice",
    premiseId: "P1",
    deviceId: "SPLET",
    invoiceNumber: 57,
    issuedAt: new Date("2026-10-26T08:14:03Z"),
    amountCents: 2000,
    description: "Naročnina Memo AI",
    operatorLabel: "SPLET",
    taxNumber: 52958248,
    zoi: "a7e5f55e1dbb48b799268e1a6d8618a3",
    eor: "8ebaff4a-8e9a-4714-94a0-198aeee37404",
    customerEmail: "kupec@example.com",
  };
  const html = renderInvoiceHtml(invoice, "cid:zoi-qr");

  assert.match(html, /Račun št\. P1-SPLET-57/);
  assert.match(html, /26\. 10\. 2026 ob 09:14/);
  assert.match(html, /Oznaka operaterja/);
  assert.match(html, /EOR: 8ebaff4a-8e9a-4714-94a0-198aeee37404/);
  assert.match(html, /ZOI: a7e5f55e1dbb48b799268e1a6d8618a3[\s\S]*<img src="cid:zoi-qr"/, "the code goes under the ZOI");
  assert.match(html, /Oproščeno plačila DDV po prvem odstavku 94\. člena ZDDV-1/);

  const withoutEor = renderInvoiceHtml({ ...invoice, eor: null }, "cid:zoi-qr");
  assert.doesNotMatch(withoutEor, /EOR/);
  assert.match(withoutEor, /ZOI: a7e5f55e1dbb48b799268e1a6d8618a3/);

  const credit = renderInvoiceText({
    ...invoice,
    kind: "credit_note",
    invoiceNumber: 63,
    amountCents: -2000,
    reference: { premiseId: "P1", deviceId: "SPLET", invoiceNumber: 57, issuedAt: invoice.issuedAt },
  });
  assert.match(credit, /Dobropis št\. P1-SPLET-63/);
  assert.match(credit, /K računu: P1-SPLET-57/);
  assert.match(credit, /-20,00 €/);
});
