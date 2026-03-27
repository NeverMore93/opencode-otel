import { describe, test, expect, afterEach } from 'bun:test'
import { install, parseLine } from '../../src/interceptor.ts'
import { SeverityNumber } from '@opentelemetry/api-logs'

describe('parseLine', () => {
  test('parses ERROR severity', () => {
    const result = parseLine('ERROR 2026-03-27 something failed', 4096)
    expect(result.severityNumber).toBe(SeverityNumber.ERROR)
    expect(result.severityText).toBe('ERROR')
  })

  test('parses WARN severity', () => {
    const result = parseLine('WARN  2026-03-27 warning message', 4096)
    expect(result.severityNumber).toBe(SeverityNumber.WARN)
  })

  test('parses INFO severity', () => {
    const result = parseLine('INFO  2026-03-27 info message', 4096)
    expect(result.severityNumber).toBe(SeverityNumber.INFO)
  })

  test('parses DEBUG severity', () => {
    const result = parseLine('DEBUG 2026-03-27 debug message', 4096)
    expect(result.severityNumber).toBe(SeverityNumber.DEBUG)
  })

  test('returns UNSPECIFIED for unknown prefix', () => {
    const result = parseLine('some random log line', 4096)
    expect(result.severityNumber).toBe(SeverityNumber.UNSPECIFIED)
  })

  test('truncates body to max length', () => {
    const long = 'A'.repeat(100)
    const result = parseLine(long, 50)
    expect(result.body.length).toBe(50)
  })

  test('preserves body under max length', () => {
    const result = parseLine('short', 4096)
    expect(result.body).toBe('short')
  })
})

describe('install', () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  test('captures complete lines from stderr', () => {
    const captured: string[] = []
    const interceptor = install((parsed) => captured.push(parsed.body), 4096)
    cleanup = interceptor.uninstall

    process.stderr.write('line one\nline two\n')

    expect(captured).toEqual(['line one', 'line two'])
  })

  test('buffers partial lines until newline', () => {
    const captured: string[] = []
    const interceptor = install((parsed) => captured.push(parsed.body), 4096)
    cleanup = interceptor.uninstall

    process.stderr.write('partial ')
    expect(captured.length).toBe(0)

    process.stderr.write('complete\n')
    expect(captured).toEqual(['partial complete'])
  })

  test('flush emits remaining buffer', () => {
    const captured: string[] = []
    const interceptor = install((parsed) => captured.push(parsed.body), 4096)
    cleanup = interceptor.uninstall

    process.stderr.write('no newline')
    expect(captured.length).toBe(0)

    interceptor.flush()
    expect(captured).toEqual(['no newline'])
  })

  test('uninstall restores original stderr.write', () => {
    const original = process.stderr.write
    const interceptor = install(() => {}, 4096)

    expect(process.stderr.write).not.toBe(original)
    interceptor.uninstall()
    expect(process.stderr.write).toBe(original)
    cleanup = null // already uninstalled
  })

  test('original stderr output is preserved', () => {
    const writes: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)

    // Temporarily capture stderr output
    const testWrite = (chunk: any) => {
      writes.push(typeof chunk === 'string' ? chunk : chunk.toString())
      return true
    }
    process.stderr.write = testWrite as any

    const interceptor = install(() => {}, 4096)
    cleanup = () => {
      interceptor.uninstall()
      process.stderr.write = origWrite
    }

    process.stderr.write('hello\n')
    expect(writes).toContain('hello\n')
  })
})
