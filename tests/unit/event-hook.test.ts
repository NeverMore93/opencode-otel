import { describe, test, expect, beforeEach } from 'bun:test'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { LoggerProvider } from '@opentelemetry/sdk-logs'
import { SpanStatusCode } from '@opentelemetry/api'
import { createEventHook } from '../../src/hooks/event.ts'
import { getSession } from '../../src/telemetry/context.ts'

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let exporter: InMemorySpanExporter
let tracerProvider: BasicTracerProvider
let loggerProvider: LoggerProvider
let errors: string[]

function makeProviders(): void {
  exporter = new InMemorySpanExporter()
  tracerProvider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  loggerProvider = new LoggerProvider()
  errors = []
}

function logError(msg: string): void {
  errors.push(msg)
}

function uniqueID(): string {
  return `session-${Math.random().toString(36).slice(2)}`
}

function makeEvent(type: string, sessionID?: string): { type: string; properties: Record<string, unknown> } {
  return {
    type,
    properties: sessionID !== undefined ? { sessionID } : {},
  }
}

beforeEach(() => {
  makeProviders()
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
// Allowlisted events emit without creating sessions
// ---------------------------------------------------------------------------

describe('non-lifecycle allowed events', () => {
  test('message.created processes without creating a session span', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    const sessionID = uniqueID()

    // message.created is allowed but is not a lifecycle event
    await hook(makeEvent('message.created', sessionID))

    // No session should be created (only session.created triggers that)
    expect(getSession(sessionID)).toBeUndefined()
    expect(errors).toHaveLength(0)
  })

  test('tool.start processes without throwing', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    await hook(makeEvent('tool.start', uniqueID()))
    expect(errors).toHaveLength(0)
  })

  test('permission.granted processes without throwing', async () => {
    const hook = createEventHook(tracerProvider, loggerProvider, logError)
    await hook(makeEvent('permission.granted', uniqueID()))
    expect(errors).toHaveLength(0)
  })
})
