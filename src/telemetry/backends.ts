/**
 * Backend-specific processor factories for multi-backend fan-out.
 *
 * Creates SpanProcessors and LogRecordProcessors for OTLP export (HTTP or gRPC).
 */

import type { SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPTraceExporter as GrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { OTLPLogExporter as GrpcLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc'
import { Metadata } from '@grpc/grpc-js'
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

function grpcMetadata(headers: Record<string, string>): Metadata {
  const metadata = new Metadata()
  for (const [key, value] of Object.entries(headers)) {
    metadata.set(key, value)
  }
  return metadata
}

export interface BackendEntry {
  readonly name: 'generic'
  readonly type: 'otlp-http' | 'otlp-grpc'
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
 * Create all processors from config. Supports fan-out to multiple backends.
 *
 * Each backend construction is wrapped in try/catch — a failure in one does
 * not prevent others. Protocol selection (gRPC vs HTTP) is driven by the
 * tracesProtocol and logsProtocol fields on config.
 */
export function createProcessors(config: OtelConfig): ProcessorSet {
  const spanProcessors: SpanProcessor[] = []
  const logProcessors: LogRecordProcessor[] = []
  const backends: BackendEntry[] = []

  const headersObj = Object.keys(config.headers).length > 0 ? { ...config.headers } : undefined
  const endpointParts: string[] = []

  // Traces
  if (config.tracesEndpoint) {
    try {
      if (config.tracesProtocol === 'grpc') {
        const exporter = new GrpcTraceExporter({
          url: config.tracesEndpoint,
          metadata: headersObj ? grpcMetadata(headersObj) : undefined,
        })
        spanProcessors.push(new BatchSpanProcessor(exporter))
      } else {
        const exporter = new OTLPTraceExporter({
          url: config.tracesEndpoint,
          headers: headersObj,
        })
        spanProcessors.push(new BatchSpanProcessor(exporter))
      }
      endpointParts.push(`traces(${config.tracesProtocol}) → ${sanitizeUrl(config.tracesEndpoint)}`)
    } catch (err) {
      console.warn(`[opencode-otel] Failed to create trace exporter: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Logs
  if (config.logsEndpoint) {
    try {
      if (config.logsProtocol === 'grpc') {
        const exporter = new GrpcLogExporter({
          url: config.logsEndpoint,
          metadata: headersObj ? grpcMetadata(headersObj) : undefined,
        })
        logProcessors.push(new BatchLogRecordProcessor(exporter))
      } else {
        const exporter = new OTLPLogExporter({
          url: config.logsEndpoint,
          headers: headersObj,
        })
        logProcessors.push(new BatchLogRecordProcessor(exporter))
      }
      endpointParts.push(`logs(${config.logsProtocol}) → ${sanitizeUrl(config.logsEndpoint)}`)
    } catch (err) {
      console.warn(`[opencode-otel] Failed to create log exporter: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (endpointParts.length > 0) {
    const hasGrpc = config.tracesProtocol === 'grpc' || config.logsProtocol === 'grpc'
    backends.push({
      name: 'generic',
      type: hasGrpc ? 'otlp-grpc' : 'otlp-http',
      endpointDisplay: endpointParts.join(', '),
      hasTraces: config.tracesEndpoint !== undefined,
      hasLogs: config.logsEndpoint !== undefined,
    })
  }

  return Object.freeze({
    spanProcessors: Object.freeze([...spanProcessors]),
    logProcessors: Object.freeze([...logProcessors]),
    backends: Object.freeze([...backends]),
  })
}
