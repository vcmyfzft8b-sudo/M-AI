import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { gate, isFresh, nextState, planWindow, resolveInstant } from '../scripts/triage-state.mjs'

const NOW = Date.parse('2026-08-18T12:00:00.000Z')

test('with no cursor the window is the default lookback', () => {
  const plan = planWindow({}, { now: NOW, defaultHours: 3 })
  assert.equal(plan.since, '2026-08-18T09:00:00.000Z')
  assert.equal(plan.until, '2026-08-18T12:00:00.000Z')
  assert.equal(plan.source, 'default')
})

test('the window starts at the cursor minus the overlap, not a fixed offset', () => {
  const plan = planWindow({ cursor: '2026-08-18T11:30:00.000Z' }, { now: NOW })
  assert.equal(plan.since, '2026-08-18T11:20:00.000Z')
  assert.equal(plan.source, 'cursor')
})

test('a skipped run widens the next window instead of losing the gap', () => {
  // Cursor is 9 hours old: three scheduled runs did not happen.
  const plan = planWindow({ cursor: '2026-08-18T03:00:00.000Z' }, { now: NOW })
  const spanHours = (Date.parse(plan.until) - Date.parse(plan.since)) / 3_600_000
  assert.ok(spanHours > 9 && spanHours < 9.2, `expected ~9h, got ${spanHours}`)
})

test('catch-up is capped so it cannot ask for logs Vercel no longer retains', () => {
  const plan = planWindow({ cursor: '2026-08-01T00:00:00.000Z' }, { now: NOW, maxHours: 24 })
  assert.equal(plan.since, '2026-08-17T12:00:00.000Z')
  assert.equal(plan.truncated, true)
})

test('an overridden window must not move the cursor', () => {
  const plan = planWindow({ cursor: '2026-08-18T11:00:00.000Z' }, { now: NOW, sinceOverride: '6h' })
  assert.equal(plan.since, '2026-08-18T06:00:00.000Z')
  assert.equal(plan.source, 'override')
  assert.equal(plan.mayAdvanceCursor, false)
})

test('a normal scheduled window may move the cursor', () => {
  assert.equal(planWindow({}, { now: NOW }).mayAdvanceCursor, true)
})

test('resolveInstant handles relative and absolute forms', () => {
  assert.equal(resolveInstant('2h', NOW).toISOString(), '2026-08-18T10:00:00.000Z')
  assert.equal(resolveInstant('2026-08-18T01:00:00Z', NOW).toISOString(), '2026-08-18T01:00:00.000Z')
  assert.throws(() => resolveInstant('soon', NOW), /Unparseable time/)
})

test('an unknown error is fresh', () => {
  assert.equal(isFresh(undefined, '2026-08-18T11:00:00Z'), true)
})

test('an error already covered by an open PR is not fresh', () => {
  const entry = { status: 'open-pr', updatedAt: '2026-08-18T11:00:00Z' }
  assert.equal(isFresh(entry, '2026-08-18T10:00:00Z'), false)
})

test('an error that recurred after being handled is a regression, so it is fresh', () => {
  const entry = { status: 'fixed', updatedAt: '2026-08-18T10:00:00Z' }
  assert.equal(isFresh(entry, '2026-08-18T11:00:00Z'), true)
})

test('a needs-human error that has not recurred does not wake the run', () => {
  // Otherwise one unfixable error would make every future run expensive.
  const entry = { status: 'needs-human', updatedAt: '2026-08-18T11:00:00Z' }
  assert.equal(isFresh(entry, '2026-08-18T10:30:00Z'), false)
})

test('the gate stays shut when nothing is new', () => {
  const decision = gate({
    vercel: { groups: [{ fingerprint: 'a', lastSeen: '2026-08-18T10:00:00Z' }] },
    sentry: { issues: [] },
    backlog: { entries: [{ fingerprint: 'a', status: 'fixed', updatedAt: '2026-08-18T11:00:00Z' }] },
  })
  assert.equal(decision.actionable, false)
  assert.equal(decision.freshVercelGroups, 0)
  assert.match(decision.reason, /nothing new/)
})

test('the gate opens for an unseen Vercel group', () => {
  const decision = gate({
    vercel: { groups: [{ fingerprint: 'new-one', lastSeen: '2026-08-18T11:00:00Z' }] },
    backlog: { entries: [] },
  })
  assert.equal(decision.actionable, true)
  assert.deepEqual(decision.freshFingerprints, ['new-one'])
})

