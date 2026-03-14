import type { Attributes, AttributeValue } from '@opentelemetry/api'
import { DEFAULT_MAX_LEN } from './constants.ts'

/**
 * Truncates a single string to at most `maxLen` characters.
 */
export function truncateString(value: string, maxLen: number = DEFAULT_MAX_LEN): string {
  return value.length <= maxLen ? value : value.slice(0, maxLen)
}

/**
 * Returns a new object with all string values truncated to `maxLen` characters.
 * Non-string values pass through unchanged. The input object is never mutated.
 */
export function truncateAttributes(
  attrs: Record<string, AttributeValue | undefined>,
  maxLen: number = DEFAULT_MAX_LEN,
): Attributes {
  return Object.fromEntries(
    Object.entries(attrs).map(([key, value]) => [
      key,
      typeof value === 'string' ? truncateString(value, maxLen) : value,
    ]),
  )
}

/**
 * Extract safe (string/number) attributes from an arbitrary record,
 * prefixing each key and optionally skipping specified keys.
 *
 * Empty strings and non-string/non-number values are silently dropped.
 * String values are truncated to DEFAULT_MAX_LEN.
 */
export function extractSafeAttributes(
  source: Record<string, unknown>,
  prefix: string,
  skipKeys: ReadonlySet<string> = new Set(),
): Record<string, string | number> {
  const result: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(source)) {
    if (skipKeys.has(key)) continue
    if (typeof value === 'string' && value !== '') {
      result[`${prefix}${key}`] = truncateString(value)
    } else if (typeof value === 'number') {
      result[`${prefix}${key}`] = value
    }
  }
  return result
}
