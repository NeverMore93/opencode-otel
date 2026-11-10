import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as mod from '../../src/index.ts'

const ENV_KEYS = ['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT', 'OTEL_PLUGIN_CONFIG_PATH'] as const
const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('plugin entry', () => {
  test('exports only a default export', () => {
    expect(Object.keys(mod)).toEqual(['default'])
  })

  test('default export has the OpenCode 2 shape (id + setup) and a V1 server', () => {
    const plugin = mod.default as unknown as Record<string, unknown>
    expect(typeof plugin).toBe('object')
    expect(plugin.id).toBe('opencode-otel')
    expect(typeof plugin.setup).toBe('function')
    expect(typeof plugin.server).toBe('function')
  })

  test('V2 setup does not patch stderr', async () => {
    const write = process.stderr.write
    await mod.default.setup({})
    expect(process.stderr.write).toBe(write)
  })

  test('V1 server still runs the plugin (inactive without an endpoint)', async () => {
    delete process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']
    process.env['OTEL_PLUGIN_CONFIG_PATH'] = join(tmpdir(), 'opencode-otel-missing', 'otel.json')

    const messages: string[] = []
    const ctx = {
      client: {
        app: {
          log: async (opts: { body: Record<string, unknown> }) => {
            messages.push(String(opts.body.message))
          },
        },
      },
    }

    const hooks = await mod.default.server(ctx)
    expect(hooks).toEqual({})
    expect(messages.some((m) => m.includes('plugin inactive'))).toBe(true)
  })
})
