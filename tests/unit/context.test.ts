import { describe, test, expect, beforeEach } from 'bun:test'
import type { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { context as otelContext, SpanStatusCode } from '@opentelemetry/api'
import {
  createSession,
  getSession,
  setMessageSpan,
  addToolSpan,
  removeToolSpan,
  endSession,
} from '../../src/telemetry/context'
import { makeTracerProvider, uniqueID } from './helpers/test-utils'

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let exporter: InMemorySpanExporter
let tracer: ReturnType<BasicTracerProvider['getTracer']>

beforeEach(() => {
  const result = makeTracerProvider()
  exporter = result.exporter
  tracer = result.provider.getTracer('test')
})

// ---------------------------------------------------------------------------
// createSession / getSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  test('stores a new session context', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const traceCtx = otelContext.active()

    createSession(id, traceCtx, rootSpan)

    const session = getSession(id)
    expect(session).toBeDefined()
    expect(session!.rootSpan).toBe(rootSpan)
    expect(session!.traceCtx).toBe(traceCtx)
    expect(session!.messageSpan).toBeUndefined()
    expect(session!.pendingTools.size).toBe(0)

    rootSpan.end()
    endSession(id)
  })

  test('overwrites an existing entry for the same sessionID', () => {
    const id = uniqueID()
    const root1 = tracer.startSpan('root1')
    const root2 = tracer.startSpan('root2')
    const ctx = otelContext.active()

    createSession(id, ctx, root1)
    createSession(id, ctx, root2)

    expect(getSession(id)!.rootSpan).toBe(root2)

    root1.end()
    root2.end()
    endSession(id)
  })
})

describe('getSession', () => {
  test('returns stored session context', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const traceCtx = otelContext.active()

    createSession(id, traceCtx, rootSpan)

    expect(getSession(id)).toBeDefined()

    rootSpan.end()
    endSession(id)
  })

  test('returns undefined for an unknown session', () => {
    expect(getSession('does-not-exist')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// setMessageSpan
// ---------------------------------------------------------------------------

describe('setMessageSpan', () => {
  test('updates the messageSpan on an existing session', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const msgSpan = tracer.startSpan('message')
    createSession(id, otelContext.active(), rootSpan)

    setMessageSpan(id, msgSpan)

    expect(getSession(id)!.messageSpan).toBe(msgSpan)

    msgSpan.end()
    rootSpan.end()
    endSession(id)
  })

  test('is a no-op for an unknown session', () => {
    const msgSpan = tracer.startSpan('message')
    // Should not throw
    setMessageSpan('unknown-session', msgSpan)
    msgSpan.end()
  })
})

// ---------------------------------------------------------------------------
// setMessageSpan — source-aware behavior
// ---------------------------------------------------------------------------

describe('setMessageSpan source-aware', () => {
  test('fallback is discarded when a primary span already exists', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const primarySpan = tracer.startSpan('primary-msg')
    const fallbackSpan = tracer.startSpan('fallback-msg')
    createSession(id, otelContext.active(), rootSpan)

    setMessageSpan(id, primarySpan, 'primary')
    setMessageSpan(id, fallbackSpan, 'fallback')

    // Primary should still be active — fallback was discarded
    expect(getSession(id)!.messageSpan).toBe(primarySpan)

    // Fallback should have been ended (discarded)
    const finished = exporter.getFinishedSpans()
    expect(finished.some((s) => s.name === 'fallback-msg')).toBe(true)

    primarySpan.end()
    rootSpan.end()
    endSession(id)
  })

  test('primary replaces an existing fallback span', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const fallbackSpan = tracer.startSpan('fallback-msg')
    const primarySpan = tracer.startSpan('primary-msg')
    createSession(id, otelContext.active(), rootSpan)

    setMessageSpan(id, fallbackSpan, 'fallback')
    expect(getSession(id)!.messageSpan).toBe(fallbackSpan)

    setMessageSpan(id, primarySpan, 'primary')

    // Primary should have replaced fallback
    expect(getSession(id)!.messageSpan).toBe(primarySpan)

    // Fallback should have been ended
    const finished = exporter.getFinishedSpans()
    expect(finished.some((s) => s.name === 'fallback-msg')).toBe(true)

    primarySpan.end()
    rootSpan.end()
    endSession(id)
  })

  test('fallback sets when no existing span', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const fallbackSpan = tracer.startSpan('fallback-msg')
    createSession(id, otelContext.active(), rootSpan)

    setMessageSpan(id, fallbackSpan, 'fallback')

    expect(getSession(id)!.messageSpan).toBe(fallbackSpan)

    fallbackSpan.end()
    rootSpan.end()
    endSession(id)
  })
})

