/**
 * Tiny zero-dependency test runner.
 *
 * Usage:
 *   import { suite, test, assert, run } from './lib/runner.mjs'
 *   suite('thing', () => {
 *     test('does X', () => { assert.equal(2+2, 4) })
 *   })
 *   await run()  // returns process exit code
 */

const C = {
  reset: '\x1b[0m', dim: '\x1b[90m', red: '\x1b[31m', green: '\x1b[32m',
  yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m'
}
const supportsColor = process.stdout.isTTY && !process.env.NO_COLOR
const c = (color, s) => supportsColor ? color + s + C.reset : s

const _suites = []
let _currentSuite = null

export function suite(name, fn) {
  const s = { name, tests: [], beforeAll: null, afterAll: null }
  _suites.push(s)
  _currentSuite = s
  fn()
  _currentSuite = null
}

export function test(name, fn) {
  if (!_currentSuite) throw new Error('test() must be called inside suite()')
  _currentSuite.tests.push({ name, fn })
}

export function beforeAll(fn) {
  if (!_currentSuite) throw new Error('beforeAll() must be called inside suite()')
  _currentSuite.beforeAll = fn
}
export function afterAll(fn) {
  if (!_currentSuite) throw new Error('afterAll() must be called inside suite()')
  _currentSuite.afterAll = fn
}

class AssertionError extends Error {
  constructor(message, expected, actual) {
    super(message)
    this.name = 'AssertionError'
    this.expected = expected
    this.actual = actual
  }
}

export const assert = {
  ok(value, msg = 'expected truthy value') {
    if (!value) throw new AssertionError(msg, 'truthy', value)
  },
  equal(actual, expected, msg) {
    if (actual !== expected) throw new AssertionError(msg || `expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`, expected, actual)
  },
  deepEqual(actual, expected, msg) {
    const aJ = JSON.stringify(actual), eJ = JSON.stringify(expected)
    if (aJ !== eJ) throw new AssertionError(msg || `deepEqual mismatch\n  expected: ${eJ}\n  actual:   ${aJ}`, expected, actual)
  },
  match(actual, regex, msg) {
    if (typeof actual !== 'string' || !regex.test(actual)) throw new AssertionError(msg || `expected ${JSON.stringify(actual)} to match ${regex}`, regex.toString(), actual)
  },
  contains(haystack, needle, msg) {
    if (typeof haystack !== 'string' || haystack.indexOf(needle) === -1) throw new AssertionError(msg || `expected ${JSON.stringify(haystack).slice(0,80)} to contain ${JSON.stringify(needle)}`, needle, haystack)
  },
  isType(actual, type, msg) {
    if (typeof actual !== type) throw new AssertionError(msg || `expected typeof ${type}, got ${typeof actual} (${JSON.stringify(actual)})`, type, typeof actual)
  },
  status(response, expected, msg) {
    if (response.status !== expected) throw new AssertionError(msg || `expected HTTP ${expected}, got ${response.status} (body: ${JSON.stringify(response.body).slice(0,200)})`, expected, response.status)
  },
  notOk(value, msg = 'expected falsy value') {
    if (value) throw new AssertionError(msg, 'falsy', value)
  },
  greaterOrEqual(actual, expected, msg) {
    if (!(actual >= expected)) throw new AssertionError(msg || `expected ${actual} >= ${expected}`, expected, actual)
  },
  fail(msg) { throw new AssertionError(msg) },
}

export async function run({ filter } = {}) {
  let total = 0, passed = 0, failed = 0, skipped = 0
  const failures = []
  const startAt = Date.now()

  console.log()
  for (const s of _suites) {
    if (filter && !s.name.includes(filter)) {
      console.log(c(C.dim, `  · ${s.name}  (skipped — filter)`))
      continue
    }
    console.log(c(C.bold + C.cyan, `\n  ▸ ${s.name}`))
    if (s.beforeAll) {
      try { await s.beforeAll() }
      catch (e) {
        console.log(c(C.red, `    ✗ beforeAll failed: ${e.message}`))
        failed += s.tests.length
        total += s.tests.length
        continue
      }
    }
    for (const t of s.tests) {
      total++
      try {
        const t0 = Date.now()
        await t.fn()
        const ms = Date.now() - t0
        passed++
        console.log(c(C.green, `    ✓ `) + t.name + c(C.dim, `  (${ms}ms)`))
      } catch (e) {
        failed++
        failures.push({ suite: s.name, test: t.name, err: e })
        console.log(c(C.red, `    ✗ `) + t.name)
        console.log(c(C.red, `        ${e.message}`))
        if (e.expected !== undefined) {
          console.log(c(C.dim,   `        expected: ${JSON.stringify(e.expected)}`))
          console.log(c(C.dim,   `        actual:   ${JSON.stringify(e.actual)}`))
        }
      }
    }
    if (s.afterAll) {
      try { await s.afterAll() }
      catch (e) { console.log(c(C.yellow, `    ⚠ afterAll error: ${e.message}`)) }
    }
  }

  const ms = Date.now() - startAt
  console.log()
  console.log(c(C.bold, '  Results: ') +
    c(C.green, `${passed} passed`) + ', ' +
    c(failed ? C.red : C.dim, `${failed} failed`) +
    (skipped ? `, ${skipped} skipped` : '') +
    c(C.dim, `  (${total} total, ${ms}ms)`))
  console.log()

  return failed === 0 ? 0 : 1
}

/** Convenience HTTP helper that always parses JSON and never throws on non-2xx. */
export async function http(url, opts = {}) {
  const finalOpts = { ...opts }
  if (finalOpts.body && typeof finalOpts.body !== 'string') {
    finalOpts.body = JSON.stringify(finalOpts.body)
    finalOpts.headers = { 'Content-Type': 'application/json', ...(finalOpts.headers || {}) }
  }
  let res
  try {
    res = await fetch(url, finalOpts)
  } catch (e) {
    return { status: 0, body: { error: `network: ${e.message}` }, raw: '' }
  }
  const raw = await res.text()
  let body
  try { body = raw ? JSON.parse(raw) : {} } catch { body = { _raw: raw } }
  return { status: res.status, body, raw }
}
