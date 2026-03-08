/**
 * Event severity mapping and allowlist for opencode-otel.
 *
 * Determines which OpenCode events are processed and at what log severity.
 */

import { SeverityNumber } from '@opentelemetry/api-logs'

/**
 * Set of event types that the plugin processes.
 *
 * High-frequency streaming events (e.g. message.part.updated, which fires
 * once per token) are intentionally excluded to avoid exporter overload.
 */
export const EVENT_ALLOWLIST: ReadonlySet<string> = new Set([
  'session.created',
  'session.idle',
  'session.deleted',
  'session.error',
  'message.created',
  'message.updated',
  'message.completed',
  'file.edited',
  'command.executed',
  'permission.granted',
  'permission.denied',
  'permission.requested',
  'tool.start',
  'tool.end',
])

/**
 * Returns true when the event type is in the allowlist and should be
 * forwarded to the OTEL pipeline.
 */
export function isAllowedEvent(eventType: string): boolean {
  return EVENT_ALLOWLIST.has(eventType)
}

/**
 * Maps an OpenCode event type to an OTEL SeverityNumber.
 *
 * Rules (evaluated in order):
 *   1. session.error              → ERROR (17)
 *   2. permission.*               → WARN  (13)
 *   3. Everything else            → INFO  (9)
 */
export function getSeverity(eventType: string): SeverityNumber {
  if (eventType === 'session.error') {
    return SeverityNumber.ERROR
  }

  if (eventType.startsWith('permission.')) {
    return SeverityNumber.WARN
  }

  return SeverityNumber.INFO
}
