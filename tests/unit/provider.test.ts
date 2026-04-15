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

function getActiveLogProcessorName(
  result: ReturnType<typeof initProviders>,
): string {
  return (
    result.loggerProvider as unknown as {
      _sharedState: {
        activeProcessor: {
          constructor: {
            name: string
          }
        }
      }
    }
  )._sharedState.activeProcessor.constructor.name
}

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
    logsTimeoutMs: 2000,
    tracesTimeoutMs: 2000,
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
  test('OTEL_SERVICE_NAME takes precedence over OTEL_RESOURCE_ATTRIBUTES service.name per OTEL spec and warns on mismatch', () => {
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

    // OTEL spec: OTEL_SERVICE_NAME takes precedence over OTEL_RESOURCE_ATTRIBUTES service.name.
    expect(result.attributes).toMatchObject({
      'service.name': 'pay-dev-agent',
      'group.id': '71236405',
      idc: 'NTGXH',
      'custom.detected': 'detected',
      'host.ip': '10.1.2.3',
    })
    expect(result.warnings.some((warning) => warning.includes('service.name'))).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('OTEL_RESOURCE_ATTRIBUTES'))).toBe(true)
  })

  test('OTEL_RESOURCE_ATTRIBUTES service.name overrides otel.json serviceName', () => {
    const config = createConfig({
      serviceName: 'from-file',
      serviceNameSource: 'config-file',
      explicitResourceAttributes: Object.freeze({
        'service.name': '100059443',
      }),
    })

    const result = resolveResourceAttributes(config, {})

    expect(result.attributes['service.name']).toBe('100059443')
    expect(result.warnings.some((warning) => warning.includes('otel.json serviceName'))).toBe(true)
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
      // serviceName comes from config-file so OTEL_RESOURCE_ATTRIBUTES can win for this test.
      serviceName: 'file-service',
      serviceNameSource: 'config-file',
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
  test('returns provider diagnostics with optional trace route enabled only when configured', async () => {
    const result = initProviders(createConfig({
      tracesEndpoint: 'http://bat-otel-collector.fws.qa.nt.ctripcorp.com:8080',
    }))

    expect(result.routes.logs.enabled).toBe(true)
    expect(result.routes.traces.enabled).toBe(true)
    expect(result.resourceAttributes['service.name']).toBe('pay-dev-agent')
    expect(getActiveLogProcessorName(result)).toBe('MultiLogRecordProcessor')

    await result.loggerProvider.shutdown()
    await result.tracerProvider.shutdown()
  })

  test('does not register log processors when logs are disabled', async () => {
    const result = initProviders(createConfig({
      logsEndpoint: undefined,
    }))

    expect(result.routes.logs.enabled).toBe(false)
    expect(getActiveLogProcessorName(result)).toBe('NoopLogRecordProcessor')

    await result.loggerProvider.shutdown()
    await result.tracerProvider.shutdown()
  })

  test('does not hard-code the current package version in provider source', async () => {
    const providerSource = await Bun.file(new URL('../../src/provider.ts', import.meta.url)).text()

    expect(providerSource).not.toContain(`const INSTRUMENTATION_VERSION = '${packageJson.version}'`)
    expect(providerSource).toContain(`from './version.ts'`)
  })
})
