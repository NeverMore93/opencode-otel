import { describe, test, expect } from 'bun:test'
import { loadConfig } from '../../src/config.ts'

describe('loadConfig', () => {
  test('returns defaults when no env vars set', async () => {
    const saved = { ...process.env }
    delete process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']
    delete process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL']
    delete process.env['OTEL_SERVICE_NAME']
    delete process.env['OTEL_EXPORTER_OTLP_HEADERS']

    const { config } = await loadConfig()

    expect(config.logsEndpoint).toBeUndefined()
    expect(config.logsProtocol).toBe('grpc')
    expect(config.serviceName).toBe('opencode-agent')
    expect(config.maxLineLength).toBe(4096)

    Object.assign(process.env, saved)
  })

  test('reads endpoint from env var', async () => {
    const saved = process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']
    process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] = 'http://collector:8080'

    const { config } = await loadConfig()
    expect(config.logsEndpoint).toBe('http://collector:8080')

    if (saved) process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] = saved
    else delete process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']
  })

  test('reads protocol from env var', async () => {
    const saved = process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL']
    process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL'] = 'http/json'

    const { config } = await loadConfig()
    expect(config.logsProtocol).toBe('http/json')

    if (saved) process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL'] = saved
    else delete process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL']
  })

  test('warns on invalid protocol and uses default', async () => {
    const saved = process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL']
    process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL'] = 'invalid'

    const { config, warnings } = await loadConfig()
    expect(config.logsProtocol).toBe('grpc')
    expect(warnings.length).toBeGreaterThan(0)

    if (saved) process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL'] = saved
    else delete process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL']
  })

  test('config is frozen (immutable)', async () => {
    const { config } = await loadConfig()
    expect(Object.isFrozen(config)).toBe(true)
  })
})
