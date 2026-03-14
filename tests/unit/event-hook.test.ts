import { describe, test, expect, beforeEach } from 'bun:test'
import type { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import type { LoggerProvider } from '@opentelemetry/sdk-logs'
import { SpanStatusCode } from '@opentelemetry/api'
import { createEventHook } from '../../src/hooks/event.ts'
import { endSession, getSession, setMessageSpan } from '../../src/telemetry/context.ts'
import { makeAllProviders, uniqueID } from './helpers/test-utils.ts'

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let exporter: InMemorySpanExporter
let tracerProvider: BasicTracerProvider
let loggerProvider: LoggerProvider
let errors: string[]

function logError(msg: string): void {
  errors.push(msg)
}

function makeEvent(
  type: string,
  sessionID?: string,
  extra?: Record<string, unknown>,
): { type: string; properties: Record<string, unknown> } {
  return {
    type,
    properties: {
      ...(sessionID !== undefined ? { sessionID } : {}),
      ...extra,
    },
  }
}

beforeEach(() => {
  const result = makeAllProviders()
  tracerProvider = result.tracerProvider
  loggerProvider = result.loggerProvider
  exporter = result.exporter
  errors = []
})

// ---------------------------------------------------------------------------
// session.created — creates root span
// ---------------------------------------------------------------------------

describe('session.created', () => {
  test('creates a root span stored in session context', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))

    const session = getSession(sessionID)
    expect(session).toBeDefined()
    expect(session!.rootSpan).toBeDefined()

    // Clean up
    session!.rootSpan.end()
  })

  test('root span has opencode.session.id attribute', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))

    const session = getSession(sessionID)
    expect(session).toBeDefined()

    // End and check exported span attributes
    session!.rootSpan.end()

    const spans = exporter.getFinishedSpans()
    const rootSpan = spans.find((s) => s.name === 'session')
    expect(rootSpan).toBeDefined()
    expect(rootSpan!.attributes['opencode.session.id']).toBe(sessionID)
  })

  test('does not throw when sessionID is missing', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    // No sessionID in properties — should not throw
    await hook(makeEvent('session.created'))
    expect(errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// session.idle — ends root span
// ---------------------------------------------------------------------------

describe('session.idle', () => {
  test('ends the root span so it appears in exporter', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('session.idle', sessionID))

    const spans = exporter.getFinishedSpans()
    const rootSpan = spans.find((s) => s.name === 'session')
    expect(rootSpan).toBeDefined()
  })

  test('removes session from context map after idle', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('session.idle', sessionID))

    expect(getSession(sessionID)).toBeUndefined()
  })

  test('is a no-op when session does not exist', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    // Should not throw for an unknown session
    await hook(makeEvent('session.idle', uniqueID()))
    expect(errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// session.deleted — ends root span
// ---------------------------------------------------------------------------

describe('session.deleted', () => {
  test('ends the root span and removes session', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('session.deleted', sessionID))

    const spans = exporter.getFinishedSpans()
    const rootSpan = spans.find((s) => s.name === 'session')
    expect(rootSpan).toBeDefined()
    expect(getSession(sessionID)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// session.error — sets ERROR status on root span
// ---------------------------------------------------------------------------

describe('session.error', () => {
  test('sets ERROR status on the root span', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('session.error', sessionID))

    const session = getSession(sessionID)
    expect(session).toBeDefined()

    // End the span and verify its status
    session!.rootSpan.end()

    const spans = exporter.getFinishedSpans()
    const rootSpan = spans.find((s) => s.name === 'session')
    expect(rootSpan).toBeDefined()
    expect(rootSpan!.status.code).toBe(SpanStatusCode.ERROR)
  })

  test('does not end the session on error (session stays active)', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('session.error', sessionID))

    // Session should still be retrievable after error
    const session = getSession(sessionID)
    expect(session).toBeDefined()

    // Clean up
    session!.rootSpan.end()
  })

  test('is a no-op when session does not exist', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    await hook(makeEvent('session.error', uniqueID()))
    expect(errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Filtered events (excluded from allowlist)
// ---------------------------------------------------------------------------

describe('filtered events', () => {
  test('message.part.updated is ignored — no span or session created', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('message.part.updated', sessionID))

    // No session should have been created
    expect(getSession(sessionID)).toBeUndefined()
    // No spans should have been recorded
    expect(exporter.getFinishedSpans()).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  test('unknown events are ignored', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('some.random.event', sessionID))

    expect(getSession(sessionID)).toBeUndefined()
    expect(exporter.getFinishedSpans()).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

describe('error boundary', () => {
  test('handler catches internal errors and calls logError — never throws', async () => {
    // Pass a broken tracerProvider to trigger an error
    const brokenProvider = {
      getTracer: () => {
        throw new Error('tracer exploded')
      },
    } as unknown as BasicTracerProvider

    const hook = createEventHook(brokenProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    // Should not throw
    await hook(makeEvent('session.created', sessionID))

    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0]).toContain('session.created')
  })

  test('errors are logged via logError, not thrown', async () => {
    const brokenLoggerProvider = {
      getLogger: () => {
        throw new Error('logger exploded')
      },
    } as unknown as LoggerProvider

    const hook = createEventHook(tracerProvider, brokenLoggerProvider, logError)
    const sessionID = uniqueID()

    let threw = false
    try {
      await hook(makeEvent('message.created', sessionID))
    } catch {
      threw = true
    }

    expect(threw).toBe(false)
    expect(errors.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Lazy session creation + message lifecycle
// ---------------------------------------------------------------------------

describe('lazy session creation and message lifecycle', () => {
  test('message.created lazily creates root span and starts message child span', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('message.created', sessionID))

    // Lazy creation should have produced a root span + message child span
    const session = getSession(sessionID)
    expect(session).toBeDefined()
    expect(session!.rootSpan).toBeDefined()
    expect(session!.messageSpan).toBeDefined()
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })

  test('message.completed ends the active message span', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('message.created', sessionID))
    expect(getSession(sessionID)!.messageSpan).toBeDefined()

    await hook(makeEvent('message.completed', sessionID))
    expect(getSession(sessionID)!.messageSpan).toBeUndefined()
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })

  test('tool.start lazily creates root span', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('tool.start', sessionID))

    expect(getSession(sessionID)).toBeDefined()
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })

  test('permission.granted lazily creates root span', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('permission.granted', sessionID))

    expect(getSession(sessionID)).toBeDefined()
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })
})

// ---------------------------------------------------------------------------
// Tool lifecycle via bus events (fallback)
// ---------------------------------------------------------------------------

describe('tool lifecycle via bus events', () => {
  test('tool.start creates a fallback tool span', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('tool.start', sessionID, { callID: 'call-1', tool: 'bash' }))

    const session = getSession(sessionID)
    expect(session).toBeDefined()
    expect(session!.pendingTools.get('call-1')).toBeDefined()
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })

  test('tool.end ends the fallback tool span with OK status', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('tool.start', sessionID, { callID: 'call-1', tool: 'read' }))
    await hook(makeEvent('tool.end', sessionID, { callID: 'call-1' }))

    const session = getSession(sessionID)
    expect(session!.pendingTools.has('call-1')).toBe(false)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.read')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.status.code).toBe(SpanStatusCode.OK)
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })

  test('tool.start without callID is a no-op', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('tool.start', sessionID, { tool: 'bash' }))

    const session = getSession(sessionID)
    expect(session!.pendingTools.size).toBe(0)
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })

  test('tool.end without callID is a no-op', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('tool.end', sessionID))

    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })

  test('tool.start span has correct attributes', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))
    await hook(makeEvent('tool.start', sessionID, { callID: 'call-abc', tool: 'write' }))
    await hook(makeEvent('tool.end', sessionID, { callID: 'call-abc' }))

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.write')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.attributes['opencode.tool.name']).toBe('write')
    expect(toolSpan!.attributes['opencode.tool.call.id']).toBe('call-abc')
    expect(toolSpan!.attributes['opencode.session.id']).toBe(sessionID)

    endSession(sessionID)
  })
})

