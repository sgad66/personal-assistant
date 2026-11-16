const assert = require('node:assert')

const suites = []
const suitePath = []

function describe(name, fn) {
  suitePath.push(name)
  try {
    fn()
  } finally {
    suitePath.pop()
  }
}

function it(name, fn) {
  suites.push({ name: [...suitePath, name].join(' > '), fn })
}

function matchers(actual, negate) {
  const check = (predicate, message) => {
    if (negate) {
      assert.ok(!predicate(), message)
    } else {
      assert.ok(predicate(), message)
    }
  }
  const api = {
    toBe: (value) => {
      if (negate) assert.notStrictEqual(actual, value)
      else assert.strictEqual(actual, value)
    },
    toEqual: (value) => {
      if (negate) assert.notDeepStrictEqual(actual, value)
      else assert.deepStrictEqual(actual, value)
    },
    toContain: (value) => check(() => actual.includes(value), `expected value to contain ${String(value)}`),
    toHaveLength: (length) => {
      if (negate) assert.notStrictEqual(actual.length, length)
      else assert.strictEqual(actual.length, length)
    },
    toBeDefined: () => {
      if (negate) assert.strictEqual(actual, undefined)
      else assert.notStrictEqual(actual, undefined)
    },
    toBeUndefined: () => {
      if (negate) assert.notStrictEqual(actual, undefined)
      else assert.strictEqual(actual, undefined)
    },
    toBeGreaterThan: (value) => check(() => actual > value, `expected ${actual} > ${value}`),
    toBeGreaterThanOrEqual: (value) => check(() => actual >= value, `expected ${actual} >= ${value}`),
    toBeLessThan: (value) => check(() => actual < value, `expected ${actual} < ${value}`),
    toBeLessThanOrEqual: (value) => check(() => actual <= value, `expected ${actual} <= ${value}`),
    toBeCloseTo: (value, precision = 2) => {
      const tolerance = Math.pow(10, -precision) / 2
      return check(
        () => Math.abs(actual - value) < tolerance,
        `expected ${actual} close to ${value} (precision ${precision})`
      )
    }
  }
  Object.defineProperty(api, 'not', {
    get() {
      return matchers(actual, !negate)
    }
  })
  return api
}

function expect(actual) {
  return matchers(actual, false)
}

async function run() {
  let passed = 0
  let failed = 0
  for (const testCase of suites) {
    try {
      await testCase.fn()
      passed += 1
      console.log(`  PASS  ${testCase.name}`)
    } catch (error) {
      failed += 1
      console.error(`  FAIL  ${testCase.name}`)
      console.error(`        ${error && error.message ? error.message : String(error)}`)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed, ${suites.length} total`)
  return failed === 0 ? 0 : 1
}

module.exports = {
  describe,
  it,
  test: it,
  expect,
  beforeEach: () => {},
  afterEach: () => {},
  beforeAll: () => {},
  afterAll: () => {},
  run
}