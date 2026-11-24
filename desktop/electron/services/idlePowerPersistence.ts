import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_IDLE_POWER_SETTINGS, IDLE_POWER_ACTIONS, isIdlePowerSettings,
  type IdlePowerRecord, type IdlePowerSettings,
} from '../../src/lib/idlePower'

export type PowerPreferenceApp = { getPath(name: 'userData'): string }
type Preferences = {
  schemaVersion: 1
  settings: IdlePowerSettings
  lastAction: IdlePowerRecord | null
  [key: string]: unknown
}
function preferencePath(app: PowerPreferenceApp): string { return path.join(app.getPath('userData'), 'idle-power.json') }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** v0/absent files predate the feature: migration never opts an existing install in. */
export function migrateIdlePowerPreferences(value: unknown): Preferences {
  if (!isRecord(value)) throw new Error('Invalid power preferences')
  if (value.schemaVersion !== undefined && value.schemaVersion !== 0 && value.schemaVersion !== 1) {
    throw new Error('Unsupported power preferences version')
  }
  if (value.schemaVersion !== 1) return { ...value, schemaVersion: 1, settings: { ...DEFAULT_IDLE_POWER_SETTINGS }, lastAction: null }
  if (!isIdlePowerSettings(value.settings)) throw new Error('Invalid power settings')
  const record = value.lastAction
  if (record !== null && (!isRecord(record)
    || !IDLE_POWER_ACTIONS.includes(record.action as IdlePowerRecord['action'])
    || typeof record.requestedAt !== 'number' || !Number.isFinite(record.requestedAt) || record.requestedAt < 0
    || !['requested', 'accepted', 'failed'].includes(record.result as string))) throw new Error('Invalid power action record')
  return { ...value, schemaVersion: 1, settings: value.settings, lastAction: record as IdlePowerRecord | null }
}

export function readIdlePowerPreferences(app: PowerPreferenceApp): Preferences {
  let raw: string
  try { raw = fs.readFileSync(preferencePath(app), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return migrateIdlePowerPreferences({})
    throw error
  }
  return migrateIdlePowerPreferences(JSON.parse(raw))
}

/** 只写调用方明确给出的字段，未给出的字段沿用磁盘上的当前值 */
export type IdlePowerPreferencesUpdate = { settings?: IdlePowerSettings, lastAction?: IdlePowerRecord | null }

export function writeIdlePowerPreferences(app: PowerPreferenceApp, value: IdlePowerPreferencesUpdate): void {
  // Read-modify-write retains extensions. Unknown/corrupt versions are never overwritten.
  // 未给出的字段沿用磁盘值，写入动作日志不会顺带改写用户配置的电源动作
  const current = readIdlePowerPreferences(app)
  const next = migrateIdlePowerPreferences({
    ...current,
    ...(value.settings === undefined ? {} : { settings: value.settings }),
    ...(value.lastAction === undefined ? {} : { lastAction: value.lastAction }),
  })
  const target = preferencePath(app)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(temporary, target)
  } finally { fs.rmSync(temporary, { force: true }) }
}
