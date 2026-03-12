/**
 * OTEL exporter factories for supported backends.
 *
 * Creates OTLPTraceExporter and OTLPLogRecordExporter from config.
 * Supports: Generic OTLP, Langfuse.
 */

import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import type { OtelConfig } from '../config.ts'

export type BackendName = 'langfuse' | 'generic'

export interface Exporters {
  readonly traceExporter: OTLPTraceExporter | undefined
  readonly logExporter: OTLPLogExporter | undefined
  readonly backend: BackendName
  readonly tracesUrl: string | undefined
  readonly logsUrl: string | undefined
}

/**
 * Create Langfuse-specific OTLP exporters.
 *
 * Langfuse exposes OTLP-compatible endpoints under /api/public/otel/v1/*.
 * Auth uses HTTP Basic with publicKey:secretKey.
 */
function createLangfuseExporters(config: OtelConfig): Exporters {
  const langfuse = config.langfuse!
  const authHeader = `Basic ${btoa(langfuse.publicKey + ':' + langfuse.secretKey)}`
  const headers = { ...config.headers, Authorization: authHeader }

  const baseUrl = langfuse.baseUrl.replace(/\/+$/, '')
  const tracesUrl = `${baseUrl}/api/public/otel/v1/traces`
  const logsUrl = `${baseUrl}/api/public/otel/v1/logs`

  return {
    traceExporter: new OTLPTraceExporter({ url: tracesUrl, headers }),
    logExporter: new OTLPLogExporter({ url: logsUrl, headers }),
    backend: 'langfuse',
    tracesUrl,
    logsUrl,
  }
}

/**
 * Create generic OTLP HTTP exporters from the resolved config.
 *
 * Returns `undefined` for each signal whose endpoint is not configured.
 * Custom headers from `OTEL_EXPORTER_OTLP_HEADERS` are forwarded to both exporters.
 */
function createGenericExporters(config: OtelConfig): Exporters {
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

  return {
    traceExporter,
    logExporter,
    backend: 'generic',
    tracesUrl: config.tracesEndpoint,
    logsUrl: config.logsEndpoint,
  }
}

/**
 * Create exporters from config. Prefers Langfuse when credentials are set,
 * falls back to generic OTLP.
 */
export function createExporters(config: OtelConfig): Exporters {
  if (config.langfuse) {
    return createLangfuseExporters(config)
  }
  return createGenericExporters(config)
}
