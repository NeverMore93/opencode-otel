import { describe, test, expect, beforeEach } from 'bun:test'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { context as otelContext, trace } from '@opentelemetry/api'
import { createSession, endSession } from '../../src/telemetry/context.ts'
import { createChatMessageHook } from '../../src/hooks/chat-message.ts'

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

beforeEach(() => {
  provider = makeProvider()
  exporter.reset()
})

// ---------------------------------------------------------------------------
// createChatMessageHook
// ---------------------------------------------------------------------------

describe('createChatMessageHook', () => {
  test('creates a child span with correct name and attributes', async () => {
    const sessionID = uniqueID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')

    // Build a traceCtx that carries the root span as parent
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const errors: string[] = []
    const hook = createChatMessageHook(provider, (msg) => errors.push(msg))

    await hook(
      {
        sessionID,
        agent: 'coder',
        model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
      },
      undefined,
    )

    rootSpan.end()
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const msgSpan = spans.find((s) => s.name === 'chat.message')
    expect(msgSpan).toBeDefined()
    expect(msgSpan!.attributes['opencode.session.id']).toBe(sessionID)
    expect(msgSpan!.attributes['opencode.message.agent']).toBe('coder')
    expect(msgSpan!.attributes['opencode.message.model.provider']).toBe('anthropic')
    expect(msgSpan!.attributes['opencode.message.model.id']).toBe('claude-3-5-sonnet')
    expect(errors).toHaveLength(0)
  })

  test('child span has root span as parent', async () => {
    const sessionID = uniqueID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const hook = createChatMessageHook(provider, () => {})

    await hook(
      {
        sessionID,
        agent: 'default',
        model: { providerID: 'openai', modelID: 'gpt-4o' },
      },
      undefined,
    )

    // End rootSpan so it appears in finished spans
    rootSpan.end()
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    const root = spans.find((s) => s.name === 'session.root')
    const child = spans.find((s) => s.name === 'chat.message')

    expect(root).toBeDefined()
    expect(child).toBeDefined()
    // The child's parentSpanContext.spanId must equal the root span's spanId
    // Note: SDK v2.5.x uses parentSpanContext, not parentSpanId
    expect(child!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId)
  })

  test('stores the span as messageSpan on the session', async () => {
    const sessionID = uniqueID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const hook = createChatMessageHook(provider, () => {})

    await hook(
      {
        sessionID,
        agent: 'default',
        model: { providerID: 'openai', modelID: 'gpt-4o' },
      },
      undefined,
    )

    // Verify that endSession ends the stored messageSpan
    rootSpan.end()
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    // endSession ends the messageSpan — it should appear in finished spans
    expect(spans.find((s) => s.name === 'chat.message')).toBeDefined()
  })

  test('lazily creates a root span for a pre-existing session', async () => {
    const errors: string[] = []
    const hook = createChatMessageHook(provider, (msg) => errors.push(msg))

    const sessionID = 'lazy-session-' + Math.random().toString(36).slice(2)

    // No session.created event — simulates a pre-existing session (e.g. Feishu)
    await hook(
      {
        sessionID,
        agent: 'coder',
        model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
      },
      undefined,
    )

    // Lazy creation should have produced a root span + chat.message span
    endSession(sessionID)
    const spans = exporter.getFinishedSpans()
    expect(spans.find((s) => s.name === 'session')).toBeDefined()
    expect(spans.find((s) => s.name === 'chat.message')).toBeDefined()
    expect(errors).toHaveLength(0)
  })

  test('truncates long attribute values to 256 characters', async () => {
    const sessionID = uniqueID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const longAgent = 'a'.repeat(500)
    const hook = createChatMessageHook(provider, () => {})

    await hook(
      {
        sessionID,
        agent: longAgent,
        model: { providerID: 'p', modelID: 'm' },
      },
      undefined,
    )

    rootSpan.end()
    endSession(sessionID)

    const msgSpan = exporter.getFinishedSpans().find((s) => s.name === 'chat.message')
    expect(msgSpan).toBeDefined()
    expect((msgSpan!.attributes['opencode.message.agent'] as string).length).toBe(256)
  })

  test('calls logError and does not throw on internal error', async () => {
    // Pass a broken provider (null tracer) to force an error path
    const errors: string[] = []
    const brokenProvider = {
      getTracer: () => {
        throw new Error('provider exploded')
      },
    } as unknown as BasicTracerProvider

    const sessionID = uniqueID()
    const tracer = provider.getTracer('test')
    const rootSpan = tracer.startSpan('session.root')
    const traceCtx = trace.setSpan(otelContext.active(), rootSpan)
    createSession(sessionID, traceCtx, rootSpan)

    const hook = createChatMessageHook(brokenProvider, (msg) => errors.push(msg))

    // Must not throw
    await hook(
      {
        sessionID,
        agent: 'default',
        model: { providerID: 'openai', modelID: 'gpt-4o' },
      },
      undefined,
    )

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('chat.message')

    rootSpan.end()
    endSession(sessionID)
  })
})
