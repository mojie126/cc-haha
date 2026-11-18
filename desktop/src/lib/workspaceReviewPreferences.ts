import type { WorkspaceDiffMode } from '@/components/workspace/workspaceDiffLayout'

/**
 * 审查面板的视图偏好
 *
 * 统一 / 分栏布局、自动换行与文件树开关在多个审查标签之间共享，并在重启后
 * 保持，避免每次打开都退回默认视图
 */
export const WORKSPACE_REVIEW_PREFERENCES_STORAGE_KEY = 'cc-haha-workspace-review'

export type WorkspaceReviewPreferences = {
  diffMode: WorkspaceDiffMode
  wrapLines: boolean
  treeOpen: boolean
}

export const DEFAULT_WORKSPACE_REVIEW_PREFERENCES: WorkspaceReviewPreferences = {
  diffMode: 'unified',
  wrapLines: false,
  treeOpen: true,
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function getDefaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** 把任意已存内容收敛为完整偏好，未知字段与损坏值回退默认值 */
export function normalizeWorkspaceReviewPreferences(value: unknown): WorkspaceReviewPreferences {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    diffMode: record.diffMode === 'split' ? 'split' : 'unified',
    wrapLines: record.wrapLines === true,
    treeOpen: record.treeOpen !== false,
  }
}

export function readWorkspaceReviewPreferences(
  storage: StorageLike | null = getDefaultStorage(),
): WorkspaceReviewPreferences {
  if (!storage) return DEFAULT_WORKSPACE_REVIEW_PREFERENCES
  try {
    const raw = storage.getItem(WORKSPACE_REVIEW_PREFERENCES_STORAGE_KEY)
    if (!raw) return DEFAULT_WORKSPACE_REVIEW_PREFERENCES
    return normalizeWorkspaceReviewPreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_WORKSPACE_REVIEW_PREFERENCES
  }
}

export function writeWorkspaceReviewPreferences(
  preferences: WorkspaceReviewPreferences,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(WORKSPACE_REVIEW_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // localStorage 在受限浏览器环境里可能不可写
  }
}
