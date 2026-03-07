import { describe, test, expect } from 'bun:test'
import { SeverityNumber } from '@opentelemetry/api-logs'
import {
  getSeverity,
  isAllowedEvent,
  EVENT_ALLOWLIST,
} from '../../src/hooks/severity.ts'

// ---------------------------------------------------------------------------
// getSeverity
// ---------------------------------------------------------------------------

describe('getSeverity', () => {
  test('session.error → ERROR (17)', () => {
    expect(getSeverity('session.error')).toBe(SeverityNumber.ERROR)
    expect(getSeverity('session.error')).toBe(17)
  })

  test('permission.* → WARN (13)', () => {
    expect(getSeverity('permission.granted')).toBe(SeverityNumber.WARN)
    expect(getSeverity('permission.denied')).toBe(SeverityNumber.WARN)
    expect(getSeverity('permission.requested')).toBe(SeverityNumber.WARN)
    expect(getSeverity('permission.anything')).toBe(SeverityNumber.WARN)
    expect(getSeverity('permission.')).toBe(SeverityNumber.WARN)
    expect(getSeverity('permission.granted')).toBe(13)
  })

  test('session.created → INFO (9)', () => {
    expect(getSeverity('session.created')).toBe(SeverityNumber.INFO)
    expect(getSeverity('session.created')).toBe(9)
  })

  test('session.deleted → INFO (9)', () => {
    expect(getSeverity('session.deleted')).toBe(SeverityNumber.INFO)
  })

  test('session.idle → INFO (9)', () => {
    expect(getSeverity('session.idle')).toBe(SeverityNumber.INFO)
  })

  test('message.updated → INFO (9)', () => {
    expect(getSeverity('message.updated')).toBe(SeverityNumber.INFO)
  })

  test('file.edited → INFO (9)', () => {
    expect(getSeverity('file.edited')).toBe(SeverityNumber.INFO)
  })

  test('command.executed → INFO (9)', () => {
    expect(getSeverity('command.executed')).toBe(SeverityNumber.INFO)
  })

  test('unknown event type → INFO (9) as default', () => {
    expect(getSeverity('some.unknown.event')).toBe(SeverityNumber.INFO)
    expect(getSeverity('')).toBe(SeverityNumber.INFO)
    expect(getSeverity('message.part.updated')).toBe(SeverityNumber.INFO)
    expect(getSeverity('tool.start')).toBe(SeverityNumber.INFO)
  })

  test('permission prefix does not match without dot', () => {
    // "permission" alone does not start with "permission."
    expect(getSeverity('permission')).toBe(SeverityNumber.INFO)
  })
})

// ---------------------------------------------------------------------------
// EVENT_ALLOWLIST
// ---------------------------------------------------------------------------

describe('EVENT_ALLOWLIST', () => {
  test('is a ReadonlySet', () => {
    expect(EVENT_ALLOWLIST).toBeInstanceOf(Set)
  })

  test('includes expected event types', () => {
    const expected = [
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
    ]
    for (const type of expected) {
      expect(EVENT_ALLOWLIST.has(type)).toBe(true)
    }
  })

  test('excludes high-frequency streaming event message.part.updated', () => {
    expect(EVENT_ALLOWLIST.has('message.part.updated')).toBe(false)
  })

  test('does not include unknown events', () => {
    expect(EVENT_ALLOWLIST.has('some.random.event')).toBe(false)
    expect(EVENT_ALLOWLIST.has('')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isAllowedEvent
// ---------------------------------------------------------------------------

describe('isAllowedEvent', () => {
  test('returns true for allowlisted events', () => {
    expect(isAllowedEvent('session.created')).toBe(true)
    expect(isAllowedEvent('session.error')).toBe(true)
    expect(isAllowedEvent('tool.end')).toBe(true)
    expect(isAllowedEvent('permission.granted')).toBe(true)
    expect(isAllowedEvent('message.completed')).toBe(true)
  })

  test('returns false for message.part.updated (excluded)', () => {
    expect(isAllowedEvent('message.part.updated')).toBe(false)
  })

  test('returns false for unknown events', () => {
    expect(isAllowedEvent('unknown.event')).toBe(false)
    expect(isAllowedEvent('')).toBe(false)
  })
})
