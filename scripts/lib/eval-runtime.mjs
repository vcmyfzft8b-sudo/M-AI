/** Shared plumbing for the offline eval harnesses: env, one generate() call path, cost ledger. */

import fs from "node:fs";
import path from "node:path";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const PRICES = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
};

export const GRADER_MODEL = "gemini-3.5-flash-lite";

export function loadEnv(root) {
  for (const file of [".env.local", ".env"]) {
    const filePath = path.join(root, file);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      const separator = line.indexOf("=");

      if (line.startsWith("#") || separator < 0) {
        continue;
      }

      const key = line.slice(0, separator).trim();

      if (!process.env[key]) {
        process.env[key] = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
}

export const ledger = { calls: 0, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, costUsd: 0 };

let client;

function getClient() {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  return client;
}

export function countWords(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function recordUsage(model, usage) {
  const price = PRICES[model] ?? { input: 0, output: 0 };
  const inputTokens = usage?.promptTokenCount ?? 0;
  const thoughtTokens = usage?.thoughtsTokenCount ?? 0;
  const outputTokens = (usage?.candidatesTokenCount ?? 0) + thoughtTokens;

  ledger.calls += 1;
  ledger.inputTokens += inputTokens;
  ledger.outputTokens += outputTokens;
  ledger.thoughtTokens += thoughtTokens;
  ledger.costUsd += (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export async function generate({
  schema,
  instructions,
  input,
  model,
  maxOutputTokens,
  thinkingLevel,
}) {
  const responseSchema = z.toJSONSchema(schema);
  let budget = maxOutputTokens;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await getClient().models.generateContent({
      model,
      contents: `${input}\n\nReturn exactly one JSON object matching this schema:\n${JSON.stringify(responseSchema)}`,
      config: {
        systemInstruction: instructions,
        responseMimeType: "application/json",
        responseSchema,
        maxOutputTokens: budget,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    });

    recordUsage(model, response.usageMetadata);

    const text = (response.text ?? "").trim();

    if (!text || response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
      if (attempt === 2) {
        throw new Error(`${model} truncated at ${budget} tokens`);
      }

      budget = Math.round(budget * 1.8);
      continue;
    }

    try {
      return schema.parse(JSON.parse(text));
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("unreachable");
}

/** Splits plain source text into windows of roughly the requested size, on paragraph boundaries. */
export function buildWindows(source, wordsPerWindow) {
  const windows = [];
  let current = [];
  let currentWords = 0;

  for (const paragraph of source.split(/\n\n+/).filter((value) => value.trim())) {
    const words = countWords(paragraph);

    if (currentWords + words > wordsPerWindow && current.length > 0) {
      windows.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }

    current.push(paragraph);
    currentWords += words;
  }

  if (current.length > 0) {
    windows.push(current.join("\n\n"));
  }

  return windows;
}

export async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    }),
  );

  return results;
}
