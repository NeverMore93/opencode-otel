/**
 * opencode-otel — OpenCode plugin that forwards runtime stderr logs
 * to an OTLP-compatible log collector via gRPC or HTTP.
 *
 * Mechanism:
 * 1. Monkey-patches process.stderr.write to intercept log output
 * 2. Uses event hook for session lifecycle (session.created / session.idle / session.deleted)
 *    to create trace context — so all logs in a session share the same traceId
 * 3. Business-level traces/spans are handled by opencode-plugin-langfuse
 */

import { loadConfig } from './config.ts'
import { install, type ParsedLine } from './interceptor.ts'
import { initProviders } from './provider.ts'
import { registerShutdown } from './shutdown.ts'
import { startSession, endSession, setActiveSession, getActiveTraceContext } from './session.ts'

const PLUGIN_NAME = 'opencode-otel'

interface PluginContext {
  readonly client: {
    readonly app: {
      log(opts: { body: Record<string, unknown> }): Promise<void>
    }
  }
}

export default async function plugin(ctx: PluginContext) {
  const log = (level: 'info' | 'error') => async (message: string) => {
    try {
      await ctx.client.app.log({
        body: { service: PLUGIN_NAME, level, message: `[${PLUGIN_NAME}] ${message}` },
      })
    } catch {
      // swallow — can't use stderr here (would recurse)
    }
  }

  const logError = log('error')
  const logInfo = log('info')

  try {
    const { config, warnings } = await loadConfig()

    for (const w of warnings) {
      await logError(w)
    }

    if (!config.logsEndpoint) {
      await logInfo('No OTEL logs endpoint configured — plugin inactive')
      return {}
    }

    const { loggerProvider, tracerProvider, logger, tracer } = initProviders(config)

    // Install stderr interceptor — emit log records with trace context
    const interceptor = install((parsed: ParsedLine) => {
      const traceCtx = getActiveTraceContext()
      logger.emit({
        body: parsed.body,
        severityNumber: parsed.severityNumber,
        severityText: parsed.severityText,
        context: traceCtx,
      })
    }, config.maxLineLength)

    registerShutdown(loggerProvider, tracerProvider, interceptor, (msg) => void logError(msg))

    let safeEndpoint: string
    try {
      safeEndpoint = config.logsEndpoint ? new URL(config.logsEndpoint).host : 'unknown'
    } catch {
      safeEndpoint = '(endpoint configured)'
    }
    await logInfo(
      `Initialized — forwarding stderr logs via ${config.logsProtocol} to ${safeEndpoint}`,
    )

    // Event hook: track session lifecycle for trace context correlation
    return {
      event: (input: { event: unknown }) => {
        try {
          const ev = input.event as { type?: string; properties?: Record<string, unknown> } | undefined
          if (!ev || typeof ev.type !== 'string') return Promise.resolve()

          const sessionId = (ev.properties as Record<string, unknown> | undefined)?.sessionID as string | undefined

          if (!sessionId) return Promise.resolve()

          switch (ev.type) {
            case 'session.created':
              startSession(tracer, sessionId)
              break
            case 'session.idle':
            case 'session.deleted':
              endSession(sessionId)
              break
            default:
              // Any event with a sessionID activates that session's trace context
              setActiveSession(sessionId)
              break
          }
        } catch {
          // swallow — never affect OpenCode
        }
        return Promise.resolve()
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logError(`Plugin initialization failed: ${message}`)
    return {}
  }
}
