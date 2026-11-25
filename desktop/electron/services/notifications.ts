import type { DesktopNotificationOptions, NotificationPermissionState } from '../../src/lib/desktopHost/types'
import { playNotificationSound, type NotificationBeep } from './notificationSound'

export type ElectronNotificationInstance = {
  show(): void
  on(event: 'click' | 'close' | 'failed', handler: () => void): ElectronNotificationInstance
}

export type ElectronNotificationConstructor = {
  new(options: { title: string, body?: string, icon?: string, silent?: boolean }): ElectronNotificationInstance
  isSupported(): boolean
}

const activeNotifications = new Set<ElectronNotificationInstance>()

export function validateNotificationOptions(value: unknown): value is DesktopNotificationOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.title === 'string'
    && record.title.trim().length > 0
    && (record.body === undefined || typeof record.body === 'string')
    && (record.icon === undefined || typeof record.icon === 'string')
    && (record.id === undefined || typeof record.id === 'number')
    && (record.sound === undefined || typeof record.sound === 'boolean')
    && (record.extra === undefined || (typeof record.extra === 'object' && record.extra !== null && !Array.isArray(record.extra)))
}

export function notificationPermissionState(
  NotificationClass: ElectronNotificationConstructor,
): NotificationPermissionState {
  return NotificationClass.isSupported() ? 'granted' : 'denied'
}

export function requestNotificationPermission(
  NotificationClass: ElectronNotificationConstructor,
): NotificationPermissionState {
  return notificationPermissionState(NotificationClass)
}

export function sendDesktopNotification({
  NotificationClass,
  options,
  onAction,
  onLifecycle,
  beep,
}: {
  NotificationClass: ElectronNotificationConstructor
  options: unknown
  onAction: (payload: unknown) => void
  onLifecycle?: (event: 'close' | 'failed') => void
  /** 系统提示音实现，调用方按设置决定是否传入 */
  beep?: NotificationBeep
}): boolean {
  if (!validateNotificationOptions(options)) {
    throw new Error('Invalid Electron notification payload')
  }
  if (!NotificationClass.isSupported()) return false

  // 只要调用方声明这条通知由自己控制声音，就一律让系统静音；
  // 是否真的发声由 beep 是否存在决定，避免关掉提示音后系统默认音又响一次
  const soundRequested = options.sound === true
  const notification = new NotificationClass({
    title: options.title,
    body: options.body,
    icon: options.icon,
    ...(soundRequested ? { silent: true } : {}),
  })

  activeNotifications.add(notification)
  const cleanup = () => {
    activeNotifications.delete(notification)
  }
  notification.on('click', () => {
    onAction({
      id: options.id,
      extra: options.extra,
      target: options.target,
      action: 'click',
    })
    cleanup()
  })
  notification.on('close', () => {
    onLifecycle?.('close')
    cleanup()
  })
  notification.on('failed', () => {
    onLifecycle?.('failed')
    cleanup()
  })
  notification.show()
  // 通知已经弹出才发声，避免系统拒绝通知时只有声音没有内容
  if (soundRequested && beep) playNotificationSound(beep, true)
  return true
}
