import type { Attributes, AttributeValue } from '@opentelemetry/api'

const DEFAULT_MAX_LEN = 256

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
