/**
 * Generic OTEL exporter factory.
 *
 * Creates OTLPTraceExporter and OTLPLogRecordExporter from config.
 * MVP: Generic OTEL backend only. Phase 2 adds Langfuse/LangSmith factories.
 */

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import type { OtelConfig } from '../config.ts'

export interface Exporters {
  readonly traceExporter: OTLPTraceExporter | undefined
  readonly logExporter: OTLPLogExporter | undefined
}

/**
 * Create OTLP HTTP exporters from the resolved config.
 *
 * Returns `undefined` for each signal whose endpoint is not configured.
 * Custom headers from `OTEL_EXPORTER_OTLP_HEADERS` are forwarded to both exporters.
 */
export function createExporters(config: OtelConfig): Exporters {
  const headersObj = Object.keys(config.headers).length > 0 ? { ...config.headers } : undefined

  const traceExporter = config.tracesEndpoint
    ? new OTLPTraceExporter({
        url: config.tracesEndpoint,
        headers: headersObj,
      })
    : undefined

  const logExporter = config.logsEndpoint
    ? new OTLPLogExporter({
        url: config.logsEndpoint,
        headers: headersObj,
      })
    : undefined

  return { traceExporter, logExporter }
}
