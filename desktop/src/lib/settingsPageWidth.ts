/**
 * Width of the Settings page frame.
 *
 * The frame was pinned to 1120px, which left wide displays with a mostly empty
 * right side and squeezed long descriptions into unnecessary wraps. This is the
 * same preset/custom shape as the chat width preference, but it drives the
 * settings frame's own CSS variable.
 */
export const SETTINGS_PAGE_WIDTH_STORAGE_KEY = 'cc-haha-settings-page-width'
export const SETTINGS_PAGE_WIDTH_VERSION = 1

export type SettingsPageWidthMode = 'standard' | 'wide' | 'full' | 'custom'

export type SettingsPageWidthPreference = {
  mode: SettingsPageWidthMode
  customWidth: string
}

export const DEFAULT_SETTINGS_PAGE_WIDTH: SettingsPageWidthPreference = {
  mode: 'standard',
  customWidth: '1600px',
}

const PRESET_WIDTHS: Record<Exclude<SettingsPageWidthMode, 'custom'>, string> = {
  standard: '1120px',
  wide: '1600px',
  full: '100%',
}

const CUSTOM_WIDTH_RE = /^(\d+(?:\.\d+)?)(px|%)$/

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function getStorage(): StorageLike | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

/** Keeps arbitrary strings out of the CSS variable. */
export function normalizeSettingsPageCustomWidth(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SETTINGS_PAGE_WIDTH.customWidth
  const match = CUSTOM_WIDTH_RE.exec(value.trim())
  if (!match) return DEFAULT_SETTINGS_PAGE_WIDTH.customWidth
  const amount = Number(match[1])
  if (match[2] === 'px') {
    return `${Math.min(4000, Math.max(800, Math.round(amount)))}px`
  }
  return `${Math.min(100, Math.max(50, Math.round(amount * 10) / 10))}%`
}

export function normalizeSettingsPageWidth(value: unknown): SettingsPageWidthPreference {
  const record = isRecord(value) ? value : {}
  return {
    mode: record.mode === 'wide' || record.mode === 'full' || record.mode === 'custom'
      ? record.mode
      : 'standard',
    customWidth: normalizeSettingsPageCustomWidth(record.customWidth),
  }
}

export function readSettingsPageWidth(storage: StorageLike | null = getStorage()): SettingsPageWidthPreference {
  try {
    const raw = storage?.getItem(SETTINGS_PAGE_WIDTH_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS_PAGE_WIDTH }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || (parsed.version !== undefined && parsed.version !== SETTINGS_PAGE_WIDTH_VERSION)) {
      return { ...DEFAULT_SETTINGS_PAGE_WIDTH }
    }
    return normalizeSettingsPageWidth(parsed)
  } catch {
    return { ...DEFAULT_SETTINGS_PAGE_WIDTH }
  }
}

export function persistSettingsPageWidth(
  preference: SettingsPageWidthPreference,
  storage: StorageLike | null = getStorage(),
): void {
  try {
    storage?.setItem(SETTINGS_PAGE_WIDTH_STORAGE_KEY, JSON.stringify({
      version: SETTINGS_PAGE_WIDTH_VERSION,
      ...normalizeSettingsPageWidth(preference),
    }))
  } catch {
    // A UI preference; ignore storage failures.
  }
}

export function resolveSettingsPageWidth(preference: SettingsPageWidthPreference): string {
  const normalized = normalizeSettingsPageWidth(preference)
  return normalized.mode === 'custom' ? normalized.customWidth : PRESET_WIDTHS[normalized.mode]
}

export function applySettingsPageWidth(preference: SettingsPageWidthPreference): void {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--settings-page-width', resolveSettingsPageWidth(preference))
}
