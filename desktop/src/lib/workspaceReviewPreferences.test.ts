import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_REVIEW_PREFERENCES,
  WORKSPACE_REVIEW_PREFERENCES_STORAGE_KEY,
  normalizeWorkspaceReviewPreferences,
  readWorkspaceReviewPreferences,
  writeWorkspaceReviewPreferences,
} from './workspaceReviewPreferences'

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
})

describe('workspace review preferences', () => {
  it('starts from the unified, unwrapped layout with the tree open', () => {
    expect(readWorkspaceReviewPreferences(storage)).toEqual(DEFAULT_WORKSPACE_REVIEW_PREFERENCES)
    expect(DEFAULT_WORKSPACE_REVIEW_PREFERENCES).toEqual({
      diffMode: 'unified',
      wrapLines: false,
      treeOpen: true,
    })
  })

  it('round-trips every switch the review toolbar persists', () => {
    writeWorkspaceReviewPreferences({ diffMode: 'split', wrapLines: true, treeOpen: false }, storage)
    expect(storage.getItem(WORKSPACE_REVIEW_PREFERENCES_STORAGE_KEY)).not.toBeNull()
    expect(readWorkspaceReviewPreferences(storage)).toEqual({
      diffMode: 'split',
      wrapLines: true,
      treeOpen: false,
    })
  })

  it('falls back per field when stored content is damaged or partial', () => {
    storage.setItem(WORKSPACE_REVIEW_PREFERENCES_STORAGE_KEY, '{not json')
    expect(readWorkspaceReviewPreferences(storage)).toEqual(DEFAULT_WORKSPACE_REVIEW_PREFERENCES)

    storage.setItem(WORKSPACE_REVIEW_PREFERENCES_STORAGE_KEY, JSON.stringify({ diffMode: 'sideways', wrapLines: 'yes' }))
    expect(readWorkspaceReviewPreferences(storage)).toEqual(DEFAULT_WORKSPACE_REVIEW_PREFERENCES)

    storage.setItem(WORKSPACE_REVIEW_PREFERENCES_STORAGE_KEY, JSON.stringify({ treeOpen: false }))
    expect(readWorkspaceReviewPreferences(storage)).toEqual({
      diffMode: 'unified',
      wrapLines: false,
      treeOpen: false,
    })
  })

  it('ignores empty arrays and null payloads', () => {
    expect(normalizeWorkspaceReviewPreferences([])).toEqual(DEFAULT_WORKSPACE_REVIEW_PREFERENCES)
    expect(normalizeWorkspaceReviewPreferences(null)).toEqual(DEFAULT_WORKSPACE_REVIEW_PREFERENCES)
  })

  it('keeps working when localStorage rejects the write', () => {
    const refusing = Object.assign(new MemoryStorage(), {
      setItem: () => { throw new Error('quota exceeded') },
    })
    expect(() => writeWorkspaceReviewPreferences({ diffMode: 'split', wrapLines: true, treeOpen: false }, refusing)).not.toThrow()
    expect(readWorkspaceReviewPreferences(refusing)).toEqual(DEFAULT_WORKSPACE_REVIEW_PREFERENCES)
  })
})
