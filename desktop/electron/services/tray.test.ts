import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { installTray, resolveTrayIconPath, shouldInstallTray } from './tray'

function createElectronTrayMocks() {
  const handlers = new Map<string, () => void>()
  return {
    handlers,
    buildFromTemplate: vi.fn((template: unknown) => ({ template })),
    createFromPath: vi.fn((iconPath: string) => ({ iconPath })),
    tray: {
      setToolTip: vi.fn(),
      setContextMenu: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler)
      }),
      destroy: vi.fn(),
    },
    Tray: vi.fn(),
  }
}

describe('Electron tray service', () => {
  it('uses the existing desktop icon assets for the tray icon', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-'))
    try {
      const iconPath = path.join(root, 'src-tauri', 'icons', 'icon.png')
      mkdirSync(path.dirname(iconPath), { recursive: true })
      writeFileSync(iconPath, 'png')

      expect(resolveTrayIconPath(root)).toBe(iconPath)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails clearly when no tray icon exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-missing-'))
    try {
      expect(() => resolveTrayIconPath(root)).toThrow('Electron tray icon not found')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips the status-bar tray on macOS and keeps it on Windows and Linux', () => {
    expect(shouldInstallTray('darwin')).toBe(false)
    expect(shouldInstallTray('win32')).toBe(true)
    expect(shouldInstallTray('linux')).toBe(true)
  })

  it('labels the menu in the stored interface language and follows later changes', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-locale-'))
    try {
      const userData = path.join(root, 'user-data')
      mkdirSync(path.join(root, 'src-tauri', 'icons'), { recursive: true })
      mkdirSync(userData, { recursive: true })
      writeFileSync(path.join(root, 'src-tauri', 'icons', 'icon.png'), 'png')
      writeFileSync(path.join(userData, 'locale-preference.json'), JSON.stringify({ locale: 'jp' }))
      const trayMocks = createElectronTrayMocks()

      const controller = await installTray({
        app: {
          name: 'Claude Code Haha',
          getPath: () => userData,
          getPreferredSystemLanguages: () => ['zh-CN'],
        } as never,
        desktopRoot: root,
        show: vi.fn(),
        quit: vi.fn(),
        electronRuntime: {
          Menu: { buildFromTemplate: trayMocks.buildFromTemplate },
          Tray: trayMocks.Tray.mockImplementation(() => trayMocks.tray),
          nativeImage: { createFromPath: trayMocks.createFromPath },
        } as never,
      })

      const labels = () => (trayMocks.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{ label?: string, type?: string }>)
        .map(item => item.label ?? item.type)
      expect(labels()).toEqual(['Claude Code Haha を表示', 'separator', 'Claude Code Haha を終了'])

      controller.setLocale('zh')
      expect(labels()).toEqual(['显示 Claude Code Haha', 'separator', '退出 Claude Code Haha'])
      controller.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('falls back to the system language when no preference was stored', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-system-locale-'))
    try {
      mkdirSync(path.join(root, 'src-tauri', 'icons'), { recursive: true })
      writeFileSync(path.join(root, 'src-tauri', 'icons', 'icon.png'), 'png')
      const trayMocks = createElectronTrayMocks()

      const controller = await installTray({
        app: {
          name: 'Claude Code Haha',
          getPath: () => path.join(root, 'missing-user-data'),
          getPreferredSystemLanguages: () => ['ko-KR'],
        } as never,
        desktopRoot: root,
        show: vi.fn(),
        quit: vi.fn(),
        electronRuntime: {
          Menu: { buildFromTemplate: trayMocks.buildFromTemplate },
          Tray: trayMocks.Tray.mockImplementation(() => trayMocks.tray),
          nativeImage: { createFromPath: trayMocks.createFromPath },
        } as never,
      })

      const template = trayMocks.buildFromTemplate.mock.calls.at(-1)?.[0] as Array<{ label?: string }>
      expect(template[0]?.label).toBe('Claude Code Haha 열기')
      controller.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('installs tray handlers that show the app, quit explicitly, and dispose cleanly', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'electron-tray-install-'))
    try {
      const trayMocks = createElectronTrayMocks()
      const iconPath = path.join(root, 'src-tauri', 'icons', 'icon.png')
      mkdirSync(path.dirname(iconPath), { recursive: true })
      writeFileSync(iconPath, 'png')
      const show = vi.fn()
      const quit = vi.fn()

      const controller = await installTray({
        app: { name: 'Claude Code Haha' } as never,
        desktopRoot: root,
        show,
        quit,
        electronRuntime: {
          Menu: {
            buildFromTemplate: trayMocks.buildFromTemplate,
          },
          Tray: trayMocks.Tray.mockImplementation(() => trayMocks.tray),
          nativeImage: {
            createFromPath: trayMocks.createFromPath,
          },
        } as never,
      })

      expect(trayMocks.createFromPath).toHaveBeenCalledWith(iconPath)
      expect(trayMocks.Tray).toHaveBeenCalledTimes(1)
      expect(trayMocks.tray.setToolTip).toHaveBeenCalledWith('Claude Code Haha')
      expect(trayMocks.buildFromTemplate).toHaveBeenCalledTimes(1)

      const template = trayMocks.buildFromTemplate.mock.calls[0]?.[0] as Array<{ label?: string, click?: () => void, type?: string }>
      expect(template.map(item => item.label ?? item.type)).toEqual([
        'Show Claude Code Haha',
        'separator',
        'Quit Claude Code Haha',
      ])

      template[0]?.click?.()
      template[2]?.click?.()
      trayMocks.handlers.get('click')?.()

      expect(show).toHaveBeenCalledTimes(2)
      expect(quit).toHaveBeenCalledTimes(1)

      controller.dispose()
      expect(trayMocks.tray.destroy).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
