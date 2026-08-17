import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classify,
  normalizeMessage,
  normalizePath,
  pick,
  recordId,
  recordMessage,
  recordPath,
  recordStatus,
  recordTimestamp,
  resolveInstant,
} from '../scripts/vercel-error-scan.mjs'

test('classify treats 5xx responses as server errors', () => {
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
