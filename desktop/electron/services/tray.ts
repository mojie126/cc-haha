import { existsSync } from 'node:fs'
import path from 'node:path'
import type { App, Tray } from 'electron'
import { resolveSupportedLocale, type Locale } from '../../src/i18n/locale'
import { readLocalePreference } from './localePreference'

type ElectronTrayRuntime = Pick<typeof import('electron'), 'Menu' | 'Tray' | 'nativeImage'>

export type TrayController = {
  tray: Tray
  /** Rebuilds the context menu after the user changes the interface language. */
  setLocale(locale: Locale): void
  dispose(): void
}

type TrayLabels = { show: string, quit: string }

const TRAY_LABELS: Record<Locale, TrayLabels> = {
  en: { show: 'Show Claude Code Haha', quit: 'Quit Claude Code Haha' },
  zh: { show: '显示 Claude Code Haha', quit: '退出 Claude Code Haha' },
  'zh-TW': { show: '顯示 Claude Code Haha', quit: '結束 Claude Code Haha' },
  jp: { show: 'Claude Code Haha を表示', quit: 'Claude Code Haha を終了' },
  kr: { show: 'Claude Code Haha 열기', quit: 'Claude Code Haha 종료' },
}

/** The interface locale Electron itself can resolve, or English. */
export function resolveTrayLocale(app: Pick<App, 'getPath' | 'getPreferredSystemLanguages'>): Locale {
  try {
    return readLocalePreference(app) ?? resolveSupportedLocale(app.getPreferredSystemLanguages())
  } catch {
    return 'en'
  }
}

export function resolveTrayIconPath(desktopRoot: string): string {
  const candidates = [
    path.join(desktopRoot, 'src-tauri', 'icons', 'icon.png'),
    path.join(desktopRoot, 'public', 'app-icon.png'),
    path.join(desktopRoot, 'dist', 'app-icon.png'),
  ]
  const resolved = candidates.find(candidate => existsSync(candidate))
  if (!resolved) {
    throw new Error(`Electron tray icon not found under ${desktopRoot}`)
  }
  return resolved
}

export function shouldInstallTray(platform = process.platform): boolean {
  return platform !== 'darwin'
}

export async function installTray({
  app,
  desktopRoot,
  show,
  quit,
  locale,
  electronRuntime,
}: {
  app: App
  desktopRoot: string
  show: () => void
  quit: () => void
  /** Interface locale; resolved from the persisted preference when omitted. */
  locale?: Locale
  electronRuntime?: ElectronTrayRuntime
}): Promise<TrayController> {
  const { Menu, Tray, nativeImage } = electronRuntime ?? await import('electron')
  const icon = nativeImage.createFromPath(resolveTrayIconPath(desktopRoot))
  const tray = new Tray(icon)
  tray.setToolTip(app.name || 'Claude Code Haha')

  const applyLocale = (nextLocale: Locale) => {
    const labels = TRAY_LABELS[nextLocale] ?? TRAY_LABELS.en
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: labels.show, click: show },
      { type: 'separator' },
      { label: labels.quit, click: quit },
    ]))
  }
  applyLocale(locale ?? resolveTrayLocale(app))
  tray.on('click', show)

  return {
    tray,
    setLocale: applyLocale,
    dispose() {
      tray.destroy()
    },
  }
}
