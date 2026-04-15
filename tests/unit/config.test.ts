import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../src/config.ts'

const ENV_KEYS = [
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
  'OTEL_EXPORTER_OTLP_TIMEOUT',
  'OTEL_EXPORTER_OTLP_LOGS_TIMEOUT',
  'OTEL_EXPORTER_OTLP_TRACES_TIMEOUT',
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_RESOURCE_ATTRIBUTES',
  'OTEL_LOGS_EXPORTER',
  'OTEL_TRACES_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
  'PAAS_APP_APPID',
  'PAAS_APP_GROUPID',
  'CDOS_IDC',
  'CDOS_BUCODE',
  'CDOS_AZ',
  'CDOS_REGION',
  'CDOS_POD_IP',
  'HOSTNAME',
  'HOME',
  'USERPROFILE',
  'BAT_TIMEOUT_PLACEHOLDER',
  'BAT_MAX_LINE_LENGTH_PLACEHOLDER',
] as const

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
)
const TEMP_HOMES = new Set<string>()

async function setTempHome(config: Record<string, unknown> | null = null): Promise<void> {
  const homeDir = await mkdtemp(join(tmpdir(), 'opencode-otel-test-'))
  TEMP_HOMES.add(homeDir)

  process.env['HOME'] = homeDir
  process.env['USERPROFILE'] = homeDir

  if (!config) return

  const configDir = join(homeDir, '.config', 'opencode', 'plugins')
  await mkdir(configDir, { recursive: true })
  await writeFile(join(configDir, 'otel.json'), JSON.stringify(config), 'utf8')
}

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  for (const homeDir of TEMP_HOMES) {
    await rm(homeDir, { force: true, recursive: true })
  }
  TEMP_HOMES.clear()
})