test('the gate opens for a Sentry issue with no Vercel counterpart', () => {
  // A client-side exception never produces a 5xx, so Vercel alone would miss it.
  const decision = gate({
    vercel: { groups: [] },
    sentry: { issues: [{ id: '123', lastSeen: '2026-08-18T11:00:00Z' }] },
    backlog: { entries: [] },
  })
  assert.equal(decision.actionable, true)
  assert.equal(decision.freshSentryIssues, 1)
})

test('the gate names the fresh Sentry issues, not just the count', () => {
  // With no Vercel counterpart, freshFingerprints is empty -- the agent has to be
  // told which Sentry issue woke the run or it may triage the wrong one.
  const decision = gate({
    vercel: { groups: [] },
    sentry: {
      issues: [
        { id: '123', lastSeen: '2026-08-18T11:00:00Z' },
        { id: '456', lastSeen: '2026-08-18T10:00:00Z' },
      ],
    },
    backlog: {
      entries: [{ fingerprint: 'x', sentryIssues: ['456'], status: 'open-pr', updatedAt: '2026-08-18T11:00:00Z' }],
    },
  })
  assert.deepEqual(decision.freshSentryIssueIds, ['123'])
  assert.deepEqual(decision.freshFingerprints, [])
})

test('a fresh issue past the enrichment cap still opens the gate', () => {
  // The report enriches only the highest-frequency issues; a brand-new low-count
  // issue lands in `additional`, which is exactly the one that must not be missed.
  const decision = gate({
    vercel: { groups: [] },
    sentry: {
      issues: [],
      additional: [{ id: '789', lastSeen: '2026-08-18T11:00:00Z' }],
    },
    backlog: { entries: [] },
  })
  assert.equal(decision.actionable, true)
  assert.deepEqual(decision.freshSentryIssueIds, ['789'])
  assert.equal(decision.sentryIssues, 1)
})

test('a missing Sentry report is flagged but does not wake the agent by itself', () => {
  // The workflow holds the cursor on sentryMissing; running the expensive half
  // with no data to act on would not help.
  const decision = gate({ vercel: { groups: [] }, sentry: null, backlog: { entries: [] } })
  assert.equal(decision.actionable, false)
  assert.equal(decision.sentryMissing, true)
  assert.match(decision.reason, /Sentry scan produced no report/)
})

test('a known Sentry issue tracked on the backlog does not reopen the gate', () => {
  const decision = gate({
    vercel: { groups: [] },
    sentry: { issues: [{ id: '123', lastSeen: '2026-08-18T10:00:00Z' }] },
    backlog: {
      entries: [{ fingerprint: 'x', sentryIssues: ['123'], status: 'open-pr', updatedAt: '2026-08-18T11:00:00Z' }],
    },
  })
  assert.equal(decision.actionable, false)
})

test('a Sentry performance detector does not open the gate, but is still reported', () => {
  // `performance_consecutive_http` and its siblings carry no exception and no stack
  // trace, and every detection files a new issue id -- so backlogging one never stops
  // the next. They are set aside by category, not by id.
  const decision = gate({
    vercel: { groups: [] },
    sentry: {
      issues: [
        { id: '147678291', issueType: 'performance_consecutive_http', lastSeen: '2026-08-18T11:00:00Z' },
      ],
    },
    backlog: { entries: [] },
  })
  assert.equal(decision.actionable, false)
  assert.deepEqual(decision.freshSentryIssueIds, [])
  assert.deepEqual(decision.ignoredSentryIssueIds, ['147678291'])
  assert.match(decision.reason, /performance detector/)
})

test('setting detectors aside does not hide a real error in the same window', () => {
  const decision = gate({
    vercel: { groups: [] },
    sentry: {
      issues: [{ id: '111', issueType: 'performance_n_plus_one_db_queries', lastSeen: '2026-08-18T11:00:00Z' }],
      additional: [{ id: '222', issueType: 'error', lastSeen: '2026-08-18T11:00:00Z' }],
    },
    backlog: { entries: [] },
  })
  assert.equal(decision.actionable, true)
  assert.deepEqual(decision.freshSentryIssueIds, ['222'])
  assert.deepEqual(decision.ignoredSentryIssueIds, ['111'])
})

test('a hydration error is not a performance detector and still opens the gate', () => {
  // `replay_hydration_error` is a real client-side defect that happens to be filed
  // under a non-error category; matching on the `performance_` prefix keeps it.
  const decision = gate({
    vercel: { groups: [] },
    sentry: {
      issues: [
        { id: '113442418', issueType: 'replay_hydration_error', issueCategory: 'frontend', lastSeen: '2026-08-18T11:00:00Z' },
      ],
    },
    backlog: { entries: [] },
  })
  assert.equal(decision.actionable, true)
  assert.deepEqual(decision.freshSentryIssueIds, ['113442418'])
})

