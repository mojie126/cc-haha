import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseNotificationSoundEnabled,
  playNotificationSound,
  readNotificationSoundEnabled,
} from './notificationSound'

const homes: string[] = []
afterEach(() => {
  homes.splice(0).forEach(home => rmSync(home, { force: true, recursive: true }))
})

describe('notification sound preferences', () => {
  it('treats an absent sound field as enabled so upgrades keep the alert', () => {
    expect(parseNotificationSoundEnabled(JSON.stringify({ desktopNotificationsEnabled: true }))).toBe(true)
  })

  it('mutes the sound when notifications themselves are disabled', () => {
    expect(parseNotificationSoundEnabled(JSON.stringify({
      desktopNotificationsEnabled: false,
      desktopNotificationSoundEnabled: true,
    }))).toBe(false)
  })

  it('honours an explicit opt-out and falls back to enabled when the file is unreadable', () => {
    expect(parseNotificationSoundEnabled(JSON.stringify({ desktopNotificationSoundEnabled: false }))).toBe(false)
    expect(parseNotificationSoundEnabled('not json')).toBe(true)
    expect(parseNotificationSoundEnabled(JSON.stringify(['array']))).toBe(true)
  })

  it('reads the sound preference from the user settings file', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'notification-sound-'))
    homes.push(home)
    writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ desktopNotificationSoundEnabled: false }))
    expect(readNotificationSoundEnabled({ CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv)).toBe(false)
  })

  it('defaults to enabled when the settings file is missing', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'notification-sound-'))
    homes.push(home)
    expect(readNotificationSoundEnabled({ CLAUDE_CONFIG_DIR: home } as NodeJS.ProcessEnv)).toBe(true)
  })

  it('plays the beep once when enabled and swallows failures', () => {
    const beep = vi.fn()
    expect(playNotificationSound(beep, true)).toBe(true)
    expect(beep).toHaveBeenCalledTimes(1)

    expect(playNotificationSound(beep, false)).toBe(false)
    expect(beep).toHaveBeenCalledTimes(1)

    const throwing = vi.fn(() => { throw new Error('no audio device') })
    expect(playNotificationSound(throwing, true)).toBe(false)
  })
})