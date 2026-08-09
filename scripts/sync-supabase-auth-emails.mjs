#!/usr/bin/env node
// Push the repository's auth email configuration to a Supabase project.
//
// Supabase stores email templates per project, so the staging branch used by
// Vercel Preview does not inherit the production templates. Without this sync
// the branch falls back to Supabase's default magic-link email and Preview
// sign-in breaks, because the app asks for a typed code that the default email
// never contains.
//
// The repository is the source of truth: subjects and OTP settings come from
// supabase/config.toml, bodies come from supabase/templates/*.html.
//
// Usage:
//   SUPABASE_ACCESS_TOKEN=... node scripts/sync-supabase-auth-emails.mjs \
//     --project-ref yviipoccwsndxyrhtcjm [--dry-run]

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const configPath = resolve(repoRoot, "supabase/config.toml");

const MANAGEMENT_API_BASE = "https://api.supabase.com";
const PRODUCTION_PROJECT_REF = "zrcwmhuwwvguiekzmcdj";

// Keys that must land for the in-app code flow to work at all.
const REQUIRED_KEYS = new Set([
  "mailer_subjects_magic_link",
  "mailer_templates_magic_link_content",
  "mailer_subjects_confirmation",
  "mailer_templates_confirmation_content",
]);

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    projectRef: process.env.SUPABASE_AUTH_CONFIG_PROJECT_REF ?? "",
    dryRun: false,
    allowProduction: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--project-ref") {
      options.projectRef = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg.startsWith("--project-ref=")) {
      options.projectRef = arg.slice("--project-ref=".length);
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--allow-production") {
      options.allowProduction = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return options;
}

// Minimal reader for the handful of scalar keys this script needs. It avoids a
// TOML dependency and only understands `key = value` lines inside `[section]`
// headers, which is all supabase/config.toml uses for these settings.
function readConfigValues(contents) {
  const values = new Map();
  let section = "";

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }

    const keyMatch = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const quoted = /^"([^"]*)"/.exec(rawValue);
    values.set(`${section}.${key}`, quoted ? quoted[1] : rawValue.trim());
  }

  return values;
}

function requireConfigValue(values, key) {
  const value = values.get(key);

  if (value === undefined || value === "") {
    fail(`supabase/config.toml is missing "${key}".`);
  }

  return value;
}

