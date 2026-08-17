import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLogsArgs,
  classify,
  normalizeMessage,
  normalizePath,
  pick,
  recordId,
  recordMessage,
  recordMethod,
  recordPath,
  recordStatus,
  recordTimestamp,
  resolveInstant,
} from '../scripts/vercel-error-scan.mjs'

// Captured verbatim from `vercel logs --json` (CLI 50.35.0) against production.
// If a future CLI release renames a field, this fixture is what will catch it.
const LIVE_RECORD = {
  id: 'tqdj8-1786993219955-2199954017b3',
  timestamp: 1786993219955,
  deploymentId: 'dpl_25kJ898Er4Qib9EunQubx9f153pj',
  projectId: 'prj_tYSLuzeXWSnRDwXzYUxATzPIAQg3',
  level: 'error',
  message:
    "Rate limit check failed; allowing request {\n  route: 'auth:google:post',\n  error: Error [TimeoutError]: Rate limit check timed out after 1200ms\n}",
  source: 'serverless-middleware',
  domain: 'www.memoai.eu',
  requestMethod: 'POST',
  requestPath: '/auth/google',
  responseStatusCode: 303,
  environment: 'production',
  branch: 'main',
  cache: 'MISS',
  traceId: '01ff60d81ee326c5741c10d6f6826d38',
}

test('the live CLI record shape is read correctly field by field', () => {
  assert.equal(recordId(LIVE_RECORD, 0), 'tqdj8-1786993219955-2199954017b3')
  assert.equal(recordStatus(LIVE_RECORD), 303)
  assert.equal(recordMethod(LIVE_RECORD), 'POST')
  assert.equal(recordPath(LIVE_RECORD), '/auth/google')
  assert.equal(recordTimestamp(LIVE_RECORD).toISOString(), new Date(1786993219955).toISOString())
})

test('a handled error that returned a non-error status is not actionable', () => {
  // The app caught this, logged it, and served the request. Flagging it would
  // send the automation chasing a warning.
  assert.equal(classify(LIVE_RECORD), null)
})

test('a real 5xx in the live shape is actionable', () => {
  assert.equal(classify({ ...LIVE_RECORD, responseStatusCode: 500 }), 'server_error')
})

const WINDOW = {
  since: new Date('2026-08-18T09:00:00Z'),
  until: new Date('2026-08-18T10:00:00Z'),
  extra: ['--level', 'error'],
}

test('the token is passed as a flag, because the CLI ignores VERCEL_TOKEN', () => {
  // A clean CI runner has no auth.json, and the CLI fails with "No existing
  // credentials found" before it ever looks at the environment.
  const args = buildLogsArgs({ ...WINDOW, token: 'secret-value' })
  const at = args.indexOf('--token')
  assert.ok(at !== -1, 'expected --token in the argument list')
  assert.equal(args[at + 1], 'secret-value')
})

test('the window is passed as explicit ISO bounds', () => {
  const args = buildLogsArgs({ ...WINDOW, token: 't' })
  assert.equal(args[args.indexOf('--since') + 1], '2026-08-18T09:00:00.000Z')
  assert.equal(args[args.indexOf('--until') + 1], '2026-08-18T10:00:00.000Z')
})

test('branch auto-detection is disabled, or a CI checkout returns nothing', () => {
  assert.ok(buildLogsArgs({ ...WINDOW, token: 't' }).includes('--no-branch'))
  assert.ok(buildLogsArgs({ ...WINDOW, token: 't' }).includes('--no-follow'))
})

test('only production logs are requested', () => {
  const args = buildLogsArgs({ ...WINDOW, token: 't' })
  assert.equal(args[args.indexOf('--environment') + 1], 'production')
})

test('no token flag is emitted when there is no token to pass', () => {
  assert.ok(!buildLogsArgs({ ...WINDOW, token: undefined }).includes('--token'))
})

test('classify treats 5xx responses as server errors', () => {
  assert.equal(classify({ responseStatusCode: 500, message: 'POST /api/notes' }), 'server_error')
  assert.equal(classify({ statusCode: 500, message: 'POST /api/notes' }), 'server_error')
  assert.equal(classify({ proxy: { statusCode: 503 } }), 'server_error')
})

test('classify treats function timeouts as timeouts even without a status', () => {
  assert.equal(
    classify({ message: 'Error: Task timed out after 60.02 seconds' }),
    'timeout',
  )
  assert.equal(classify({ level: 'error', message: 'FUNCTION_INVOCATION_TIMEOUT' }), 'timeout')
})

