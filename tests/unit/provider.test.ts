import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import {
  initProviders,
  resolveResourceAttributes,
  resolveSignalRoutes,
} from '../../src/provider.ts'
import type { BatRuntimeMetadata, IdentitySource, OtelConfig } from '../../src/config.ts'

const require = createRequire(import.meta.url)
const packageJson = require('../../package.json') as { version: string }

function createConfig(overrides: Partial<OtelConfig> = {}): OtelConfig {
  const runtimeMetadata: BatRuntimeMetadata = {
    appId: '100059443',
    groupId: '71236405',
    idc: 'NTGXH',
    buCode: 'BBZ',
    availabilityZone: 'NTGXH-AZ1',
    region: 'NT',
    hostIp: '10.1.2.3',
    hostName: 'pod-001',
  }

  return Object.freeze({
    logsEndpoint: 'http://triplog-otel-collector.fws.qa.nt.ctripcorp.com:8080',
    logsProtocol: 'grpc',
    tracesEndpoint: undefined,
    tracesProtocol: 'grpc',
    timeoutMs: 2000,
    serviceName: 'pay-dev-agent',
    serviceNameSource: 'env' as IdentitySource,
    explicitResourceAttributes: {},
    runtimeMetadata,
    headers: Object.freeze({}),
    maxLineLength: 4096,
    ...overrides,
  })
}

describe('resolveSignalRoutes', () => {
  test('keeps logs enabled and traces optional', () => {
    const routes = resolveSignalRoutes(createConfig())

    expect(routes.logs).toEqual({
      signal: 'logs',
      enabled: true,
      endpoint: 'http://triplog-otel-collector.fws.qa.nt.ctripcorp.com:8080',
      protocol: 'grpc',
      timeoutMs: 2000,
    })
    expect(routes.traces).toEqual({
      signal: 'traces',
      enabled: false,
      endpoint: undefined,
      protocol: 'grpc',
      timeoutMs: 2000,
    })
  })
})

describe('resolveResourceAttributes', () => {
  test('preserves explicit BAT service identity over OTEL_SERVICE_NAME and warns on mismatch', () => {
    const config = createConfig({
      explicitResourceAttributes: Object.freeze({
        'service.name': '100059443',
        'group.id': '71236405',
        idc: 'NTGXH',
      }),
    })

    const result = resolveResourceAttributes(config, {
      'telemetry.sdk.language': 'nodejs',
      'service.name': 'should-be-ignored',
      'custom.detected': 'detected',
    })

    expect(result.attributes).toMatchObject({
      'service.name': '100059443',
      'group.id': '71236405',
      idc: 'NTGXH',
      'custom.detected': 'detected',
      'host.ip': '10.1.2.3',
    })
    expect(result.warnings.some((warning) => warning.includes('service.name'))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('OTEL_SERVICE_NAME'))).toBe(true)
  })

  test('backfills BAT resource attributes from runtime metadata when explicit attrs are missing', () => {
    const result = resolveResourceAttributes(createConfig({
      serviceName: '100059443',
    }), {
      'telemetry.sdk.language': 'nodejs',
    })

    expect(result.attributes).toMatchObject({
      'service.name': '100059443',
      'group.id': '71236405',
      idc: 'NTGXH',
      'bu.code': 'BBZ',
      'cloud.availability_zone': 'NTGXH-AZ1',
      'cloud.region': 'NT',
      'host.ip': '10.1.2.3',
      'host.name': 'pod-001',
      'telemetry.sdk.language': 'nodejs',
    })
    expect(result.warnings).toEqual([])
  })

  test('preserves explicit generic and tracked attributes instead of overwriting them with BAT fallbacks', () => {
    const config = createConfig({
      explicitResourceAttributes: Object.freeze({
        'service.name': 'custom-service',
        'group.id': 'custom-group',
        'host.name': 'explicit-host',
        'custom.attr': 'custom-value',
      }),
    })

    const result = resolveResourceAttributes(config, {
      'custom.detected': 'detected-value',
    })

    expect(result.attributes).toMatchObject({
      'service.name': 'custom-service',
      'group.id': 'custom-group',
      'host.name': 'explicit-host',
      'custom.attr': 'custom-value',
      'custom.detected': 'detected-value',
    })
  })
})

describe('initProviders', () => {
  test('returns provider diagnostics with optional trace route enabled only when configured', () => {
    const result = initProviders(createConfig({
      tracesEndpoint: 'http://bat-otel-collector.fws.qa.nt.ctripcorp.com:8080',
    }))

    expect(result.routes.logs.enabled).toBe(true)
    expect(result.routes.traces.enabled).toBe(true)
    expect(result.resourceAttributes['service.name']).toBe('pay-dev-agent')

    void result.loggerProvider.shutdown()
    void result.tracerProvider.shutdown()
  })

  test('does not hard-code the current package version in provider source', async () => {
    const providerSource = await Bun.file(new URL('../../src/provider.ts', import.meta.url)).text()

    expect(providerSource).not.toContain(`const INSTRUMENTATION_VERSION = '${packageJson.version}'`)
    expect(providerSource).toContain(`from './version.ts'`)
  })
})
