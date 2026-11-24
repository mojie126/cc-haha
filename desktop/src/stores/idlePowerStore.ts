import { create } from 'zustand'
import { getDesktopHost, type DesktopHostUnlisten } from '@/lib/desktopHost'
import type { IdlePowerSettings, IdlePowerState } from '@/lib/idlePower'

// 诊断日志经控制台汇入主进程的 idle-power-debug.jsonl，记录配置与状态下发
function debugLog(event: string, data: Record<string, unknown> = {}): void {
  try {
    console.info(`[idle-power] ${JSON.stringify({ event, ...data })}`)
  } catch {
    // 诊断输出不得影响电源设置
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type IdlePowerStore = {
  snapshot: IdlePowerState | null
  loading: boolean
  saving: boolean
  cancelling: boolean
  error: 'load' | 'save' | 'cancel' | null
  refresh: () => Promise<void>
  configure: (settings: IdlePowerSettings) => Promise<void>
  cancel: () => Promise<void>
  start: () => Promise<DesktopHostUnlisten>
}

export const useIdlePowerStore = create<IdlePowerStore>((set, get) => {
  let snapshotRevision = 0
  let refreshSequence = 0

  function receive(snapshot: IdlePowerState) {
    snapshotRevision += 1
    debugLog('renderer.state', {
      settings: snapshot.settings,
      countdown: snapshot.countdown?.action ?? null,
      notice: snapshot.notice,
      lastAction: snapshot.lastAction,
    })
    set({ snapshot, error: null })
  }

  return {
    snapshot: null,
    loading: false,
    saving: false,
    cancelling: false,
    error: null,

    refresh: async () => {
      const host = getDesktopHost()
      if (!host.isDesktop) return
      const request = ++refreshSequence
      const revision = snapshotRevision
      set({ loading: true, error: null })
      try {
        const snapshot = await host.power.getIdleActionState()
        // A push received while IPC was in flight is newer than that reply.
        // In particular, a cancelled countdown must never reappear.
        if (request === refreshSequence && revision === snapshotRevision) receive(snapshot)
      } catch (error) {
        debugLog('renderer.refresh.failed', { error: errorMessage(error) })
        if (request === refreshSequence && revision === snapshotRevision) set({ error: 'load' })
        throw error
      } finally {
        if (request === refreshSequence) set({ loading: false })
      }
    },

    configure: async settings => {
      const host = getDesktopHost()
      if (!host.isDesktop || get().saving) return
      const revision = snapshotRevision
      debugLog('renderer.configure', { settings, stack: new Error('idle-power configure').stack })
      set({ saving: true, error: null })
      try {
        const snapshot = await host.power.configureIdleAction(settings)
        if (revision === snapshotRevision) {
          receive(snapshot)
        } else {
          // A concurrent native event may precede or follow the save. Read the
          // current state instead of overwriting it with an ambiguous reply.
          await get().refresh().catch(() => {})
        }
      } catch (error) {
        debugLog('renderer.configure.failed', { settings, error: errorMessage(error) })
        set({ error: 'save' })
        throw error
      } finally {
        set({ saving: false })
      }
    },

    cancel: async () => {
      const host = getDesktopHost()
      if (!host.isDesktop || get().cancelling) return
      set({ cancelling: true, error: null })
      try {
        try {
          await host.power.cancelIdleAction()
        } catch (error) {
          set({ error: 'cancel' })
          throw error
        }
        await get().refresh()
      } finally {
        set({ cancelling: false })
      }
    },

    start: async () => {
      const host = getDesktopHost()
      if (!host.isDesktop) return () => {}
      let active = true
      let unlisten: DesktopHostUnlisten
      try {
        unlisten = await host.power.onIdleActionState(snapshot => {
          if (active) receive(snapshot)
        })
      } catch (error) {
        debugLog('renderer.start.failed', { error: errorMessage(error) })
        set({ error: 'load' })
        throw error
      }
      // Subscribe first so completion between registration and the initial
      // read is observed. A failed read can be retried from Settings.
      await get().refresh().catch(() => {})
      return () => {
        if (!active) return
        active = false
        unlisten()
      }
    },
  }
})
