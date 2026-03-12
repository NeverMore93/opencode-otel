/**
 * OpenCode event hook — emits OTEL spans and log records for session events.
 *
 * Session lifecycle:
 *   session.created  → start root "session" span, store in context map
 *   session.idle     → end root span (via endSession)
 *   session.deleted  → end root span (via endSession)
 *   session.error    → mark root span ERROR (session stays active)
 *
 * All allowed events additionally emit an OTEL LogRecord.
 *
 * Bun AsyncLocalStorage is broken — explicit context map is used instead of
 * context.with() for span propagation.
 *
 * IMPORTANT: OpenCode plugin SDK passes { event: Event } to the event hook,
 * where Event has { type, properties }. The event is nested one level deeper
 * than the hook input.
 */

import { type BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { type LoggerProvider } from '@opentelemetry/sdk-logs'
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api'
import { SeverityNumber } from '@opentelemetry/api-logs'
import { createSession, endSession, getSession } from '../telemetry/context.ts'
import { truncateAttributes, truncateString } from '../telemetry/attributes.ts'
import { getSeverity, isAllowedEvent } from './severity.ts'

const LOGGER_NAME = 'opencode-otel'

/**
 * OpenCode Event type — discriminated union with { type, properties }.
 * See @opencode-ai/sdk EventSessionCreated, EventSessionIdle, etc.
 *
 * The plugin SDK passes this object directly as the hook input.
 */
type EventHookInput = {
  readonly type: string
  readonly properties: Record<string, unknown>
}

/**
 * Resolve a human-readable severity text from a SeverityNumber.
 */
function severityText(severity: SeverityNumber): string {
  if (severity >= SeverityNumber.ERROR) return 'ERROR'
  if (severity >= SeverityNumber.WARN) return 'WARN'
  return 'INFO'
}

/**
 * Extract sessionID from event properties.
 *
 * All events: properties.sessionID (flat form used by plugin SDK)
 * Fallback for session.created/deleted/updated: properties.info.id (nested form)
 */
function extractSessionID(eventType: string, properties: Record<string, unknown>): string {
  // Flat form: all events may carry sessionID directly
  const flat = properties['sessionID']
  if (typeof flat === 'string' && flat !== '') return flat

  // Nested form: session lifecycle events may carry { info: { id } }
  if (
    eventType === 'session.created' ||
    eventType === 'session.deleted'
  ) {
    const info = properties['info']
    if (typeof info === 'object' && info !== null && 'id' in info) {
      const id = (info as { id: unknown }).id
      return typeof id === 'string' ? id : ''
    }
  }

  return ''
}

/**
 * Emit a LogRecord for the event via the loggerProvider.
 */
function emitLogRecord(
  loggerProvider: LoggerProvider,
  eventType: string,
  sessionID: string,
): void {
  const severity = getSeverity(eventType)
  const attrs = truncateAttributes({
    'opencode.event.type': eventType,
    ...(sessionID !== '' ? { 'opencode.session.id': sessionID } : {}),
  })

  const logger = loggerProvider.getLogger(LOGGER_NAME)
  logger.emit({
    severityNumber: severity,
    severityText: severityText(severity),
    body: eventType,
    attributes: attrs,
  })
}

/**
 * Handle session.created:
 *   - Start a root "session" span with opencode.session.id attribute.
 *   - Store span + context in the session map.
 */
function handleSessionCreated(
  tracerProvider: BasicTracerProvider,
  sessionID: string,
): void {
  if (sessionID === '') return

  const tracer = tracerProvider.getTracer(LOGGER_NAME)
  const rootSpan = tracer.startSpan('session', undefined, otelContext.active())
  rootSpan.setAttribute('opencode.session.id', truncateString(sessionID))

  // Build the context carrying the root span so child spans can be parented.
  const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
  createSession(sessionID, traceCtx, rootSpan)
}

/**
 * Handle session.idle / session.deleted:
 *   - Clean up orphaned child spans (endSession handles this).
 *   - End the root span.
 */
function handleSessionEnd(sessionID: string): void {
  if (sessionID === '') return
  endSession(sessionID)
}

/**
 * Handle session.error:
 *   - Set ERROR status on the root span.
 *   - Session remains active (not ended).
 */
function handleSessionError(sessionID: string): void {
  if (sessionID === '') return

  const session = getSession(sessionID)
  if (session === undefined) return

  session.rootSpan.setStatus({
    code: SpanStatusCode.ERROR,
    message: 'session.error event received',
  })
}

/**
 * Factory — creates a bound event hook function.
 *
 * @param tracerProvider  Initialised BasicTracerProvider.
 * @param loggerProvider  Initialised LoggerProvider.
 * @param logError        Callback for non-fatal errors (never throws).
 */
export function createEventHook(
  tracerProvider: BasicTracerProvider,
  loggerProvider: LoggerProvider,
  logError: (msg: string) => void,
): (input: EventHookInput) => Promise<void> {
  return async (input: EventHookInput): Promise<void> => {
    try {
      if (input === undefined || input === null) return

      if (!isAllowedEvent(input.type)) return

      const sessionID = extractSessionID(input.type, input.properties ?? {})

      // --- Session lifecycle ---
      if (input.type === 'session.created') {
        handleSessionCreated(tracerProvider, sessionID)
      } else if (input.type === 'session.idle' || input.type === 'session.deleted') {
        handleSessionEnd(sessionID)
      } else if (input.type === 'session.error') {
        handleSessionError(sessionID)
      }

      // --- Log record for every allowed event ---
      emitLogRecord(loggerProvider, input.type, sessionID)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError(`Event hook error [${input?.type ?? 'unknown'}]: ${message}`)
    }
  }
}
