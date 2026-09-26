/**
 * Reads the conversation out of a ChatGPT share page (chatgpt.com/share/<id>).
 *
 * The page is rendered in the browser, so its visible HTML holds nothing but the ChatGPT shell:
 * a learner's shared study conversation reached us as "Use ChatGPT to answer questions..." and
 * failed as having nothing to learn from (2026-09-22). The conversation itself is in the page all
 * the same, as the React Router loader data it streams in with
 * `streamController.enqueue("...")`. That payload is turbo-stream: one flat JSON array in which
 * an object is written as {"_<index of key>": <index of value>} and every value is an index into
 * the same array. Decoding it gives the `linear_conversation` the page renders from.
 *
 * Pure: no I/O, so it is unit-tested against a captured page (tests/chatgpt-share.test.mjs).
 */

export type SharedConversationTurn = { role: "user" | "assistant"; text: string };

export type SharedConversation = { title: string | null; turns: SharedConversationTurn[] };

export function isChatGptShareUrl(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");

  return (host === "chatgpt.com" || host === "chat.openai.com") && /^\/share\/[\w-]+/.test(url.pathname);
}

function readStreamPayload(html: string) {
  const chunks: string[] = [];
  const pattern = /streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g;

  for (const match of html.matchAll(pattern)) {
    try {
      chunks.push(JSON.parse(match[1]) as string);
    } catch {
      // A chunk we cannot decode is skipped; the loader data is in the first one.
    }
  }

  return chunks.join("");
}

function decodeTurboStream(flat: unknown[]) {
  const memo = new Map<number, unknown>();

  const hydrate = (index: number, depth: number): unknown => {
    if (index < 0 || index >= flat.length || depth > 200) {
      return null;
    }

    if (memo.has(index)) {
      return memo.get(index);
    }

    const value = flat[index];

    if (Array.isArray(value)) {
      const out: unknown[] = [];
      memo.set(index, out);

      for (const entry of value) {
        out.push(typeof entry === "number" ? hydrate(entry, depth + 1) : entry);
      }

      return out;
    }

    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      memo.set(index, out);

      for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
        if (!rawKey.startsWith("_")) {
          continue;
        }

        const key = flat[Number(rawKey.slice(1))];

        if (typeof key !== "string") {
          continue;
        }

        out[key] = typeof rawValue === "number" ? hydrate(rawValue, depth + 1) : rawValue;
      }

      return out;
    }

    return value;
  };

  return hydrate(0, 0);
}

function findKey(value: unknown, key: string, depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 40) {
    return undefined;
  }

  if (!Array.isArray(value) && key in value) {
    return (value as Record<string, unknown>)[key];
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findKey(child, key, depth + 1);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

/** Placeholders ChatGPT writes into a shared conversation in place of real content. */
const PLACEHOLDER_TURNS = [/^original custom instructions no longer available$/i];

export function extractChatGptSharedConversation(html: string): SharedConversation | null {
  const payload = readStreamPayload(html);
  const firstLine = payload.split("\n").find((line) => line.trim().startsWith("["));

  if (!firstLine) {
    return null;
  }

  let flat: unknown;

  try {
    flat = JSON.parse(firstLine);
  } catch {
    return null;
  }

  if (!Array.isArray(flat)) {
    return null;
  }

  const root = decodeTurboStream(flat);
  const nodes = findKey(root, "linear_conversation");

  if (!Array.isArray(nodes)) {
    return null;
  }

  const turns: SharedConversationTurn[] = [];

  for (const node of nodes) {
    const message = (node as { message?: unknown } | null)?.message as
      | { author?: { role?: unknown }; content?: { parts?: unknown } }
      | undefined;
    const role = message?.author?.role;

    if (role !== "user" && role !== "assistant") {
      continue;
    }

    const parts = Array.isArray(message?.content?.parts) ? message.content.parts : [];
    const text = parts
      .filter((part): part is string => typeof part === "string")
      .join("\n")
      .trim();

    if (!text || PLACEHOLDER_TURNS.some((pattern) => pattern.test(text))) {
      continue;
    }

    turns.push({ role, text });
  }

  if (turns.length === 0) {
    return null;
  }

  const title = findKey(root, "title");

  return { title: typeof title === "string" && title.trim() ? title.trim() : null, turns };
}

/**
 * The conversation as study material: the learner's questions as headings, the answers as the
 * body. Canvas/"writing" wrappers ChatGPT puts around a document are unwrapped to their content.
 */
export function formatSharedConversationAsSource(conversation: SharedConversation) {
  const sections = conversation.turns.map((turn) => {
    const text = turn.text
      .replace(/^:::writing\{[^}]*\}\s*/gm, "")
      .replace(/^:::\s*$/gm, "")
      .trim();

    return turn.role === "user" ? `## ${text.replace(/\s+/g, " ").slice(0, 300)}` : text;
  });

  return [conversation.title ? `# ${conversation.title}` : null, ...sections]
    .filter(Boolean)
    .join("\n\n");
}
