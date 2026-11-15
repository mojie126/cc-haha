import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPromptHistory,
  PROMPT_HISTORY_STORAGE_KEY,
  readPromptHistory,
  recordPromptHistory,
} from './promptHistory'

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() })
})

describe('prompt history', () => {
  it('returns the newest prompt first and drops blank entries', () => {
    recordPromptHistory('first')
    recordPromptHistory('   ')
    recordPromptHistory('second')

    expect(readPromptHistory()).toEqual(['second', 'first'])
  })

  it('collapses consecutive duplicates and moves repeats to the front', () => {
    recordPromptHistory('alpha')
    recordPromptHistory('beta')
    recordPromptHistory('beta')
    expect(readPromptHistory()).toEqual(['beta', 'alpha'])

    recordPromptHistory('alpha')
    expect(readPromptHistory()).toEqual(['alpha', 'beta'])
  })

  it('keeps a bounded number of prompts', () => {
    for (let index = 0; index < 120; index += 1) recordPromptHistory(`prompt ${index}`)

    const history = readPromptHistory()
    expect(history).toHaveLength(100)
    expect(history[0]).toBe('prompt 119')
    expect(history).not.toContain('prompt 0')
  })

  it('truncates a very long prompt instead of storing it whole', () => {
    recordPromptHistory('x'.repeat(20_000))
    expect(readPromptHistory()[0]).toHaveLength(8_000)
  })

  it('survives a corrupt payload', () => {
    localStorage.setItem(PROMPT_HISTORY_STORAGE_KEY, '{not json')
    expect(readPromptHistory()).toEqual([])
    recordPromptHistory('after corruption')
    expect(readPromptHistory()).toEqual(['after corruption'])
  })

  it('clears the list', () => {
    recordPromptHistory('one')
    clearPromptHistory()
    expect(readPromptHistory()).toEqual([])
  })
})
