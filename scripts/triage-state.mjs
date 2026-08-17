#!/usr/bin/env node
// Cursor arithmetic and the "is there anything to do?" gate.
//
// This exists so a run that finds nothing can end before the expensive steps
// start. Most runs find nothing, and on a private repository every minute of
// those runs is billed.
//
// Subcommands:
//   plan   --state F [--since-override S] [--default-hours 3] [--max-hours 24]
//            -> {since, until, source} on stdout
//   gate   --vercel F [--sentry F] [--backlog F]
//            -> {actionable, reason, ...} on stdout
//   commit --state F --until ISO --status ok|failed [--no-advance]
//            -> rewrites state.json
//
// `plan` and `commit` are the only places the cursor is computed or moved.

import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const HOUR_MS = 3_600_000
const OVERLAP_MS = 10 * 60 * 1000 // re-read the last 10 minutes so nothing falls between runs

function readJson(path, fallback) {
  if (!path) return fallback
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function parseFlags(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      i += 1
    }
  }
  return flags
}

export function resolveInstant(value, now) {
  const relative = /^(\d+)(m|h|d)$/.exec(String(value))
  if (relative) {
    const unit = { m: 60_000, h: HOUR_MS, d: 86_400_000 }[relative[2]]
    return new Date(now - Number(relative[1]) * unit)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Unparseable time: ${value}`)
  return parsed
}

// The window never starts from "three hours ago". It starts where the last
// successful scan ended, so a skipped or failed run widens the next window
// instead of dropping the errors that happened while nothing was watching.
export function planWindow(state, options = {}) {
  const now = options.now ?? Date.now()
  const defaultHours = Number(options.defaultHours ?? 3)
  const maxHours = Number(options.maxHours ?? 24)
  const until = new Date(now)

  let since
  let source

  if (options.sinceOverride) {
    since = resolveInstant(options.sinceOverride, now)
    source = 'override'
  } else if (state?.cursor) {
    since = new Date(new Date(state.cursor).getTime() - OVERLAP_MS)
    source = 'cursor'
  } else {
    since = new Date(now - defaultHours * HOUR_MS)
    source = 'default'
  }

  let truncated = false
  if (until.getTime() - since.getTime() > maxHours * HOUR_MS) {
    // Vercel's runtime log retention is shorter than a long catch-up window,
    // so asking for more than this returns nothing useful anyway.
    since = new Date(until.getTime() - maxHours * HOUR_MS)
    truncated = true
  }
  if (since.getTime() > until.getTime()) since = new Date(until.getTime() - defaultHours * HOUR_MS)

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    source,
    truncated,
    // An overridden window is an ad-hoc investigation, not scheduled coverage,
    // so it must not move the cursor.
    mayAdvanceCursor: source !== 'override',
  }
}

const HANDLED = new Set(['open-pr', 'fixed', 'wontfix'])

// Something is worth waking the expensive half of the run for if it is either
// unknown, or known but has happened again since we last looked at it.
export function isFresh(entry, lastSeen) {
  if (!entry) return true
  if (HANDLED.has(entry.status)) {
    // A handled error that recurred afterwards is a regression, which is news.
    return Boolean(lastSeen && entry.updatedAt && new Date(lastSeen) > new Date(entry.updatedAt))
  }
  // open / needs-human: only news if it has actually happened again.
  if (!entry.updatedAt || !lastSeen) return true
  return new Date(lastSeen) > new Date(entry.updatedAt)
}

export function gate({ vercel, sentry, backlog }) {
  const entries = new Map()
  for (const entry of backlog?.entries ?? []) {
    if (entry?.fingerprint) entries.set(entry.fingerprint, entry)
    for (const issueId of entry?.sentryIssues ?? []) entries.set(`sentry:${issueId}`, entry)
  }

  const freshVercel = (vercel?.groups ?? []).filter((group) =>
    isFresh(entries.get(group.fingerprint), group.lastSeen),
  )
  const freshSentry = (sentry?.issues ?? []).filter((issue) =>
    isFresh(entries.get(`sentry:${issue.id}`), issue.lastSeen),
  )

  // A scan that could not read its whole window is itself a reason to run: the
  // agent reports the gap and the cursor stays put.
  const lossy = Boolean(vercel?.lossy)
  const actionable = freshVercel.length > 0 || freshSentry.length > 0 || lossy

  let reason
  if (lossy) reason = 'the Vercel scan could not read the whole window'
  else if (actionable)
    reason = `${freshVercel.length} new or regressed Vercel group(s), ${freshSentry.length} Sentry issue(s)`
  else reason = 'nothing new since the last run'

  return {
    actionable,
    reason,
    lossy,
    vercelGroups: vercel?.groups?.length ?? 0,
    sentryIssues: sentry?.issues?.length ?? 0,
    freshVercelGroups: freshVercel.length,
    freshSentryIssues: freshSentry.length,
    freshFingerprints: freshVercel.map((group) => group.fingerprint),
  }
}

function main(argv) {
  const [subcommand, ...rest] = argv
  const flags = parseFlags(rest)

  if (subcommand === 'plan') {
    const state = readJson(flags.state, {})
    const plan = planWindow(state, {
      // An empty string arrives from an unset workflow input; treat it as absent.
      sinceOverride: typeof flags['since-override'] === 'string' ? flags['since-override'] : null,
      defaultHours: flags['default-hours'],
      maxHours: flags['max-hours'],
    })
    console.log(JSON.stringify(plan))
    return 0
  }

  if (subcommand === 'gate') {
    const decision = gate({
      vercel: readJson(flags.vercel, null),
      sentry: readJson(flags.sentry, null),
      backlog: readJson(flags.backlog, { entries: [] }),
    })
    console.log(JSON.stringify(decision))
    return 0
  }

  if (subcommand === 'commit') {
    const state = readJson(flags.state, {})
    const failed = flags.status === 'failed'
    const advance = !flags['no-advance'] && !failed

    const next = {
      ...state,
      cursor: advance ? new Date(flags.until).toISOString() : (state.cursor ?? null),
      lastRunAt: new Date().toISOString(),
      lastStatus: failed ? 'failed' : 'ok',
      consecutiveFailures: failed ? Number(state.consecutiveFailures ?? 0) + 1 : 0,
    }
    writeFileSync(flags.state, `${JSON.stringify(next, null, 2)}\n`)
    console.log(JSON.stringify({ cursorAdvanced: advance, cursor: next.cursor }))
    return 0
  }

  console.error(`Usage: triage-state.mjs <plan|gate|commit> [flags]`)
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)))
}
