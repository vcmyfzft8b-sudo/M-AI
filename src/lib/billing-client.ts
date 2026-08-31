"use client";

import { useRouter } from "next/navigation";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

export class BillingRequiredError extends Error {
  redirectTo: string;

  constructor(message: string, redirectTo: string) {
    super(message);
    this.name = "BillingRequiredError";
    this.redirectTo = redirectTo;
  }
}

type ApiErrorPayload = {
  error?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(values: unknown) {
  if (!Array.isArray(values)) {
    return null;
  }

  const first = values.find((value): value is string =>
    typeof value === "string" && value.trim().length > 0,
  );
  return first?.trim() ?? null;
}

function firstValidationError(error: Record<string, unknown>) {
  const formError = firstString(error.formErrors);

  if (formError) {
    return formError;
  }

  if (!isRecord(error.fieldErrors)) {
    return null;
  }

  for (const value of Object.values(error.fieldErrors)) {
    const fieldError = firstString(value);

    if (fieldError) {
      return fieldError;
    }
  }

  return null;
}

export function getApiErrorMessage(payload: ApiErrorPayload | null | undefined, fallback: string) {
  const error = payload?.error;

  if (typeof error === "string" && error.trim().length > 0) {
    return error.trim();
  }

  if (Array.isArray(error)) {
    return firstString(error) ?? fallback;
  }

  if (isRecord(error)) {
    if (typeof error.message === "string" && error.message.trim().length > 0) {
      return error.message.trim();
    }

    return firstValidationError(error) ?? fallback;
  }

  return fallback;
}

/**
 * `t` is passed in because this runs in the browser but outside React. The
 * message the API sent is already in the reader's language and is preferred;
 * these two are the fallbacks for a response that carried none.
 */
export async function parseApiResponse<T>(
  response: Response,
  t: Translate<MessageKey>,
): Promise<T> {
  const clonedResponse = response.clone();
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: unknown; redirectTo?: string; code?: string })
    | null;

  if (!response.ok) {
    if (response.status === 402 && payload?.redirectTo) {
      throw new BillingRequiredError(
        getApiErrorMessage(payload, t("billing.actionNeedsPlan")),
        payload.redirectTo,
      );
    }

    const fallbackText = await clonedResponse.text().catch(() => "");
    throw new Error(
      getApiErrorMessage(
        payload,
        (fallbackText.trim().length > 0 ? fallbackText.trim().slice(0, 240) : null) ??
          t("billing.requestFailed"),
      ),
    );
  }

  return (payload ?? {}) as T;
}

export function redirectToBillingIfNeeded(params: {
  error: unknown;
  router: ReturnType<typeof useRouter>;
}) {
  if (params.error instanceof BillingRequiredError) {
    params.router.push(params.error.redirectTo);
    return true;
  }

  return false;
}
