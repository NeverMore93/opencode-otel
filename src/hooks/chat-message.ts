/**
 * Hook handler for `chat.message` events.
 *
 * Creates a child span under the session root span each time the model
 * generates a message. The span is stored on the session context so that
 * it can be ended by a subsequent event or by endSession cleanup.
 *
 * Data sensitivity: no message content is ever attached to the span.
 *
 * IMPORTANT: OpenCode plugin SDK passes (input, output) where:
 *   input: { sessionID, agent?, model?: { providerID, modelID }, messageID?, variant? }
 *   output: { message: UserMessage, parts: Part[] }
 *   model is OPTIONAL.
 */

import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { getOrCreateSession, setMessageSpan } from '../telemetry/context.ts'
import { truncateAttributes } from '../telemetry/attributes.ts'
import { TRACER_NAME, TRACER_VERSION } from '../telemetry/constants.ts'

export interface ChatMessageInput {
  readonly sessionID: string
  readonly agent?: string
  readonly model?: {
    readonly providerID: string
    readonly modelID: string
  }
  readonly messageID?: string
  readonly variant?: string
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
      const session = getOrCreateSession(input.sessionID, tracerProvider)
      if (session === undefined) return

      const tracer = tracerProvider.getTracer(TRACER_NAME, TRACER_VERSION)

      const attributes = truncateAttributes({
        'opencode.session.id': input.sessionID,
        ...(input.agent !== undefined ? { 'opencode.message.agent': input.agent } : {}),
        ...(input.model && { 'opencode.message.model.provider': input.model.providerID, 'opencode.message.model.id': input.model.modelID }),
        ...(input.messageID !== undefined ? { 'opencode.message.id': input.messageID } : {}),
        ...(input.variant !== undefined ? { 'opencode.message.variant': input.variant } : {}),
      })

      const span = tracer.startSpan('chat.message', { attributes }, session.traceCtx)

      setMessageSpan(input.sessionID, span, 'primary')
    } catch (err) {
      logError(
        `chat.message hook error: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}
