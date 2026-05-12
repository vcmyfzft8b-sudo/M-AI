import { NextResponse } from "next/server";
import { z } from "zod";

const encoder = new TextEncoder();

function getContentLength(request: Request) {
  const rawValue = request.headers.get("content-length");

  if (!rawValue) {
    return null;
  }

  const contentLength = Number(rawValue);
  return Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : null;
}

function buildPayloadErrorResponse(message: string, status: 400 | 413) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export function buildValidationErrorResponse(error: z.ZodError) {
  return NextResponse.json(
    {
      error: "Neveljavni podatki v zahtevi.",
      validation: error.flatten(),
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

function getJsonContentType(request: Request) {
  return request.headers.get("content-type")?.toLowerCase() ?? "";
}

function ensureContentLengthWithinLimit(request: Request, maxBytes: number) {
  const contentLength = getContentLength(request);

  if (contentLength !== null && contentLength > maxBytes) {
    return buildPayloadErrorResponse("Payload too large.", 413);
  }

  return null;
}

export async function parseJsonRequest<TSchema extends z.ZodTypeAny>(
  request: Request,
  schema: TSchema,
  options: {
    maxBytes: number;
  },
): Promise<
  | { success: true; data: z.infer<TSchema> }
  | { success: false; response: NextResponse }
> {
  const contentType = getJsonContentType(request);

  if (contentType && !contentType.includes("application/json")) {
    return {
      success: false,
      response: buildPayloadErrorResponse("Expected a JSON request body.", 400),
    };
  }

  const tooLarge = ensureContentLengthWithinLimit(request, options.maxBytes);

  if (tooLarge) {
    return {
      success: false,
      response: tooLarge,
    };
  }

  let rawBody = "";

  try {
    rawBody = await request.text();
  } catch {
    return {
      success: false,
      response: buildPayloadErrorResponse("Malformed request body.", 400),
    };
  }

  if (encoder.encode(rawBody).length > options.maxBytes) {
    return {
      success: false,
      response: buildPayloadErrorResponse("Payload too large.", 413),
    };
  }

  if (rawBody.trim().length === 0) {
    return {
      success: false,
      response: buildPayloadErrorResponse("Request body is required.", 400),
    };
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return {
      success: false,
      response: buildPayloadErrorResponse("Malformed JSON payload.", 400),
    };
  }

  const parsed = schema.safeParse(parsedBody);

  if (!parsed.success) {
    return {
      success: false,
      response: buildValidationErrorResponse(parsed.error),
    };
  }

  return {
    success: true,
    data: parsed.data,
  };
}

function estimateFormDataSize(formData: FormData) {
  let totalBytes = 0;

  for (const [, value] of formData.entries()) {
    totalBytes += typeof value === "string" ? encoder.encode(value).length : value.size;
  }

  return totalBytes;
}

export async function parseFormDataRequest(
  request: Request,
  options: {
    maxBytes: number;
  },
): Promise<
  | { success: true; data: FormData }
  | { success: false; response: NextResponse }
> {
  const tooLarge = ensureContentLengthWithinLimit(request, options.maxBytes);

  if (tooLarge) {
    return {
      success: false,
      response: tooLarge,
    };
  }

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return {
      success: false,
      response: buildPayloadErrorResponse("Malformed form payload.", 400),
    };
  }

  if (estimateFormDataSize(formData) > options.maxBytes) {
    return {
      success: false,
      response: buildPayloadErrorResponse("Payload too large.", 413),
    };
  }

  return {
    success: true,
    data: formData,
  };
}
