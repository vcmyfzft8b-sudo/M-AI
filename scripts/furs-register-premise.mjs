/**
 * Registers the s.p.'s seat with FURS as the business premise fiscal invoices are issued from.
 * Must run once, before the first invoice (FURS answers S006 to invoices from an unregistered
 * premise), and again with a new --valid-from whenever the premise data changes.
 *
 *   node --experimental-strip-types scripts/furs-register-premise.mjs \
 *     --cadastral 2150 --building 123 --section 1 --valid-from 2026-10-26 [--send] [--echo]
 *
 * Reads FURS_ENVIRONMENT, FURS_CERT_PEM, FURS_KEY_PEM, FURS_CA_PEM and FURS_TAX_NUMBER from the
 * environment (docs/fiscal-verification.md). Without --send it only prints the request. --echo
 * first checks that the TLS connection with the certificate works.
 *
 * The cadastral municipality, building and part numbers of Zgoša 87 come from the GURS real-estate
 * register (e-prostor). If the building has no number there, FURS says to send zeros.
 */

import crypto from "node:crypto";
import https from "node:https";
import { parseArgs } from "node:util";

import {
  buildBusinessPremiseRequest,
  jwsHeader,
  openFursToken,
  readBusinessPremiseAnswer,
  rfc2253Name,
  signJws,
} from "../src/lib/fiscal/furs-protocol.ts";

const { values } = parseArgs({
  options: {
    cadastral: { type: "string" },
    building: { type: "string" },
    section: { type: "string" },
    "valid-from": { type: "string" },
    send: { type: "boolean", default: false },
    echo: { type: "boolean", default: false },
  },
});

const pem = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value.replace(/\\n/g, "\n");
};

const environment = process.env.FURS_ENVIRONMENT?.trim();
const hosts = { test: ["blagajne-test.fu.gov.si", 9002], production: ["blagajne.fu.gov.si", 9003] };

if (!hosts[environment]) throw new Error('FURS_ENVIRONMENT must be "test" or "production".');
if (!values.cadastral || !values.building || !values.section || !values["valid-from"]) {
  throw new Error("--cadastral, --building, --section and --valid-from are required.");
}

const certPem = pem("FURS_CERT_PEM");
const keyPem = pem("FURS_KEY_PEM");
const caPem = pem("FURS_CA_PEM");
const taxNumber = Number(process.env.FURS_TAX_NUMBER);
const certificate = new crypto.X509Certificate(certPem);
const [host, port] = hosts[environment];

function post(path, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      { host, port, path, method: "POST", key: keyPem, cert: certPem, ca: caPem, minVersion: "TLSv1.2",
        headers: { "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(body) },
        timeout: 15000 },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    request.on("timeout", () => request.destroy(new Error("FURS did not answer within 15 s.")));
    request.on("error", reject);
    request.end(body);
  });
}

if (values.echo) {
  const echo = await post("/v1/cash_registers/echo", JSON.stringify({ EchoRequest: "furs" }));
  console.log(`Echo (${environment}): ${echo.status} ${echo.text}`);
}

const payload = buildBusinessPremiseRequest({
  messageId: crypto.randomUUID(),
  sentAt: new Date(),
  taxNumber,
  premiseId: "P1",
  cadastralNumber: Number(values.cadastral),
  buildingNumber: Number(values.building),
  buildingSectionNumber: Number(values.section),
  street: "Zgoša",
  houseNumber: "87",
  community: "Zgoša",
  city: "Begunje na Gorenjskem",
  postalCode: "4275",
  validityDate: values["valid-from"],
  // Memo AI's invoicing is written and maintained by the s.p. itself.
  softwareSupplierTaxNumber: taxNumber,
});

console.log(JSON.stringify(payload, null, 2));

if (!values.send) {
  console.log("\nDry run. Add --send to register the premise with FURS.");
  process.exit(0);
}

const header = jwsHeader(
  process.env.FURS_CERT_SUBJECT_NAME?.trim() || rfc2253Name(certificate.subject),
  process.env.FURS_CERT_ISSUER_NAME?.trim() || rfc2253Name(certificate.issuer),
  certificate.serialNumber,
);
const token = signJws(header, payload, crypto.createPrivateKey(keyPem));
const response = await post("/v1/cash_registers/invoices/register", JSON.stringify({ token }));
const trusted = (caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map(
  (block) => new crypto.X509Certificate(block),
);
const answer = readBusinessPremiseAnswer(openFursToken(JSON.parse(response.text).token, trusted));

console.log(`\nFURS (${environment}) answered ${response.status}:`, answer);
process.exit(answer.ok ? 0 : 1);
