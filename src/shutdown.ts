/**
 * Graceful shutdown — flush pending log records and trace spans before process exit.
 */

import type { LoggerProvider } from '@opentelemetry/sdk-logs'
import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import type { Interceptor } from './interceptor.ts'
import { endAllSessions } from './session.ts'

const SHUTDOWN_TIMEOUT_MS = 5000

export function registerShutdown(
  loggerProvider: LoggerProvider,
  tracerProvider: BasicTracerProvider,
  interceptor: Interceptor,
  logError: (msg: string) => void,
): void {
  let shuttingDown = false

  async function shutdown() {
    if (shuttingDown) return
    shuttingDown = true

    try {
      interceptor.flush()
      endAllSessions()
      await Promise.race([
        Promise.all([
          loggerProvider.forceFlush(),
          tracerProvider.forceFlush(),
        ]),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Flush timeout')), SHUTDOWN_TIMEOUT_MS),
        ),
      ])
    } catch (err) {
      logError(`Shutdown flush failed: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      await loggerProvider.shutdown()
      await tracerProvider.shutdown()
    } catch {
      // swallow
    }
  }

  process.on('beforeExit', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}
