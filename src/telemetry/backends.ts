/**
 * Backend-specific processor factories for multi-backend fan-out.
 *
 * Creates SpanProcessors and LogRecordProcessors from config.
 * Supports simultaneous Langfuse (native SDK) + Generic OTLP export.
 */

import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { LangfuseSpanProcessor } from '@langfuse/otel'
import type { OtelConfig } from '../config.ts'

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.searchParams.forEach((_value, key) => {
      url.searchParams.set(key, 'REDACTED')
    })
    return url.toString()
  } catch {
    return '<invalid URL>'
  }
}

export interface BackendEntry {
  readonly name: 'langfuse' | 'generic'
  readonly type: 'langfuse-sdk' | 'otlp-http'
  readonly endpointDisplay: string
  readonly hasTraces: boolean
  readonly hasLogs: boolean
}

export interface ProcessorSet {
  readonly spanProcessors: ReadonlyArray<SpanProcessor>
  readonly logProcessors: ReadonlyArray<LogRecordProcessor>
  readonly backends: ReadonlyArray<BackendEntry>
}

/**
 * Create LangfuseSpanProcessor from config.
 *
 * CRITICAL: Passes shouldExportSpan: () => true to override the default
 * filter that only exports spans with gen_ai.* attributes. Our plugin's
 * session/message/tool spans don't have these attributes.
 */
function createLangfuseProcessors(config: OtelConfig): {
  spanProcessors: SpanProcessor[]
  logProcessors: LogRecordProcessor[]
  backend: BackendEntry
} {
  const langfuse = config.langfuse!

  const processor = new LangfuseSpanProcessor({
    publicKey: langfuse.publicKey,
    secretKey: langfuse.secretKey,
    baseUrl: langfuse.baseUrl,
    shouldExportSpan: () => true,
  })

  const baseUrl = langfuse.baseUrl.replace(/\/+$/, '')

  return {
    spanProcessors: [processor as SpanProcessor],
    logProcessors: [],
    backend: {
      name: 'langfuse',
      type: 'langfuse-sdk',
      endpointDisplay: baseUrl,
      hasTraces: true,
      hasLogs: false,
    },
  }
}

/**
 * Create generic OTLP HTTP processors from config.
 *
 * Returns BatchSpanProcessor and/or BatchLogRecordProcessor depending
 * on which endpoints are configured.
 */
function createGenericProcessors(config: OtelConfig): {
  spanProcessors: SpanProcessor[]
  logProcessors: LogRecordProcessor[]
  backend: BackendEntry
} {
  const headersObj = Object.keys(config.headers).length > 0 ? { ...config.headers } : undefined
  const spanProcessors: SpanProcessor[] = []
  const logProcessors: LogRecordProcessor[] = []

  if (config.tracesEndpoint) {
    const traceExporter = new OTLPTraceExporter({
      url: config.tracesEndpoint,
      headers: headersObj,
    })
    spanProcessors.push(new BatchSpanProcessor(traceExporter))
  }

  if (config.logsEndpoint) {
    const logExporter = new OTLPLogExporter({
      url: config.logsEndpoint,
      headers: headersObj,
    })
    logProcessors.push(new BatchLogRecordProcessor(logExporter))
  }

  const endpointParts: string[] = []
  if (config.tracesEndpoint) endpointParts.push(`traces → ${sanitizeUrl(config.tracesEndpoint)}`)
  if (config.logsEndpoint) endpointParts.push(`logs → ${sanitizeUrl(config.logsEndpoint)}`)

  return {
    spanProcessors,
    logProcessors,
    backend: {
      name: 'generic',
      type: 'otlp-http',
      endpointDisplay: endpointParts.join(', '),
      hasTraces: config.tracesEndpoint !== undefined,
      hasLogs: config.logsEndpoint !== undefined,
    },
  }
}

/**
 * Create all processors from config. Supports fan-out to multiple backends.
 *
 * When both Langfuse credentials and generic OTLP endpoints are configured,
 * both backends are created independently. Each backend construction is
 * wrapped in try/catch — a failure in one does not prevent others.
 */
export function createProcessors(config: OtelConfig): ProcessorSet {
  const spanProcessors: SpanProcessor[] = []
  const logProcessors: LogRecordProcessor[] = []
  const backends: BackendEntry[] = []

  if (config.langfuse) {
    try {
      const result = createLangfuseProcessors(config)
      spanProcessors.push(...result.spanProcessors)
      logProcessors.push(...result.logProcessors)
      backends.push(result.backend)
    } catch (err) {
      console.warn(
        `[opencode-otel] Failed to create Langfuse backend: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  if (config.tracesEndpoint || config.logsEndpoint) {
    try {
      const result = createGenericProcessors(config)
      spanProcessors.push(...result.spanProcessors)
      logProcessors.push(...result.logProcessors)
      backends.push(result.backend)
    } catch (err) {
      console.warn(
        `[opencode-otel] Failed to create generic OTLP backend: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return Object.freeze({
    spanProcessors: Object.freeze([...spanProcessors]),
    logProcessors: Object.freeze([...logProcessors]),
    backends: Object.freeze([...backends]),
  })
}
