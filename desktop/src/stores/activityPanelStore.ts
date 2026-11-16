import { create } from 'zustand'
import type { ActivitySectionId } from '../components/activity/sessionActivityModel'

/**
 * What the phone's top bar needs to draw the activity pill: whether the
 * session has any parallel work to show, and how much of it needs a look
 * (running, pending or failed). The session page derives it from the same
 * model the panel renders and publishes it here, because the top bar sits
 * outside that page.
 */
export type MobileActivitySummary = {
  visible: boolean
  count: number
}

type ActivityPanelStore = {
  /**
   * Sessions whose activity panel is open. Per session, not one at a time:
   * switching conversations must not close the panel behind you, and coming
   * back to a conversation has to show the panel exactly as it was left.
   */
  openSessionIds: string[]
  mobileSummaryBySession: Record<string, MobileActivitySummary | undefined>
  setMobileSummary: (sessionId: string, summary: MobileActivitySummary | null) => void
  selectedSectionBySession: Record<string, ActivitySectionId | undefined>
  dismissedBackgroundTaskKeysBySession: Record<string, string[] | undefined>

  isOpen: (sessionId: string) => boolean
  toggle: (sessionId: string) => void
  open: (sessionId: string, section?: ActivitySectionId) => void
  close: (sessionId?: string) => void
  getSelectedSection: (sessionId: string) => ActivitySectionId | undefined
  getDismissedBackgroundTaskKeys: (sessionId: string) => Set<string>
  dismissBackgroundTaskKeys: (sessionId: string, taskKeys: Iterable<string>) => void
  pruneDismissedBackgroundTaskKeys: (sessionId: string, activeTaskKeys: Iterable<string>) => void
}

export const useActivityPanelStore = create<ActivityPanelStore>((set, get) => ({
  openSessionIds: [],
  mobileSummaryBySession: {},
  setMobileSummary: (sessionId, summary) =>
    set((state) => {
      const current = state.mobileSummaryBySession[sessionId]
      if (!summary) {
        if (!current) return state
        const next = { ...state.mobileSummaryBySession }
        delete next[sessionId]
        return { mobileSummaryBySession: next }
      }
      if (current && current.visible === summary.visible && current.count === summary.count) return state
      return { mobileSummaryBySession: { ...state.mobileSummaryBySession, [sessionId]: summary } }
    }),
  selectedSectionBySession: {},
  dismissedBackgroundTaskKeysBySession: {},

  isOpen: (sessionId) => get().openSessionIds.includes(sessionId),

  toggle: (sessionId) =>
    set((state) => ({
      openSessionIds: state.openSessionIds.includes(sessionId)
        ? state.openSessionIds.filter((id) => id !== sessionId)
        : [...state.openSessionIds, sessionId],
    })),

  open: (sessionId, section) =>
    set((state) => ({
      openSessionIds: state.openSessionIds.includes(sessionId)
        ? state.openSessionIds
        : [...state.openSessionIds, sessionId],
      selectedSectionBySession: section
        ? {
            ...state.selectedSectionBySession,
            [sessionId]: section,
          }
        : state.selectedSectionBySession,
    })),

  close: (sessionId) =>
    set((state) => {
      if (sessionId) {
        if (!state.openSessionIds.includes(sessionId)) return state
        return { openSessionIds: state.openSessionIds.filter((id) => id !== sessionId) }
      }
      return state.openSessionIds.length === 0 ? state : { openSessionIds: [] }
    }),

  getSelectedSection: (sessionId) => get().selectedSectionBySession[sessionId],

  getDismissedBackgroundTaskKeys: (sessionId) =>
    new Set(get().dismissedBackgroundTaskKeysBySession[sessionId] ?? []),

  dismissBackgroundTaskKeys: (sessionId, taskKeys) =>
    set((state) => {
      const keys = Array.from(new Set(taskKeys)).filter((key) => key.length > 0)
      if (keys.length === 0) return state

      const existing = state.dismissedBackgroundTaskKeysBySession[sessionId] ?? []
      const merged = Array.from(new Set([...existing, ...keys]))
      if (merged.length === existing.length) return state

      return {
        dismissedBackgroundTaskKeysBySession: {
          ...state.dismissedBackgroundTaskKeysBySession,
          [sessionId]: merged,
        },
      }
    }),

  pruneDismissedBackgroundTaskKeys: (sessionId, activeTaskKeys) =>
    set((state) => {
      const existing = state.dismissedBackgroundTaskKeysBySession[sessionId]
      if (!existing || existing.length === 0) return state

      const activeSet = new Set(activeTaskKeys)
      const pruned = existing.filter((key) => activeSet.has(key))
      if (pruned.length === existing.length) return state

      const nextBySession = { ...state.dismissedBackgroundTaskKeysBySession }
      if (pruned.length > 0) {
        nextBySession[sessionId] = pruned
      } else {
        delete nextBySession[sessionId]
      }

      return {
        dismissedBackgroundTaskKeysBySession: nextBySession,
      }
    }),
}))
