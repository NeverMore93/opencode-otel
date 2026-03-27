/**
 * Session tracker — manages trace context per OpenCode session.
 *
 * Creates a root span per session so that all log records emitted during
 * that session share the same traceId. This enables log-to-session correlation
 * in the observability backend.
 *
 * Uses a Map<sessionID, Span> since Bun's AsyncLocalStorage is broken.
 */

import { type Tracer, type Span, SpanStatusCode, context, trace } from '@opentelemetry/api'

const sessions = new Map<string, Span>()

let activeSessionId: string | undefined

export function getActiveTraceContext() {
  if (!activeSessionId) return undefined
  const span = sessions.get(activeSessionId)
  if (!span) return undefined
  return trace.setSpan(context.active(), span)
}

export function startSession(tracer: Tracer, sessionId: string): void {
  if (sessions.has(sessionId)) return
  const span = tracer.startSpan('session', {
    attributes: { 'opencode.session.id': sessionId },
  })
  sessions.set(sessionId, span)
  activeSessionId = sessionId
}

export function endSession(sessionId: string): void {
  const span = sessions.get(sessionId)
  if (!span) return
  span.end()
  sessions.delete(sessionId)
  if (activeSessionId === sessionId) {
    // Switch to the most recent remaining session, or undefined
    const remaining = [...sessions.keys()]
    activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1] : undefined
  }
}

export function setActiveSession(sessionId: string): void {
  if (sessions.has(sessionId)) {
    activeSessionId = sessionId
  }
}

export function endAllSessions(): void {
  for (const [id, span] of sessions) {
    span.setStatus({ code: SpanStatusCode.OK })
    span.end()
  }
  sessions.clear()
  activeSessionId = undefined
}
