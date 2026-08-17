#!/usr/bin/env node
// Scan Vercel production runtime logs for actionable errors.
//
// Actionable = HTTP 5xx, function timeouts, and uncaught runtime exceptions.
// 4xx and warning-level noise are deliberately ignored.
//
// Usage:
//   node scripts/vercel-error-scan.mjs --since 2026-08-17T09:00:00Z [--until ISO]
//   node scripts/vercel-error-scan.mjs --since 3h --out report.json --raw raw.jsonl
//
// Env:
//   VERCEL_TOKEN       required, access token for the team that owns the project
//   VERCEL_ORG_ID      required, team id (team_...)
//   VERCEL_PROJECT_ID  required, project id (prj_...)
//   VERCEL_CLI_VERSION optional, defaults to the pinned version below
//
// The Vercel CLI returns the same log record many times over, so every record is
// deduplicated on its `id` before anything is counted. Counts without that step
// come out roughly 20x too high.

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PINNED_CLI = process.env.VERCEL_CLI_VERSION || '50.35.0'
const MAX_WINDOW_MS = 60 * 60 * 1000 // the CLI truncates long windows; walk in <=1h chunks
const PAGE_LIMIT = 1000
const MIN_CHUNK_MS = 5 * 60 * 1000 // stop subdividing a saturated window below 5 minutes

function parseArgs(argv) {
  const args = { since: '3h', until: null, out: null, raw: null, maxHours: 24 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--since') args.since = next()
    else if (arg === '--until') args.until = next()
    else if (arg === '--out') args.out = next()
    else if (arg === '--raw') args.raw = next()
    else if (arg === '--max-hours') args.maxHours = Number(next())
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

export function resolveInstant(value, fallback) {
  if (!value) return fallback
  const relative = /^(\d+)(m|h|d)$/.exec(value)
  if (relative) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2]]
    return new Date(Date.now() - Number(relative[1]) * unit)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) throw new Error(`Unparseable time: ${value}`)
  return parsed
}

// A full day's scan is ~48 CLI invocations. Resolving the package through npx
// every time dominates the runtime, so prefer an already-installed binary at the
// pinned version and fall back to npx only when there isn't one.
let cachedLauncher = null
function resolveLauncher() {
  if (cachedLauncher) return cachedLauncher
  const probe = spawnSync('vercel', ['--version'], { encoding: 'utf8' })
  if (probe.status === 0 && (probe.stdout || '').trim().endsWith(PINNED_CLI)) {
    cachedLauncher = { command: 'vercel', prefix: [] }
  } else {
    cachedLauncher = { command: 'npx', prefix: ['--yes', `vercel@${PINNED_CLI}`] }
  }
  return cachedLauncher
}

// `vercel logs` defaults to filtering by the current git branch, which silently
// returns nothing from a worktree or a detached CI checkout -- hence --no-branch.
function runVercelLogs({ since, until, extra }) {
  const launcher = resolveLauncher()
  const argv = [
    'logs',
    '--json',
    '--no-follow',
    '--no-branch',
    '--environment',
    'production',
    '--since',
    since.toISOString(),
    '--until',
    until.toISOString(),
    '--limit',
    String(PAGE_LIMIT),
    ...extra,
  ]
  const result = spawnSync(launcher.command, [...launcher.prefix, ...argv], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      VERCEL_TOKEN: process.env.VERCEL_TOKEN,
      VERCEL_ORG_ID: process.env.VERCEL_ORG_ID,
      VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
    },
  })
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim()
    throw new Error(`vercel logs exited ${result.status}: ${stderr.slice(0, 2000)}`)
  }
  const records = []
  const rawLines = []
  for (const line of (result.stdout || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('{')) continue
    rawLines.push(trimmed)
    try {
      records.push(JSON.parse(trimmed))
    } catch {
      // A partially flushed line is not worth failing the whole scan over.
    }
  }
  return { records, rawLines }
}

