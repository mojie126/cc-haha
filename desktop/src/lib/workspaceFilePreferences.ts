/**
 * 文件预览工具栏的视图偏好
 *
 * 文件树与预览面板的开关在重启、切换标签后保持，避免每次打开文件都退回默认视图
 */
export const WORKSPACE_FILE_PREFERENCES_STORAGE_KEY = 'cc-haha-workspace-files'

export type WorkspaceFilePreferences = {
  treeOpen: boolean
  previewVisible: boolean
}

export const DEFAULT_WORKSPACE_FILE_PREFERENCES: WorkspaceFilePreferences = {
  treeOpen: true,
  previewVisible: true,
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
export function normalizeWorkspaceFilePreferences(value: unknown): WorkspaceFilePreferences {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    treeOpen: record.treeOpen !== false,
    previewVisible: record.previewVisible !== false,
  }
}

export function readWorkspaceFilePreferences(
  storage: StorageLike | null = getDefaultStorage(),
): WorkspaceFilePreferences {
  if (!storage) return DEFAULT_WORKSPACE_FILE_PREFERENCES
  try {
    const raw = storage.getItem(WORKSPACE_FILE_PREFERENCES_STORAGE_KEY)
    if (!raw) return DEFAULT_WORKSPACE_FILE_PREFERENCES
    return normalizeWorkspaceFilePreferences(JSON.parse(raw))
  } catch {
    return DEFAULT_WORKSPACE_FILE_PREFERENCES
  }
}

export function writeWorkspaceFilePreferences(
  preferences: WorkspaceFilePreferences,
  storage: StorageLike | null = getDefaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(WORKSPACE_FILE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // localStorage 在受限浏览器环境里可能不可写
  }
}
