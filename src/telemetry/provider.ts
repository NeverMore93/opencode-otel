/**
 * TracerProvider + LoggerProvider initialization with Resource attributes.
 *
 * Sets up OTEL providers with BatchSpanProcessor/BatchLogRecordProcessor.
 * Uses processor arrays to support future multi-backend fan-out.
 */

import { hostname as osHostname } from 'node:os'
import pkg from '../../package.json'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base'
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  type LogRecordExporter,
} from '@opentelemetry/sdk-logs'
import type { OtelConfig } from '../config.ts'
import { createExporters, type BackendName } from './backends.ts'

export interface BackendInfo {
  readonly name: BackendName
  readonly hasTraces: boolean
  readonly hasLogs: boolean
  readonly tracesUrl: string | undefined
  readonly logsUrl: string | undefined
}

export interface Providers {
  readonly tracerProvider: BasicTracerProvider
  readonly loggerProvider: LoggerProvider
  readonly backend: BackendInfo
}

/**
 * Create and configure OTEL providers from config.
 *
 * Resource attributes:
 * - service.name: from config (default "opencode-agent")
 * - service.version: plugin package version
 * - service.instance.id: "{hostname}-{pid}"
 */
export function initProviders(config: OtelConfig): Providers {
  const resource = resourceFromAttributes({
    'service.name': config.serviceName,
    'service.version': pkg.version,
    'service.instance.id': `${getHostname()}-${process.pid}`,
  })

  const exporters = createExporters(config)
  const { traceExporter, logExporter } = exporters

  const spanProcessors = traceExporter
    ? [new BatchSpanProcessor(traceExporter as SpanExporter)]
    : []

  const logProcessors = logExporter
    ? [new BatchLogRecordProcessor(logExporter as LogRecordExporter)]
    : []

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors,
  })

  const loggerProvider = new LoggerProvider({
    resource,
    processors: logProcessors,
  })

  const backend: BackendInfo = {
    name: exporters.backend,
    hasTraces: traceExporter !== undefined,
    hasLogs: logExporter !== undefined,
    tracesUrl: exporters.tracesUrl,
    logsUrl: exporters.logsUrl,
  }

  return { tracerProvider, loggerProvider, backend }
}

function getHostname(): string {
  try {
    return osHostname()
  } catch (err) {
    console.warn(
      `[opencode-otel] Failed to get hostname: ${err instanceof Error ? err.message : String(err)}`,
    )
    return 'unknown'
  }
}
