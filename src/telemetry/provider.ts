/**
 * TracerProvider + LoggerProvider initialization with Resource attributes.
 *
 * Sets up OTEL providers with processors from ProcessorSet.
 * Supports multi-backend fan-out via multiple SpanProcessors.
 */

import { hostname as osHostname } from 'node:os'
import pkg from '../../package.json'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { LoggerProvider } from '@opentelemetry/sdk-logs'
import type { OtelConfig } from '../config.ts'
import { createProcessors, type BackendEntry } from './backends.ts'

export interface Providers {
  readonly tracerProvider: BasicTracerProvider
  readonly loggerProvider: LoggerProvider
  readonly backends: ReadonlyArray<BackendEntry>
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

  const processorSet = createProcessors(config)

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [...processorSet.spanProcessors],
  })

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [...processorSet.logProcessors],
  })

  return {
    tracerProvider,
    loggerProvider,
    backends: processorSet.backends,
  }
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
