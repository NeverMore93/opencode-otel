/**
 * Configuration types and loading for opencode-otel.
 *
 * Sources (in precedence order, highest first):
 *   1. Environment variables
 *   2. .opencode/plugins/otel.json (if present)
 *   3. Built-in defaults
 */

/** Parsed representation of OTEL_EXPORTER_OTLP_HEADERS */
export type OtelHeaders = Readonly<Record<string, string>>

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
}

const DEFAULT_SERVICE_NAME = 'opencode-agent'
const CONFIG_FILE_PATH = '.opencode/plugins/otel.json'

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
 * Attempt to read and parse the optional config file.
 * Returns `null` if the file does not exist or cannot be parsed.
 * Never throws.
 */
async function readConfigFile(): Promise<ConfigFileShape | null> {
  try {
    const file = Bun.file(CONFIG_FILE_PATH)
    const exists = await file.exists()
    if (!exists) {
      return null
    }
    const parsed: unknown = await file.json()
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null
    }
    return parsed as ConfigFileShape
  } catch {
    return null
  }
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
function fileHeaders(raw: unknown): Record<string, string> {
  if (typeof raw === 'string') {
    return parseOtlpHeaders(raw) as Record<string, string>
  }
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const result: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') {
        result[k] = v
      }
    }
    return result
  }
  return {}
}

/**
 * Load and merge configuration from all sources.
 *
 * Precedence (highest → lowest):
 *   env vars → config file → defaults
 *
 * The returned object is deeply frozen (immutable).
 */
export async function loadConfig(): Promise<OtelConfig> {
  const fileConfig = await readConfigFile()

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
      : Object.freeze(fileHeaders(fileConfig?.headers))

  return Object.freeze({
    tracesEndpoint,
    logsEndpoint,
    serviceName,
    headers,
  } satisfies OtelConfig)
}
