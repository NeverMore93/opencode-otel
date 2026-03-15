/**
 * Configuration types and loading for opencode-otel.
 *
 * Sources (in precedence order, highest first):
 *   1. Environment variables
 *   2. Config file: ~/.config/opencode/plugins/otel.json
 *   3. Built-in defaults
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** Parsed representation of OTEL_EXPORTER_OTLP_HEADERS */
export type OtelHeaders = Readonly<Record<string, string>>

/** Langfuse-specific credentials. */
export interface LangfuseConfig {
  readonly publicKey: string
  readonly secretKey: string
  readonly baseUrl: string
}

/** Full plugin configuration. All fields are immutable after construction. */
export interface OtelConfig {
  /** OTLP HTTP endpoint for traces (e.g. http://localhost:4318/v1/traces) */
  readonly tracesEndpoint: string | undefined
  /** OTLP HTTP endpoint for logs (e.g. http://localhost:4318/v1/logs) */
  readonly logsEndpoint: string | undefined
  /** service.name resource attribute. Defaults to "opencode-agent". */
  readonly serviceName: string
  /** Parsed headers from OTEL_EXPORTER_OTLP_HEADERS or config file. */
  readonly headers: OtelHeaders
  /** Langfuse backend credentials. Present only when all three vars are set. */
  readonly langfuse: LangfuseConfig | undefined
}

/** Return type of loadConfig(). Includes any warnings collected during loading. */
export interface ConfigResult {
  readonly config: OtelConfig
  readonly warnings: readonly string[]
}

/**
 * Shape of the optional .opencode/plugins/otel.json file.
 * All fields are optional; env vars always win over file values.
 */
interface ConfigFileShape {
  tracesEndpoint?: unknown
  logsEndpoint?: unknown
  serviceName?: unknown
  headers?: unknown
  langfuse?: {
    publicKey?: unknown
    secretKey?: unknown
    baseUrl?: unknown
  }
}

const DEFAULT_SERVICE_NAME = 'opencode-agent'
const CONFIG_FILE_PATH = join(homedir(), '.config', 'opencode', 'plugins', 'otel.json')

/**
 * Parse a OTEL_EXPORTER_OTLP_HEADERS string into a plain object.
 *
 * Format: comma-separated key=value pairs, e.g.
 *   "Authorization=Basic abc123,x-custom=value"
 *
 * Whitespace around commas and around the `=` sign is trimmed.
 * Pairs that do not contain `=` are silently skipped.
 */
export function parseOtlpHeaders(raw: string): OtelHeaders {
  if (raw.trim() === '') {
    return {}
  }

  const entries = raw.split(',').reduce<Record<string, string>>((acc, pair) => {
    const eqIndex = pair.indexOf('=')
    if (eqIndex === -1) {
      return acc
    }
    const key = pair.slice(0, eqIndex).trim()
    const value = pair.slice(eqIndex + 1).trim()
    if (key === '') {
      return acc
    }
    acc[key] = value
    return acc
  }, {} as Record<string, string>)

  return Object.freeze(entries)
}

/**
 * Recursively replace ${VAR} placeholders in parsed JSON with process.env values.
 * Strings without placeholders pass through unchanged. Non-string primitives
 * (numbers, booleans, null) are returned as-is.
 * Throws if a referenced env var is undefined.
 */
function resolveEnvPlaceholders(obj: unknown): unknown {
  if (typeof obj === 'string') {
    if (!obj.includes('${')) return obj
    return obj.replace(/\$\{(\w+)\}/g, (_match, name: string) => {
      const val = process.env[name]
      if (val === undefined) {
        throw new Error(`Environment variable ${name} is not set (config references \${${name}})`)
      }
      return val
    })
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvPlaceholders)
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveEnvPlaceholders(value)
    }
    return result
  }
  return obj
}

/**
 * Attempt to read and parse the optional config file.
 * Returns `null` if the file does not exist or cannot be parsed.
 * ${VAR} placeholders are resolved against process.env.
 * Never throws. Warnings are appended to the provided array.
 */
