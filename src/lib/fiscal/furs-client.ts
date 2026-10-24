import "server-only";

import crypto from "node:crypto";
import https from "node:https";

import { jwsHeader, openFursToken, rfc2253Name, signJws } from "@/lib/fiscal/furs-protocol";

/**
 * Talks to FURS: two-way TLS with the purpose-issued certificate (namensko digitalno potrdilo,
 * "DavPotRac"), RS256-signed requests, signed answers checked against SIGOV-CA.
 *
 * Configuration (docs/fiscal-verification.md has how to get each value):
 *   FURS_ENABLED            "true" to issue fiscal invoices at all. Off by default: numbering must
 *                           not start before the premise is registered and the internal act exists.
 *   FURS_ENVIRONMENT        "test" (blagajne-test.fu.gov.si:9002) or "production" (…:9003).
 *   FURS_CERT_PEM           the certificate, PEM (converted once from the .p12 with openssl).
 *   FURS_KEY_PEM            its private key, PEM, unencrypted.
 *   FURS_CA_PEM             SIGOV-CA and the SI-TRUST root, PEM: trusted for FURS's TLS
 *                           certificate and for the certificate that signs its answers.
 *   FURS_TAX_NUMBER         the s.p.'s tax number (on test: the one in the test certificate).
 *   FURS_CERT_SUBJECT_NAME  optional override of the JWS subject_name (see rfc2253Name).
 *   FURS_CERT_ISSUER_NAME   optional override of the JWS issuer_name.
 */

const HOSTS = {
  test: { host: "blagajne-test.fu.gov.si", port: 9002 },
  production: { host: "blagajne.fu.gov.si", port: 9003 },
} as const;

export type FursCredentials = {
  environment: keyof typeof HOSTS;
  taxNumber: number;
  privateKey: crypto.KeyObject;
  keyPem: string;
  certPem: string;
  caPem: string;
  trustedIssuers: crypto.X509Certificate[];
  headerJson: string;
};

/** PEM values pasted into Vercel often arrive with literal `\n`; real newlines are restored. */
function pemFromEnv(name: string) {
  const value = process.env[name]?.trim();
  return value ? value.replace(/\\n/g, "\n") : null;
}

function splitPemCertificates(pem: string) {
  return pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
}

let cached: FursCredentials | null | undefined;

/** The credentials, or null when fiscal verification is not switched on and fully configured. */
export function getFursCredentials(): FursCredentials | null {
  if (cached !== undefined) {
    return cached;
  }

  const enabled = process.env.FURS_ENABLED?.trim() === "true";
  const environment = process.env.FURS_ENVIRONMENT?.trim();
  const certPem = pemFromEnv("FURS_CERT_PEM");
  const keyPem = pemFromEnv("FURS_KEY_PEM");
  const caPem = pemFromEnv("FURS_CA_PEM");
  const taxNumber = Number(process.env.FURS_TAX_NUMBER?.trim());

  if (
    !enabled ||
    (environment !== "test" && environment !== "production") ||
    !certPem ||
    !keyPem ||
    !caPem ||
    !Number.isInteger(taxNumber) ||
    taxNumber < 10000000 ||
    taxNumber > 99999999
  ) {
    cached = null;
    return cached;
  }

  const certificate = new crypto.X509Certificate(certPem);
  const subjectName = process.env.FURS_CERT_SUBJECT_NAME?.trim() || rfc2253Name(certificate.subject);
  const issuerName = process.env.FURS_CERT_ISSUER_NAME?.trim() || rfc2253Name(certificate.issuer);

  cached = {
    environment,
    taxNumber,
    privateKey: crypto.createPrivateKey(keyPem),
    keyPem,
    certPem,
    caPem,
    trustedIssuers: splitPemCertificates(caPem).map((pem) => new crypto.X509Certificate(pem)),
    headerJson: jwsHeader(subjectName, issuerName, certificate.serialNumber),
  };

  return cached;
}

export type FursExchange = {
  requestToken: string;
  status: number | null;
  responseToken: string | null;
  payload: unknown;
  transportError: string | null;
};

const TIMEOUT_MS = 8000;

function post(credentials: FursCredentials, path: string, body: string) {
  const { host, port } = HOSTS[credentials.environment];

  // node:https rather than fetch: fetch (undici) ignores https.Agent and so cannot present the
  // client certificate.
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const request = https.request(
      {
        host,
        port,
        path,
        method: "POST",
        key: credentials.keyPem,
        cert: credentials.certPem,
        ca: credentials.caPem,
        minVersion: "TLSv1.2",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );

    request.on("timeout", () => request.destroy(new Error(`FURS did not answer within ${TIMEOUT_MS} ms.`)));
    request.on("error", reject);
    request.end(body);
  });
}

/**
 * Signs `payload`, sends it, and opens FURS's signed answer. Never throws: a network failure or an
 * unreadable answer comes back as `transportError`, because the caller must still issue the
 * invoice (without an EOR) and send it again later.
 */
export async function sendToFurs(
  credentials: FursCredentials,
  kind: "invoice" | "business_premise",
  payload: unknown,
): Promise<FursExchange> {
  const requestToken = signJws(credentials.headerJson, payload, credentials.privateKey);
  const path =
    kind === "invoice" ? "/v1/cash_registers/invoices" : "/v1/cash_registers/invoices/register";

  try {
    const response = await post(credentials, path, JSON.stringify({ token: requestToken }));
    const parsed = JSON.parse(response.text) as { token?: string };

    if (typeof parsed.token !== "string") {
      return {
        requestToken,
        status: response.status,
        responseToken: null,
        payload: null,
        transportError: `FURS answered ${response.status} without a token.`,
      };
    }

    return {
      requestToken,
      status: response.status,
      responseToken: parsed.token,
      payload: openFursToken(parsed.token, credentials.trustedIssuers),
      transportError: null,
    };
  } catch (error) {
    return {
      requestToken,
      status: null,
      responseToken: null,
      payload: null,
      transportError: error instanceof Error ? error.message : String(error),
    };
  }
}
