import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  getInitialSettings,
  getUserLanguageSettingWithFallback,
  updateSettingsForSource,
} from '../settings.js'
import { resetSettingsCache } from '../settingsCache.js'
import { getInitialEffortSetting } from '../../effort.js'

// 代理托管重启会把 ~/.claude/settings.json 重写为模板，General 的回复语言与默认推理
// 强度随之外丢失；cc-haha/settings.json 保留一份可回退副本，显式用户值仍优先
describe('cc-haha General settings fallback', () => {
  let home: string
  let configDir: string

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-haha-general-fallback-'))
    configDir = path.join(home, '.claude')
    await fs.mkdir(path.join(configDir, 'cc-haha'), { recursive: true })
    process.env.HOME = home
    process.env.CLAUDE_CONFIG_DIR = configDir
    resetSettingsCache()
  })

  afterEach(async () => {
    resetSettingsCache()
    delete process.env.HOME
    delete process.env.CLAUDE_CONFIG_DIR
    await fs.rm(home, { recursive: true, force: true })
  })

  it('restores language and xhigh effort after a proxy-managed settings.json rewrite', async () => {
    await fs.writeFile(
      path.join(configDir, 'cc-haha', 'settings.json'),
      JSON.stringify({ defaultEffort: 'xhigh', language: 'chinese' }),
    )
    await fs.writeFile(
      path.join(configDir, 'settings.json'),
      JSON.stringify({ env: { ANTHROPIC_API_KEY: 'PROXY_MANAGED' }, outputStyle: 'engineer-professional' }),
    )
    resetSettingsCache()

    expect(getInitialSettings().language).toBe('chinese')
    expect(getUserLanguageSettingWithFallback()).toBe('chinese')
    expect(getInitialEffortSetting()).toBe('xhigh')
  })

  it('lets an explicit user reset override the fallback', async () => {
    await fs.writeFile(
      path.join(configDir, 'cc-haha', 'settings.json'),
      JSON.stringify({ defaultEffort: 'xhigh', language: 'chinese' }),
    )
    await fs.writeFile(path.join(configDir, 'settings.json'), JSON.stringify({ language: '' }))
    resetSettingsCache()

    expect(getInitialSettings().language).toBe('')
  })

  it('writes user General changes back to the fallback copy for the next reboot', async () => {
    updateSettingsForSource('userSettings', { language: 'japanese', effort: 'high' })
    resetSettingsCache()

    const backup = JSON.parse(
      await fs.readFile(path.join(configDir, 'cc-haha', 'settings.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(backup).toMatchObject({ language: 'japanese', defaultEffort: 'high' })
    expect(backup).not.toHaveProperty('effort')

    updateSettingsForSource('userSettings', { language: '', effort: '' })
    resetSettingsCache()
    const cleared = JSON.parse(
      await fs.readFile(path.join(configDir, 'cc-haha', 'settings.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(cleared).not.toHaveProperty('language')
    expect(cleared).not.toHaveProperty('defaultEffort')
  })
})
