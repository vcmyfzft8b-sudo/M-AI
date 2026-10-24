/**
 * The FURS connection for one-off scripts (premise registration, back-filing), which run outside
 * Next and so cannot use src/lib/fiscal/furs-client.ts. Same environment variables, same rules:
 * two-way TLS with the certificate, RS256 requests, FURS's answers checked against FURS_CA_PEM.
 */

import crypto from "node:crypto";
import https from "node:https";

import { jwsHeader, openFursToken, rfc2253Name, signJws } from "../../src/lib/fiscal/furs-protocol.ts";

const HOSTS = { test: ["blagajne-test.fu.gov.si", 9002], production: ["blagajne.fu.gov.si", 9003] };

const pem = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value.replace(/\\n/g, "\n");
};

export function fursScriptClient() {
  const environment = process.env.FURS_ENVIRONMENT?.trim();

  if (!HOSTS[environment]) throw new Error('FURS_ENVIRONMENT must be "test" or "production".');

  const certPem = pem("FURS_CERT_PEM");
  const keyPem = pem("FURS_KEY_PEM");
  const caPem = pem("FURS_CA_PEM");
  const taxNumber = Number(process.env.FURS_TAX_NUMBER);
  const certificate = new crypto.X509Certificate(certPem);
  const privateKey = crypto.createPrivateKey(keyPem);
  const trusted = (caPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map(
    (block) => new crypto.X509Certificate(block),
  );
  const header = jwsHeader(
    process.env.FURS_CERT_SUBJECT_NAME?.trim() || rfc2253Name(certificate.subject),
    process.env.FURS_CERT_ISSUER_NAME?.trim() || rfc2253Name(certificate.issuer),
    certificate.serialNumber,
  );
  const [host, port] = HOSTS[environment];

  if (!Number.isInteger(taxNumber)) throw new Error("FURS_TAX_NUMBER is not set.");

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

  return {
    environment,
    taxNumber,
    privateKey,
    echo: () => post("/v1/cash_registers/echo", JSON.stringify({ EchoRequest: "furs" })),
    /** Signs and sends; returns the request token, the raw answer and FURS's opened payload. */
    async send(kind, payload) {
      const requestToken = signJws(header, payload, privateKey);
      const path = kind === "invoice" ? "/v1/cash_registers/invoices" : "/v1/cash_registers/invoices/register";
      const response = await post(path, JSON.stringify({ token: requestToken }));
      const responseToken = JSON.parse(response.text).token;
      return { requestToken, status: response.status, responseToken, payload: openFursToken(responseToken, trusted) };
    },
  };
}
