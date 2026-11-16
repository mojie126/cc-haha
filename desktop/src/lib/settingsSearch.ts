import type { SettingsTab } from '@/stores/uiStore'

/**
 * One searchable setting label and the pane that renders it. The index is
 * built from the translation dictionary rather than from mounted components,
 * so a setting in a pane the user has never opened is still findable.
 */
export type SettingsSearchEntry = {
  key: string
  label: string
  tab: SettingsTab
}

/** Keys whose text is a status line, hint or action rather than a setting. */
const SKIP_SUFFIXES = [
  'Hint',
  'Description',
  'Desc',
  'Placeholder',
  'Error',
  'Failed',
  'Failure',
  'Loading',
  'Empty',
  'Toast',
  'Tooltip',
  'Confirm',
  'Warning',
  'Notice',
  'Unavailable',
  'Caption',
  'Retry',
  'Status',
  'Unknown',
]

const INDEXABLE_PREFIXES = ['settings.', 'voice.', 'pet.', 'power.', 'publicAccess.', 'h5Settings.']

function isIndexable(key: string, label: string): boolean {
  if (!INDEXABLE_PREFIXES.some((prefix) => key.startsWith(prefix))) return false
  if (key.startsWith('settings.tab.') || key.startsWith('settings.help.') || key.startsWith('settings.search.')) return false
  if (!label.trim() || label.length > 90) return false
  if (label.includes('{') || label.includes('}')) return false
  if (/[.。…]$/.test(label.trim())) return false
  return !SKIP_SUFFIXES.some((suffix) => key.endsWith(suffix))
}

export function settingsTabForKey(key: string): SettingsTab {
  if (key.startsWith('voice.')) return 'voice'
  if (key.startsWith('pet.')) return 'pets'
  if (key.startsWith('power.')) return 'general'
  if (key.startsWith('publicAccess.') || key.startsWith('h5Settings.')) return 'h5Access'

  const namespace = key.slice('settings.'.length).split('.')[0]
  switch (namespace) {
    case 'providers':
    case 'claudeOfficialLogin':
    case 'grokOfficialLogin':
    case 'chatgptOfficialLogin':
    case 'deepseekAccountLogin':
    case 'officialLoginRisk':
      return 'providers'
    case 'activity':
      return 'activity'
    case 'adapters':
      return 'adapters'
    case 'terminal':
      return 'terminal'
    case 'mcp':
      return 'mcp'
    case 'agents':
      return 'agents'
    case 'skills':
      return 'skills'
    case 'memory':
      return 'memory'
    case 'plugins':
      return 'plugins'
    case 'pets':
      return 'pets'
    case 'computerUse':
      return 'computerUse'
    case 'diagnostics':
      return 'diagnostics'
    case 'about':
      return 'about'
    case 'h5Access':
      return 'h5Access'
    default:
      return 'general'
  }
}

export function buildSettingsSearchEntries(
  dictionary: Record<string, string>,
): SettingsSearchEntry[] {
  const entries: SettingsSearchEntry[] = []
  const seen = new Set<string>()

  for (const [key, label] of Object.entries(dictionary)) {
    if (!isIndexable(key, label)) continue
    const tab = settingsTabForKey(key)
    const dedupeKey = `${tab}\u0000${label.trim()}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    entries.push({ key, label: label.trim(), tab })
  }

  return entries
}

/**
 * Fuzzy score for one label, or null when the query's characters do not appear
 * in order. Contiguous matches beat scattered subsequences, and shorter labels
 * win ties so "Language" ranks above a sentence that happens to contain it.
 */
export function fuzzySettingsScore(query: string, label: string): number | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return null
  const haystack = label.toLowerCase()

  if (haystack === needle) return 1000
  if (haystack.startsWith(needle)) return 900 - haystack.length

  const index = haystack.indexOf(needle)
  if (index >= 0) return 700 - index - haystack.length * 0.1

  let cursor = 0
  let gaps = 0
  let previous = -1
  for (let i = 0; i < haystack.length && cursor < needle.length; i += 1) {
    if (haystack[i] !== needle[cursor]) continue
    if (previous >= 0) gaps += i - previous - 1
    previous = i
    cursor += 1
  }
  if (cursor < needle.length) return null
  return 400 - gaps - haystack.length * 0.1
}

export function searchSettings(
  entries: ReadonlyArray<SettingsSearchEntry>,
  query: string,
  limit = 12,
): SettingsSearchEntry[] {
  if (!query.trim()) return []
  return entries
    .flatMap((entry) => {
      const score = fuzzySettingsScore(query, entry.label)
      return score === null ? [] : [{ entry, score }]
    })
    .sort((a, b) => b.score - a.score || a.entry.label.length - b.entry.label.length)
    .slice(0, limit)
    .map(({ entry }) => entry)
}
