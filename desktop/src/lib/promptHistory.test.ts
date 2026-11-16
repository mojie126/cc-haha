import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearPromptHistory,
  GLOBAL_PROMPT_HISTORY_SCOPE,
  MAX_PROMPT_HISTORY_TOTAL_CHARS,
  PROMPT_HISTORY_SCOPES_STORAGE_KEY,
  PROMPT_HISTORY_STORAGE_KEY,
  promptHistoryScopeForProject,
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

  it('isolates recall between projects', () => {
    const alpha = promptHistoryScopeForProject('/repo/alpha')
    const beta = promptHistoryScopeForProject('C:\\repo\\beta')
    recordPromptHistory('alpha prompt', alpha)
    recordPromptHistory('beta prompt', beta)

    expect(readPromptHistory(alpha)).toEqual(['alpha prompt'])
    expect(readPromptHistory(beta)).toEqual(['beta prompt'])
    // A project scope never inherits the legacy global list.
    expect(readPromptHistory(GLOBAL_PROMPT_HISTORY_SCOPE)).toEqual([])
  })

  it('normalizes the project path so the same directory shares one scope', () => {
    expect(promptHistoryScopeForProject('/repo/alpha/')).toBe(promptHistoryScopeForProject('/repo/alpha'))
    expect(promptHistoryScopeForProject('C:\\repo\\beta')).toBe(promptHistoryScopeForProject('C:/repo/beta'))
    expect(promptHistoryScopeForProject('  ')).toBe(GLOBAL_PROMPT_HISTORY_SCOPE)
  })

  it('reads the pre-scope list for the fallback scope', () => {
    localStorage.setItem(PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(['legacy one']))
    expect(readPromptHistory()).toEqual(['legacy one'])
    expect(readPromptHistory(promptHistoryScopeForProject('/repo/alpha'))).toEqual([])
  })

  it('bounds total stored text across every scope', () => {
    for (let scopeIndex = 0; scopeIndex < 6; scopeIndex += 1) {
      const scope = promptHistoryScopeForProject(`/repo/${scopeIndex}`)
      for (let entry = 0; entry < 40; entry += 1) {
        recordPromptHistory(`${scopeIndex}-${entry}-${'x'.repeat(7_900)}`, scope)
      }
    }

    const envelope = JSON.parse(localStorage.getItem(PROMPT_HISTORY_SCOPES_STORAGE_KEY)!) as {
      scopes: Record<string, { prompts: string[] }>
    }
    const total = Object.values(envelope.scopes)
      .flatMap((entry) => entry.prompts)
      .reduce((sum, prompt) => sum + prompt.length, 0)
    expect(total).toBeLessThanOrEqual(MAX_PROMPT_HISTORY_TOTAL_CHARS)
    // The newest scope survives with its newest prompt.
    expect(readPromptHistory(promptHistoryScopeForProject('/repo/5'))[0]).toMatch(/^5-39-/)
  })

  it('survives a corrupt payload', () => {
    localStorage.setItem(PROMPT_HISTORY_SCOPES_STORAGE_KEY, '{not json')
    expect(readPromptHistory()).toEqual([])
    recordPromptHistory('after corruption')
    expect(readPromptHistory()).toEqual(['after corruption'])
  })

  it('clears one scope without touching another', () => {
    const alpha = promptHistoryScopeForProject('/repo/alpha')
    recordPromptHistory('one', alpha)
    recordPromptHistory('two', promptHistoryScopeForProject('/repo/beta'))

    clearPromptHistory(alpha)
    expect(readPromptHistory(alpha)).toEqual([])
    expect(readPromptHistory(promptHistoryScopeForProject('/repo/beta'))).toEqual(['two'])

    clearPromptHistory()
    expect(readPromptHistory(promptHistoryScopeForProject('/repo/beta'))).toEqual([])
  })
})
