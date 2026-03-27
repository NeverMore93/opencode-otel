/**
 * Stderr interceptor — monkey-patches process.stderr.write to capture log lines.
 *
 * Each complete line (delimited by \n) is emitted via the provided callback.
 * The original stderr.write is ALWAYS called to preserve normal output.
 */

import { SeverityNumber } from '@opentelemetry/api-logs'

export interface ParsedLine {
  readonly body: string
  readonly severityNumber: SeverityNumber
  readonly severityText: string
}

const SEVERITY_MAP: ReadonlyMap<string, { number: SeverityNumber; text: string }> = new Map([
  ['ERROR', { number: SeverityNumber.ERROR, text: 'ERROR' }],
  ['WARN', { number: SeverityNumber.WARN, text: 'WARN' }],
  ['INFO', { number: SeverityNumber.INFO, text: 'INFO' }],
  ['DEBUG', { number: SeverityNumber.DEBUG, text: 'DEBUG' }],
])

export function parseLine(raw: string, maxLength: number): ParsedLine {
  const body = raw.length > maxLength ? raw.slice(0, maxLength) : raw
  const firstSpace = raw.indexOf(' ')
  const prefix = firstSpace > 0 ? raw.slice(0, firstSpace).toUpperCase().trim() : ''
  const match = SEVERITY_MAP.get(prefix)
  return {
    body,
    severityNumber: match?.number ?? SeverityNumber.UNSPECIFIED,
    severityText: match?.text ?? 'UNSPECIFIED',
  }
}

export interface Interceptor {
  uninstall(): void
  flush(): void
}

export function install(
  emit: (parsed: ParsedLine) => void,
  maxLineLength: number,
): Interceptor {
  let buffer = ''
  let inEmit = false // recursion guard

  const originalWrite = process.stderr.write

  const wrapper = function (
    this: typeof process.stderr,
    chunk: Uint8Array | string,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void,
  ): boolean {
    // Always call original first
    const result = typeof encodingOrCallback === 'function'
      ? originalWrite.call(process.stderr, chunk, encodingOrCallback)
      : callback
        ? originalWrite.call(process.stderr, chunk, encodingOrCallback as BufferEncoding, callback)
        : originalWrite.call(process.stderr, chunk, encodingOrCallback as BufferEncoding)

    // Skip if we're inside an emit (recursion guard)
    if (inEmit) return result

    try {
      inEmit = true
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk)
      buffer += text

      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trimEnd()
        buffer = buffer.slice(newlineIdx + 1)
        if (line.length > 0) {
          emit(parseLine(line, maxLineLength))
        }
      }
    } catch {
      // Swallow interceptor errors — never affect stderr
    } finally {
      inEmit = false
    }

    return result
  } as typeof process.stderr.write

  process.stderr.write = wrapper

  return {
    uninstall() {
      process.stderr.write = originalWrite
    },
    flush() {
      if (buffer.length > 0) {
        const remaining = buffer.trimEnd()
        buffer = ''
        if (remaining.length > 0) {
          try {
            inEmit = true
            emit(parseLine(remaining, maxLineLength))
          } catch {
            // swallow
          } finally {
            inEmit = false
          }
        }
      }
    },
  }
}
