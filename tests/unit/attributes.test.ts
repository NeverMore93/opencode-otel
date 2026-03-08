import { describe, test, expect } from 'bun:test'
import { truncateString, truncateAttributes } from '../../src/telemetry/attributes.ts'

describe('truncateString', () => {
  test('returns string unchanged when shorter than maxLen', () => {
    expect(truncateString('hello', 256)).toBe('hello')
  })

  test('returns string unchanged when exactly maxLen', () => {
    const s = 'a'.repeat(256)
    expect(truncateString(s)).toBe(s)
    expect(truncateString(s).length).toBe(256)
  })

  test('truncates string when longer than maxLen', () => {
    const s = 'a'.repeat(257)
    const result = truncateString(s)
    expect(result.length).toBe(256)
    expect(result).toBe('a'.repeat(256))
  })

  test('respects custom maxLen', () => {
    expect(truncateString('hello world', 5)).toBe('hello')
    expect(truncateString('hi', 5)).toBe('hi')
  })
})

describe('truncateAttributes', () => {
  test('truncates string values exceeding default maxLen', () => {
    const long = 'x'.repeat(300)
    const result = truncateAttributes({ key: long })
    expect((result['key'] as string).length).toBe(256)
  })

  test('leaves string values at or below maxLen unchanged', () => {
    const exact = 'a'.repeat(256)
    const short = 'short'
    const result = truncateAttributes({ exact, short })
    expect(result['exact']).toBe(exact)
    expect(result['short']).toBe(short)
  })

  test('does not truncate non-string values', () => {
    const attrs = { num: 42, flag: true, arr: [1, 2, 3] }
    const result = truncateAttributes(attrs)
    expect(result['num']).toBe(42)
    expect(result['flag']).toBe(true)
    expect(result['arr']).toEqual([1, 2, 3])
  })

  test('handles mixed types — only strings are truncated', () => {
    const long = 'z'.repeat(500)
    const attrs = { label: long, count: 7, active: false }
    const result = truncateAttributes(attrs)
    expect((result['label'] as string).length).toBe(256)
    expect(result['count']).toBe(7)
    expect(result['active']).toBe(false)
  })

  test('does not mutate the original object', () => {
    const long = 'y'.repeat(300)
    const original = { text: long, num: 1 }
    truncateAttributes(original)
    expect(original.text.length).toBe(300)
    expect(original.num).toBe(1)
  })

  test('returns a new object reference', () => {
    const original = { a: 'hello' }
    const result = truncateAttributes(original)
    expect(result).not.toBe(original)
  })

  test('respects custom maxLen', () => {
    const attrs = { label: 'hello world', count: 3 }
    const result = truncateAttributes(attrs, 5)
    expect(result['label']).toBe('hello')
    expect(result['count']).toBe(3)
  })
})