async function readConfigFile(warnings: string[]): Promise<ConfigFileShape | null> {
  try {
    const file = Bun.file(CONFIG_FILE_PATH)
    if (await file.exists()) {
      const parsed: unknown = await file.json()
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return resolveEnvPlaceholders(parsed) as ConfigFileShape
      }
      warnings.push(
        `Invalid config file at ${CONFIG_FILE_PATH}: content is not a JSON object`,
      )
    }
  } catch (err) {
    warnings.push(
      `Failed to read config file ${CONFIG_FILE_PATH}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  return null
}

/**
 * Extract a string value from an unknown source, returning `undefined` if
 * the value is absent or not a non-empty string.
 */
function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim()
  }
  return undefined
}

/**
 * Merge file-level headers (object or string) into a plain record.
 * Invalid shapes are silently ignored.
 */
function fileHeaders(raw: unknown): OtelHeaders {
  if (typeof raw === 'string') {
    return parseOtlpHeaders(raw)
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') {
        result[k] = v
      }
    }
    return Object.freeze(result)
  }
  return Object.freeze({})
}

/**
 * Load and merge configuration from all sources.
 *
 * Precedence (highest → lowest):
 *   env vars → config file → defaults
 *
 * The returned config object is deeply frozen (immutable).
 * Any non-fatal warnings (e.g. partial Langfuse config) are collected and
 * returned alongside the config so callers can log them via the plugin logger.
 */
export async function loadConfig(): Promise<ConfigResult> {
  const warnings: string[] = []
  const fileConfig = await readConfigFile(warnings)

  // Env vars take precedence over file values.
  const tracesEndpoint =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT']) ??
    toOptionalString(fileConfig?.tracesEndpoint)

  const logsEndpoint =
    toOptionalString(process.env['OTEL_EXPORTER_OTLP_LOGS_ENDPOINT']) ??
    toOptionalString(fileConfig?.logsEndpoint)

  const serviceName =
    toOptionalString(process.env['OTEL_SERVICE_NAME']) ??
    toOptionalString(fileConfig?.serviceName) ??
    DEFAULT_SERVICE_NAME

  // Headers: env var wins; fall back to file; merge is intentionally NOT done
  // (env var completely replaces file headers to avoid credential leakage).
  const rawEnvHeaders = process.env['OTEL_EXPORTER_OTLP_HEADERS']
  const headers: OtelHeaders =
    rawEnvHeaders !== undefined
      ? parseOtlpHeaders(rawEnvHeaders)
      : fileHeaders(fileConfig?.headers)

  // Langfuse: detect when all three credentials are present.
  const langfusePublicKey =
    toOptionalString(process.env['LANGFUSE_PUBLIC_KEY']) ??
    toOptionalString(fileConfig?.langfuse?.publicKey)
  const langfuseSecretKey =
    toOptionalString(process.env['LANGFUSE_SECRET_KEY']) ??
    toOptionalString(fileConfig?.langfuse?.secretKey)
  const langfuseBaseUrl =
    toOptionalString(process.env['LANGFUSE_BASE_URL']) ??
    toOptionalString(fileConfig?.langfuse?.baseUrl)

  const langfuseCreds = [langfusePublicKey, langfuseSecretKey, langfuseBaseUrl]
  const hasPartialLangfuse =
    langfuseCreds.some(Boolean) && !langfuseCreds.every(Boolean)

  if (hasPartialLangfuse) {
    warnings.push(
      'Partial Langfuse config detected — need LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL. Skipping Langfuse backend.',
    )
  }

  const langfuse: LangfuseConfig | undefined =
    langfusePublicKey && langfuseSecretKey && langfuseBaseUrl
      ? Object.freeze({ publicKey: langfusePublicKey, secretKey: langfuseSecretKey, baseUrl: langfuseBaseUrl })
      : undefined

  return {
    config: Object.freeze({
      tracesEndpoint,
      logsEndpoint,
      serviceName,
      headers,
      langfuse,
    } satisfies OtelConfig),
    warnings,
  }
}
