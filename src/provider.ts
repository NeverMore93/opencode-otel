/**
 * Provider setup — LoggerProvider + TracerProvider with resource detection.
 *
 * TracerProvider is minimal: only used to create session root spans for
 * log-to-session correlation (traceId). No detailed message/tool spans.
 */

import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { OTLPLogExporter as GrpcLogExporter } from '@opentelemetry/exporter-logs-otlp-grpc'
import { OTLPLogExporter as HttpLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPTraceExporter as GrpcTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { envDetector, resourceFromAttributes } from '@opentelemetry/resources'
import { Metadata } from '@grpc/grpc-js'
import type { Tracer } from '@opentelemetry/api'
import type { OtelConfig } from './config.ts'
import type { Logger } from '@opentelemetry/api-logs'

export interface ProviderResult {
  readonly loggerProvider: LoggerProvider
  readonly tracerProvider: BasicTracerProvider
  readonly logger: Logger
  readonly tracer: Tracer
}

function grpcMetadata(headers: Record<string, string>): Metadata {
  const metadata = new Metadata()
  for (const [key, value] of Object.entries(headers)) {
    metadata.set(key, value)
  }
  return metadata
}

export function initProviders(config: OtelConfig): ProviderResult {
  // Resource: env-detected attrs merged with explicit service.name
  const envAttrs = envDetector.detect().attributes as Record<string, string>
  const resource = resourceFromAttributes({
    ...envAttrs,
    'service.name': config.serviceName,
  })

  const hasHeaders = Object.keys(config.headers).length > 0
  const metadata = hasHeaders ? grpcMetadata({ ...config.headers }) : undefined

  // Log exporter: gRPC or HTTP
  const logExporter = config.logsProtocol === 'grpc'
    ? new GrpcLogExporter({
        url: config.logsEndpoint,
        metadata,
      })
    : new HttpLogExporter({
        url: config.logsEndpoint,
        headers: hasHeaders ? { ...config.headers } : undefined,
      })

  const logProcessor = new BatchLogRecordProcessor(logExporter)
  const loggerProvider = new LoggerProvider({ resource, logRecordProcessors: [logProcessor] })
  const logger = loggerProvider.getLogger('opencode-otel', '1.0.0')

  // Trace exporter: gRPC only (same endpoint as logs, for session correlation)
  // Traces go to the traces collector, not the logs collector
  const traceExporter = config.tracesEndpoint
    ? new GrpcTraceExporter({
        url: config.tracesEndpoint,
        metadata,
      })
    : new GrpcTraceExporter({
        url: config.logsEndpoint, // fallback: same endpoint as logs
        metadata,
      })

  const spanProcessor = new BatchSpanProcessor(traceExporter)
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [spanProcessor],
  })
  const tracer = tracerProvider.getTracer('opencode-otel', '1.0.0')

  return { loggerProvider, tracerProvider, logger, tracer }
}
