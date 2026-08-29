/**
 * OpenAI backend for the offline bake-offs.
 *
 * Both harnesses send the same prompts against the same zod schemas, so a model from either
 * provider can be graded by the same grader on the same fixtures. That is the only way to argue a
 * price card against measured quality rather than against a benchmark someone else ran on someone
 * else's task.
 */
import { z } from "zod";

export const isOpenAiModel = (model) => model.startsWith("gpt-");

/**
 * OpenRouter fronts every provider behind one OpenAI-shaped API, which is how a Gemini model on a
 * promotional rate gets compared against the same model bought direct. Models are named with an
 * "or/" prefix here so the harness can tell the route apart from the model.
 */
export const isOpenRouterModel = (model) => model.startsWith("or/");
export const openRouterModelId = (model) => model.slice("or/".length);

// OpenAI spends reasoning tokens out of max_output_tokens exactly as Gemini spends thinking
// tokens, so the levels map straight across and the same headroom multipliers apply.
const REASONING_EFFORT = { minimal: "minimal", low: "low", medium: "medium", high: "high" };

/**
 * GLM publishes only max/high/low, and an unmapped name silently buys its default ("max").
 * Everything maps to "low", mirroring production (model-config.ts): measured 2026-08-29,
 * low-effort GLM matched or beat high-effort on recall while writing shorter, denser notes.
 */
const GLM_REASONING_EFFORT = { minimal: "low", low: "low", medium: "low", high: "low" };

const isMandatoryReasoningModel = (model) => /glm-5/i.test(model);

/**
 * The reasoning block to put on the wire. A model that must reason is told to reason as little as
 * the stage allows; one that can abstain is told to abstain, which is what "minimal" has always
 * meant here.
 */
function reasoningBlock(model, thinkingLevel) {
  if (isMandatoryReasoningModel(model)) {
    return { reasoning: { effort: GLM_REASONING_EFFORT[thinkingLevel] ?? "low", exclude: true } };
  }

  return thinkingLevel && thinkingLevel !== "minimal"
    ? { reasoning: { effort: REASONING_EFFORT[thinkingLevel] } }
    : { reasoning: { exclude: true } };
}

// Strict structured outputs accept a subset of JSON Schema: every object must forbid extra
// properties and require every key, and the value constraints are simply rejected. Dropping them
// is what makes the schema loadable at all.
const UNSUPPORTED_SCHEMA_KEYS = [
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "multipleOf",
  "default",
  "$schema",
];

export function toStrictSchema(node) {
  if (Array.isArray(node)) {
    return node.map(toStrictSchema);
  }

  if (node === null || typeof node !== "object") {
    return node;
  }

  const output = {};

  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED_SCHEMA_KEYS.includes(key)) {
      continue;
    }

    output[key] = toStrictSchema(value);
  }

  if (output.type === "object" && output.properties) {
    output.additionalProperties = false;
    output.required = Object.keys(output.properties);
  }

  return output;
}

/**
 * Gemini enforces "at most four terms" inside the platform; OpenAI's strict mode cannot express
 * it, so the model has to obey it from the prompt and the small models do not. Clamping the answer
 * back into the schema keeps the comparison about whether a model finds the right material rather
 * than whether it can count, and the clamp count is recorded so the difference is not hidden.
 */
export function clampToSchema(value, node, stats) {
  if (!node || typeof node !== "object") {
    return value;
  }

  if (node.type === "array" && Array.isArray(value)) {
    const clamped =
      typeof node.maxItems === "number" && value.length > node.maxItems
        ? ((stats.clamped = (stats.clamped ?? 0) + 1), value.slice(0, node.maxItems))
        : value;

    return clamped.map((entry) => clampToSchema(entry, node.items, stats));
  }

  if (node.type === "object" && value && typeof value === "object") {
    const output = {};

    for (const [key, entry] of Object.entries(value)) {
      output[key] = clampToSchema(entry, node.properties?.[key], stats);
    }

    return output;
  }

  if ((node.type === "integer" || node.type === "number") && typeof value === "number") {
    const low = typeof node.minimum === "number" ? Math.max(node.minimum, value) : value;

    return typeof node.maximum === "number" ? Math.min(node.maximum, low) : low;
  }

  return value;
}

/**
 * Runs one structured-output call and folds its usage into the caller's ledger. `prices` maps a
 * model id to { input, output } dollars per million tokens; an unpriced model records zero rather
 * than guessing.
 */
