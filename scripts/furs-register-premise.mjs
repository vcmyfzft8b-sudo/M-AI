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
import { parseArgs } from "node:util";

import { buildBusinessPremiseRequest, readBusinessPremiseAnswer } from "../src/lib/fiscal/furs-protocol.ts";
import { fursScriptClient } from "./lib/furs-script-client.mjs";

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

if (!values.cadastral || !values.building || !values.section || !values["valid-from"]) {
  throw new Error("--cadastral, --building, --section and --valid-from are required.");
}

const furs = fursScriptClient();
const taxNumber = furs.taxNumber;

if (values.echo) {
  const echo = await furs.echo();
  console.log(`Echo (${furs.environment}): ${echo.status} ${echo.text}`);
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

const exchange = await furs.send("business_premise", payload);
const answer = readBusinessPremiseAnswer(exchange.payload);

console.log(`\nFURS (${furs.environment}) answered ${exchange.status}:`, answer);
process.exit(answer.ok ? 0 : 1);
