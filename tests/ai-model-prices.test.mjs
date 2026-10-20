import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AI_STAGES,
  resolveStageFallbackModel,
  resolveStageModelConfig,
} from "../src/lib/ai/model-config.ts";
import { getModelPrice, MODEL_PRICES } from "../src/lib/ai/model-prices.ts";

/*
 * A model with no price logs every call at no cost, and nothing complains: in September 2026 that
 * was 17,159 routed gemini-3.5-flash-lite calls (language check, tutor turns, source language),
 * about $25 the daily cost report never saw. These tests make the gap a failing build instead of a
 * month-end reconciliation.
 */

const root = path.resolve(import.meta.dirname, "..");
const serverEnvSource = readFileSync(path.join(root, "src/lib/server-env.ts"), "utf8");

/** The GEMINI_*_MODEL defaults, read from the schema (server-env.ts is server-only). */
function serverEnvModelDefaults() {
  return Object.fromEntries(
    [...serverEnvSource.matchAll(/(GEMINI_[A-Z_]+_MODEL): trimmedString\.default\("([^"]+)"\)/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
}

/** "or/google/gemini-3.7-flash" -> "gemini-3.7-flash", as json.ts's direct fallback tier does. */
function directModelId(model) {
  return model.replace(/^or\//, "").replace(/^[a-z0-9-]+\//i, "");
}

/**
 * Every model the text pipeline can call with no env override: each stage's primary, its named
 * fallback, and the direct-Gemini tier under both (json.ts). A routed non-Gemini primary falls back
 * to the stage fallback or GEMINI_TEXT_MODEL, never to its own bare id.
 */
function modelsTheCodeCalls() {
  const envDefaults = serverEnvModelDefaults();
  // Embeddings included: they are logged since 2026-10-20 (embeddings.ts).
  const models = new Set(Object.values(envDefaults));

  for (const stage of AI_STAGES) {
    const { model } = resolveStageModelConfig({
      stage,
      env: {},
      fallbackModel: envDefaults.GEMINI_TEXT_MODEL,
    });
    const fallback = resolveStageFallbackModel(stage);

    for (const candidate of [model, fallback]) {
      if (!candidate) {
        continue;
      }

      models.add(candidate);

      if (candidate.startsWith("or/") && /gemini/i.test(candidate)) {
        models.add(directModelId(candidate));
      }
    }
  }

  // A routed non-Gemini stage with no fallback of its own buys GEMINI_TEXT_MODEL through the
  // gateway first (json.ts), then direct.
  models.add(`or/google/${envDefaults.GEMINI_TEXT_MODEL}`);

  return [...models].sort();
}

test("the env defaults are found, so the sweep below is not vacuously green", () => {
  const defaults = serverEnvModelDefaults();

  for (const key of ["GEMINI_TEXT_MODEL", "GEMINI_OCR_LITE_MODEL", "GEMINI_OCR_STRONG_MODEL"]) {
    assert.ok(defaults[key], `${key} default not found in server-env.ts`);
  }

  assert.ok(modelsTheCodeCalls().some((model) => model.startsWith("or/")));
});

test("every model the code calls has a price", () => {
  const unpriced = modelsTheCodeCalls().filter((model) => !getModelPrice(model));

  assert.deepEqual(
    unpriced,
    [],
    `Add these to MODEL_PRICES in src/lib/ai/model-prices.ts (read the live rate from ` +
      `https://openrouter.ai/api/v1/models for "or/" ids): ${unpriced.join(", ")}`,
  );
});

/**
 * Model ids written as string literals anywhere under src/, so a new constant or a hardcoded call
 * outside model-config.ts cannot slip past the sweep above.
 */
const LITERAL_MODEL_ID =
  /["'`]((?:or\/[a-z0-9-]+\/[a-z0-9][a-z0-9.:-]*)|(?:models\/)?(?:gemini|glm)-\d[a-z0-9.-]*)["'`]/gi;

/** Literals that are not calls the usage log prices, each with the reason. */
const UNPRICED_LITERALS = new Map([
  ["glm-5.3-flash", "named in json.ts as the bare id that must never be sent to the Gemini API"],
]);

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

test("every model id written in the source has a price", () => {
  const unpriced = new Set();

  for (const file of sourceFiles(path.join(root, "src"))) {
    for (const match of readFileSync(file, "utf8").matchAll(LITERAL_MODEL_ID)) {
      const model = match[1].toLowerCase();

      if (!UNPRICED_LITERALS.has(model) && !getModelPrice(model)) {
        unpriced.add(`${model} (${path.relative(root, file)})`);
      }
    }
  }

  assert.deepEqual([...unpriced], []);
});

test("routed prices are the gateway's, and the 2026-10-02 corrections hold", () => {
  // GLM doubled and the 3.7-flash promotion ended; both were logged at the old rates for weeks.
  assert.deepEqual(getModelPrice("or/z-ai/glm-5.3-flash"), {
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0.5,
  });
  assert.deepEqual(getModelPrice("or/google/gemini-3.7-flash"), getModelPrice("gemini-3.7-flash"));
  assert.ok(getModelPrice("or/google/gemini-3.5-flash-lite"));
  // The SDK sometimes reports a model as "models/<id>".
  assert.deepEqual(getModelPrice("models/gemini-2.5-flash-lite"), MODEL_PRICES["gemini-2.5-flash-lite"]);

  for (const [model, price] of Object.entries(MODEL_PRICES)) {
    assert.equal(model, model.toLowerCase(), `${model} must be lower-case to be found`);
    assert.ok(price.inputUsdPerMillion > 0, model);
    // An embedding produces vectors, not tokens; everything else bills its output.
    assert.ok(model.includes("embedding") || price.outputUsdPerMillion > 0, model);
  }
});

test("direct Gemini rates match Google's pricing page as read on 2026-10-20", () => {
  // The day the €100 spending cap was reached while this log said $62. Every rate matched the
  // page (https://ai.google.dev/gemini-api/docs/pricing, paid tier, standard), so the gap was
  // unlogged calls and other users of the key, not prices. Re-read the page before changing one.
  const page = {
    "gemini-3.8-flash-tts": [0.5, 9],
    "gemini-3-flash-preview": [0.5, 3],
    "gemini-3.5-flash-lite": [0.3, 2.5],
    "gemini-3.1-flash-lite": [0.25, 1.5],
    "gemini-2.5-flash-lite": [0.1, 0.4],
    "gemini-3.6-flash": [0.75, 3.75],
  };

  const readOn = new Date("2026-10-20T12:00:00Z");

  for (const [model, [input, output]] of Object.entries(page)) {
    assert.deepEqual(
      getModelPrice(model, readOn),
      { inputUsdPerMillion: input, outputUsdPerMillion: output },
      model,
    );
  }

});

test("the announced 2027-01-01 doubling applies on its own from that date", () => {
  const before = new Date("2026-12-31T23:59:59Z");
  const after = new Date("2027-01-01T00:00:00Z");

  assert.deepEqual(getModelPrice("gemini-3.8-flash-tts", before), {
    inputUsdPerMillion: 0.5,
    outputUsdPerMillion: 9,
  });
  assert.deepEqual(getModelPrice("gemini-3.8-flash-tts", after), {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 18,
  });
  assert.deepEqual(getModelPrice("models/gemini-3.6-flash", after), {
    inputUsdPerMillion: 1.5,
    outputUsdPerMillion: 7.5,
  });
  // A model with no announced change keeps its rate.
  assert.deepEqual(getModelPrice("gemini-2.5-flash-lite", after), MODEL_PRICES["gemini-2.5-flash-lite"]);
});

test("embeddings are logged and priced, so they count toward the Gemini spending cap", () => {
  assert.deepEqual(getModelPrice("gemini-embedding-001"), {
    inputUsdPerMillion: 0.15,
    outputUsdPerMillion: 0,
  });

  const source = readFileSync(path.join(root, "src/lib/ai/embeddings.ts"), "utf8");
  assert.match(source, /logGeminiUsageEvent\(/);
  assert.match(source, /stage: "embedding"/);
  assert.match(source, /promptTokenCount: Math\.ceil\(chars \/ EMBEDDING_CHARS_PER_TOKEN\)/);
});

test("every routed call logs what the gateway billed, not our estimate of it", () => {
  // OpenRouter returns usage.cost on every response and stream end; the price table is then only
  // a fallback, so a stale or missing rate cannot under-report a routed call again.
  const source = readFileSync(path.join(root, "src/lib/ai/openrouter.ts"), "utf8");
  const logCalls = source.split("await logGeminiUsageEvent({").slice(1);

  assert.ok(logCalls.length >= 4);

  for (const call of logCalls) {
    const body = call.slice(0, call.indexOf("});"));
    assert.match(body, /billedCostUsd: [\w?.]*usage\?\.cost/);
  }

  const logger = readFileSync(path.join(root, "src/lib/ai/usage-logging.ts"), "utf8");
  assert.match(logger, /billedCostUsd \?\? estimateGeminiCostUsd\(/);
});