test('classify treats error-level uncaught exceptions as actionable', () => {
  assert.equal(
    classify({ level: 'error', message: 'TypeError: Cannot read properties of undefined' }),
    'uncaught',
  )
  assert.equal(
    classify({ level: 'fatal', message: 'Unhandled Promise Rejection: boom' }),
    'uncaught',
  )
})

test('classify ignores 4xx and non-error noise', () => {
  assert.equal(classify({ statusCode: 404, message: 'GET /favicon.ico' }), null)
  assert.equal(classify({ statusCode: 401, level: 'warning', message: 'unauthorized' }), null)
  assert.equal(classify({ statusCode: 200, level: 'info', message: 'Error: handled and logged' }), null)
  assert.equal(classify({ level: 'info', message: 'compiled successfully' }), null)
})

test('a timeout is classified as a timeout even when it also returned 500', () => {
  assert.equal(
    classify({ statusCode: 500, message: 'Task timed out after 60.02 seconds' }),
    'timeout',
  )
})

test('pick reads through alternative and nested field shapes', () => {
  assert.equal(pick({ statusCode: 500 }, ['statusCode', 'proxy.statusCode']), 500)
  assert.equal(pick({ proxy: { statusCode: 502 } }, ['statusCode', 'proxy.statusCode']), 502)
  assert.equal(pick({ proxy: null }, ['proxy.statusCode']), undefined)
  assert.equal(pick({ message: '' }, ['message']), undefined)
})

test('record accessors tolerate both flat and proxy-nested records', () => {
  const flat = {
    id: 'log_1',
    statusCode: 500,
    message: 'boom',
    path: '/api/notes?cursor=abc',
    timestamp: 1_771_000_000_000,
  }
  assert.equal(recordId(flat, 0), 'log_1')
  assert.equal(recordStatus(flat), 500)
  assert.equal(recordMessage(flat), 'boom')
  assert.equal(recordPath(flat), '/api/notes')
  assert.equal(recordTimestamp(flat).toISOString(), new Date(1_771_000_000_000).toISOString())

  const nested = {
    rowId: 'log_2',
    proxy: { statusCode: 502, path: 'https://memoai.eu/api/audio', errorMessage: 'upstream' },
  }
  assert.equal(recordId(nested, 0), 'log_2')
  assert.equal(recordStatus(nested), 502)
  assert.equal(recordMessage(nested), 'upstream')
  assert.equal(recordPath(nested), '/api/audio')
})

test('recordId falls back to a synthetic id so unidentified rows still dedupe', () => {
  const record = { timestamp: 1_771_000_000_000 }
  assert.equal(recordId(record, 4), recordId(record, 4))
  assert.notEqual(recordId(record, 4), recordId(record, 5))
})

test('duplicate records collapse to one id, which is what keeps counts honest', () => {
  // The CLI repeats each record many times; counting raw rows inflates ~20x.
  const repeated = Array.from({ length: 20 }, () => ({ id: 'log_9', statusCode: 500 }))
  const distinct = new Set(repeated.map((record, index) => recordId(record, index)))
  assert.equal(distinct.size, 1)
})

test('normalizeMessage collapses ids, hashes, numbers, and durations', () => {
  const a = normalizeMessage(
    'Error: note 3f1b9c2d-1111-4a2b-9c3d-aabbccddeeff failed after 1200 ms',
  )
  const b = normalizeMessage(
    'Error: note 88ffaa11-2222-4c3d-8e4f-112233445566 failed after 950 ms',
  )
  assert.equal(a, b)
  assert.match(a, /<uuid>/)
  assert.match(a, /<duration>/)
})

test('normalizeMessage keeps only the first line of a stack trace', () => {
  const message = normalizeMessage('TypeError: bad\n    at foo (/var/task/app.js:1:1)')
  assert.equal(message, 'TypeError: bad')
})

test('normalizePath folds dynamic route segments together', () => {
  assert.equal(
    normalizePath('/api/notes/3f1b9c2d-1111-4a2b-9c3d-aabbccddeeff/audio'),
    '/api/notes/<id>/audio',
  )
  assert.equal(normalizePath('/api/lectures/12345'), '/api/lectures/<n>')
  assert.equal(normalizePath('/api/health'), '/api/health')
})

test('resolveInstant understands relative and ISO windows', () => {
  const iso = resolveInstant('2026-08-17T09:00:00Z')
  assert.equal(iso.toISOString(), '2026-08-17T09:00:00.000Z')

  const threeHoursAgo = resolveInstant('3h')
  const delta = Date.now() - threeHoursAgo.getTime()
  assert.ok(Math.abs(delta - 3 * 3_600_000) < 5_000, `unexpected delta ${delta}`)

  assert.throws(() => resolveInstant('not-a-time'), /Unparseable time/)
})
