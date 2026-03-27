import { describe, test, expect } from 'bun:test'
import { createProcessors } from '../../src/telemetry/backends.ts'
import type { OtelConfig } from '../../src/config.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<OtelConfig> = {}): OtelConfig {
  return Object.freeze({
    tracesEndpoint: undefined,
    logsEndpoint: undefined,
    serviceName: 'test-agent',
    headers: Object.freeze({}),
    ...overrides,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createProcessors', () => {
  test('returns empty arrays when no backends configured', () => {
    const config = makeConfig()
    const result = createProcessors(config)

    expect(result.spanProcessors).toHaveLength(0)
    expect(result.logProcessors).toHaveLength(0)
    expect(result.backends).toHaveLength(0)
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
