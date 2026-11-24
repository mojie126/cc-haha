import type { PowerMonitor, PowerSaveBlocker, Screen, WebContents } from 'electron'
import { en } from '../../src/i18n/locales/en'
import { zh } from '../../src/i18n/locales/zh'
import { zh as zhTW } from '../../src/i18n/locales/zh-TW'
import { jp } from '../../src/i18n/locales/jp'
import { kr } from '../../src/i18n/locales/kr'
import type { Locale } from '../../src/i18n/locale'
import type { IdlePowerAction, IdlePowerState } from '../../src/lib/idlePower'
import { IdlePowerService, type PowerActivitySnapshot } from './idlePower'
import type { IdlePowerDebug } from './idlePowerDebug'
import { detectPowerCapabilities, executePowerAction } from './idlePowerPlatform'
import { readIdlePowerPreferences, writeIdlePowerPreferences, type PowerPreferenceApp } from './idlePowerPersistence'
import { sendDesktopNotification, type ElectronNotificationConstructor } from './notifications'

const dictionaries: Record<Locale, Record<string, string>> = { en, zh, 'zh-TW': zhTW, jp, kr }
export async function createIdlePowerHost(options: {
  app: PowerPreferenceApp
  blocker: Pick<PowerSaveBlocker, 'start' | 'stop'>
  monitor: Pick<PowerMonitor, 'getSystemIdleTime'>
  screen: Pick<Screen, 'getCursorScreenPoint'>
  NotificationClass: ElectronNotificationConstructor
  locale(): Locale
  readActivity(signal: AbortSignal): Promise<PowerActivitySnapshot>
  onChange(state: IdlePowerState): void
  detectCapabilities?: typeof detectPowerCapabilities
  executeAction?: typeof executePowerAction
  /** 诊断日志，记录读盘、配置与派发过程 */
  debug?: IdlePowerDebug
}): Promise<IdlePowerService> {
  const preferences = readIdlePowerPreferences(options.app)
  const translate = (key: string, params: Record<string, string | number> = {}) => {
    let value = dictionaries[options.locale()][key] ?? dictionaries.en[key] ?? key
    for (const [name, replacement] of Object.entries(params)) value = value.replaceAll(`{${name}}`, String(replacement))
    return value
  }
  const actionName = (action: IdlePowerAction) => translate(`power.action.${action}`)
  const capabilities = await (options.detectCapabilities ?? detectPowerCapabilities)()
  options.debug?.('host.load', { settings: preferences.settings, lastAction: preferences.lastAction, capabilities })
  const service = new IdlePowerService({
    settings: preferences.settings,
    blocker: options.blocker,
    capabilities,
    readActivity: options.readActivity,
    getIdleSeconds: () => options.monitor.getSystemIdleTime(),
    getPointerPosition: () => options.screen.getCursorScreenPoint(),
    execute: (action, beforeExecute) => (options.executeAction ?? executePowerAction)(action, { beforeExecute }),
    save: value => {
      try {
        writeIdlePowerPreferences(options.app, value)
        options.debug?.('persist.ok', { ...value })
      } catch (error) {
        options.debug?.('persist.failed', { ...value, error: error instanceof Error ? error.message : String(error) })
        throw error
      }
    },
    onChange: options.onChange,
    debug: options.debug,
    notifyCountdown: (countdown, seconds, cancel) => {
      // 通知失败不阻塞派发（系统关闭 Toast 通知时倒计时照常推进），仅取消点击仍生效
      sendDesktopNotification({
        NotificationClass: options.NotificationClass,
        options: { title: 'cc-haha', body: translate('power.countdown', { action: actionName(countdown.action), seconds }) },
        onAction: () => cancel(),
      })
    },
    notifyNotice: notice => {
      sendDesktopNotification({ NotificationClass: options.NotificationClass,
        options: { title: 'cc-haha', body: translate(`power.cancelled.${notice}`) }, onAction: () => {} })
    },
  })
  service.start()
  return service
}

export function installIdlePowerLifecycle(
  contents: Pick<WebContents, 'on'>,
  getService: () => IdlePowerService | null,
  onStop: () => void = () => {},
): void {
  const stop = () => { onStop(); getService()?.stop() }
  contents.on('did-navigate', stop)
  contents.on('render-process-gone', stop)
  contents.on('destroyed', stop)
  contents.on('before-input-event', () => {
    if (getService()?.getState().countdown) getService()?.cancel('user-activity')
  })
}
