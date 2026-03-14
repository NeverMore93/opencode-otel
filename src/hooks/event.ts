/**
 * OpenCode event hook — emits OTEL spans and log records for bus events.
 *
 * Lazy root span creation:
 *   Any event with a sessionID lazily creates a root "session" span via
 *   getOrCreateSession(). This handles pre-existing sessions (e.g. Feishu
 *   long-lived sessions) that never fired session.created.
 *
 * Session lifecycle:
 *   session.idle     → end root span (via endSession)
 *   session.deleted  → end root span (via endSession)
 *   session.error    → mark root span ERROR (session stays active)
 *
 * Message lifecycle:
 *   message.created   → start "message" child span under session root
 *   message.completed → end message child span
 *
 * All allowed events additionally emit an OTEL LogRecord.
 *
 * IMPORTANT: OpenCode plugin SDK passes { event: Event } to the event hook,
 * where Event has { type, properties }. The event is nested one level deeper
 * than the hook input.
 */

import { type BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { type LoggerProvider } from '@opentelemetry/sdk-logs'
import { SpanStatusCode } from '@opentelemetry/api'
import { SeverityNumber } from '@opentelemetry/api-logs'
import { addToolSpan, endMessageSpan, endSession, getOrCreateSession, getSession, removeToolSpan, setMessageSpan } from '../telemetry/context.ts'
import { truncateAttributes, extractSafeAttributes } from '../telemetry/attributes.ts'
import { TRACER_NAME, TRACER_VERSION, LOGGER_NAME } from '../telemetry/constants.ts'
import { getSeverity, isAllowedEvent } from './severity.ts'

const DEBUG = process.env['OTEL_PLUGIN_DEBUG'] === '1'

const EVENT_SKIP_KEYS: ReadonlySet<string> = new Set(['sessionID', 'info'])
const SESSION_SKIP_KEYS: ReadonlySet<string> = new Set(['id'])

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
 * Fallback for session.created/deleted: properties.info.id (nested form)
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
 * Forward session.created info properties to the root span as attributes.
 * Extracts all safe string/number fields from properties.info.
 */
function forwardSessionAttributes(
  sessionID: string,
  properties: Record<string, unknown>,
): void {
  const session = getSession(sessionID)
  if (session === undefined) return

  const info = properties['info']
  if (typeof info !== 'object' || info === null) return

  const attrs = extractSafeAttributes(info as Record<string, unknown>, 'opencode.session.', SESSION_SKIP_KEYS)
  session.rootSpan.setAttributes(attrs)
}

/**
 * Emit a LogRecord for the event via the loggerProvider.
 */
function emitLogRecord(
  loggerProvider: LoggerProvider,
  eventType: string,
  sessionID: string,
  properties: Record<string, unknown>,
): void {
  const severity = getSeverity(eventType)
  const eventAttrs = extractSafeAttributes(properties, 'opencode.event.', EVENT_SKIP_KEYS)
  const attrs = truncateAttributes({
    'opencode.event.type': eventType,
    ...(sessionID !== '' ? { 'opencode.session.id': sessionID } : {}),
    ...eventAttrs,
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
 * Handle message.created:
 *   - Start a "message" child span under the session root.
 */
function handleMessageCreated(
  tracerProvider: BasicTracerProvider,
  sessionID: string,
): void {
  const session = getSession(sessionID)
  if (session === undefined) return

  const tracer = tracerProvider.getTracer(TRACER_NAME, TRACER_VERSION)
  const messageSpan = tracer.startSpan('message', undefined, session.traceCtx)
  setMessageSpan(sessionID, messageSpan, 'fallback')
}

/**
 * Handle tool.start:
 *   - Start a tool child span under the session root (fallback source).
 *   - Discarded if tool.execute.before already created a primary span.
 */
function handleToolStart(
  tracerProvider: BasicTracerProvider,
  sessionID: string,
  properties: Record<string, unknown>,
): void {
  const session = getSession(sessionID)
  if (session === undefined) return

  const callID = typeof properties['callID'] === 'string' ? properties['callID'] : ''
  if (callID === '') return

  const toolName = (typeof properties['tool'] === 'string' && properties['tool'] !== '') ? properties['tool'] : 'unknown'

  const tracer = tracerProvider.getTracer(TRACER_NAME, TRACER_VERSION)
  const attributes = truncateAttributes({
    'opencode.session.id': sessionID,
    'opencode.tool.name': toolName,
    'opencode.tool.call.id': callID,
  })

  const span = tracer.startSpan(`tool.${toolName}`, { attributes }, session.traceCtx)
  addToolSpan(sessionID, callID, span, 'fallback')
}

/**
 * Handle tool.end:
 *   - End the pending tool span for the given callID.
 */
function handleToolEnd(
  sessionID: string,
  properties: Record<string, unknown>,
): void {
  const callID = typeof properties['callID'] === 'string' ? properties['callID'] : ''
  if (callID === '') return

  const span = removeToolSpan(sessionID, callID)
  if (span === undefined) return

  span.setStatus({ code: SpanStatusCode.OK })
  span.end()
}

/**
 * Handle message.completed:
 *   - End the active message span.
 */
function handleMessageCompleted(sessionID: string): void {
  endMessageSpan(sessionID)
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

      const properties = input.properties ?? {}
      const sessionID = extractSessionID(input.type, properties)

      // --- Debug logging for runtime visibility ---
      if (DEBUG) console.error(`[opencode-otel] event: ${input.type} session=${sessionID || 'none'}`)

      // --- Lazy root span creation ---
      // Ensures a root span exists for any event carrying a sessionID.
      // Handles pre-existing sessions (e.g. Feishu long-lived sessions
      // created before the plugin loaded) that never fired session.created.
      if (sessionID !== '') {
        getOrCreateSession(sessionID, tracerProvider)
      }

      // --- Forward session.created info to root span attributes ---
      if (input.type === 'session.created' && sessionID !== '') {
        forwardSessionAttributes(sessionID, properties)
      }

      // --- Session lifecycle ---
      if (input.type === 'session.idle' || input.type === 'session.deleted') {
        handleSessionEnd(sessionID)
      } else if (input.type === 'session.error') {
        handleSessionError(sessionID)
      }

      // --- Message lifecycle ---
      if (input.type === 'message.created') {
        handleMessageCreated(tracerProvider, sessionID)
      } else if (input.type === 'message.completed') {
        handleMessageCompleted(sessionID)
      }

      // --- Tool lifecycle (fallback for Feishu mode) ---
      if (input.type === 'tool.start') {
        handleToolStart(tracerProvider, sessionID, properties)
      } else if (input.type === 'tool.end') {
        handleToolEnd(sessionID, properties)
      }

      // --- Log record for every allowed event ---
      emitLogRecord(loggerProvider, input.type, sessionID, properties)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logError(`Event hook error [${input?.type ?? 'unknown'}]: ${message}`)
    }
  }
}
