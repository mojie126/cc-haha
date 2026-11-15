import { beforeEach, describe, expect, it } from 'vitest'
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  clearPersistedComposerDraft,
  readComposerDrafts,
  writeComposerDraft,
} from './composerDraftPersistence'

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

describe('composer draft persistence', () => {
  it('round-trips text, mentions and path-only attachments', () => {
    writeComposerDraft('session-a', {
      input: 'read @README.md',
      mentions: [{ label: 'README.md', path: '/repo/README.md', isDirectory: false, tokenOrdinal: 0 }],
      attachments: [{ id: 'att-1', name: 'notes.md', type: 'file', path: '/repo/notes.md' }],
    })

    const drafts = readComposerDrafts()
    expect(drafts['session-a']).toMatchObject({
      input: 'read @README.md',
      mentions: [{ label: 'README.md', path: '/repo/README.md' }],
      attachments: [{ id: 'att-1', name: 'notes.md', path: '/repo/notes.md' }],
    })
  })

  it('drops inline image payloads that would blow the storage quota', () => {
    writeComposerDraft('session-a', {
      input: '',
      mentions: [],
      attachments: [{
        id: 'att-img', name: 'shot.png', type: 'image',
        data: 'data:image/png;base64,AAAA', previewUrl: 'data:image/png;base64,AAAA',
      }],
    })

    const attachment = readComposerDrafts()['session-a']?.attachments[0]
    expect(attachment).toMatchObject({ id: 'att-img', name: 'shot.png', type: 'image' })
    expect(attachment?.data).toBeUndefined()
    expect(attachment?.previewUrl).toBeUndefined()
  })

  it('removes the record when the draft becomes empty', () => {
    writeComposerDraft('session-a', { input: 'draft', mentions: [], attachments: [] })
    writeComposerDraft('session-a', { input: '', mentions: [], attachments: [] })

    expect(readComposerDrafts()).toEqual({})
  })

  it('clears one session without touching the others', () => {
    writeComposerDraft('a', { input: 'first', mentions: [], attachments: [] })
    writeComposerDraft('b', { input: 'second', mentions: [], attachments: [] })

    clearPersistedComposerDraft('a')

    expect(readComposerDrafts()).toEqual({ b: { input: 'second', mentions: [], attachments: [] } })
  })

  it('keeps only the newest twenty sessions', () => {
    for (let index = 0; index < 25; index += 1) {
      writeComposerDraft(`session-${index}`, { input: `draft ${index}`, mentions: [], attachments: [] })
    }

    const drafts = readComposerDrafts()
    expect(Object.keys(drafts)).toHaveLength(20)
    expect(drafts['session-0']).toBeUndefined()
    expect(drafts['session-24']?.input).toBe('draft 24')
  })

  it('ignores a corrupt or foreign payload instead of throwing', () => {
    storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, '{not json')
    expect(readComposerDrafts()).toEqual({})

    storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify({ version: 99, drafts: { a: { input: 'x' } } }))
    expect(readComposerDrafts()).toEqual({})
  })

  it('keeps a draft when the storage quota rejects the write', () => {
    const refusing: Storage = {
      ...new MemoryStorage(),
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: refusing })

    expect(() => writeComposerDraft('session-a', { input: 'kept', mentions: [], attachments: [] })).not.toThrow()
  })
})