function readTemplate(contentPath) {
  // config.toml paths are written relative to the repository root.
  const templatePath = resolve(repoRoot, contentPath.replace(/^\.\//, ""));

  let contents;
  try {
    contents = readFileSync(templatePath, "utf8");
  } catch {
    fail(`Cannot read email template at ${templatePath}.`);
  }

  if (!contents.includes("{{ .Token }}")) {
    fail(
      `${templatePath} does not contain the {{ .Token }} placeholder, so the email would not carry a sign-in code.`,
    );
  }

  return contents;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildDesiredConfig() {
  let configContents;
  try {
    configContents = readFileSync(configPath, "utf8");
  } catch {
    fail(`Cannot read ${configPath}.`);
  }

  const values = readConfigValues(configContents);

  const desired = {
    mailer_subjects_magic_link: requireConfigValue(
      values,
      "auth.email.template.magic_link.subject",
    ),
    mailer_templates_magic_link_content: readTemplate(
      requireConfigValue(values, "auth.email.template.magic_link.content_path"),
    ),
    mailer_subjects_confirmation: requireConfigValue(
      values,
      "auth.email.template.confirmation.subject",
    ),
    mailer_templates_confirmation_content: readTemplate(
      requireConfigValue(values, "auth.email.template.confirmation.content_path"),
    ),
  };

  const otpLength = parsePositiveInteger(values.get("auth.email.otp_length") ?? "");
  if (otpLength !== null) {
    desired.mailer_otp_length = otpLength;
  }

  const otpExpiry = parsePositiveInteger(values.get("auth.email.otp_expiry") ?? "");
  if (otpExpiry !== null) {
    desired.mailer_otp_exp = otpExpiry;
  }

  return desired;
}

// SMTP is optional. Supabase's built-in sender only delivers to project team
// members and is heavily rate limited, so staging can use it for manual
// testing, while a real provider can be wired in by exporting these variables.
function readSmtpOverrides() {
  const overrides = {};
  const mapping = [
    ["SUPABASE_SMTP_HOST", "smtp_host", "string"],
    ["SUPABASE_SMTP_PORT", "smtp_port", "number"],
    ["SUPABASE_SMTP_USER", "smtp_user", "string"],
    ["SUPABASE_SMTP_PASS", "smtp_pass", "string"],
    ["SUPABASE_SMTP_ADMIN_EMAIL", "smtp_admin_email", "string"],
    ["SUPABASE_SMTP_SENDER_NAME", "smtp_sender_name", "string"],
  ];

  for (const [envName, apiKey, kind] of mapping) {
    const value = process.env[envName];

    if (value === undefined || value === "") {
      continue;
    }

    if (kind === "number") {
      const parsed = parsePositiveInteger(value);
      if (parsed === null) {
        fail(`${envName} must be a positive integer.`);
      }
      overrides[apiKey] = parsed;
      continue;
    }

    overrides[apiKey] = value;
  }

  const providedKeys = Object.keys(overrides);
  if (providedKeys.length > 0 && !overrides.smtp_host) {
    fail("SUPABASE_SMTP_HOST is required when any other SMTP variable is set.");
  }

  return overrides;
}

async function callManagementApi(path, { token, method = "GET", body }) {
  let response;
  try {
    response = await fetch(`${MANAGEMENT_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    fail(
      `${method} ${path} could not reach the Supabase Management API: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const text = await response.text();

  if (!response.ok) {
    fail(
      `${method} ${path} failed with ${response.status} ${response.statusText}: ${text.slice(0, 500)}`,
    );
  }

  try {
    return text === "" ? {} : JSON.parse(text);
  } catch {
    fail(`${method} ${path} returned a response that is not JSON.`);
  }
}

function describe(key, value) {
  if (typeof value === "string" && value.length > 60) {
    return `${key}: ${value.length} characters`;
  }

  if (key === "smtp_pass") {
    return `${key}: (hidden)`;
  }

  return `${key}: ${String(value)}`;
}

function matches(actual, expected) {
  if (typeof expected === "number") {
    return Number(actual) === expected;
  }

  return String(actual ?? "").trim() === String(expected).trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  if (!token) {
    fail(
      "SUPABASE_ACCESS_TOKEN is not set. Create a personal access token at https://supabase.com/dashboard/account/tokens.",
    );
  }

  if (!options.projectRef) {
    fail("Pass --project-ref <ref> (staging is yviipoccwsndxyrhtcjm).");
  }

  if (options.projectRef === PRODUCTION_PROJECT_REF && !options.allowProduction) {
    fail(
      "Refusing to write to the production project without --allow-production.",
    );
  }

  const desired = { ...buildDesiredConfig(), ...readSmtpOverrides() };
  const authConfigPath = `/v1/projects/${options.projectRef}/config/auth`;

  console.log("Configuration read from the repository:");
  for (const [key, value] of Object.entries(desired)) {
    console.log(`  - ${describe(key, value)}`);
  }

  console.log(`Reading auth config for project ${options.projectRef}...`);
  const current = await callManagementApi(authConfigPath, { token });

  const changes = Object.entries(desired).filter(
    ([key, value]) => !matches(current[key], value),
  );

  if (changes.length === 0) {
    console.log("Auth email configuration already matches the repository.");
    return;
  }

  console.log("Keys to update:");
  for (const [key, value] of changes) {
    console.log(`  - ${describe(key, value)}`);
  }

  if (options.dryRun) {
    console.log("Dry run requested, no changes were sent.");
    return;
  }

  await callManagementApi(authConfigPath, {
    token,
    method: "PATCH",
    body: Object.fromEntries(changes),
  });

  // Read the config back so a silently ignored or renamed field is reported
  // instead of being mistaken for a successful sync.
  const applied = await callManagementApi(authConfigPath, { token });
  const stillWrong = changes.filter(([key, value]) => !matches(applied[key], value));

  if (stillWrong.length === 0) {
    console.log(`Updated ${changes.length} auth setting(s) on ${options.projectRef}.`);
    return;
  }

  const fatal = stillWrong.filter(([key]) => REQUIRED_KEYS.has(key));

  for (const [key] of stillWrong) {
    const level = REQUIRED_KEYS.has(key) ? "did not apply" : "was not applied (optional)";
    console.error(`  ! ${key} ${level}.`);
  }

  if (fatal.length > 0) {
    // A field the API silently ignores is almost always a renamed key, so list
    // the mail-related names the project actually reports.
    const candidates = Object.keys(applied)
      .filter((key) => /mailer|template|smtp/i.test(key))
      .sort();

    if (candidates.length > 0) {
      console.error(`Mail-related keys reported by the project: ${candidates.join(", ")}`);
    }

    fail("Required auth email settings were not applied.");
  }

  console.log(
    `Updated the required auth email settings on ${options.projectRef}; optional settings above were ignored by the API.`,
  );
}

await main();
