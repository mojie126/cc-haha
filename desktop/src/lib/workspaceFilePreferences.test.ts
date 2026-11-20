import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_FILE_PREFERENCES,
  WORKSPACE_FILE_PREFERENCES_STORAGE_KEY,
  normalizeWorkspaceFilePreferences,
  readWorkspaceFilePreferences,
  writeWorkspaceFilePreferences,
} from './workspaceFilePreferences'

function memoryStorage(initial?: string) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(WORKSPACE_FILE_PREFERENCES_STORAGE_KEY, initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    values,
  }
}

describe('workspace file preferences', () => {
  it('falls back to showing both panes for missing or malformed records', () => {
    expect(normalizeWorkspaceFilePreferences(null)).toEqual(DEFAULT_WORKSPACE_FILE_PREFERENCES)
    expect(normalizeWorkspaceFilePreferences({ treeOpen: 'no', previewVisible: 0 })).toEqual(DEFAULT_WORKSPACE_FILE_PREFERENCES)
    expect(readWorkspaceFilePreferences(memoryStorage('{oops'))).toEqual(DEFAULT_WORKSPACE_FILE_PREFERENCES)
  })

  it('keeps explicit false values', () => {
    expect(normalizeWorkspaceFilePreferences({ treeOpen: false, previewVisible: false })).toEqual({
      treeOpen: false,
      previewVisible: false,
    })
  })

  it('round-trips through storage', () => {
    const storage = memoryStorage()
    writeWorkspaceFilePreferences({ treeOpen: false, previewVisible: true }, storage)
    expect(readWorkspaceFilePreferences(storage)).toEqual({ treeOpen: false, previewVisible: true })
  })
})
