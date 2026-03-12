/**
 * opencode-otel — OpenCode plugin for unified observability via OpenTelemetry.
 *
 * Exports session traces and logs to any OTLP-compatible backend
 * (Langfuse, LangSmith, Jaeger, Grafana Tempo, etc.).
 */

import { loadConfig } from './config.ts'
import { initProviders } from './telemetry/provider.ts'
import type { BackendEntry } from './telemetry/backends.ts'
import { registerShutdown } from './telemetry/shutdown.ts'
import { createEventHook } from './hooks/event.ts'
import { createChatMessageHook } from './hooks/chat-message.ts'
import { createToolExecuteHooks } from './hooks/tool-execute.ts'

const PLUGIN_NAME = 'opencode-otel'

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.searchParams.forEach((_value, key) => {
      url.searchParams.set(key, 'REDACTED')
    })
    return url.toString()
  } catch (err) {
    console.warn(
      `[opencode-otel] Failed to parse endpoint URL: ${err instanceof Error ? err.message : String(err)}`,
    )
    return '<invalid URL>'
  }
}

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
        body: { service: PLUGIN_NAME, level, message: `[${PLUGIN_NAME}] ${message}` },
      })
    } catch (err) {
      console.warn(
        `[opencode-otel] Failed to send log to OpenCode: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const logError = log('error')
  const logInfo = log('info')

  try {
    const config = await loadConfig()

    if (!config.tracesEndpoint && !config.logsEndpoint && !config.langfuse) {
      await logInfo('No OTEL endpoints configured — plugin inactive')
      return {}
    }

    const { tracerProvider, loggerProvider, backends } = initProviders(config)

    if (backends.length === 0) {
      await logInfo('No backends initialized — plugin inactive')
      return {}
    }

    registerShutdown(tracerProvider, loggerProvider, logError)

    const eventHook = createEventHook(tracerProvider, loggerProvider, logError)
    const chatMessageHook = createChatMessageHook(tracerProvider, logError)
    const toolHooks = createToolExecuteHooks(tracerProvider, logError)

    const backendNames = backends.map((b: BackendEntry) => b.name).join(', ')
    await logInfo(
      `Initialized — backends: ${backendNames} (${backends.length} active), service: ${config.serviceName}`,
    )

    for (const backend of backends) {
      await logInfo(`Backend [${backend.name}]: ${backend.endpointDisplay}`)
    }

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
