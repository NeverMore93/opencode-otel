import { describe, test, expect, beforeEach } from 'bun:test'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { context as otelContext, SpanStatusCode, trace } from '@opentelemetry/api'
import { createSession, endSession, getSession } from '../../src/telemetry/context.ts'
import { createToolExecuteHooks } from '../../src/hooks/tool-execute.ts'

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

let exporter: InMemorySpanExporter
let provider: BasicTracerProvider

function makeProvider(): BasicTracerProvider {
  exporter = new InMemorySpanExporter()
  const p = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  return p
}

function uniqueID(): string {
  return `session-${Math.random().toString(36).slice(2)}`
}

function uniqueCallID(): string {
  return `call-${Math.random().toString(36).slice(2)}`
}

beforeEach(() => {
  provider = makeProvider()
  exporter.reset()
})

// ---------------------------------------------------------------------------
// createToolExecuteHooks — before
// ---------------------------------------------------------------------------

describe('createToolExecuteHooks — before', () => {
  test('creates a tool span with name "tool.{toolName}"', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const errors: string[] = []
    const { before } = createToolExecuteHooks(provider, (msg) => errors.push(msg))

    await before({ sessionID, tool: 'bash', callID }, undefined)

    // The span is pending — end the session to flush it
    rootSpan.end()
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(errors).toHaveLength(0)
  })

  test('span has correct attributes', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'read_file', callID, args: { path: '/etc/passwd' } }, undefined)

    rootSpan.end()
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
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before(
      { sessionID, tool: 'write_file', callID, args: { secret: 'very sensitive data' } },
      undefined,
    )

    rootSpan.end()
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.write_file')
    expect(toolSpan).toBeDefined()
    const attrKeys = Object.keys(toolSpan!.attributes)
    // No args-related key should appear
    expect(attrKeys.some((k) => k.toLowerCase().includes('arg'))).toBe(false)
    expect(attrKeys.some((k) => k.toLowerCase().includes('input'))).toBe(false)
    expect(JSON.stringify(toolSpan!.attributes)).not.toContain('sensitive')
  })

  test('span is stored as pending tool on the session', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)

    const session = getSession(sessionID)
    expect(session).toBeDefined()
    expect(session!.pendingTools.has(callID)).toBe(true)

    rootSpan.end()
    endSession(sessionID)
  })

  test('span has root span as parent', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'glob', callID }, undefined)

    rootSpan.end()
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

    const sessionID = 'lazy-tool-' + Math.random().toString(36).slice(2)
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
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID, output: 'some output', title: 'Run bash' }, undefined)

    rootSpan.end()
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const toolSpan = spans.find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.status.code).toBe(SpanStatusCode.OK)
  })

  test('sets opencode.tool.title when title is provided', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID, title: 'List files' }, undefined)

    rootSpan.end()
    endSession(sessionID)

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect(toolSpan!.attributes['opencode.tool.title']).toBe('List files')
  })

  test('truncates title to 256 characters', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before, after } = createToolExecuteHooks(provider, () => {})
    const longTitle = 't'.repeat(500)

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID, title: longTitle }, undefined)

    rootSpan.end()
    endSession(sessionID)

    const toolSpan = exporter.getFinishedSpans().find((s) => s.name === 'tool.bash')
    expect(toolSpan).toBeDefined()
    expect((toolSpan!.attributes['opencode.tool.title'] as string).length).toBe(256)
  })

  test('does NOT include output in span attributes', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({
      sessionID,
      tool: 'bash',
      callID,
      output: 'SUPER SECRET OUTPUT',
      title: 'done',
    }, undefined)

    rootSpan.end()
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
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const errors: string[] = []
    const { after } = createToolExecuteHooks(provider, (msg) => errors.push(msg))

    // No before was called, so callID is unknown
    await after({ sessionID, tool: 'bash', callID: 'unknown-call' }, undefined)

    expect(exporter.getFinishedSpans()).toHaveLength(0)
    expect(errors).toHaveLength(0)

    rootSpan.end()
    endSession(sessionID)
  })

  test('span is removed from pendingTools after after hook', async () => {
    const sessionID = uniqueID()
    const callID = uniqueCallID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before, after } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)
    await after({ sessionID, tool: 'bash', callID }, undefined)

    const session = getSession(sessionID)
    expect(session).toBeDefined()
    expect(session!.pendingTools.has(callID)).toBe(false)

    rootSpan.end()
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
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before } = createToolExecuteHooks(provider, () => {})

    await before({ sessionID, tool: 'bash', callID }, undefined)

    // No after call — session ends while tool is pending
    rootSpan.end()
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
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const { before } = createToolExecuteHooks(brokenProvider, (msg) => errors.push(msg))

    await before({ sessionID, tool: 'bash', callID: 'c1' }, undefined)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('tool.before')

    rootSpan.end()
    endSession(sessionID)
  })
})
