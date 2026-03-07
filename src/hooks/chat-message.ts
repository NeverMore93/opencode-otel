/**
 * Hook handler for `chat.message` events.
 *
 * Creates a child span under the session root span each time the model
 * generates a message. The span is stored on the session context so that
 * it can be ended by a subsequent event or by endSession cleanup.
 *
 * Data sensitivity: no message content is ever attached to the span.
 */

import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { getSession, setMessageSpan } from '../telemetry/context.ts'
import { truncateAttributes } from '../telemetry/attributes.ts'

const TRACER_NAME = 'opencode-otel'
const TRACER_VERSION = '0.1.0'

export interface ChatMessageInput {
  readonly sessionID: string
  readonly agent: string
  readonly model: {
    readonly providerID: string
    readonly modelID: string
  }
}

/**
 * Factory that returns a `chat.message` hook handler.
 *
 * @param tracerProvider - Configured BasicTracerProvider with span processors.
 * @param logError - Callback invoked with an error message string if the hook
 *                   encounters an unexpected error. Must not throw.
 */
export function createChatMessageHook(
  tracerProvider: BasicTracerProvider,
  logError: (msg: string) => void,
): (input: ChatMessageInput, output: unknown) => Promise<void> {
  return async (input: ChatMessageInput, _output: unknown): Promise<void> => {
    try {
      const session = getSession(input.sessionID)
      if (session === undefined) return

      const tracer = tracerProvider.getTracer(TRACER_NAME, TRACER_VERSION)

      const attributes = truncateAttributes({
        'opencode.session.id': input.sessionID,
        'opencode.message.agent': input.agent,
        'opencode.message.model.provider': input.model.providerID,
        'opencode.message.model.id': input.model.modelID,
      })

      const span = tracer.startSpan('chat.message', { attributes }, session.traceCtx)

      setMessageSpan(input.sessionID, span)
    } catch (err) {
      logError(
        `chat.message hook error: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}
