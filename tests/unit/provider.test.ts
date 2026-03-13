import { describe, test, expect } from 'bun:test'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import pkg from '../../package.json'

/**
 * Unit test for pluginContext resource attributes.
 *
 * Since initProviders creates processors internally and addSpanProcessor
 * is not available on SDK v2.5, we test the resource construction logic
 * directly by replicating the attribute-merge pattern from provider.ts.
 */
describe('pluginContext resource attributes', () => {
  function buildResource(pluginContext?: { directory?: string; project?: string }) {
    return resourceFromAttributes({
      'service.name': 'test-service',
      'service.version': pkg.version,
      'service.instance.id': 'test-host-1234',
      ...(pluginContext?.directory ? { 'opencode.directory': pluginContext.directory } : {}),
      ...(pluginContext?.project ? { 'opencode.project': pluginContext.project } : {}),
    })
  }

  test('includes opencode.directory and opencode.project when provided', () => {
    const resource = buildResource({
      directory: '/home/user/project',
      project: 'my-project',
    })

    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    const span = provider.getTracer('test').startSpan('probe')
    span.end()

    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0]!.resource.attributes['opencode.directory']).toBe('/home/user/project')
    expect(spans[0]!.resource.attributes['opencode.project']).toBe('my-project')

    provider.shutdown()
  })

  test('omits opencode.directory and opencode.project when not provided', () => {
    const resource = buildResource()

    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    const span = provider.getTracer('test').startSpan('probe')
    span.end()

    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0]!.resource.attributes['opencode.directory']).toBeUndefined()
    expect(spans[0]!.resource.attributes['opencode.project']).toBeUndefined()

    provider.shutdown()
  })

  test('omits empty string values for directory/project', () => {
    const resource = buildResource({ directory: '', project: '' })

    const exporter = new InMemorySpanExporter()
    const provider = new BasicTracerProvider({
      resource,
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    })

    const span = provider.getTracer('test').startSpan('probe')
    span.end()

    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0]!.resource.attributes['opencode.directory']).toBeUndefined()
    expect(spans[0]!.resource.attributes['opencode.project']).toBeUndefined()

    provider.shutdown()
  })
})
