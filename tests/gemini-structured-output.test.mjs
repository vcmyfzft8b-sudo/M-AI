import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  GeminiTruncatedOutputError,
  buildStructuredRetryInstruction,
  extractJsonPayload,
  isTruncatedFinishReason,
  parseStructuredText,
  resolveStructuredMaxOutputTokens,
} from "../src/lib/ai/structured-output.ts";

const noteSchema = z.object({
  title: z.string(),
  structuredNotesMd: z.string(),
});

test("truncated JSON output still fails to parse, so truncation must be caught upstream", () => {
  // Shape of the production incident (MEMOAI-WEB-1M): generation stopped at the token
  // limit in the middle of the structuredNotesMd string, leaving the string unterminated.
  const truncated = '{"title": "Predavanje", "structuredNotesMd": "## Pregled\\nSnov obsega';

  assert.throws(() => parseStructuredText(noteSchema, truncated), SyntaxError);
});

test("complete JSON parses through the extracted payload path", () => {
  const complete = '```json\n{"title": "Predavanje", "structuredNotesMd": "## Pregled"}\n```';

  assert.deepEqual(parseStructuredText(noteSchema, complete), {
    title: "Predavanje",
    structuredNotesMd: "## Pregled",
  });
});

test("extractJsonPayload keeps trailing braces inside markdown content", () => {
  const payload = '{"title": "A", "structuredNotesMd": "formula {x}"} trailing junk';

  assert.equal(extractJsonPayload(payload), '{"title": "A", "structuredNotesMd": "formula {x}"}');
});

test("MAX_TOKENS is the only finish reason treated as truncation", () => {
  assert.equal(isTruncatedFinishReason("MAX_TOKENS"), true);
  assert.equal(isTruncatedFinishReason("STOP"), false);
  assert.equal(isTruncatedFinishReason(undefined), false);
});

test("truncation retries raise the output budget faster than invalid-JSON retries", () => {
  const base = 6720; // the document final-notes budget from the incident

  assert.equal(resolveStructuredMaxOutputTokens(base, 0, null), 6720);

  const truncation = new GeminiTruncatedOutputError(base);
  assert.equal(resolveStructuredMaxOutputTokens(base, 1, truncation), 12096);
  assert.equal(resolveStructuredMaxOutputTokens(base, 2, truncation), 17472);
  assert.equal(resolveStructuredMaxOutputTokens(base, 3, truncation), 22848);

  const invalidJson = new SyntaxError("Unexpected token");
  assert.equal(resolveStructuredMaxOutputTokens(base, 1, invalidJson), 9408);
  assert.equal(resolveStructuredMaxOutputTokens(base, 2, invalidJson), 12096);

  assert.equal(resolveStructuredMaxOutputTokens(undefined, 1, truncation), undefined);
});

test("truncation retry instruction asks for a shorter response, not just valid JSON", () => {
  const instruction = buildStructuredRetryInstruction(new GeminiTruncatedOutputError(6720));

  assert.match(instruction, /cut off/i);
  assert.match(instruction, /concise/i);
  assert.doesNotMatch(instruction, /JSON was invalid/);
});

test("non-truncation errors keep the invalid-JSON retry instruction", () => {
  const instruction = buildStructuredRetryInstruction(
    new SyntaxError("Unterminated string in JSON at position 43299"),
  );

  assert.match(instruction, /JSON was invalid/);
  assert.match(instruction, /Unterminated string in JSON at position 43299/);
});

test("first attempt gets no retry instruction", () => {
  assert.equal(buildStructuredRetryInstruction(null), "");
});
