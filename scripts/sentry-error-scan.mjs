#!/usr/bin/env node
// Pull Sentry issues for a time window, with the stack trace Vercel logs do not carry.
//
// Vercel tells you a route returned 500; Sentry usually tells you which line threw.
// Sentry is also a detection source of its own: a client-side exception, or a server
// error a route handled before responding, never produces a 5xx and exists only
// here. The cursor is the same cursor as the Vercel scan's.
//
// Usage:
//   node scripts/sentry-error-scan.mjs --since 2026-08-17T09:00:00Z [--until ISO] [--out FILE]
//   node scripts/sentry-error-scan.mjs --since 3h --frames 12
//
// Env (a local run can `source .env.sentry.local` instead):
//   SENTRY_AUTH_TOKEN  required
//   SENTRY_ORG         required
//   SENTRY_PROJECT     required
//   SENTRY_BASE_URL    optional, defaults to https://de.sentry.io

import { writeFileSync } from 'node:fs'

const DEFAULT_BASE_URL = 'https://de.sentry.io'
const MAX_ISSUES = 50
const MAX_ENRICHED = 15 // fetching the latest event is one request per issue

function parseArgs(argv) {
  const args = { since: '3h', until: null, out: null, frames: 8, query: 'is:unresolved' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => argv[(i += 1)]
    if (arg === '--since') args.since = next()
    else if (arg === '--until') args.until = next()
    else if (arg === '--out') args.out = next()
    else if (arg === '--frames') args.frames = Number(next())
    else if (arg === '--query') args.query = next()
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

function resolveInstant(value, fallback) {
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

async function sentryFetch(baseUrl, path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Sentry ${response.status} on ${path}: ${body.slice(0, 500)}`)
  }
  return response.json()
}

// Sentry symbolicates `stacktrace` server-side; `rawStacktrace` holds the minified
// frames the browser actually saw. The symbolicated one is what a human wants here.
function extractFrames(event, limit) {
  const entries = Array.isArray(event?.entries) ? event.entries : []
  const exception = entries.find((entry) => entry.type === 'exception')
  const values = exception?.data?.values
  if (!Array.isArray(values) || values.length === 0) return null

  const primary = values[values.length - 1]
  const frames = primary?.stacktrace?.frames ?? primary?.rawStacktrace?.frames ?? []

  return {
    type: primary?.type ?? null,
    value: primary?.value ?? null,
    // Sentry orders frames oldest-first; the throwing frame is last.
    frames: frames
      .slice(-limit)
      .reverse()
      .map((frame) => ({
        filename: frame.filename ?? frame.absPath ?? null,
        function: frame.function ?? null,
        lineNo: frame.lineNo ?? null,
        colNo: frame.colNo ?? null,
        inApp: Boolean(frame.inApp),
        context: Array.isArray(frame.context)
          ? frame.context.filter(([, line]) => typeof line === 'string').slice(0, 7)
          : null,
      })),
  }
}

function extractRequest(event) {
  const entries = Array.isArray(event?.entries) ? event.entries : []
  const request = entries.find((entry) => entry.type === 'request')?.data
  if (!request) return null
  return {
    method: request.method ?? null,
    url: request.url ?? null,
    // Query strings and headers can carry tokens and personal data -- keep names only.
    queryKeys: Array.isArray(request.query) ? request.query.map(([key]) => key) : null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = process.env.SENTRY_AUTH_TOKEN
  const org = process.env.SENTRY_ORG
  const project = process.env.SENTRY_PROJECT
  const baseUrl = (process.env.SENTRY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '')

  if (!token || !org || !project) {
    console.error('Missing SENTRY_AUTH_TOKEN, SENTRY_ORG, or SENTRY_PROJECT')
    process.exit(2)
  }

  const until = resolveInstant(args.until, new Date())
  const since = resolveInstant(args.since, new Date(until.getTime() - 3 * 3_600_000))

  const params = new URLSearchParams({
    query: args.query,
    start: since.toISOString().replace(/\.\d{3}Z$/, ''),
    end: until.toISOString().replace(/\.\d{3}Z$/, ''),
    utc: 'true',
    sort: 'freq',
    limit: String(MAX_ISSUES),
  })

  const issues = await sentryFetch(
    baseUrl,
    `/api/0/projects/${org}/${project}/issues/?${params}`,
    token,
  )

  const enriched = []
  for (const issue of issues.slice(0, MAX_ENRICHED)) {
    let exception = null
    let request = null
    try {
      const event = await sentryFetch(baseUrl, `/api/0/issues/${issue.id}/events/latest/`, token)
      exception = extractFrames(event, args.frames)
      request = extractRequest(event)
    } catch (error) {
      // A missing latest event must not sink the whole enrichment pass.
      exception = { error: String(error.message ?? error) }
    }
    enriched.push({
      id: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      level: issue.level,
      status: issue.status,
      substatus: issue.substatus ?? null,
      // Not every unresolved issue is an error: Sentry files its performance span
      // detectors in the same list, with no exception and no stack trace. Carry the
      // classification so triage does not have to re-derive it from the API.
      issueType: issue.issueType ?? null,
      issueCategory: issue.issueCategory ?? null,
      count: Number(issue.count ?? 0),
      userCount: Number(issue.userCount ?? 0),
      firstSeen: issue.firstSeen ?? null,
      lastSeen: issue.lastSeen ?? null,
      permalink: issue.permalink,
      platform: issue.platform ?? null,
      exception,
      request,
    })
  }

  const report = {
    window: { since: since.toISOString(), until: until.toISOString() },
    query: args.query,
    totals: { issues: issues.length, enriched: enriched.length },
    truncated: issues.length > MAX_ENRICHED,
    issues: enriched,
    // Issues past the enrichment cap still matter for correlation, so keep the heads.
    additional: issues.slice(MAX_ENRICHED).map((issue) => ({
      id: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      culprit: issue.culprit,
      issueType: issue.issueType ?? null,
      issueCategory: issue.issueCategory ?? null,
      count: Number(issue.count ?? 0),
      lastSeen: issue.lastSeen ?? null,
      permalink: issue.permalink,
    })),
  }

  const serialized = JSON.stringify(report, null, 2)
  if (args.out) writeFileSync(args.out, `${serialized}\n`)
  else console.log(serialized)
}

main().catch((error) => {
  console.error(String(error.stack ?? error))
  process.exit(1)
})
