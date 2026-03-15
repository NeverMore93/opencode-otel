import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { loadConfig, parseOtlpHeaders } from '../../src/config.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snapshot of env vars we touch so we can restore them after each test. */
const ENV_KEYS = [
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_HEADERS',
] as const

type EnvSnapshot = Partial<Record<(typeof ENV_KEYS)[number], string>>

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {}
  for (const key of ENV_KEYS) {
    if (process.env[key] !== undefined) {
      snap[key] = process.env[key]
    }
  }
  return snap
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const key of ENV_KEYS) {
    if (key in snap) {
      process.env[key] = snap[key]
    } else {
      delete process.env[key]
    }
  }
}

function clearOtelEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

// ---------------------------------------------------------------------------
// parseOtlpHeaders — pure unit tests (no I/O)
// ---------------------------------------------------------------------------

describe('parseOtlpHeaders', () => {
  test('returns empty object for empty string', () => {
    expect(parseOtlpHeaders('')).toEqual({})
  })

  test('returns empty object for whitespace-only string', () => {
    expect(parseOtlpHeaders('   ')).toEqual({})
  })

  test('parses a single key=value pair', () => {
    expect(parseOtlpHeaders('Authorization=Bearer token123')).toEqual({
      Authorization: 'Bearer token123',
    })
  })

  test('parses multiple comma-separated pairs', () => {
    const result = parseOtlpHeaders(
      'Authorization=Basic abc,x-custom-header=my-value,x-tenant=acme',
    )
    expect(result).toEqual({
      Authorization: 'Basic abc',
      'x-custom-header': 'my-value',
      'x-tenant': 'acme',
    })
  })

  test('trims whitespace around commas and around the = sign', () => {
    expect(parseOtlpHeaders('  key1 = val1 , key2=val2  ')).toEqual({
      key1: 'val1',
      key2: 'val2',
    })
  })

  test('silently skips pairs without an = sign', () => {
    expect(parseOtlpHeaders('invalid,key=value')).toEqual({ key: 'value' })
  })

  test('silently skips pairs with an empty key', () => {
    expect(parseOtlpHeaders('=value,good=ok')).toEqual({ good: 'ok' })
  })

  test('allows = characters inside the value', () => {
    // Base64-encoded credentials contain = padding
    expect(parseOtlpHeaders('Authorization=Basic dXNlcjpwYXNz==')).toEqual({
      Authorization: 'Basic dXNlcjpwYXNz==',
    })
  })

  test('returns a frozen (immutable) object', () => {
    const result = parseOtlpHeaders('k=v')
    expect(Object.isFrozen(result)).toBe(true)
  })

  test('does not mutate any external state', () => {
    const input = 'a=1,b=2'
    parseOtlpHeaders(input)
    expect(input).toBe('a=1,b=2')
  })
})

// ---------------------------------------------------------------------------
// loadConfig — integration-style tests (reads env vars + optional file I/O)
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  let envSnapshot: EnvSnapshot

  beforeEach(() => {
    envSnapshot = snapshotEnv()
    clearOtelEnv()
  })

  afterEach(() => {
    restoreEnv(envSnapshot)
  })

  // --- Default values -------------------------------------------------------

  test('uses "opencode-agent" as default serviceName when OTEL_SERVICE_NAME is not set', async () => {
    const { config } = await loadConfig()
    expect(config.serviceName).toBe('opencode-agent')
  })

  test('tracesEndpoint is undefined by default', async () => {
    const { config } = await loadConfig()
    expect(config.tracesEndpoint).toBeUndefined()
  })

  test('logsEndpoint is undefined by default', async () => {
    const { config } = await loadConfig()
    expect(config.logsEndpoint).toBeUndefined()
  })

  test('headers is an empty object by default', async () => {
    const { config } = await loadConfig()
    expect(config.headers).toEqual({})
  })

  // --- Env var reading -------------------------------------------------------

  test('reads OTEL_EXPORTER_OTLP_TRACES_ENDPOINT from env', async () => {
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] =
      'http://localhost:4318/v1/traces'
    const { config } = await loadConfig()
    expect(config.tracesEndpoint).toBe('http://localhost:4318/v1/traces')
  })

  test('reads OTEL_EXPORTER_OTLP_LOGS_ENDPOINT from env', async () => {
    process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] =
      'http://localhost:4318/v1/logs'
    const { config } = await loadConfig()
    expect(config.logsEndpoint).toBe('http://localhost:4318/v1/logs')
  })

  test('reads OTEL_SERVICE_NAME from env', async () => {
    process.env['OTEL_SERVICE_NAME'] = 'my-custom-service'
    const { config } = await loadConfig()
    expect(config.serviceName).toBe('my-custom-service')
  })

  test('reads and parses OTEL_EXPORTER_OTLP_HEADERS from env', async () => {
    process.env['OTEL_EXPORTER_OTLP_HEADERS'] =
      'Authorization=Bearer tok,x-org=acme'
    const { config } = await loadConfig()
    expect(config.headers).toEqual({
      Authorization: 'Bearer tok',
      'x-org': 'acme',
    })
  })

  test('empty OTEL_EXPORTER_OTLP_HEADERS env var yields empty headers', async () => {
    process.env['OTEL_EXPORTER_OTLP_HEADERS'] = ''
    const { config } = await loadConfig()
    expect(config.headers).toEqual({})
  })

  test('single-entry OTEL_EXPORTER_OTLP_HEADERS', async () => {
    process.env['OTEL_EXPORTER_OTLP_HEADERS'] = 'x-api-key=secret'
    const { config } = await loadConfig()
    expect(config.headers).toEqual({ 'x-api-key': 'secret' })
  })

  // --- Immutability ---------------------------------------------------------

  test('returned config object is frozen', async () => {
    const { config } = await loadConfig()
    expect(Object.isFrozen(config)).toBe(true)
  })

  test('returned headers object is frozen', async () => {
    process.env['OTEL_EXPORTER_OTLP_HEADERS'] = 'k=v'
    const { config } = await loadConfig()
    expect(Object.isFrozen(config.headers)).toBe(true)
  })

  // --- Missing config file --------------------------------------------------

  test('does not throw when .opencode/plugins/otel.json does not exist', async () => {
    // The file almost certainly does not exist in the test environment.
    // loadConfig must return a valid config with defaults.
    await expect(loadConfig()).resolves.toBeDefined()
  })

  test('returns default serviceName even when config file is absent', async () => {
    const { config } = await loadConfig()
    expect(config.serviceName).toBe('opencode-agent')
  })
})
