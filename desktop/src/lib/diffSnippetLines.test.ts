import { describe, expect, it } from 'vitest'
import { resolveSnippetStartLine } from './diffSnippetLines'

describe('resolveSnippetStartLine', () => {
  const file = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n')

  it('locates a unique applied snippet at its real line', () => {
    expect(resolveSnippetStartLine(file, 'line 3', 'line 3 changed')).toBe(3)
  })

  it('matches CRLF files against LF snippets', () => {
    expect(resolveSnippetStartLine('a\r\nb\r\nc\r\nd', 'c', 'c changed')).toBe(3)
  })

  it('prefers the old snippet while the file is still pre-edit', () => {
    const preEdit = 'alpha\nbeta\ngamma'
    expect(resolveSnippetStartLine(preEdit, 'beta', 'BETA', { phase: 'before' })).toBe(2)
  })

  it('refuses an ambiguous snippet so the caller can hide line numbers', () => {
    expect(resolveSnippetStartLine('same\nsame\nsame', 'same', 'other')).toBeNull()
  })

  it('takes the first occurrence when the edit replaced every match', () => {
    expect(resolveSnippetStartLine('same\nx\nsame', 'same', 'other', { replaceAll: true })).toBe(1)
  })

  it('returns null for a pure deletion that left nothing to anchor on', () => {
    expect(resolveSnippetStartLine('alpha\ngamma', 'beta\n', '')).toBeNull()
  })
})
