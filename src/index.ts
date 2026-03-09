/**
 * opencode-otel — OpenCode plugin for unified observability via OpenTelemetry.
 *
 * Exports session traces and logs to any OTLP-compatible backend
 * (Langfuse, LangSmith, Jaeger, Grafana Tempo, etc.).
 */

import { loadConfig } from './config.ts'
import { initProviders } from './telemetry/provider.ts'
import { registerShutdown } from './telemetry/shutdown.ts'
import { createEventHook } from './hooks/event.ts'
import { createChatMessageHook } from './hooks/chat-message.ts'
import { createToolExecuteHooks } from './hooks/tool-execute.ts'

interface PluginContext {
  readonly client: {
    readonly app: {
      log(opts: { body: Record<string, unknown> }): Promise<void>
    }
  }
}

/**
 * Plugin entry point. Called by OpenCode when the plugin is loaded.
 *
 * Initializes OTEL providers and registers hooks for session event
 * capture. If initialization fails, returns empty hooks (graceful degradation).
 */
export default async function plugin(ctx: PluginContext) {
  const log = (level: 'info' | 'error') => async (message: string) => {
    try {
      await ctx.client.app.log({
        body: { service: 'opencode-otel', level, message },
      })
    } catch {
      // Silently drop — cannot log
    }
  }

  const logError = log('error')
  const logInfo = log('info')

  try {
    const config = await loadConfig()

    if (!config.tracesEndpoint && !config.logsEndpoint) {
      await logInfo('No OTEL endpoints configured — plugin inactive')
      return {}
    }

    const { tracerProvider, loggerProvider } = initProviders(config)

    registerShutdown(tracerProvider, loggerProvider, logError)

    const eventHook = createEventHook(tracerProvider, loggerProvider, logError)

    const chatMessageHook = createChatMessageHook(tracerProvider, logError)

    const toolHooks = createToolExecuteHooks(tracerProvider, logError)

    const backends = [
      config.tracesEndpoint ? 'traces' : null,
      config.logsEndpoint ? 'logs' : null,
    ].filter(Boolean).join(', ')

    await logInfo(`Initialized — endpoints: ${backends}, service: ${config.serviceName}`)

    return {
      event: eventHook,
      'chat.message': chatMessageHook,
      'tool.execute.before': toolHooks.before,
      'tool.execute.after': toolHooks.after,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logError(`Plugin initialization failed: ${message}`)
    return {}
  }
}