// ---------------------------------------------------------------------------
// addToolSpan / removeToolSpan
// ---------------------------------------------------------------------------

describe('addToolSpan / removeToolSpan', () => {
  test('adds a tool span and retrieves it by callID', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const toolSpan = tracer.startSpan('tool')
    createSession(id, otelContext.active(), rootSpan)

    addToolSpan(id, 'call-1', toolSpan)

    expect(getSession(id)!.pendingTools.get('call-1')).toBe(toolSpan)

    toolSpan.end()
    rootSpan.end()
    endSession(id)
  })

  test('removeToolSpan returns and removes the span', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const toolSpan = tracer.startSpan('tool')
    createSession(id, otelContext.active(), rootSpan)
    addToolSpan(id, 'call-2', toolSpan)

    const removed = removeToolSpan(id, 'call-2')

    expect(removed).toBe(toolSpan)
    expect(getSession(id)!.pendingTools.has('call-2')).toBe(false)

    toolSpan.end()
    rootSpan.end()
    endSession(id)
  })

  test('removeToolSpan returns undefined for missing callID', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    createSession(id, otelContext.active(), rootSpan)

    expect(removeToolSpan(id, 'no-such-call')).toBeUndefined()

    rootSpan.end()
    endSession(id)
  })

  test('removeToolSpan returns undefined for unknown session', () => {
    expect(removeToolSpan('unknown', 'call-x')).toBeUndefined()
  })

  test('addToolSpan is a no-op for unknown session', () => {
    const toolSpan = tracer.startSpan('tool')
    // Should not throw
    addToolSpan('unknown-session', 'call-1', toolSpan)
    toolSpan.end()
  })
})

// ---------------------------------------------------------------------------
// addToolSpan — source-aware behavior
// ---------------------------------------------------------------------------

describe('addToolSpan source-aware', () => {
  test('fallback is discarded when a primary span exists for same callID', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const primaryTool = tracer.startSpan('primary-tool')
    const fallbackTool = tracer.startSpan('fallback-tool')
    createSession(id, otelContext.active(), rootSpan)

    addToolSpan(id, 'call-1', primaryTool, 'primary')
    addToolSpan(id, 'call-1', fallbackTool, 'fallback')

    expect(getSession(id)!.pendingTools.get('call-1')).toBe(primaryTool)

    const finished = exporter.getFinishedSpans()
    expect(finished.some((s) => s.name === 'fallback-tool')).toBe(true)

    primaryTool.end()
    rootSpan.end()
    endSession(id)
  })

  test('primary replaces an existing fallback tool span', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const fallbackTool = tracer.startSpan('fallback-tool')
    const primaryTool = tracer.startSpan('primary-tool')
    createSession(id, otelContext.active(), rootSpan)

    addToolSpan(id, 'call-1', fallbackTool, 'fallback')
    expect(getSession(id)!.pendingTools.get('call-1')).toBe(fallbackTool)

    addToolSpan(id, 'call-1', primaryTool, 'primary')

    expect(getSession(id)!.pendingTools.get('call-1')).toBe(primaryTool)

    const finished = exporter.getFinishedSpans()
    expect(finished.some((s) => s.name === 'fallback-tool')).toBe(true)

    primaryTool.end()
    rootSpan.end()
    endSession(id)
  })

  test('fallback sets when no existing span for callID', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const fallbackTool = tracer.startSpan('fallback-tool')
    createSession(id, otelContext.active(), rootSpan)

    addToolSpan(id, 'call-1', fallbackTool, 'fallback')

    expect(getSession(id)!.pendingTools.get('call-1')).toBe(fallbackTool)

    fallbackTool.end()
    rootSpan.end()
    endSession(id)
  })
})