describe('loadConfig', () => {
  test('returns defaults when no OTEL env vars are set', async () => {
    await setTempHome()

    for (const key of ENV_KEYS) delete process.env[key]

    const { config, warnings } = await loadConfig()

    expect(config.logsEndpoint).toBeUndefined()
    expect(config.logsProtocol).toBe('grpc')
    expect(config.tracesEndpoint).toBeUndefined()
    expect(config.tracesProtocol).toBe('grpc')
    expect(config.logsTimeoutMs).toBeUndefined()
    expect(config.tracesTimeoutMs).toBeUndefined()
    expect(config.serviceName).toBe('opencode-agent')
    expect(config.serviceNameSource).toBe('default')
    expect(config.explicitResourceAttributes).toEqual({})
    expect(config.headers).toEqual({})
    expect(config.maxLineLength).toBe(4096)
    expect(config.runtimeMetadata.hostName).toBeDefined()
    expect(warnings).toEqual([])
    expect(Object.isFrozen(config)).toBe(true)
  })

  test('merges otel.json key pairs with env overrides for headers and resource attributes', async () => {
    await setTempHome({
      headers: {
        authorization: 'Bearer file-token',
        'x-file-header': 'from-file',
      },
      resourceAttributes: {
        'service.name': 'file-service',
        'group.id': 'file-group',
        idc: 'FILE-IDC',
      },
    })

    process.env['OTEL_EXPORTER_OTLP_HEADERS'] = 'authorization=Bearer env-token,x-env-header=from-env'
    process.env['OTEL_RESOURCE_ATTRIBUTES'] = 'group.id=env-group,custom.attr=env-attr'

    const { config, warnings } = await loadConfig()

    expect(config.headers).toEqual({
      authorization: 'Bearer env-token',
      'x-file-header': 'from-file',
      'x-env-header': 'from-env',
    })
    expect(config.explicitResourceAttributes).toEqual({
      'service.name': 'file-service',
      'group.id': 'env-group',
      idc: 'FILE-IDC',
      'custom.attr': 'env-attr',
    })
    expect(warnings).toEqual([])
  })

  test('parses placeholder-backed numeric values from otel.json', async () => {
    await setTempHome({
      timeoutMs: '${BAT_TIMEOUT_PLACEHOLDER}',
      maxLineLength: '${BAT_MAX_LINE_LENGTH_PLACEHOLDER}',
    })

    process.env['BAT_TIMEOUT_PLACEHOLDER'] = '2500'
    process.env['BAT_MAX_LINE_LENGTH_PLACEHOLDER'] = '8192'

    const { config, warnings } = await loadConfig()

    expect(config.logsTimeoutMs).toBe(2500)
    expect(config.tracesTimeoutMs).toBe(2500)
    expect(config.maxLineLength).toBe(8192)
    expect(warnings).toEqual([])
  })

  test('parses BAT endpoints, timeout, headers, explicit attrs, and runtime metadata', async () => {
    process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] = 'http://triplog-otel-collector.fws.qa.nt.ctripcorp.com:8080'
    process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL'] = 'grpc'
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] = 'http://bat-otel-collector.fws.qa.nt.ctripcorp.com:8080'
    process.env['OTEL_EXPORTER_OTLP_TRACES_PROTOCOL'] = 'grpc'
    process.env['OTEL_EXPORTER_OTLP_TIMEOUT'] = '2000'
    process.env['OTEL_SERVICE_NAME'] = 'pay-dev-agent'
    process.env['OTEL_EXPORTER_OTLP_HEADERS'] = 'authorization=Bearer token,x-tenant=payment'
    process.env['OTEL_RESOURCE_ATTRIBUTES'] = 'service.name=100059443,group.id=71236405,idc=NTGXH,custom.attr=custom'
    process.env['PAAS_APP_APPID'] = '100059443'
    process.env['PAAS_APP_GROUPID'] = '71236405'
    process.env['CDOS_IDC'] = 'NTGXH'
    process.env['CDOS_BUCODE'] = 'BBZ'
    process.env['CDOS_AZ'] = 'NTGXH-AZ1'
    process.env['CDOS_REGION'] = 'NT'
    process.env['CDOS_POD_IP'] = '10.1.2.3'
    process.env['HOSTNAME'] = 'pod-001'

    const { config, warnings } = await loadConfig()

    expect(config.logsEndpoint).toBe('http://triplog-otel-collector.fws.qa.nt.ctripcorp.com:8080')
    expect(config.tracesEndpoint).toBe('http://bat-otel-collector.fws.qa.nt.ctripcorp.com:8080')
    expect(config.logsTimeoutMs).toBe(2000)
    expect(config.tracesTimeoutMs).toBe(2000)
    expect(config.serviceName).toBe('pay-dev-agent')
    expect(config.serviceNameSource).toBe('env')
    expect(config.headers).toEqual({
      authorization: 'Bearer token',
      'x-tenant': 'payment',
    })
    expect(config.explicitResourceAttributes).toEqual({
      'service.name': '100059443',
      'group.id': '71236405',
      idc: 'NTGXH',
      'custom.attr': 'custom',
    })
    expect(config.runtimeMetadata).toEqual({
      appId: '100059443',
      groupId: '71236405',
      idc: 'NTGXH',
      buCode: 'BBZ',
      availabilityZone: 'NTGXH-AZ1',
      region: 'NT',
      hostIp: '10.1.2.3',
      hostName: 'pod-001',
    })
    expect(warnings).toEqual([])
  })

  test('signal-specific timeouts override generic OTEL_EXPORTER_OTLP_TIMEOUT per OTEL spec', async () => {
    process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] = 'http://collector:8080'
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] = 'http://collector:8080'
    process.env['OTEL_EXPORTER_OTLP_TIMEOUT'] = '1000'
    process.env['OTEL_EXPORTER_OTLP_LOGS_TIMEOUT'] = '3000'
    process.env['OTEL_EXPORTER_OTLP_TRACES_TIMEOUT'] = '5000'

    const { config, warnings } = await loadConfig()

    expect(config.logsTimeoutMs).toBe(3000)
    expect(config.tracesTimeoutMs).toBe(5000)
    expect(warnings).toEqual([])
  })

  test('falls back to generic timeout when only one signal-specific timeout is set', async () => {
    process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] = 'http://collector:8080'
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] = 'http://collector:8080'
    process.env['OTEL_EXPORTER_OTLP_TIMEOUT'] = '1500'
    process.env['OTEL_EXPORTER_OTLP_LOGS_TIMEOUT'] = '4000'

    const { config } = await loadConfig()

    expect(config.logsTimeoutMs).toBe(4000)
    expect(config.tracesTimeoutMs).toBe(1500)
  })

  test('warns and disables traces when traces protocol is unsupported', async () => {
    process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] = 'http://collector:8080'
    process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'] = 'http://trace-collector:8080'
    process.env['OTEL_EXPORTER_OTLP_TRACES_PROTOCOL'] = 'http/json'

    const { config, warnings } = await loadConfig()

    expect(config.logsEndpoint).toBe('http://collector:8080')
    expect(config.tracesEndpoint).toBeUndefined()
    expect(config.tracesProtocol).toBe('grpc')
    expect(warnings.some((warning) => warning.includes('Trace exporter only supports "grpc"'))).toBe(true)
  })

  test('tolerates shared exporter and metrics env vars without changing routing', async () => {
    process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT'] = 'http://collector:8080'
    process.env['OTEL_LOGS_EXPORTER'] = 'otlp'
    process.env['OTEL_TRACES_EXPORTER'] = 'otlp'
    process.env['OTEL_METRICS_EXPORTER'] = 'otlp'
    process.env['OTEL_EXPORTER_OTLP_METRICS_ENDPOINT'] = 'http://metrics:8080'
    process.env['OTEL_EXPORTER_OTLP_METRICS_PROTOCOL'] = 'grpc'

    const { config, warnings } = await loadConfig()

    expect(config.logsEndpoint).toBe('http://collector:8080')
    expect(config.tracesEndpoint).toBeUndefined()
    expect(warnings).toEqual([])
  })

  test('decodes percent-encoded OTEL headers and resource attributes', async () => {
    process.env['OTEL_EXPORTER_OTLP_HEADERS'] = 'authorization=Bearer%20token,scope=read%2Cwrite'
    process.env['OTEL_RESOURCE_ATTRIBUTES'] = 'service.name=svc%2Fapi,custom.attr=hello%20world,scope=read%2Cwrite'

    const { config } = await loadConfig()

    expect(config.headers).toEqual({
      authorization: 'Bearer token',
      scope: 'read,write',
    })
    expect(config.explicitResourceAttributes).toEqual({
      'service.name': 'svc/api',
      'custom.attr': 'hello world',
      scope: 'read,write',
    })
  })
})