// The CLI's JSON shape has moved around between versions, so read every field
// through a list of plausible keys rather than one hardcoded path.
export function pick(record, paths) {
  for (const path of paths) {
    let value = record
    for (const key of path.split('.')) {
      if (value == null || typeof value !== 'object') {
        value = undefined
        break
      }
      value = value[key]
    }
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

export function recordId(record, index) {
  return String(
    pick(record, ['id', 'rowId', 'requestId', 'proxy.requestId', 'requestPath.id']) ??
      `synthetic-${index}-${pick(record, ['timestamp', 'timestampInMs']) ?? ''}`,
  )
}

export function recordStatus(record) {
  const raw = pick(record, [
    'responseStatusCode', // what the CLI actually emits as of 50.35.0
    'statusCode',
    'status',
    'proxy.statusCode',
    'response.statusCode',
  ])
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function recordMethod(record) {
  const raw = pick(record, ['requestMethod', 'method', 'proxy.method'])
  return typeof raw === 'string' ? raw.toUpperCase() : null
}

export function recordMessage(record) {
  const raw = pick(record, [
    'message',
    'text',
    'payload.text',
    'payload.message',
    'proxy.errorMessage',
    'error.message',
  ])
  if (typeof raw === 'string') return raw
  if (raw && typeof raw === 'object') return JSON.stringify(raw)
  return ''
}

export function recordPath(record) {
  const raw = pick(record, ['requestPath', 'path', 'proxy.path', 'url', 'proxy.url', 'route'])
  if (typeof raw !== 'string') return ''
  try {
    return new URL(raw, 'https://memoai.eu').pathname
  } catch {
    return raw.split('?')[0]
  }
}

export function recordTimestamp(record) {
  const raw = pick(record, ['timestamp', 'timestampInMs', 'created', 'date'])
  if (raw == null) return null
  const asNumber = Number(raw)
  const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

const TIMEOUT_PATTERN =
  /FUNCTION_INVOCATION_TIMEOUT|Task timed out after|EDGE_FUNCTION_INVOCATION_TIMEOUT|SANDBOX_.*TIMEOUT/i
const UNCAUGHT_PATTERN =
  /Unhandled(?: Promise)? [Rr]ejection|uncaughtException|FUNCTION_INVOCATION_FAILED|^\s*(?:[A-Z]\w*)?Error:|^\s*TypeError:|^\s*ReferenceError:/m

// Returns null for anything that is not actionable, which is most of the stream.
export function classify(record) {
  const status = recordStatus(record)
  const message = recordMessage(record)
  const level = String(pick(record, ['level', 'severity', 'type']) ?? '').toLowerCase()

  if (TIMEOUT_PATTERN.test(message)) return 'timeout'
  if (status !== null && status >= 500 && status <= 599) return 'server_error'
  if ((level === 'error' || level === 'fatal') && UNCAUGHT_PATTERN.test(message)) return 'uncaught'
  return null
}

// Collapse the variable parts of a message so the same bug groups into one entry
// across requests: ids, hashes, numbers, quoted values, and durations.
export function normalizeMessage(message) {
  return message
    .split('\n')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hash>')
    .replace(/"[^"]{0,120}"/g, '"<value>"')
    .replace(/'[^']{0,120}'/g, "'<value>'")
    .replace(/\b\d+(\.\d+)?\s*(ms|s|MB|KB|GB)\b/gi, '<duration>')
    .replace(/\b\d+\b/g, '<n>')
    .trim()
    .slice(0, 300)
}

// Route params vary per request; fold them so /notes/<uuid> is one group.
export function normalizePath(path) {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/<id>')
    .replace(/\/\d+(?=\/|$)/g, '/<n>')
    .replace(/\/[0-9a-f]{20,}/gi, '/<id>')
}

function scanWindow(since, until, seen, rawSink) {
  // Two passes: the level filter catches thrown exceptions that returned no status,
  // the status filter catches 5xx that logged no error line. Overlap is deduped.
  const passes = [['--level', 'error'], ['--status-code', '5xx']]
  const fresh = []
  let sawFullPage = false

  for (const extra of passes) {
    const { records, rawLines } = runVercelLogs({ since, until, extra })
    if (rawSink) rawSink.push(...rawLines)

    const distinct = new Set()
    records.forEach((record, index) => {
      const id = recordId(record, index)
      distinct.add(id)
      if (seen.has(id)) return
      seen.add(id)
      fresh.push(record)
    })
    if (distinct.size >= PAGE_LIMIT) sawFullPage = true
  }

  return { fresh, saturated: sawFullPage }
}

function collect(since, until, seen, rawSink, out) {
  const { fresh, saturated } = scanWindow(since, until, seen, rawSink)
  out.push(...fresh)

  // A saturated page means the window was truncated and we are missing records;
  // split it and rescan rather than under-reporting.
  const span = until.getTime() - since.getTime()
  if (saturated && span > MIN_CHUNK_MS) {
    const mid = new Date(since.getTime() + Math.floor(span / 2))
    collect(since, mid, seen, rawSink, out)
    collect(mid, until, seen, rawSink, out)
  }
  return saturated && span <= MIN_CHUNK_MS
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  for (const key of ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) {
    if (!process.env[key]) {
      console.error(`Missing required env var ${key}`)
      process.exit(2)
    }
  }

  const until = resolveInstant(args.until, new Date())
  let since = resolveInstant(args.since, new Date(until.getTime() - 3 * 3_600_000))

  // Bound catch-up work after a long outage. Vercel runtime log retention is
  // short, so a window older than this cannot be answered anyway.
  const maxSpan = args.maxHours * 3_600_000
  let truncatedWindow = false
  if (until.getTime() - since.getTime() > maxSpan) {
    since = new Date(until.getTime() - maxSpan)
    truncatedWindow = true
  }

  const seen = new Set()
  const rawSink = args.raw ? [] : null
  const records = []
  let lossy = false

  for (let start = since.getTime(); start < until.getTime(); start += MAX_WINDOW_MS) {
    const chunkStart = new Date(start)
    const chunkEnd = new Date(Math.min(start + MAX_WINDOW_MS, until.getTime()))
    if (collect(chunkStart, chunkEnd, seen, rawSink, records)) lossy = true
  }

  const groups = new Map()
  let actionable = 0

  for (const record of records) {
    const type = classify(record)
    if (!type) continue
    actionable += 1

    const path = normalizePath(recordPath(record))
    const message = recordMessage(record)
    const method = recordMethod(record)
    // Method belongs in the fingerprint: a GET and a POST failing on the same
    // route are usually two different bugs.
    const fingerprint = `${type}:${method ?? '-'} ${path}:${normalizeMessage(message)}`
    const timestamp = recordTimestamp(record)

    let group = groups.get(fingerprint)
    if (!group) {
      group = {
        fingerprint,
        type,
        method,
        path,
        normalizedMessage: normalizeMessage(message),
        count: 0,
        firstSeen: null,
        lastSeen: null,
        statusCodes: new Set(),
        // traceIds let a human find the exact request in the Vercel dashboard.
        traceIds: [],
        deploymentIds: new Set(),
        sample: record,
      }
      groups.set(fingerprint, group)
    }

    group.count += 1
    const status = recordStatus(record)
    if (status !== null) group.statusCodes.add(status)
    const traceId = pick(record, ['traceId', 'requestId', 'proxy.requestId'])
    if (traceId && group.traceIds.length < 5) group.traceIds.push(String(traceId))
    const deploymentId = pick(record, ['deploymentId', 'proxy.deploymentId'])
    if (deploymentId) group.deploymentIds.add(String(deploymentId))
    if (timestamp) {
      if (!group.firstSeen || timestamp < group.firstSeen) group.firstSeen = timestamp
      if (!group.lastSeen || timestamp > group.lastSeen) group.lastSeen = timestamp
    }
  }

  const report = {
    window: { since: since.toISOString(), until: until.toISOString() },
    truncatedWindow,
    lossy,
    totals: {
      distinctRecords: records.length,
      actionableRecords: actionable,
      groups: groups.size,
    },
    groups: [...groups.values()]
      .sort((a, b) => b.count - a.count)
      .map((group) => ({
        ...group,
        statusCodes: [...group.statusCodes].sort((a, b) => a - b),
        deploymentIds: [...group.deploymentIds],
        firstSeen: group.firstSeen ? group.firstSeen.toISOString() : null,
        lastSeen: group.lastSeen ? group.lastSeen.toISOString() : null,
      })),
  }

  if (args.raw && rawSink) writeFileSync(args.raw, `${rawSink.join('\n')}\n`)
  const serialized = JSON.stringify(report, null, 2)
  if (args.out) writeFileSync(args.out, `${serialized}\n`)
  else console.log(serialized)

  // A scan that could not read the whole window must not let the caller advance
  // its cursor past unread time.
  process.exit(lossy ? 3 : 0)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
