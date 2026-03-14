import { describe, test, expect, beforeEach } from 'bun:test'
import type { BasicTracerProvider, InMemorySpanExporter } from '@opentelemetry/sdk-trace-base'
import { endSession } from '../../src/telemetry/context.ts'
import { createChatMessageHook } from '../../src/hooks/chat-message.ts'
import { makeTracerProvider, uniqueID, createTestSession, findSpan } from './helpers/test-utils.ts'

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
// createChatMessageHook
// ---------------------------------------------------------------------------

describe('createChatMessageHook', () => {
  test('creates a child span with correct name and attributes', async () => {
    const sessionID = uniqueID()
    const { rootSpan } = createTestSession(provider, sessionID)

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

    const msgSpan = findSpan(exporter, 'chat.message')
    expect(msgSpan).toBeDefined()
    expect(msgSpan!.attributes['opencode.session.id']).toBe(sessionID)
    expect(msgSpan!.attributes['opencode.message.agent']).toBe('coder')
    expect(msgSpan!.attributes['opencode.message.model.provider']).toBe('anthropic')
    expect(msgSpan!.attributes['opencode.message.model.id']).toBe('claude-3-5-sonnet')
    expect(errors).toHaveLength(0)
  })

  test('child span has root span as parent', async () => {
    const sessionID = uniqueID()
    const { rootSpan } = createTestSession(provider, sessionID)

    const hook = createChatMessageHook(provider, () => {})

    await hook(
      {
        sessionID,
        agent: 'default',
        model: { providerID: 'openai', modelID: 'gpt-4o' },
      },
      undefined,
    )

    rootSpan.end()
    endSession(sessionID)

    const root = findSpan(exporter, 'session.root')
    const child = findSpan(exporter, 'chat.message')

    expect(root).toBeDefined()
    expect(child).toBeDefined()
    expect(child!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId)
  })

  test('stores the span as messageSpan on the session', async () => {
    const sessionID = uniqueID()
    const { rootSpan } = createTestSession(provider, sessionID)

    const hook = createChatMessageHook(provider, () => {})

    await hook(
      {
        sessionID,
        agent: 'default',
        model: { providerID: 'openai', modelID: 'gpt-4o' },
      },
      undefined,
    )

    rootSpan.end()
    endSession(sessionID)

    const spans = exporter.getFinishedSpans()
    expect(spans.find((s) => s.name === 'chat.message')).toBeDefined()
  })

  test('lazily creates a root span for a pre-existing session', async () => {
    const errors: string[] = []
    const hook = createChatMessageHook(provider, (msg) => errors.push(msg))

    const sessionID = uniqueID('lazy-session')

    await hook(
      {
        sessionID,
        agent: 'coder',
        model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
      },
      undefined,
    )

    endSession(sessionID)
    expect(findSpan(exporter, 'session')).toBeDefined()
    expect(findSpan(exporter, 'chat.message')).toBeDefined()
    expect(errors).toHaveLength(0)
  })

  test('includes messageID and variant when provided', async () => {
    const sessionID = uniqueID()
    const { rootSpan } = createTestSession(provider, sessionID)

    const hook = createChatMessageHook(provider, () => {})

    await hook(
      {
        sessionID,
        agent: 'coder',
        model: { providerID: 'anthropic', modelID: 'claude-3-5-sonnet' },
        messageID: 'msg_abc123',
        variant: 'primary',
      },
      undefined,
    )

    rootSpan.end()
    endSession(sessionID)

    const msgSpan = findSpan(exporter, 'chat.message')
    expect(msgSpan).toBeDefined()
    expect(msgSpan!.attributes['opencode.message.id']).toBe('msg_abc123')
    expect(msgSpan!.attributes['opencode.message.variant']).toBe('primary')
  })

  test('omits messageID and variant when not provided', async () => {
    const sessionID = uniqueID()
    const { rootSpan } = createTestSession(provider, sessionID)

    const hook = createChatMessageHook(provider, () => {})

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

    const msgSpan = findSpan(exporter, 'chat.message')
    expect(msgSpan).toBeDefined()
    expect(msgSpan!.attributes['opencode.message.id']).toBeUndefined()
    expect(msgSpan!.attributes['opencode.message.variant']).toBeUndefined()
  })

  test('truncates long attribute values to 256 characters', async () => {
    const sessionID = uniqueID()
    const { rootSpan } = createTestSession(provider, sessionID)

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

    const msgSpan = findSpan(exporter, 'chat.message')
    expect(msgSpan).toBeDefined()
    expect((msgSpan!.attributes['opencode.message.agent'] as string).length).toBe(256)
  })

  test('calls logError and does not throw on internal error', async () => {
    const errors: string[] = []
    const brokenProvider = {
      getTracer: () => {
        throw new Error('provider exploded')
      },
    } as unknown as BasicTracerProvider

    const sessionID = uniqueID()
    createTestSession(provider, sessionID)

    const hook = createChatMessageHook(brokenProvider, (msg) => errors.push(msg))

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

    endSession(sessionID)
  })
})