// ---------------------------------------------------------------------------
// endSession
// ---------------------------------------------------------------------------

describe('endSession', () => {
  test('removes the session from the map', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    createSession(id, otelContext.active(), rootSpan)

    endSession(id)

    expect(getSession(id)).toBeUndefined()
    rootSpan.end()
  })

  test('ends the messageSpan when present', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const msgSpan = tracer.startSpan('message')
    createSession(id, otelContext.active(), rootSpan)
    setMessageSpan(id, msgSpan)

    endSession(id)

    // The exported spans should include the message span that was ended
    const finishedSpans = exporter.getFinishedSpans()
    const names = finishedSpans.map((s) => s.name)
    expect(names).toContain('message')

    rootSpan.end()
  })

  test('ends all pending tool spans with ERROR status (orphan cleanup)', () => {
    const id = uniqueID()
    const rootSpan = tracer.startSpan('root')
    const tool1 = tracer.startSpan('tool-1')
    const tool2 = tracer.startSpan('tool-2')
    createSession(id, otelContext.active(), rootSpan)
    addToolSpan(id, 'call-a', tool1)
    addToolSpan(id, 'call-b', tool2)

    endSession(id)

    const finishedSpans = exporter.getFinishedSpans()
    const toolNames = ['tool-1', 'tool-2']

    for (const name of toolNames) {
      const span = finishedSpans.find((s) => s.name === name)
      expect(span).toBeDefined()
      expect(span!.status.code).toBe(SpanStatusCode.ERROR)
    }

    rootSpan.end()
  })

  test('is a no-op for an unknown session', () => {
    // Should not throw
    endSession('unknown-session')
  })
})

// ---------------------------------------------------------------------------
// Concurrent sessions
// ---------------------------------------------------------------------------

describe('concurrent sessions', () => {
  test('multiple sessionIDs are isolated from each other', () => {
    const idA = uniqueID()
    const idB = uniqueID()
    const rootA = tracer.startSpan('rootA')
    const rootB = tracer.startSpan('rootB')
    const msgA = tracer.startSpan('messageA')
    const toolB = tracer.startSpan('toolB')

    createSession(idA, otelContext.active(), rootA)
    createSession(idB, otelContext.active(), rootB)

    setMessageSpan(idA, msgA)
    addToolSpan(idB, 'call-b', toolB)

    // Session A has a message span, no tools
    expect(getSession(idA)!.messageSpan).toBe(msgA)
    expect(getSession(idA)!.pendingTools.size).toBe(0)

    // Session B has a tool span, no message span
    expect(getSession(idB)!.messageSpan).toBeUndefined()
    expect(getSession(idB)!.pendingTools.size).toBe(1)

    endSession(idA)

    // After ending A, B is still intact
    expect(getSession(idA)).toBeUndefined()
    expect(getSession(idB)).toBeDefined()

    endSession(idB)

    expect(getSession(idB)).toBeUndefined()
    rootA.end()
    rootB.end()
  })

  test('operations on one session do not affect another', () => {
    const idA = uniqueID()
    const idB = uniqueID()
    const rootA = tracer.startSpan('rootA')
    const rootB = tracer.startSpan('rootB')
    createSession(idA, otelContext.active(), rootA)
    createSession(idB, otelContext.active(), rootB)

    const toolA = tracer.startSpan('toolA')
    addToolSpan(idA, 'tool-call', toolA)

    expect(getSession(idB)!.pendingTools.size).toBe(0)

    toolA.end()
    rootA.end()
    rootB.end()
    endSession(idA)
    endSession(idB)
  })
})
