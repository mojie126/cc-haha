import { describe, expect, it } from 'vitest'

import {
  buildSettingsSearchEntries,
  fuzzySettingsScore,
  searchSettings,
  settingsTabForKey,
} from './settingsSearch'

const DICTIONARY: Record<string, string> = {
  'settings.general.languageTitle': 'Language',
  'settings.general.languageDescription': 'Choose the interface language.',
  'settings.chatAppearance.fontSize': 'Chat font size',
  'settings.providers.addProvider': 'Add provider',
  'settings.tabs.limit': 'Open tab limit',
  'settings.tabs.limitCount': '{count} tabs',
  'settings.tab.voice': 'Voice',
  'settings.search.placeholder': 'Search settings',
  'voice.settings.enabled': 'Voice input',
  'pet.enabled': 'Desktop pet',
  'power.action.sleep': 'Sleep',
  'unrelated.key': 'Unrelated',
}

describe('settings search index', () => {
  it('indexes setting labels but drops hints, actions and dynamic text', () => {
    const labels = buildSettingsSearchEntries(DICTIONARY).map((entry) => entry.label)
    expect(labels).toContain('Language')
    expect(labels).toContain('Chat font size')
    expect(labels).toContain('Voice input')
    expect(labels).not.toContain('Choose the interface language.')
    expect(labels).not.toContain('{count} tabs')
    expect(labels).not.toContain('Search settings')
    expect(labels).not.toContain('Unrelated') // unrelated prefix is not indexed
  })

  it('maps each namespace to the pane that renders it', () => {
    expect(settingsTabForKey('settings.providers.addProvider')).toBe('providers')
    expect(settingsTabForKey('settings.chatAppearance.fontSize')).toBe('general')
    expect(settingsTabForKey('settings.tabs.limit')).toBe('general')
    expect(settingsTabForKey('voice.settings.enabled')).toBe('voice')
    expect(settingsTabForKey('pet.enabled')).toBe('pets')
    expect(settingsTabForKey('power.action.sleep')).toBe('general')
  })

  it('ranks an exact label above a longer label containing the query', () => {
    expect(fuzzySettingsScore('language', 'Language')).toBeGreaterThan(
      fuzzySettingsScore('language', 'Interface language preferences')!,
    )
  })

  it('matches Chinese and scattered subsequences', () => {
    expect(fuzzySettingsScore('字号', '聊天字号')).not.toBeNull()
    expect(fuzzySettingsScore('chfs', 'Chat font size')).not.toBeNull()
    expect(fuzzySettingsScore('xyz', 'Chat font size')).toBeNull()
  })

  it('returns the most relevant pane for a query', () => {
    const entries = buildSettingsSearchEntries(DICTIONARY)
    expect(searchSettings(entries, 'font')[0]?.label).toBe('Chat font size')
    expect(searchSettings(entries, 'voice').map((entry) => entry.tab)).toContain('voice')
    expect(searchSettings(entries, '')).toEqual([])
  })
})
