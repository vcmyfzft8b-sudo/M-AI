import assert from "node:assert/strict";
import test from "node:test";

import {
  extractChatGptSharedConversation,
  formatSharedConversationAsSource,
  isChatGptShareUrl,
} from "../src/lib/chatgpt-share.ts";

/**
 * Encodes a value the way React Router's turbo-stream does: one flat array, objects as
 * {"_<key index>": <value index>}, arrays as lists of indices. The share page streams the loader
 * data in exactly this shape; building it here keeps a real person's conversation out of the repo.
 */
function encodeTurboStream(root) {
  const flat = [];

  const put = (value) => {
    if (value === null || typeof value !== "object") {
      flat.push(value);
      return flat.length - 1;
    }

    const index = flat.length;
    flat.push(null);

    if (Array.isArray(value)) {
      flat[index] = value.map(put);
    } else {
      const encoded = {};

      for (const [key, child] of Object.entries(value)) {
        encoded[`_${put(key)}`] = put(child);
      }

      flat[index] = encoded;
    }

    return index;
  };

  put(root);
  return flat;
}

function sharePage(loaderData) {
  const payload = `${JSON.stringify(encodeTurboStream(loaderData))}\n`;

  return `<!DOCTYPE html><html><head><title>ChatGPT - Učenje biologije celic</title></head><body>
<div>Use ChatGPT to answer questions, write, create images, complete work, and code.</div>
<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(payload)});</script>
<script>window.__reactRouterContext.streamController.close();</script></body></html>`;
}

const message = (role, text) => ({ message: { author: { role }, content: { content_type: "text", parts: [text] } } });

const PAGE = sharePage({
  loaderData: {
    "routes/share.$shareId.($action)": {
      serverResponse: {
        data: {
          title: "Učenje biologije celic",
          linear_conversation: [
            message("system", ""),
            message("user", "Original custom instructions no longer available"),
            message("user", "Kaj so histoni?"),
            message("assistant", "**Histoni** so beljakovine v jedru, okoli katerih se ovija DNA."),
            message("tool", "The output of this plugin was redacted."),
            message("user", "Kaj pomeni haploidno?"),
            message("assistant", "Haploidna celica ima en komplet kromosomov (n)."),
          ],
        },
      },
    },
  },
});

test("share links are recognised on both ChatGPT hosts", () => {
  assert.equal(isChatGptShareUrl(new URL("https://chatgpt.com/share/6ab2919a-69fc-83eb")), true);
  assert.equal(isChatGptShareUrl(new URL("https://chat.openai.com/share/abc-123")), true);
  assert.equal(isChatGptShareUrl(new URL("https://chatgpt.com/c/abc")), false);
});

test("the conversation is read out of the streamed loader data, not the app shell", () => {
  const conversation = extractChatGptSharedConversation(PAGE);

  assert.ok(conversation);
  assert.equal(conversation.title, "Učenje biologije celic");
  assert.deepEqual(
    conversation.turns.map((turn) => turn.role),
    ["user", "assistant", "user", "assistant"],
    "system, tool and placeholder turns are dropped",
  );
});

test("the source reads as questions and their answers", () => {
  const source = formatSharedConversationAsSource(extractChatGptSharedConversation(PAGE));

  assert.match(source, /^# Učenje biologije celic/);
  assert.match(source, /## Kaj so histoni\?\n\n\*\*Histoni\*\* so beljakovine/);
  assert.doesNotMatch(source, /Use ChatGPT to answer questions/);
});

test("a page without the stream is not mistaken for a conversation", () => {
  assert.equal(extractChatGptSharedConversation("<html><body>Not found</body></html>"), null);
});
