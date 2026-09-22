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
//   queue  --vercel F [--sentry F] --backlog F --state F --until ISO
//            [--may-advance true|false] -> records findings for manual triage
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

function readRequiredJson(path) {
  if (!path) throw new Error('Missing required JSON file path')
  return JSON.parse(readFileSync(path, 'utf8'))
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

// Sentry's performance span detectors -- `performance_consecutive_http` and its
// siblings -- are unresolved issues in the same list as real errors, but they carry
// no exception and no stack trace: they are a measurement of how a request spent its
// time, not something that failed. Each detection also files a brand-new issue id, so
// recording one in the backlog never stops the next from gating. This triage handles
// 5xx, timeouts and uncaught exceptions, so they are set aside -- reported, never
// silently dropped. An issue from a report predating this field has no issueType and
// stays actionable.
function isPerformanceDetector(issue) {
  return typeof issue?.issueType === 'string' && issue.issueType.startsWith('performance_')
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
  // Sentry is a detection source in its own right, not just enrichment: an error
  // handled inside a route (or thrown client-side) never produces a 5xx, so it
  // exists nowhere else. Issues past the enrichment cap land in `additional` --
  // sorted by frequency, which is exactly where a brand-new low-count issue sits
  // -- so they gate too.
  const freshSentryAll = [...(sentry?.issues ?? []), ...(sentry?.additional ?? [])].filter(
    (issue) => isFresh(entries.get(`sentry:${issue.id}`), issue.lastSeen),
  )
  const freshSentry = freshSentryAll.filter((issue) => !isPerformanceDetector(issue))
  const ignoredSentry = freshSentryAll.filter(isPerformanceDetector)

  // A scan that could not read its whole window is itself a reason to run: the
  // agent reports the gap and the cursor stays put. A missing Sentry report means
  // the Sentry half of the window went unread -- the workflow holds the cursor
  // for it, but it does not wake the agent on its own.
  const lossy = Boolean(vercel?.lossy)
  const sentryMissing = !sentry
  const actionable = freshVercel.length > 0 || freshSentry.length > 0 || lossy

  let reason
  if (lossy) reason = 'the Vercel scan could not read the whole window'
  else if (actionable)
    reason = `${freshVercel.length} new or regressed Vercel group(s), ${freshSentry.length} Sentry issue(s)`
  else if (sentryMissing) reason = 'nothing new from Vercel, and the Sentry scan produced no report'
  else if (ignoredSentry.length > 0)
    reason = `nothing new since the last run (${ignoredSentry.length} Sentry performance detector(s) set aside)`
  else reason = 'nothing new since the last run'

  return {
    actionable,
    reason,
    lossy,
    sentryMissing,
    vercelGroups: vercel?.groups?.length ?? 0,
    sentryIssues: (sentry?.issues?.length ?? 0) + (sentry?.additional?.length ?? 0),
    freshVercelGroups: freshVercel.length,
    freshSentryIssues: freshSentry.length,
    freshFingerprints: freshVercel.map((group) => group.fingerprint),
    freshSentryIssueIds: freshSentry.map((issue) => issue.id),
    ignoredSentryIssueIds: ignoredSentry.map((issue) => issue.id),
  }
}

// "Did the run succeed?" and "may the cursor move?" are two different questions.
// A hand-dispatched window succeeds but must not move the cursor, and recording it
// as a failure would inflate consecutiveFailures and hide a real outage.
export function nextState(state, { until, status, noAdvance, now }) {
  const failed = status === 'failed'
  const advance = !noAdvance && !failed
  return {
    ...state,
    cursor: advance ? new Date(until).toISOString() : (state.cursor ?? null),
    lastRunAt: now,
    lastStatus: failed ? 'failed' : 'ok',
    consecutiveFailures: failed ? Number(state.consecutiveFailures ?? 0) + 1 : 0,
  }
}

// When the hosted fixer has no usable credential, the scheduled scan must still
// preserve every finding and move the cursor after a complete scan. Otherwise
// the 24-hour log retention eventually turns an authentication outage into an
// unobservable production interval. A partial scan is recorded but never
// advances the cursor.
export function queueScanOnly({ vercel, sentry, backlog, state, until, mayAdvance = true, now }) {
  const decision = gate({ vercel, sentry, backlog })
  const entries = (backlog?.entries ?? []).map((entry) => ({ ...entry }))
  const byFingerprint = new Map(entries.map((entry) => [entry.fingerprint, entry]))
  const bySentryIssue = new Map(
    entries.flatMap((entry) => (entry.sentryIssues ?? []).map((id) => [String(id), entry])),
  )
  const recordedAt = now ?? new Date().toISOString()
  const later = (left, right) =>
    !left || (right && new Date(right) > new Date(left)) ? right : left
  let queuedVercelGroups = 0
  let queuedSentryIssues = 0

  for (const group of vercel?.groups ?? []) {
    if (!decision.freshFingerprints.includes(group.fingerprint)) continue
    let entry = byFingerprint.get(group.fingerprint)
    if (!entry) {
      entry = {
        fingerprint: group.fingerprint,
        type: group.type ?? 'vercel',
        path: group.path ?? null,
        summary: `${group.type ?? 'error'} ${group.method ?? ''} ${group.path ?? ''}`.trim(),
        firstSeen: group.firstSeen ?? null,
        occurrences: group.count ?? 1,
        sentryIssues: [],
        prUrl: null,
        notes: 'Automated fixer disabled; awaiting manual triage.',
      }
      entries.push(entry)
      byFingerprint.set(entry.fingerprint, entry)
    }
    entry.status = 'needs-human'
    entry.lastSeen = later(entry.lastSeen, group.lastSeen)
    entry.updatedAt = recordedAt
    queuedVercelGroups += 1
  }

  for (const issue of [...(sentry?.issues ?? []), ...(sentry?.additional ?? [])]) {
    if (!decision.freshSentryIssueIds.includes(issue.id)) continue
    let entry = bySentryIssue.get(String(issue.id)) ?? byFingerprint.get(`sentry:${issue.id}`)
    if (!entry) {
      entry = {
        fingerprint: `sentry:${issue.id}`,
        type: 'sentry',
        path: issue.culprit ?? null,
        summary: `Sentry ${issue.shortId ?? issue.id} at ${issue.culprit ?? 'unknown route'}`,
        firstSeen: issue.firstSeen ?? null,
        occurrences: issue.count ?? 1,
        sentryIssues: [String(issue.id)],
        prUrl: null,
        notes: 'Automated fixer disabled; awaiting manual triage.',
      }
      entries.push(entry)
      byFingerprint.set(entry.fingerprint, entry)
      bySentryIssue.set(String(issue.id), entry)
    } else if (!(entry.sentryIssues ?? []).includes(String(issue.id))) {
      entry.sentryIssues = [...(entry.sentryIssues ?? []), String(issue.id)]
      bySentryIssue.set(String(issue.id), entry)
    }
    entry.status = 'needs-human'
    entry.lastSeen = later(entry.lastSeen, issue.lastSeen)
    entry.updatedAt = recordedAt
    queuedSentryIssues += 1
  }

  const complete = Boolean(vercel && !vercel.lossy && sentry)
  return {
    backlog: { ...backlog, entries },
    state: nextState(state ?? {}, {
      until,
      status: complete ? 'ok' : 'failed',
      noAdvance: !mayAdvance,
      now: recordedAt,
    }),
    complete,
    queuedVercelGroups,
    queuedSentryIssues,
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
    const next = nextState(state, {
      until: flags.until,
      status: flags.status,
      noAdvance: Boolean(flags['no-advance']),
      now: new Date().toISOString(),
    })
    writeFileSync(flags.state, `${JSON.stringify(next, null, 2)}\n`)
    console.log(
      JSON.stringify({
        cursorAdvanced: next.cursor !== (state.cursor ?? null),
        cursor: next.cursor,
        lastStatus: next.lastStatus,
      }),
    )
    return 0
  }

  if (subcommand === 'queue') {
    const result = queueScanOnly({
      vercel: readRequiredJson(flags.vercel),
      sentry: readJson(flags.sentry, null),
      backlog: readRequiredJson(flags.backlog),
      state: readRequiredJson(flags.state),
      until: flags.until,
      mayAdvance: flags['may-advance'] !== 'false',
    })
    writeFileSync(flags.backlog, `${JSON.stringify(result.backlog)}\n`)
    writeFileSync(flags.state, `${JSON.stringify(result.state, null, 2)}\n`)
    console.log(JSON.stringify({
      complete: result.complete,
      queuedVercelGroups: result.queuedVercelGroups,
      queuedSentryIssues: result.queuedSentryIssues,
      cursor: result.state.cursor,
    }))
    return 0
  }

  console.error(`Usage: triage-state.mjs <plan|gate|queue|commit> [flags]`)
  return 2
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)))
}