export async function generateOpenRouter({
  schema,
  instructions,
  input,
  model,
  maxOutputTokens,
  thinkingLevel,
  ledger,
  prices,
  timeoutMs = 180_000,
}) {
  const responseSchema = z.toJSONSchema(schema);
  const routedModel = openRouterModelId(model);
  let prompt = input;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      signal: AbortSignal.timeout(timeoutMs),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      },
      body: JSON.stringify({
        model: routedModel,
        messages: [
          { role: "system", content: instructions },
          {
            role: "user",
            content: `${prompt}\n\nReturn exactly one JSON object matching this schema:\n${JSON.stringify(responseSchema)}`,
          },
        ],
        max_tokens: maxOutputTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "stage_output",
            strict: true,
            schema: toStrictSchema(responseSchema),
          },
        },
        ...reasoningBlock(routedModel, thinkingLevel),
      }),
    });
    const payload = await response.json();

    if (payload.error) {
      throw new Error(`${routedModel}: ${payload.error.message ?? JSON.stringify(payload.error)}`);
    }

    const price = prices[model] ?? { input: 0, output: 0 };
    const inputTokens = payload.usage?.prompt_tokens ?? 0;
    const outputTokens = payload.usage?.completion_tokens ?? 0;
    const thoughtTokens = payload.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

    ledger.calls += 1;
    ledger.inputTokens += inputTokens;
    ledger.outputTokens += outputTokens;
    ledger.thoughtTokens += thoughtTokens;
    ledger.costUsd += (inputTokens * price.input + outputTokens * price.output) / 1_000_000;

    const choice = payload.choices?.[0];
    const text = (choice?.message?.content ?? "").trim();

    if (!text || choice?.finish_reason === "length") {
      if (attempt === 2) {
        throw new Error(`${routedModel} truncated at ${maxOutputTokens} tokens`);
      }

      maxOutputTokens = Math.round(maxOutputTokens * 1.8);
      continue;
    }

    const parsed = schema.safeParse(clampToSchema(JSON.parse(text), responseSchema, ledger));

    if (!parsed.success) {
      if (attempt === 2) {
        throw new Error(`${routedModel} broke the schema: ${parsed.error.issues[0]?.message}`);
      }

      prompt = `${input}\n\nYour previous answer was rejected: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}. Obey every constraint in the schema.`;
      continue;
    }

    return { value: parsed.data, usage: { inputTokens, outputTokens, thoughtTokens } };
  }

  throw new Error(`${routedModel} never returned usable output`);
}

export async function generateOpenAi({
  schema,
  instructions,
  input,
  model,
  maxOutputTokens,
  thinkingLevel,
  ledger,
  prices,
  timeoutMs = 180_000,
}) {
  const responseSchema = z.toJSONSchema(schema);
  let prompt = input;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      signal: AbortSignal.timeout(timeoutMs),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        instructions,
        input: `${prompt}\n\nReturn exactly one JSON object matching this schema:\n${JSON.stringify(responseSchema)}`,
        max_output_tokens: maxOutputTokens,
        text: {
          format: {
            type: "json_schema",
            name: "stage_output",
            strict: true,
            schema: toStrictSchema(responseSchema),
          },
        },
        ...(thinkingLevel ? { reasoning: { effort: REASONING_EFFORT[thinkingLevel] ?? "low" } } : {}),
      }),
    });
    const payload = await response.json();

    if (payload.error) {
      throw new Error(`${model}: ${payload.error.message}`);
    }

    const price = prices[model] ?? { input: 0, output: 0 };
    const inputTokens = payload.usage?.input_tokens ?? 0;
    const outputTokens = payload.usage?.output_tokens ?? 0;
    const thoughtTokens = payload.usage?.output_tokens_details?.reasoning_tokens ?? 0;

    ledger.calls += 1;
    ledger.inputTokens += inputTokens;
    ledger.outputTokens += outputTokens;
    ledger.thoughtTokens += thoughtTokens;
    ledger.costUsd += (inputTokens * price.input + outputTokens * price.output) / 1_000_000;

    const text = (payload.output ?? [])
      .flatMap((entry) => entry.content ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!text || payload.status === "incomplete") {
      if (attempt === 2) {
        throw new Error(
          `${model} truncated at ${maxOutputTokens} tokens (${payload.incomplete_details?.reason ?? "empty"})`,
        );
      }

      maxOutputTokens = Math.round(maxOutputTokens * 1.8);
      continue;
    }

    const parsed = schema.safeParse(clampToSchema(JSON.parse(text), responseSchema, ledger));

    if (!parsed.success) {
      if (attempt === 2) {
        throw new Error(`${model} broke the schema: ${parsed.error.issues[0]?.message}`);
      }

      prompt = `${input}\n\nYour previous answer was rejected: ${parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}. Obey every constraint in the schema.`;
      continue;
    }

    return {
      value: parsed.data,
      usage: { inputTokens, outputTokens, thoughtTokens },
    };
  }

  throw new Error(`${model} never returned usable output`);
}
