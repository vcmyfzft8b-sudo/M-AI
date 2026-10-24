import crypto from "node:crypto";

/**
 * The FURS fiscal-verification protocol (davčno potrjevanje računov, ZDavPR), as pure functions:
 * no network, no database, no environment. Everything here is what FURS's technical specification
 * (v3.2, March 2026) fixes byte for byte, so it is tested on its own in
 * tests/fiscal-verification.test.mjs. docs/fiscal-verification.md has the sources.
 */

export type LjubljanaParts = Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;

const LJUBLJANA_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Ljubljana",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/**
 * FURS takes naive local times: the invoice shows Slovenian time, and the ZOI and the QR code
 * must sign the time the invoice shows. One instant is therefore rendered three ways below, never
 * re-read from the clock in between.
 */
export function ljubljanaParts(instant: Date): LjubljanaParts {
  const parts = Object.fromEntries(
    LJUBLJANA_FORMAT.formatToParts(instant).map((part) => [part.type, part.value]),
  );

  return parts as LjubljanaParts;
}

/** `YYYY-MM-DDTHH:MM:SS`, for `IssueDateTime` and `Header.DateTime`. */
export function fursDateTime(instant: Date) {
  const p = ljubljanaParts(instant);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

/** `dd.MM.yyyy HH:mm:ss`, the date format inside the ZOI (FURS's Java and C# reference code). */
export function zoiDateTime(instant: Date) {
  const p = ljubljanaParts(instant);
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}`;
}

/** `d. M. yyyy ob HH:mm`, as printed on the invoice. */
export function printedDateTime(instant: Date) {
  const p = ljubljanaParts(instant);
  return `${Number(p.day)}. ${Number(p.month)}. ${p.year} ob ${p.hour}:${p.minute}`;
}

/** The business year an invoice is numbered in: the Slovenian calendar year of its issue. */
export function businessYear(instant: Date) {
  return Number(ljubljanaParts(instant).year);
}

/** Cents to FURS's amount string: a dot, always two decimals (`20.00`, `-14.25`). */
export function formatAmount(cents: number) {
  if (!Number.isInteger(cents)) {
    throw new Error(`Amount must be whole cents, got ${cents}.`);
  }

  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

/** Cents as the JSON number FURS's schema wants (multipleOf 0.01). */
export function amountNumber(cents: number) {
  return Number(formatAmount(cents));
}

export type InvoiceIdentity = {
  taxNumber: number;
  issuedAt: Date;
  invoiceNumber: number;
  premiseId: string;
  deviceId: string;
  amountCents: number;
};

/**
 * What the ZOI signs: tax number, issue time, sequence number, premise, device, amount, joined
 * with nothing in between. Only the sequence part of the number goes in, not `P1-SPLET-57`.
 */
export function zoiInput(identity: InvoiceIdentity) {
  return [
    String(identity.taxNumber),
    zoiDateTime(identity.issuedAt),
    String(identity.invoiceNumber),
    identity.premiseId,
    identity.deviceId,
    formatAmount(identity.amountCents),
  ].join("");
}

/**
 * ZOI = MD5 of the SHA256withRSA (PKCS#1 v1.5) signature of `zoiInput`, in lowercase hex.
 * PKCS#1 v1.5 is deterministic, so the same invoice always gives the same ZOI and a lost one can
 * be computed again. (PSS, which one popular library uses, would give a new ZOI every time.)
 */
export function computeZoi(identity: InvoiceIdentity, privateKey: crypto.KeyObject) {
  const signature = crypto.sign("sha256", Buffer.from(zoiInput(identity), "utf8"), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });

  return crypto.createHash("md5").update(signature).digest("hex");
}

/**
 * The 60 digits encoded in the invoice's QR code: the ZOI in decimal padded to 39 digits, the tax
 * number, the issue time as `YYMMDDHHMMSS`, and a control digit (sum of the 59 digits, mod 10).
 */
export function qrPayload(zoi: string, taxNumber: number, issuedAt: Date) {
  const p = ljubljanaParts(issuedAt);
  const body =
    BigInt(`0x${zoi}`).toString(10).padStart(39, "0") +
    String(taxNumber) +
    `${p.year.slice(2)}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
  const control = [...body].reduce((sum, digit) => sum + Number(digit), 0) % 10;

  return `${body}${control}`;
}

/** `P1-SPLET-57`: how the three-part number is printed. FURS gets the parts separately. */
export function printedInvoiceNumber(premiseId: string, deviceId: string, invoiceNumber: number) {
  return `${premiseId}-${deviceId}-${invoiceNumber}`;
}

