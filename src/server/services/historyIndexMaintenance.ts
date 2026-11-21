/**
 * 历史可见性索引的维护：占用统计与清理。
 *
 * 索引目录由 sessionHistoryContext 按会话文件 identity 持久化在
 * cc-haha/history-context/ 下（meta 校验失效会自动重建，删除是安全的）；
 * 旧版机制在 %TEMP%/claude-history-context-* 留下的一次性目录也已迁移
 * 出来，属于孤儿，可整批回收。
 */
import { readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCcHahaDir } from '../../utils/envUtils.js'

/** 旧版 %TEMP% 目录的前缀：迁移到持久目录后不会再被引用。 */
const LEGACY_TEMP_PREFIX = 'claude-history-context-'
/** 测试注入点：默认按配置目录求值。 */
let indexRootOverride: string | null = null
let tempRootOverride: string | null = null

/** @internal 仅供测试注入目录根，生产代码不得调用。 */
export function setHistoryIndexRootsForTesting(options: { indexRoot?: string, tempRoot?: string } = {}): void {
  indexRootOverride = options.indexRoot ?? null
  tempRootOverride = options.tempRoot ?? null
}

function indexRoot(): string {
  return indexRootOverride ?? join(getCcHahaDir(), 'history-context')
}

function tempRoot(): string {
  return tempRootOverride ?? tmpdir()
}

export type HistoryIndexUsage = {
  /** 持久索引目录的总字节数。 */
  indexBytes: number
  /** 持久索引的目录个数（每个对应一个会话文件）。 */
  indexCount: number
  /** %TEMP% 里旧机制遗留的孤儿目录总字节数。 */
  legacyTempBytes: number
  /** %TEMP% 里旧机制遗留的孤儿目录个数。 */
  legacyTempCount: number
}

/** 递归求和目录总字节数（索引由 sqlite 文件构成，层级浅，量级小）。 */
async function directoryBytes(path: string): Promise<number> {
  const info = await stat(path).catch(() => null)
  if (!info) return 0
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0
  let total = info.size
  const entries = await readdir(path, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    total += await directoryBytes(join(path, entry.name))
  }
  return total
}

/** 汇总索引占用（持久索引 + TEMP 孤儿）。数字用于设置页展示。 */
export async function getHistoryIndexUsage(): Promise<HistoryIndexUsage> {
  const usage: HistoryIndexUsage = {
    indexBytes: 0, indexCount: 0, legacyTempBytes: 0, legacyTempCount: 0,
  }
  const entries = await readdir(indexRoot(), { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    usage.indexCount += 1
    usage.indexBytes += await directoryBytes(join(indexRoot(), entry.name))
  }
  const tempEntries = await readdir(tempRoot(), { withFileTypes: true }).catch(() => [])
  for (const entry of tempEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith(LEGACY_TEMP_PREFIX)) continue
    usage.legacyTempCount += 1
    usage.legacyTempBytes += await directoryBytes(join(tempRoot(), entry.name))
  }
  return usage
}

/** 删除持久索引目录的全部内容与 TEMP 里的旧机制孤儿，返回回收的字节估计。 */
export async function clearHistoryIndexes(): Promise<{ removedBytes: number }> {
  const before = await getHistoryIndexUsage()
  const rootEntries = await readdir(indexRoot(), { withFileTypes: true }).catch(() => [])
  for (const entry of rootEntries) {
    if (!entry.isDirectory()) continue
    await rm(join(indexRoot(), entry.name), { recursive: true, force: true }).catch(() => {})
  }
  const tempEntries = await readdir(tempRoot(), { withFileTypes: true }).catch(() => [])
  for (const entry of tempEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith(LEGACY_TEMP_PREFIX)) continue
    await rm(join(tempRoot(), entry.name), { recursive: true, force: true }).catch(() => {})
  }
  return { removedBytes: before.indexBytes + before.legacyTempBytes }
}
