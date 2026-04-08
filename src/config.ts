/**
 * Configuration for opencode-otel stderr log forwarder.
 *
 * Sources (precedence: env vars > config file > defaults):
 *   OTEL_EXPORTER_OTLP_LOGS_ENDPOINT
 *   OTEL_EXPORTER_OTLP_LOGS_PROTOCOL (default: "grpc")
 *   OTEL_EXPORTER_OTLP_TRACES_ENDPOINT (optional, for session correlation)
 *   OTEL_SERVICE_NAME (default: "opencode-agent")
 *   OTEL_EXPORTER_OTLP_HEADERS
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

export type OtelProtocol = 'grpc' | 'http/json'

export interface OtelConfig {
  readonly logsEndpoint: string | undefined
  readonly logsProtocol: OtelProtocol
  readonly tracesEndpoint: string | undefined
  readonly serviceName: string
  readonly headers: Readonly<Record<string, string>>
  readonly maxLineLength: number
}

export interface ConfigResult {
  readonly config: OtelConfig
  readonly warnings: readonly string[]
}

const DEFAULT_PROTOCOL: OtelProtocol = 'grpc'
const DEFAULT_SERVICE_NAME = 'opencode-agent'
const DEFAULT_MAX_LINE_LENGTH = 4096
const VALID_PROTOCOLS = new Set<string>(['grpc', 'http/json'])
const CONFIG_FILE_PATH = join(homedir(), '.config', 'opencode', 'plugins', 'otel.json')

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return undefined
}

function parseHeaders(raw: string): Record<string, string> {
  if (raw.trim() === '') return {}
  const result: Record<string, string> = {}
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()
    if (key) result[key] = value
  }
  return Object.freeze(result)
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

export async function loadConfig(): Promise<ConfigResult> {
  const warnings: string[] = []
  const fileConfig = await readConfigFile(warnings)

  const logsEndpoint =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']) ??
    toOptionalString(fileConfig?.logsEndpoint)

  const tracesEndpoint =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']) ??
    toOptionalString(fileConfig?.tracesEndpoint)

  const rawProtocol =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_LOGS_PROTOCOL']) ??
    toOptionalString(fileConfig?.logsProtocol)
  let logsProtocol: OtelProtocol = DEFAULT_PROTOCOL
  if (rawProtocol) {
    const normalized = rawProtocol.toLowerCase().trim()
    if (VALID_PROTOCOLS.has(normalized)) {
      logsProtocol = normalized as OtelProtocol
    } else {
      warnings.push(`Unrecognized logs protocol "${rawProtocol}" — using "${DEFAULT_PROTOCOL}"`)
    }
  }

  const serviceName =
    toOptionalString(process.env['OTEL_SERVICE_NAME']) ??
    toOptionalString(fileConfig?.serviceName as string | undefined) ??
    DEFAULT_SERVICE_NAME

  const rawHeaders = process.env['OTEL_EXPORTER_OTLP_HEADERS']
  const headers: Readonly<Record<string, string>> = rawHeaders
    ? parseHeaders(rawHeaders)
    : Object.freeze({})

  const envMaxLineLength = process.env['OTEL_MAX_LINE_LENGTH']
  const rawMaxLineLength = envMaxLineLength !== undefined && envMaxLineLength.trim() !== ''
    ? Number(envMaxLineLength)
    : typeof fileConfig?.maxLineLength === 'number'
      ? fileConfig.maxLineLength
      : DEFAULT_MAX_LINE_LENGTH
  const maxLineLength = Number.isFinite(rawMaxLineLength) && rawMaxLineLength > 0
    ? Math.floor(rawMaxLineLength)
    : DEFAULT_MAX_LINE_LENGTH

  return {
    config: Object.freeze({ logsEndpoint, logsProtocol, tracesEndpoint, serviceName, headers, maxLineLength }),
    warnings,
  }
}
