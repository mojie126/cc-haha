/**
 * 项目键与工作目录的路径比较，供侧边栏项目分组与目录选择下拉共用
 */

const isWindows = typeof navigator !== 'undefined' && /Win/.test(navigator.platform)

/** 反斜杠归一为正斜杠，去掉结尾斜杠，Windows 下忽略大小写 */
function normalizeProjectPathForComparison(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/g, '') || value
  return isWindows ? normalized.toLowerCase() : normalized
}

function isDriveRootComparisonPath(value: string): boolean {
  return /^[a-z]:$/i.test(value)
}

/**
 * 判断工作目录是否落在项目键之下，两个方向都要匹配（键与目录互为前缀也算命中）
 *
 * @param projectKey 侧边栏项目分组的键或 remembered 项目键
 * @param workDir 会话或 remembered 记录的工作目录
 * @returns 两者指向同一项目时为 true，盘符根路径不与任何子路径匹配
 */
export function projectPathMatches(projectKey: string, workDir: string): boolean {
  const normalizedProjectKey = normalizeProjectPathForComparison(projectKey)
  const normalizedWorkDir = normalizeProjectPathForComparison(workDir)

  if (normalizedProjectKey === normalizedWorkDir) return true
  if (isDriveRootComparisonPath(normalizedProjectKey)) return false
  return normalizedWorkDir.startsWith(`${normalizedProjectKey}/`)
}
