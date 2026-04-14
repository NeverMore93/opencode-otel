/**
 * Configuration for opencode-otel stderr log forwarder.
 *
 * Sources (precedence: env vars > config file > defaults):
 *   OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
 *   OTEL_EXPORTER_OTLP_LOGS_PROTOCOL (default: "grpc")
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT (optional, for session correlation)
 *   OTEL_EXPORTER_OTLP_TRACES_PROTOCOL (validated, gRPC only)
 *   OTEL_EXPORTER_OTLP_TIMEOUT (optional, shared timeout in ms)
 *   OTEL_SERVICE_NAME (default: "opencode-agent")
 *   OTEL_RESOURCE_ATTRIBUTES
 *   OTEL_EXPORTER_OTLP_HEADERS
 */

import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import { parseKeyPairsIntoRecord } from '@opentelemetry/core'

export type OtelProtocol = 'grpc' | 'http/json'
export type IdentitySource = 'env' | 'config-file' | 'default'

export interface BatRuntimeMetadata {
  readonly appId: string | undefined
  readonly groupId: string | undefined
  readonly idc: string | undefined
  readonly buCode: string | undefined
  readonly availabilityZone: string | undefined
  readonly region: string | undefined
  readonly hostIp: string | undefined
  readonly hostName: string | undefined
}

export interface OtelConfig {
  readonly logsEndpoint: string | undefined
  readonly logsProtocol: OtelProtocol
  readonly tracesEndpoint: string | undefined
  readonly tracesProtocol: 'grpc'
  readonly timeoutMs: number | undefined
  readonly serviceName: string
  readonly serviceNameSource: IdentitySource
  readonly explicitResourceAttributes: Readonly<Record<string, string>>
  readonly runtimeMetadata: BatRuntimeMetadata
  readonly headers: Readonly<Record<string, string>>
  readonly maxLineLength: number
}

export interface ConfigResult {
  readonly config: OtelConfig
  readonly warnings: readonly string[]
}

const DEFAULT_PROTOCOL: OtelProtocol = 'grpc'
const DEFAULT_TRACE_PROTOCOL = 'grpc'
const DEFAULT_SERVICE_NAME = 'opencode-agent'
const DEFAULT_MAX_LINE_LENGTH = 4096
const VALID_PROTOCOLS = new Set<string>(['grpc', 'http/json'])
const CONFIG_FILE_PATH = join(homedir(), '.config', 'opencode', 'plugins', 'otel.json')

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return undefined
}

function parseOtelKeyPairs(raw: string | undefined): Readonly<Record<string, string>> {
  if (!raw || raw.trim() === '') return Object.freeze({})
  return Object.freeze(parseKeyPairsIntoRecord(raw))
}

function resolveEnvPlaceholders(obj: unknown): unknown {
  if (typeof obj === 'string') {
    if (!obj.includes('${')) return obj
    return obj.replace(/\$\{(\w+)\}/g, (_m, name: string) => {
      const val = process.env[name]
      if (val === undefined) throw new Error(`Env var ${name} not set (referenced as \${${name}})`)
      return val
    })
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvPlaceholders)
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = resolveEnvPlaceholders(v)
    }
    return result
  }
  return obj
}

async function readConfigFile(warnings: string[]): Promise<Record<string, unknown> | null> {
  try {
    const file = Bun.file(CONFIG_FILE_PATH)
    if (await file.exists()) {
      const parsed: unknown = await file.json()
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return resolveEnvPlaceholders(parsed) as Record<string, unknown>
      }
      warnings.push(`Invalid config file at ${CONFIG_FILE_PATH}: not a JSON object`)
    }
  } catch (err) {
    warnings.push(`Failed to read config file: ${err instanceof Error ? err.message : String(err)}`)
  }
  return null
}

function parsePositiveInteger(
  raw: string | number | undefined,
  label: string,
  warnings: string[],
): number | undefined {
  if (raw === undefined) return undefined
  const numeric = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isInteger(numeric) && numeric > 0) return numeric
  warnings.push(`${label} must be a positive integer — ignoring "${String(raw)}"`)
  return undefined
}

