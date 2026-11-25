import { readFileSync } from 'node:fs'
import path from 'node:path'
import { claudeConfigDir } from './sidecarManager'

/** 只关注提示音开关，其余设置字段与主进程无关 */
export function parseNotificationSoundEnabled(
  contents: string,
  fallback = true,
): boolean {
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    return fallback
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const settings = value as Record<string, unknown>
  // 声音从属于系统通知，通知本身关闭时不再单独发声
  if (settings.desktopNotificationsEnabled === false) return false
  // 缺省视为开启，只有显式关闭才静音
  return settings.desktopNotificationSoundEnabled !== false
}

/** 读取用户设置里的提示音开关，读取失败时按开启处理 */
export function readNotificationSoundEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const settingsPath = path.join(claudeConfigDir(env), 'settings.json')
    return parseNotificationSoundEnabled(readFileSync(settingsPath, 'utf-8'))
  } catch {
    return true
  }
}

export type NotificationBeep = () => void

/**
 * 按设置播放系统提示音
 * @param beep 实际发声实现，测试可注入
 * @param enabled 是否允许发声
 * @returns 是否真的发声
 */
export function playNotificationSound(
  beep: NotificationBeep,
  enabled: boolean,
): boolean {
  if (!enabled) return false
  try {
    beep()
    return true
  } catch {
    return false
  }
}