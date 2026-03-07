/**
 * Graceful shutdown handler for OTEL providers.
 *
 * Flushes remaining spans and log records on process exit.
 * Listens on beforeExit, SIGINT, and SIGTERM.
 * Errors are logged via callback, never thrown.
 */

import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import type { LoggerProvider } from '@opentelemetry/sdk-logs'

const SHUTDOWN_TIMEOUT_MS = 5_000

type LogFn = (message: string) => void

/**
 * Register process exit handlers that flush both providers.
 *
 * Both shutdown calls race against a 5s timeout.
 * A guard prevents double-shutdown if multiple signals fire.
 * Errors are reported via `logError` (typically `client.app.log`).
 */
export function registerShutdown(
  tracerProvider: BasicTracerProvider,
  loggerProvider: LoggerProvider,
  logError: LogFn,
): void {
  let called = false

  const shutdown = async () => {
    if (called) return
    called = true

    let timeoutId: ReturnType<typeof setTimeout>

    try {
      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS)
      })

      const result = await Promise.race([
        Promise.all([
          tracerProvider.shutdown(),
          loggerProvider.shutdown(),
        ]).then(() => 'ok' as const),
        timeoutPromise,
      ])

      if (result === 'timeout') {
        logError('opencode-otel shutdown timed out after 5s')
      }
    } catch (err) {
      logError(`opencode-otel shutdown error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      clearTimeout(timeoutId!)
    }
  }

  process.on('beforeExit', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