function getServiceName(fileConfig: Record<string, unknown> | null): {
  value: string
  source: IdentitySource
} {
  const envValue = toOptionalString(process.env['OTEL_SERVICE_NAME'])
  if (envValue) {
    return { value: envValue, source: 'env' }
  }

  const fileValue = toOptionalString(fileConfig?.serviceName)
  if (fileValue) {
    return { value: fileValue, source: 'config-file' }
  }

  return { value: DEFAULT_SERVICE_NAME, source: 'default' }
}

function getRuntimeMetadata(): BatRuntimeMetadata {
  const hostName = toOptionalString(process.env['HOSTNAME']) ?? (() => {
    try {
      return hostname()
    } catch {
      return undefined
    }
  })()

  return Object.freeze({
    appId: toOptionalString(process.env['PAAS_APP_APPID']),
    groupId: toOptionalString(process.env['PAAS_APP_GROUPID']),
    idc: toOptionalString(process.env['CDOS_IDC']),
    buCode: toOptionalString(process.env['CDOS_BUCODE']),
    availabilityZone: toOptionalString(process.env['CDOS_AZ']),
    region: toOptionalString(process.env['CDOS_REGION']),
    hostIp: toOptionalString(process.env['CDOS_POD_IP']),
    hostName,
  })
}

export async function loadConfig(): Promise<ConfigResult> {
  const warnings: string[] = []
  const fileConfig = await readConfigFile(warnings)

  const logsEndpoint =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']) ??
    toOptionalString(fileConfig?.logsEndpoint)

  let tracesEndpoint =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']) ??
    toOptionalString(fileConfig?.tracesEndpoint)

  const rawLogsProtocol =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL']) ??
    toOptionalString(fileConfig?.logsProtocol)
  let logsProtocol: OtelProtocol = DEFAULT_PROTOCOL
  if (rawLogsProtocol) {
    const normalized = rawLogsProtocol.toLowerCase().trim()
    if (VALID_PROTOCOLS.has(normalized)) {
      logsProtocol = normalized as OtelProtocol
    } else {
      warnings.push(`Unrecognized logs protocol "${rawLogsProtocol}" — using "${DEFAULT_PROTOCOL}"`)
    }
  }

  const rawTracesProtocol =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_TRACES_PROTOCOL']) ??
    toOptionalString(fileConfig?.tracesProtocol)
  if (rawTracesProtocol && rawTracesProtocol.toLowerCase().trim() !== DEFAULT_TRACE_PROTOCOL) {
    warnings.push(`Trace exporter only supports "${DEFAULT_TRACE_PROTOCOL}" — disabling trace export`)
    tracesEndpoint = undefined
  }

  const timeoutMs = parsePositiveInteger(
    process.env['OTEL_EXPORTER_OTLP_TIMEOUT'] ??
      (typeof fileConfig?.timeoutMs === 'number' ? fileConfig.timeoutMs : undefined),
    'OTEL_EXPORTER_OTLP_TIMEOUT',
    warnings,
  )

  const { value: serviceName, source: serviceNameSource } = getServiceName(fileConfig)
  const explicitResourceAttributes = parseOtelKeyPairs(process.env['OTEL_RESOURCE_ATTRIBUTES'])

  const rawHeaders = process.env['OTEL_EXPORTER_OTLP_HEADERS']
  const headers = parseOtelKeyPairs(rawHeaders)

  const envMaxLineLength = parsePositiveInteger(
    process.env['OTEL_MAX_LINE_LENGTH'] ??
      (typeof fileConfig?.maxLineLength === 'number' ? fileConfig.maxLineLength : undefined),
    'OTEL_MAX_LINE_LENGTH',
    warnings,
  )
  const maxLineLength = envMaxLineLength ?? DEFAULT_MAX_LINE_LENGTH

  return {
    config: Object.freeze({
      logsEndpoint,
      logsProtocol,
      tracesEndpoint,
      tracesProtocol: DEFAULT_TRACE_PROTOCOL,
      timeoutMs,
      serviceName,
      serviceNameSource,
      explicitResourceAttributes,
      runtimeMetadata: getRuntimeMetadata(),
      headers,
      maxLineLength,
    }),
    warnings,
  }
}
