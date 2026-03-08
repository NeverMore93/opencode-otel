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
 */

import { type BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { type LoggerProvider } from '@opentelemetry/sdk-logs'
import { SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api'
import { SeverityNumber } from '@opentelemetry/api-logs'
import { createSession, endSession, getSession } from '../telemetry/context.ts'
import { truncateAttributes, truncateString } from '../telemetry/attributes.ts'
import { getSeverity, isAllowedEvent } from './severity.ts'

const LOGGER_NAME = 'opencode-otel'

type EventPayload = {
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
 * Extract sessionID from event properties. Returns empty string when absent.
 */
function extractSessionID(properties: Record<string, unknown>): string {
  const raw = properties['sessionID']
  return typeof raw === 'string' ? raw : ''
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
): (event: EventPayload) => Promise<void> {
  return async (event: EventPayload): Promise<void> => {
    try {
      if (!isAllowedEvent(event.type)) return

      const sessionID = extractSessionID(event.properties)

      // --- Session lifecycle ---
      if (event.type === 'session.created') {
        handleSessionCreated(tracerProvider, sessionID)
      } else if (event.type === 'session.idle' || event.type === 'session.deleted') {
        handleSessionEnd(sessionID)
      } else if (event.type === 'session.error') {
        handleSessionError(sessionID)
      }

      // --- Log record for every allowed event ---
      emitLogRecord(loggerProvider, event.type, sessionID)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError(`opencode-otel event hook error [${event.type}]: ${message}`)
    }
  }
}
