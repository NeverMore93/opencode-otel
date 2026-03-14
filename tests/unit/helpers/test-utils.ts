/**
 * Shared test infrastructure for opencode-otel unit tests.
 *
 * Centralises provider creation, session setup, and span lookup helpers
 * that were previously duplicated across test files.
 */

import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base'
import { LoggerProvider } from '@opentelemetry/sdk-logs'
import { context as otelContext, trace, type Span } from '@opentelemetry/api'
import { createSession } from '../../../src/telemetry/context.ts'

/**
 * Create a BasicTracerProvider backed by an InMemorySpanExporter.
 */
export function makeTracerProvider(): {
  readonly provider: BasicTracerProvider
  readonly exporter: InMemorySpanExporter
} {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  return { provider, exporter }
}

/**
 * Create both tracer and logger providers for event hook tests.
 */
export function makeAllProviders(): {
  readonly tracerProvider: BasicTracerProvider
  readonly loggerProvider: LoggerProvider
  readonly exporter: InMemorySpanExporter
} {
  const { provider, exporter } = makeTracerProvider()
  return { tracerProvider: provider, loggerProvider: new LoggerProvider(), exporter }
}

/**
 * Generate a unique session ID with an optional prefix.
 */
export function uniqueID(prefix = 'session'): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`
}

/**
 * Generate a unique tool call ID.
 */
export function uniqueCallID(): string {
  return `call-${Math.random().toString(36).slice(2)}`
}

/**
 * Create a test session with a root span and register it in the context map.
 */
export function createTestSession(
  provider: BasicTracerProvider,
  sessionID: string,
): { readonly rootSpan: Span } {
  const tracer = provider.getTracer('test')
  const rootSpan = tracer.startSpan('session.root')
  const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
  createSession(sessionID, traceCtx, rootSpan)
  return { rootSpan }
}

/**
 * Find a finished span by name in the exporter.
 */
export function findSpan(
  exporter: InMemorySpanExporter,
  name: string,
): ReadableSpan | undefined {
  return exporter.getFinishedSpans().find((s) => s.name === name)
}
