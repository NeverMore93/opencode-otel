import { describe, test, expect, beforeEach } from 'bun:test'
import type { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { SpanStatusCode } from '@opentelemetry/api'
import { endSession, getSession } from '../../src/telemetry/context.ts'
import { createToolExecuteHooks } from '../../src/hooks/tool-execute.ts'
import { makeTracerProvider, uniqueID, uniqueCallID, createTestSession } from './helpers/test-utils.ts'

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let exporter: InMemorySpanExporter
let provider: BasicTracerProvider

beforeEach(() => {
  const result = makeTracerProvider()
  provider = result.provider
  exporter = result.exporter
})

// ---------------------------------------------------------------------------
// createToolExecuteHooks — before
// ---------------------------------------------------------------------------

describe('createToolExecuteHooks — before', () => {
  test('creates a tool span with name "tool.{toolName}"', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const errors: string[] = []
    const { before } = createToolExecuteHooks(provider, (msg) => errors.push(msg))

    await before({ sessionID, tool: 'bash', callID }, undefined)

    // The span is pending — end the session to flush it
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(errors).toHaveLength(0)
  })

  test('span has correct attributes', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'read_file', callID }, undefined)

    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.read_file')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.attributes['opencode.session.id']).toBe(sessionID)
    expect(toolSpan!.attributes['opencode.tool.name']).toBe('read_file')
    expect(toolSpan!.attributes['opencode.tool.call.id']).toBe(callID)
  })

  test('does NOT include args in span attributes', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before(
      { sessionID, tool: 'write_file', callID } as never,
      undefined,
    )

    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.write_file')
    expect(toolSpan).toBeDefined()
    const attrKeys = Object.keys(toolSpan!.attributes)
    // No args-related key should appear
    expect(attrKeys.some((k) => k.toLowerCase().includes('arg'))).toBe(false)
    expect(attrKeys.some((k) => k.toLowerCase().includes('input'))).toBe(false)
  })

  test('span is stored as pending tool on the session', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)

    const session = getSession(sessionID)
    expect(session).toBeDefined()
    expect(session!.pendingTools.has(callID)).toBe(true)

    endSession(sessionID)
  })

  test('span has root span as parent', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'glob', callID }, undefined)

    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const root = spans.find((s) => s.name === 'session.root')
    const child = spans.find((s) => s.name === 'tool.glob')
    expect(root).toBeDefined()
    expect(child).toBeDefined()
    // SDK v2.5.x uses parentSpanContext, not parentSpanId
    expect(child!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId)
  })

  test('lazily creates a root span for a pre-existing session', async () => {
    const errors: string[] = []
    const { before, after } = createToolExecuteHooks(provider, (msg) => errors.push(msg))

    const sessionID = uniqueID('lazy-tool')
    const callID = 'c-lazy-1'

    // No session.created event — simulates a pre-existing session
    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID, title: 'ran bash' }, undefined)

    endSession(sessionID)
    const spans = exporter.getFinishedSpans()
    expect(spans.find((s) => s.name === 'session')).toBeDefined()
    expect(spans.find((s) => s.name === 'tool.bash')).toBeDefined()
    expect(errors).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// createToolExecuteHooks — after
// ---------------------------------------------------------------------------

describe('createToolExecuteHooks — after', () => {
  test('ends the span with OK status', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID, output: 'some output', title: 'Run bash' }, undefined)

    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.status.code).toBe(SpanStatusCode.OK)
  })

  test('sets opencode.tool.title when title is provided', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID, title: 'List files' }, undefined)

    endSession(sessionID)

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.attributes['opencode.tool.title']).toBe('List files')
  })

  test('truncates title to 256 characters', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before, after } = createToolExecuteHooks(provider, () => {})
    const longTitle = 't'.repeat(500)

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID, title: longTitle }, undefined)

    endSession(sessionID)

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect((toolSpan!.attributes['opencode.tool.title'] as string).length).toBe(256)
  })

  test('forwards safe metadata fields as span attributes', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({
      sessionID,
      tool: 'bash',
      callID,
      title: 'Run command',
      metadata: { region: 'us-east-1', retries: 3, nested: { x: 1 }, empty: '' },
    }, undefined)

    endSession(sessionID)

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.attributes['opencode.tool.metadata.region']).toBe('us-east-1')
    expect(toolSpan!.attributes['opencode.tool.metadata.retries']).toBe(3)
    // nested objects and empty strings should be skipped
    expect(toolSpan!.attributes['opencode.tool.metadata.nested']).toBeUndefined()
    expect(toolSpan!.attributes['opencode.tool.metadata.empty']).toBeUndefined()
  })

  test('does NOT include output in span attributes', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({
      sessionID,
      tool: 'bash',
      callID,
      output: 'SUPER SECRET OUTPUT',
      title: 'done',
    }, undefined)

    endSession(sessionID)

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(JSON.stringify(toolSpan!.attributes)).not.toContain('SUPER SECRET OUTPUT')
    expect(JSON.stringify(toolSpan!.attributes)).not.toContain('output')
  })

  test('is a no-op when after is called without before (orphaned after)', async () => {
    const errors: string[] = []
    const { after } = createToolExecuteHooks(provider, (msg) => errors.push(msg))

    // No before call, so no span is registered for this callID
    await after({ sessionID: 'no-session', tool: 'bash', callID: 'c1' }, undefined)

    expect(exporter.getFinishedSpans()).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  test('after without before for known session is a no-op', async () => {
    const sessionID = uniqueID()
    createTestSession(provider, sessionID)

    const errors: string[] = []
    const { after } = createToolExecuteHooks(provider, (msg) => errors.push(msg))

    // No before was called, so callID is unknown
    await after({ sessionID, tool: 'bash', callID: 'unknown-call' }, undefined)

    expect(exporter.getFinishedSpans()).toHaveLength(0)
    expect(errors).toHaveLength(0)

    endSession(sessionID)
  })

  test('span is removed from pendingTools after after hook', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID }, undefined)

    const session = getSession(sessionID)
    expect(session).toBeDefined()
    expect(session!.pendingTools.has(callID)).toBe(false)

    endSession(sessionID)
  })
})

// ---------------------------------------------------------------------------
// Orphan cleanup via endSession
// ---------------------------------------------------------------------------

describe('orphaned tool spans via endSession', () => {
  test('before without after — endSession ends the span with ERROR status', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    createTestSession(provider, sessionID)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)

    // No after call — session ends while tool is pending
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.status.code).toBe(SpanStatusCode.ERROR)
  })
})

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe('createToolExecuteHooks — error handling', () => {
  test('before calls logError and does not throw on internal error', async () => {
    const errors: string[] = []
    const brokenProvider = {
      getTracer: () => {
        throw new Error('tracer broken')
      },
    } as unknown as BasicTracerProvider

    const sessionID = uniqueID()
    createTestSession(provider, sessionID)

    const { before } = createToolExecuteHooks(brokenProvider, (msg) => errors.push(msg))

    await before({ sessionID, tool: 'bash', callID: 'c1' }, undefined)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('tool.before')

    endSession(sessionID)
  })
})
