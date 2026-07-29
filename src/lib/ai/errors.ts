function getErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getNestedErrorDetails(error: unknown, depth = 0): { messages: string[]; codes: string[] } {
  if (!error || depth > 4) {
    return { messages: [], codes: [] };
  }

  if (typeof error === "string") {
    return { messages: [error], codes: [] };
  }

  if (typeof error !== "object") {
    return { messages: [], codes: [] };
  }

  const record = error as {
    message?: unknown;
    code?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  const details = {
    messages: typeof record.message === "string" ? [record.message] : [],
    codes: typeof record.code === "string" ? [record.code] : [],
  };
  const children = [record.cause];

  if (Array.isArray(record.errors)) {
    children.push(...record.errors);
  }

  for (const child of children) {
    const nested = getNestedErrorDetails(child, depth + 1);
    details.messages.push(...nested.messages);
    details.codes.push(...nested.codes);
  }

  return details;
}

export function isRetryableAiError(error: unknown) {
  const details = getNestedErrorDetails(error);
  const message = [getErrorText(error), ...details.messages].join(" ").toLowerCase();
  const codes = new Set(details.codes.map((code) => code.toUpperCase()));

  if (
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout")
  ) {
    return false;
  }

  return (
    message.includes("503") ||
    message.includes("429") ||
    message.includes("unavailable") ||
    message.includes("high demand") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("try again later") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable") ||
    message.includes("deadline exceeded") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("fetch failed") ||
    message.includes("network error") ||
    message.includes("terminated") ||
    codes.has("ETIMEDOUT") ||
    codes.has("ECONNRESET") ||
    codes.has("ECONNREFUSED") ||
    codes.has("EAI_AGAIN") ||
    codes.has("UND_ERR_CONNECT_TIMEOUT") ||
    codes.has("UND_ERR_SOCKET")
  );
}

export function toUserFacingAiErrorMessage(error: unknown) {
  const message = getErrorText(error).toLowerCase();

  if (
    message.includes("statement timeout") ||
    message.includes("canceling statement due to statement timeout")
  ) {
    return "The note took too long to save. Please retry this note in a minute.";
  }

  if (isRetryableAiError(error)) {
    return "The AI provider is temporarily overloaded. Please retry this note in a minute.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Unknown processing error.";
}
