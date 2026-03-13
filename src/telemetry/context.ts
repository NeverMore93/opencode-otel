/**
 * Session context map — Bun workaround for broken AsyncLocalStorage.
 *
 * Maintains explicit Map<sessionID, SessionContext> so that span context
 * can be propagated across async boundaries without relying on
 * AsyncLocalStorage (which is non-functional in Bun).
 */

import { type Context, type Span, SpanStatusCode, context as otelContext, trace } from '@opentelemetry/api'
import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { truncateString } from './attributes.ts'

export type SessionContext = {
  readonly traceCtx: Context
  readonly rootSpan: Span
  messageSpan?: Span
  readonly pendingTools: Map<string, Span>
}

const sessions = new Map<string, SessionContext>()

/**
 * Store a new session context. Overwrites any existing entry for the same
 * sessionID (callers should guard against duplicate creation).
 */
export function createSession(
  sessionID: string,
  traceCtx: Context,
  rootSpan: Span,
): void {
  if (sessions.has(sessionID)) {
    console.warn(`[opencode-otel] Overwriting existing session: ${sessionID}`)
    endSession(sessionID)
  }
  sessions.set(sessionID, {
    traceCtx,
    rootSpan,
    pendingTools: new Map(),
  })
}

/**
 * Look up a session by ID. Returns undefined if not found.
 */
export function getSession(sessionID: string): SessionContext | undefined {
  return sessions.get(sessionID)
}

/**
 * Look up a session by ID; if not found, lazily create a root span.
 *
 * This handles pre-existing sessions (created before the plugin loaded,
 * e.g. Feishu long-lived sessions) that never fired session.created.
 */
export function getOrCreateSession(
  sessionID: string,
  tracerProvider: BasicTracerProvider,
): SessionContext | undefined {
  if (sessionID === '') return undefined

  const existing = sessions.get(sessionID)
  if (existing !== undefined) return existing

  const tracer = tracerProvider.getTracer('opencode-otel')
  const rootSpan = tracer.startSpan('session', undefined, otelContext.active())
  rootSpan.setAttribute('opencode.session.id', truncateString(sessionID))

  const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
  const newSession: SessionContext = { traceCtx, rootSpan, pendingTools: new Map() }
  sessions.set(sessionID, newSession)

  return newSession
}

/**
 * Attach the current message span to a session.
 *
 * @param source - `'primary'` (dedicated hook) always sets, ending any existing span.
 *                 `'fallback'` (event hook) only sets if no span exists; discards otherwise.
 */
export function setMessageSpan(
  sessionID: string,
  span: Span,
  source: 'fallback' | 'primary' = 'primary',
): void {
  const session = sessions.get(sessionID)
  if (session === undefined) return
  if (session.messageSpan !== undefined) {
    if (source === 'fallback') {
      span.end()
      return
    }
    session.messageSpan.end()
  }
  session.messageSpan = span
}

/**
 * Register a pending tool span under its callID.
 *
 * @param source - `'primary'` (dedicated hook) always sets, ending any existing span for callID.
 *                 `'fallback'` (event hook) only sets if no span exists for callID; discards otherwise.
 */
export function addToolSpan(
  sessionID: string,
  callID: string,
  span: Span,
  source: 'fallback' | 'primary' = 'primary',
): void {
  const session = sessions.get(sessionID)
  if (session === undefined) return
  const existing = session.pendingTools.get(callID)
  if (existing !== undefined) {
    if (source === 'fallback') {
      span.end()
      return
    }
    existing.end()
  }
  session.pendingTools.set(callID, span)
}

/**
 * Remove and return a pending tool span by callID.
 * Returns undefined if the session or callID is not found.
 */
export function removeToolSpan(
  sessionID: string,
  callID: string,
): Span | undefined {
  const session = sessions.get(sessionID)
  if (session === undefined) return undefined
  const span = session.pendingTools.get(callID)
  session.pendingTools.delete(callID)
  return span
}

/**
 * Tear down a session:
 * 1. End the active messageSpan (if any).
 * 2. End every orphaned pendingTool span with ERROR status.
 * 3. End the root span.
 * 4. Remove the session from the map.
 *
 * Calling .end() on an already-ended span is a safe no-op in OTEL SDK.
 */
export function endSession(sessionID: string): void {
  const session = sessions.get(sessionID)
  if (session === undefined) return

  if (session.messageSpan !== undefined) {
    session.messageSpan.end()
  }

  if (session.pendingTools.size > 0) {
    console.warn(
      `[opencode-otel] Ending ${session.pendingTools.size} orphaned tool span(s) for session ${sessionID}`,
    )
  }
  for (const [, toolSpan] of session.pendingTools) {
    toolSpan.setStatus({ code: SpanStatusCode.ERROR, message: 'orphaned tool span — session ended before tool completed' })
    toolSpan.end()
  }

  session.rootSpan.end()
  sessions.delete(sessionID)
}