test('a report written before issueType was carried stays actionable', () => {
  // Fail open: an unclassified issue is triaged, not silently set aside.
  const decision = gate({
    vercel: { groups: [] },
    sentry: { issues: [{ id: '999', lastSeen: '2026-08-18T11:00:00Z' }] },
    backlog: { entries: [] },
  })
  assert.equal(decision.actionable, true)
  assert.deepEqual(decision.freshSentryIssueIds, ['999'])
})

test('a lossy scan opens the gate even with nothing fresh, so the gap gets reported', () => {
  const decision = gate({ vercel: { groups: [], lossy: true }, backlog: { entries: [] } })
  assert.equal(decision.actionable, true)
  assert.match(decision.reason, /could not read the whole window/)
})

test('a normal scheduled run moves the cursor and clears the failure count', () => {
  const next = nextState(
    { cursor: '2026-08-18T09:00:00.000Z', consecutiveFailures: 2 },
    { until: '2026-08-18T12:00:00.000Z', status: 'ok', noAdvance: false, now: 'N' },
  )
  assert.equal(next.cursor, '2026-08-18T12:00:00.000Z')
  assert.equal(next.lastStatus, 'ok')
  assert.equal(next.consecutiveFailures, 0)
})

test('a hand-dispatched run is a success that leaves the cursor alone', () => {
  // Recording this as a failure would inflate consecutiveFailures and mask a real
  // outage, which is exactly the bug the first live dry run exposed.
  const next = nextState(
    { cursor: '2026-08-18T09:00:00.000Z', consecutiveFailures: 0 },
    { until: '2026-08-18T12:00:00.000Z', status: 'ok', noAdvance: true, now: 'N' },
  )
  assert.equal(next.cursor, '2026-08-18T09:00:00.000Z')
  assert.equal(next.lastStatus, 'ok')
  assert.equal(next.consecutiveFailures, 0)
})

test('a lossy scan is a real failure: cursor holds and the count rises', () => {
  const next = nextState(
    { cursor: '2026-08-18T09:00:00.000Z', consecutiveFailures: 1 },
    { until: '2026-08-18T12:00:00.000Z', status: 'failed', noAdvance: false, now: 'N' },
  )
  assert.equal(next.cursor, '2026-08-18T09:00:00.000Z')
  assert.equal(next.lastStatus, 'failed')
  assert.equal(next.consecutiveFailures, 2)
})

// The tests above call nextState() directly. These run the CLI the workflow
// actually invokes, which is where a refactor once left a dangling reference that
// every unit test sailed past and the first live run hit immediately.
function runCommit(state, args) {
  const file = join(mkdtempSync(join(tmpdir(), 'triage-')), 'state.json')
  writeFileSync(file, JSON.stringify(state))
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../scripts/triage-state.mjs', import.meta.url)), 'commit', '--state', file, ...args],
    { encoding: 'utf8' },
  )
  return { result, state: JSON.parse(readFileSync(file, 'utf8')) }
}

test('the commit command runs clean and reports what it did', () => {
  const { result, state } = runCommit(
    { cursor: '2026-08-18T09:00:00.000Z' },
    ['--until', '2026-08-18T12:00:00.000Z', '--status', 'ok'],
  )
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  assert.equal(state.cursor, '2026-08-18T12:00:00.000Z')
  assert.deepEqual(JSON.parse(result.stdout), {
    cursorAdvanced: true,
    cursor: '2026-08-18T12:00:00.000Z',
    lastStatus: 'ok',
  })
})

test('the commit command honours --no-advance without calling the run a failure', () => {
  const { result, state } = runCommit(
    { cursor: '2026-08-18T09:00:00.000Z' },
    ['--until', '2026-08-18T12:00:00.000Z', '--status', 'ok', '--no-advance'],
  )
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  assert.equal(state.cursor, '2026-08-18T09:00:00.000Z')
  assert.equal(JSON.parse(result.stdout).cursorAdvanced, false)
  assert.equal(state.lastStatus, 'ok')
})

test('the plan and gate commands run clean too', () => {
  const script = fileURLToPath(new URL('../scripts/triage-state.mjs', import.meta.url))
  const plan = spawnSync(process.execPath, [script, 'plan', '--since-override', ''], { encoding: 'utf8' })
  assert.equal(plan.status, 0, `stderr: ${plan.stderr}`)
  assert.ok(JSON.parse(plan.stdout).since)

  const gateRun = spawnSync(process.execPath, [script, 'gate'], { encoding: 'utf8' })
  assert.equal(gateRun.status, 0, `stderr: ${gateRun.stderr}`)
  assert.equal(JSON.parse(gateRun.stdout).actionable, false)
})
