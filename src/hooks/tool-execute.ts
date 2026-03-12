/**
 * Hook handlers for `tool.execute.before` and `tool.execute.after` events.
 *
 * `before` — opens a child span for each tool invocation and parks it in the
 *             session's pendingTools map under its callID.
 * `after`  — retrieves the pending span, marks it OK, optionally attaches a
 *             human-readable title, then closes it.
 *
 * Data sensitivity: tool args and tool output are NEVER written to spans.
 *
 * IMPORTANT: OpenCode plugin SDK passes (input, output) where:
 *   before input: { tool, sessionID, callID }
 *   before output: { args }
 *   after input: { tool, sessionID, callID, title? }
 *   after output: unknown
 */

import { SpanStatusCode } from '@opentelemetry/api'
import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { getOrCreateSession, getSession, addToolSpan, removeToolSpan } from '../telemetry/context.ts'
import { truncateString, truncateAttributes } from '../telemetry/attributes.ts'

const TRACER_NAME = 'opencode-otel'
const TRACER_VERSION = '0.1.0'
const TITLE_MAX_LEN = 256

export interface ToolBeforeInput {
  readonly sessionID: string
  readonly tool: string
  readonly callID: string
}

export interface ToolAfterInput {
  readonly sessionID: string
  readonly tool: string
  readonly callID: string
  readonly title?: string
  readonly output?: string
  readonly metadata?: unknown
}

export interface ToolExecuteHooks {
  readonly before: (input: ToolBeforeInput, output: unknown) => Promise<void>
  readonly after: (input: ToolAfterInput, output: unknown) => Promise<void>
}

/**
 * Factory that returns `{ before, after }` hook handlers for tool execution.
 *
 * @param tracerProvider - Configured BasicTracerProvider with span processors.
 * @param logError - Callback invoked with an error message string if a hook
 *                   encounters an unexpected error. Must not throw.
 */
export function createToolExecuteHooks(
  tracerProvider: BasicTracerProvider,
  logError: (msg: string) => void,
): ToolExecuteHooks {
  const before = async (input: ToolBeforeInput, _output: unknown): Promise<void> => {
    try {
      const session = getOrCreateSession(input.sessionID, tracerProvider)
      if (session === undefined) return

      const tracer = tracerProvider.getTracer(TRACER_NAME, TRACER_VERSION)

      const attributes = truncateAttributes({
        'opencode.session.id': input.sessionID,
        'opencode.tool.name': input.tool,
        'opencode.tool.call.id': input.callID,
      })

      const span = tracer.startSpan(`tool.${input.tool}`, { attributes }, session.traceCtx)

      addToolSpan(input.sessionID, input.callID, span)
    } catch (err) {
      logError(
        `tool.before hook error: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  const after = async (input: ToolAfterInput, _output: unknown): Promise<void> => {
    try {
      const span = removeToolSpan(input.sessionID, input.callID)
      if (span === undefined) return

      if (input.title !== undefined) {
        span.setAttribute('opencode.tool.title', truncateString(input.title, TITLE_MAX_LEN))
      }

      span.setStatus({ code: SpanStatusCode.OK })
      span.end()
    } catch (err) {
      logError(
        `tool.after hook error: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return { before, after }
}