export type InvoiceRequestInput = InvoiceIdentity & {
  messageId: string;
  sentAt: Date;
  zoi: string;
  operatorTaxNumber: number;
  subsequentSubmit: boolean;
  reference?: { premiseId: string; deviceId: string; invoiceNumber: number; issuedAt: Date } | null;
  specialNotes?: string | null;
};

/**
 * The `InvoiceRequest` for a small taxpayer outside the VAT system. FURS: such a taxpayer puts the
 * whole value in `ExemptVATTaxableAmount` and leaves every VAT field out. The schema rejects unknown
 * keys (S002), so nothing optional is sent unless it is needed.
 */
export function buildInvoiceRequest(input: InvoiceRequestInput) {
  const amount = amountNumber(input.amountCents);
  const invoice: Record<string, unknown> = {
    TaxNumber: input.taxNumber,
    IssueDateTime: fursDateTime(input.issuedAt),
    NumberingStructure: "C",
    InvoiceIdentifier: {
      BusinessPremiseID: input.premiseId,
      ElectronicDeviceID: input.deviceId,
      InvoiceNumber: String(input.invoiceNumber),
    },
    InvoiceAmount: amount,
    PaymentAmount: amount,
    TaxesPerSeller: [{ ExemptVATTaxableAmount: amount }],
    OperatorTaxNumber: input.operatorTaxNumber,
    ProtectedID: input.zoi,
  };

  if (input.subsequentSubmit) {
    invoice.SubsequentSubmit = true;
  }

  if (input.reference) {
    invoice.ReferenceInvoice = [
      {
        ReferenceInvoiceIdentifier: {
          BusinessPremiseID: input.reference.premiseId,
          ElectronicDeviceID: input.reference.deviceId,
          InvoiceNumber: String(input.reference.invoiceNumber),
        },
        ReferenceInvoiceIssueDateTime: fursDateTime(input.reference.issuedAt),
      },
    ];
  }

  if (input.specialNotes) {
    invoice.SpecialNotes = input.specialNotes;
  }

  return {
    InvoiceRequest: {
      Header: { MessageID: input.messageId, DateTime: fursDateTime(input.sentAt) },
      Invoice: invoice,
    },
  };
}

export type BusinessPremiseInput = {
  messageId: string;
  sentAt: Date;
  taxNumber: number;
  premiseId: string;
  cadastralNumber: number;
  buildingNumber: number;
  buildingSectionNumber: number;
  street: string;
  houseNumber: string;
  houseNumberAdditional?: string | null;
  community: string;
  city: string;
  postalCode: string;
  validityDate: string;
  softwareSupplierTaxNumber: number;
  closing?: boolean;
};

/**
 * Registers the s.p.'s seat as an immovable premise. FURS's guidance for web sales: "Za spletno
 * prodajo je potrebno registrirati nepremični poslovni prostor na naslovu, kjer se izdajajo
 * računi", and for invoices made on a hosted server the seat counts as that address.
 */
export function buildBusinessPremiseRequest(input: BusinessPremiseInput) {
  const address: Record<string, string> = {
    Street: input.street,
    HouseNumber: input.houseNumber,
    Community: input.community,
    City: input.city,
    PostalCode: input.postalCode,
  };

  // An empty string fails the schema's minLength, so the key is left out when there is none.
  if (input.houseNumberAdditional) {
    address.HouseNumberAdditional = input.houseNumberAdditional;
  }

  const premise: Record<string, unknown> = {
    TaxNumber: input.taxNumber,
    BusinessPremiseID: input.premiseId,
    BPIdentifier: {
      RealEstateBP: {
        PropertyID: {
          CadastralNumber: input.cadastralNumber,
          BuildingNumber: input.buildingNumber,
          BuildingSectionNumber: input.buildingSectionNumber,
        },
        Address: address,
      },
    },
    ValidityDate: input.validityDate,
    SoftwareSupplier: [{ TaxNumber: input.softwareSupplierTaxNumber }],
  };

  if (input.closing) {
    premise.ClosingTag = "Z";
  }

  return {
    BusinessPremiseRequest: {
      Header: { MessageID: input.messageId, DateTime: fursDateTime(input.sentAt) },
      BusinessPremise: premise,
    },
  };
}

const base64url = (value: Buffer) => value.toString("base64url");

/**
 * The JWS header FURS wants: the certificate's subject and issuer names and its serial number as
 * a decimal JSON *number*. The serials are larger than 2^53, so the digits are written into the
 * JSON text directly; JSON.stringify of a Number would silently round them.
 */
export function jwsHeader(subjectName: string, issuerName: string, serialHex: string) {
  const serialDecimal = BigInt(`0x${serialHex}`).toString(10);

  return (
    `{"alg":"RS256","subject_name":${JSON.stringify(subjectName)},` +
    `"issuer_name":${JSON.stringify(issuerName)},"serial":${serialDecimal}}`
  );
}

