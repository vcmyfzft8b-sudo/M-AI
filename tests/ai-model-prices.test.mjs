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
  const models = new Set(
    Object.entries(envDefaults)
      // Embeddings are billed per input token and never pass through the usage log.
      .filter(([key]) => key !== "GEMINI_EMBEDDING_MODEL")
      .map(([, model]) => model),
  );

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

  for (const key of ["GEMINI_TEXT_MODEL", "GEMINI_OCR_MODEL", "GEMINI_OCR_RESCUE_MODEL"]) {
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
  ["gemini-embedding-001", "embeddings never pass through the usage log"],
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
    assert.ok(price.inputUsdPerMillion > 0 && price.outputUsdPerMillion > 0, model);
  }
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
