/**
 * TracerProvider + LoggerProvider initialization with Resource attributes.
 *
 * Sets up OTEL providers with processors from ProcessorSet.
 * Supports multi-backend fan-out via multiple SpanProcessors.
 */

import { hostname as osHostname } from 'node:os'
import pkg from '../../package.json'
import { resourceFromAttributes, envDetector } from '@opentelemetry/resources'
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
export interface PluginContextAttrs {
  readonly directory?: string
  readonly project?: string
}

export function initProviders(
  config: OtelConfig,
  pluginContext?: PluginContextAttrs,
): Providers {
  // Merge env-detected resource attributes (OTEL_RESOURCE_ATTRIBUTES) with explicit ones.
  // Explicit attributes take precedence over env-detected ones.
  const envResource = resourceFromAttributes(
    (envDetector.detect().attributes ?? {}) as Record<string, import('@opentelemetry/api').AttributeValue>,
  )
  const explicitResource = resourceFromAttributes({
    'service.name': config.serviceName,
    'service.version': pkg.version,
    'service.instance.id': `${getHostname()}-${process.pid}`,
    ...(pluginContext?.directory ? { 'opencode.directory': pluginContext.directory } : {}),
    ...(pluginContext?.project ? { 'opencode.project': pluginContext.project } : {}),
  })
  const resource = envResource.merge(explicitResource)

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