// ---------------------------------------------------------------------------
// session.created — forwards info properties to root span attributes
// ---------------------------------------------------------------------------

describe('session.created attribute forwarding', () => {
  test('forwards string/number fields from properties.info to root span', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', undefined, {
      info: {
        id: sessionID,
        employeeId: 'E12345',
        workspacePath: '/home/user/project',
        priority: 42,
      },
      sessionID,
    }))

    const session = getSession(sessionID)
    expect(session).toBeDefined()

    session!.rootSpan.end()

    const spans = exporter.getFinishedSpans()
    const rootSpan = spans.find((s) => s.name === 'session')
    expect(rootSpan).toBeDefined()
    expect(rootSpan!.attributes['opencode.session.employeeId']).toBe('E12345')
    expect(rootSpan!.attributes['opencode.session.workspacePath']).toBe('/home/user/project')
    expect(rootSpan!.attributes['opencode.session.priority']).toBe(42)
    // id should be skipped (already set as opencode.session.id)
    expect(rootSpan!.attributes['opencode.session.id']).toBe(sessionID)
  })

  test('skips non-string/number fields in info', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', undefined, {
      info: {
        id: sessionID,
        nested: { deep: true },
        tags: ['a', 'b'],
        empty: '',
      },
      sessionID,
    }))

    const session = getSession(sessionID)
    expect(session).toBeDefined()

    session!.rootSpan.end()

    const spans = exporter.getFinishedSpans()
    const rootSpan = spans.find((s) => s.name === 'session')
    expect(rootSpan).toBeDefined()
    // nested objects, arrays, empty strings should NOT be forwarded
    expect(rootSpan!.attributes['opencode.session.nested']).toBeUndefined()
    expect(rootSpan!.attributes['opencode.session.tags']).toBeUndefined()
    expect(rootSpan!.attributes['opencode.session.empty']).toBeUndefined()
  })

  test('is a no-op when properties.info is missing', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))

    const session = getSession(sessionID)
    expect(session).toBeDefined()
    expect(errors).toHaveLength(0)

    session!.rootSpan.end()
  })
})

// ---------------------------------------------------------------------------
// Source-aware: fallback message span discarded when primary exists
// ---------------------------------------------------------------------------

describe('source-aware message span in event hook', () => {
  test('event hook fallback message span is discarded when primary exists', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    await hook(makeEvent('session.created', sessionID))

    // Simulate chat-message hook creating a primary span first
    const session = getSession(sessionID)!
    const primarySpan = tracerProvider.getTracer('test').startSpan('chat.message', undefined, session.traceCtx)
    setMessageSpan(sessionID, primarySpan, 'primary')

    // Now event hook fires message.created — should NOT replace primary
    await hook(makeEvent('message.created', sessionID))

    expect(getSession(sessionID)!.messageSpan).toBe(primarySpan)
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })
})
