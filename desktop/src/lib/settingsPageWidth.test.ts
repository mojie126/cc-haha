import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS_PAGE_WIDTH,
  applySettingsPageWidth,
  normalizeSettingsPageCustomWidth,
  normalizeSettingsPageWidth,
  persistSettingsPageWidth,
  readSettingsPageWidth,
  resolveSettingsPageWidth,
  SETTINGS_PAGE_WIDTH_STORAGE_KEY,
} from './settingsPageWidth'

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
})

describe('settings page width', () => {
  it('defaults to the standard frame', () => {
    expect(readSettingsPageWidth(storage)).toEqual(DEFAULT_SETTINGS_PAGE_WIDTH)
    expect(resolveSettingsPageWidth(DEFAULT_SETTINGS_PAGE_WIDTH)).toBe('1120px')
  })

  it('resolves every preset', () => {
    expect(resolveSettingsPageWidth({ mode: 'standard', customWidth: '1600px' })).toBe('1120px')
    expect(resolveSettingsPageWidth({ mode: 'wide', customWidth: '1600px' })).toBe('1600px')
    expect(resolveSettingsPageWidth({ mode: 'full', customWidth: '1600px' })).toBe('100%')
  })

  it('clamps custom widths and never interpolates arbitrary CSS', () => {
    expect(normalizeSettingsPageCustomWidth('20000px')).toBe('4000px')
    expect(normalizeSettingsPageCustomWidth('10px')).toBe('800px')
    expect(normalizeSettingsPageCustomWidth('90%')).toBe('90%')
    expect(normalizeSettingsPageCustomWidth('120%')).toBe('100%')
    expect(normalizeSettingsPageCustomWidth('5%')).toBe('50%')
    expect(normalizeSettingsPageCustomWidth('calc(100vw)')).toBe('1600px')
  })

  it('round-trips through storage and rejects unknown shapes', () => {
    persistSettingsPageWidth({ mode: 'custom', customWidth: '1400px' }, storage)
    expect(readSettingsPageWidth(storage)).toEqual({ mode: 'custom', customWidth: '1400px' })

    storage.setItem(SETTINGS_PAGE_WIDTH_STORAGE_KEY, JSON.stringify({ mode: 'huge', customWidth: 'x' }))
    expect(readSettingsPageWidth(storage)).toEqual(DEFAULT_SETTINGS_PAGE_WIDTH)

    storage.setItem(SETTINGS_PAGE_WIDTH_STORAGE_KEY, JSON.stringify({ version: 99, mode: 'full' }))
    expect(readSettingsPageWidth(storage)).toEqual(DEFAULT_SETTINGS_PAGE_WIDTH)
  })

  it('writes the resolved width to the document variable', () => {
    applySettingsPageWidth({ mode: 'wide', customWidth: '1600px' })
    expect(document.documentElement.style.getPropertyValue('--settings-page-width')).toBe('1600px')
    applySettingsPageWidth({ mode: 'custom', customWidth: '75%' })
    expect(document.documentElement.style.getPropertyValue('--settings-page-width')).toBe('75%')
    applySettingsPageWidth(DEFAULT_SETTINGS_PAGE_WIDTH)
  })

  it('normalizes an unversioned record additively', () => {
    expect(normalizeSettingsPageWidth({ mode: 'wide' })).toEqual({ mode: 'wide', customWidth: '1600px' })
  })
})
