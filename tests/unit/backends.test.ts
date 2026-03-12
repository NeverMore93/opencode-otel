import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createProcessors, type ProcessorSet } from '../../src/telemetry/backends.ts'
import type { OtelConfig } from '../../src/config.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LANGFUSE_ENV_KEYS = [
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_BASEURL',
] as const

type EnvSnapshot = Record<string, string | undefined>

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {}
  for (const key of LANGFUSE_ENV_KEYS) {
    snap[key] = process.env[key]
  }
  return snap
}

function restoreEnv(snap: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snap)) {
    if (value !== undefined) {
      process.env[key] = value
    } else {
      delete process.env[key]
    }
  }
}

function clearLangfuseEnv(): void {
  for (const key of LANGFUSE_ENV_KEYS) {
    delete process.env[key]
  }
}

function makeConfig(overrides: Partial<OtelConfig> = {}): OtelConfig {
  return Object.freeze({
    tracesEndpoint: undefined,
    logsEndpoint: undefined,
    serviceName: 'test-agent',
    headers: Object.freeze({}),
    langfuse: undefined,
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createProcessors', () => {
  let envSnap: EnvSnapshot

  beforeEach(() => {
    envSnap = snapshotEnv()
    clearLangfuseEnv()
  })

  afterEach(() => {
    restoreEnv(envSnap)
  })

  test('returns empty arrays when no backends configured', () => {
    const config = makeConfig()
    const result = createProcessors(config)

    expect(result.spanProcessors).toHaveLength(0)
    expect(result.logProcessors).toHaveLength(0)
    expect(result.backends).toHaveLength(0)
  })

  test('creates only LangfuseSpanProcessor when only langfuse configured', () => {
    const config = makeConfig({
      langfuse: Object.freeze({
        publicKey: 'pk-lf-test',
        secretKey: 'sk-lf-test',
        baseUrl: 'https://langfuse.example.com',
      }),
    })

    const result = createProcessors(config)

    expect(result.spanProcessors).toHaveLength(1)
    expect(result.logProcessors).toHaveLength(0)
    expect(result.backends).toHaveLength(1)

    const backend = result.backends[0]
    expect(backend.name).toBe('langfuse')
    expect(backend.type).toBe('langfuse-sdk')
    expect(backend.hasTraces).toBe(true)
    expect(backend.hasLogs).toBe(false)
    expect(backend.endpointDisplay).toBe('https://langfuse.example.com')
  })

  test('creates only BatchSpanProcessor when only generic traces configured', () => {
    const config = makeConfig({
      tracesEndpoint: 'http://localhost:4318/v1/traces',
    })

    const result = createProcessors(config)

    expect(result.spanProcessors).toHaveLength(1)
    expect(result.logProcessors).toHaveLength(0)
    expect(result.backends).toHaveLength(1)

    const backend = result.backends[0]
    expect(backend.name).toBe('generic')
    expect(backend.type).toBe('otlp-http')
    expect(backend.hasTraces).toBe(true)
    expect(backend.hasLogs).toBe(false)
  })

  test('creates both span and log processors when generic traces+logs configured', () => {
    const config = makeConfig({
      tracesEndpoint: 'http://localhost:4318/v1/traces',
      logsEndpoint: 'http://localhost:4318/v1/logs',
    })

    const result = createProcessors(config)

    expect(result.spanProcessors).toHaveLength(1)
    expect(result.logProcessors).toHaveLength(1)
    expect(result.backends).toHaveLength(1)

    const backend = result.backends[0]
    expect(backend.hasTraces).toBe(true)
    expect(backend.hasLogs).toBe(true)
  })

  test('creates fan-out processors when both langfuse and generic configured', () => {
    const config = makeConfig({
      langfuse: Object.freeze({
        publicKey: 'pk-lf-test',
        secretKey: 'sk-lf-test',
        baseUrl: 'https://langfuse.example.com',
      }),
      tracesEndpoint: 'http://localhost:4318/v1/traces',
    })

    const result = createProcessors(config)

    expect(result.spanProcessors).toHaveLength(2)
    expect(result.backends).toHaveLength(2)

    expect(result.backends[0].name).toBe('langfuse')
    expect(result.backends[1].name).toBe('generic')
  })

  test('langfuse base URL trailing slash is stripped from endpointDisplay', () => {
    const config = makeConfig({
      langfuse: Object.freeze({
        publicKey: 'pk-lf-test',
        secretKey: 'sk-lf-test',
        baseUrl: 'https://langfuse.example.com/',
      }),
    })

    const result = createProcessors(config)
    expect(result.backends[0].endpointDisplay).toBe('https://langfuse.example.com')
  })

  test('generic endpointDisplay sanitizes URLs with credentials', () => {
    const config = makeConfig({
      tracesEndpoint: 'http://user:pass@localhost:4318/v1/traces?token=secret',
    })

    const result = createProcessors(config)
    const display = result.backends[0].endpointDisplay

    expect(display).not.toContain('user')
    expect(display).not.toContain('pass')
    expect(display).not.toContain('secret')
    expect(display).toContain('REDACTED')
  })

  test('result is frozen (immutable)', () => {
    const config = makeConfig()
    const result = createProcessors(config)

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.spanProcessors)).toBe(true)
    expect(Object.isFrozen(result.logProcessors)).toBe(true)
    expect(Object.isFrozen(result.backends)).toBe(true)
  })
})