/** A compact RS256 JWS over `payload`, sent to FURS as `{"token": ...}`. */
export function signJws(headerJson: string, payload: unknown, privateKey: crypto.KeyObject) {
  const signingInput = `${base64url(Buffer.from(headerJson, "utf8"))}.${base64url(
    Buffer.from(JSON.stringify(payload), "utf8"),
  )}`;
  const signature = crypto.sign("sha256", Buffer.from(signingInput, "ascii"), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PADDING,
  });

  return `${signingInput}.${base64url(signature)}`;
}

/**
 * A certificate's distinguished name in RFC 2253 form, most specific first, commas escaped:
 * what FURS's own sample header carries. FURS finds the certificate by its serial, and the
 * spec is not consistent about this string, so FURS_CERT_SUBJECT_NAME can override it.
 */
export function rfc2253Name(nodeName: string) {
  return nodeName
    .split("\n")
    .filter(Boolean)
    .reverse()
    .map((rdn) => {
      const separator = rdn.indexOf("=");
      const type = rdn.slice(0, separator);
      const value = rdn.slice(separator + 1).replace(/([,+"\\<>;])/g, "\\$1");
      return `${type}=${value}`;
    })
    .join(",");
}

export class FursResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FursResponseError";
  }
}

/**
 * Opens a signed answer from FURS. The signature is checked against the certificate FURS puts
 * in the header (`x5c`), and that certificate must be issued by one of `trustedIssuers` (SIGOV-CA):
 * the implementing rules require the client to verify FURS's signature, not just read the EOR.
 */
export function openFursToken(token: string, trustedIssuers: crypto.X509Certificate[]) {
  const [headerPart, payloadPart, signaturePart] = token.split(".");

  if (!headerPart || !payloadPart || !signaturePart) {
    throw new FursResponseError("FURS answered with a token that is not a compact JWS.");
  }

  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8")) as {
    x5c?: string[];
  };
  const leaf = header.x5c?.[0];

  if (!leaf) {
    throw new FursResponseError("FURS's answer carries no signing certificate (x5c).");
  }

  const fursCertificate = new crypto.X509Certificate(Buffer.from(leaf, "base64"));
  const signed = crypto.verify(
    "sha256",
    Buffer.from(`${headerPart}.${payloadPart}`, "ascii"),
    { key: fursCertificate.publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(signaturePart, "base64url"),
  );

  if (!signed) {
    throw new FursResponseError("FURS's answer has an invalid signature.");
  }

  const chained = trustedIssuers.some(
    (issuer) => fursCertificate.checkIssued(issuer) && fursCertificate.verify(issuer.publicKey),
  );

  if (!chained) {
    throw new FursResponseError("FURS's signing certificate is not issued by a trusted CA.");
  }

  return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as unknown;
}

export type FursInvoiceAnswer =
  | { ok: true; eor: string; messageId: string | null }
  | { ok: false; errorCode: string; errorMessage: string };

/** Reads `InvoiceResponse`: the EOR (`UniqueInvoiceID`) or FURS's error code. */
export function readInvoiceAnswer(payload: unknown): FursInvoiceAnswer {
  const response = (payload as { InvoiceResponse?: Record<string, unknown> })?.InvoiceResponse;
  const error = response?.Error as { ErrorCode?: string; ErrorMessage?: string } | undefined;

  if (error) {
    return {
      ok: false,
      errorCode: String(error.ErrorCode ?? "").toUpperCase(),
      errorMessage: String(error.ErrorMessage ?? ""),
    };
  }

  const eor = response?.UniqueInvoiceID;

  if (typeof eor !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eor)) {
    return { ok: false, errorCode: "NO_EOR", errorMessage: "FURS answered without an EOR." };
  }

  const header = response?.Header as { MessageID?: string } | undefined;
  return { ok: true, eor: eor.toLowerCase(), messageId: header?.MessageID ?? null };
}

/** Reads `BusinessPremiseResponse`: an answer without `Error` is the acknowledgement. */
export function readBusinessPremiseAnswer(payload: unknown) {
  const response = (payload as { BusinessPremiseResponse?: Record<string, unknown> })
    ?.BusinessPremiseResponse;
  const error = response?.Error as { ErrorCode?: string; ErrorMessage?: string } | undefined;

  if (!response) {
    return { ok: false as const, errorCode: "NO_RESPONSE", errorMessage: "FURS sent no premise answer." };
  }

  if (error) {
    return {
      ok: false as const,
      errorCode: String(error.ErrorCode ?? "").toUpperCase(),
      errorMessage: String(error.ErrorMessage ?? ""),
    };
  }

  return { ok: true as const };
}
