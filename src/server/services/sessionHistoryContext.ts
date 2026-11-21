import { createHash } from 'node:crypto'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCcHahaDir } from '../../utils/envUtils.js'
import { withHistoryReadBudget } from './boundedSessionHistory.js'
import { streamSessionMetadata } from './sessionMetadataReader.js'
import { ApiError } from '../middleware/errorHandler.js'

/** `hidden` marks an unowned sidechain record that a root-only view must not show. */
type Context = { owner?: string; hidden: boolean }
type Cache = { database: Database; directory: string; identity: string; size: number; mtime: string; offset: number; fingerprint?: string }
type Flight = { promise: Promise<void>; controller: AbortController; users: number }
const cache = new Map<string, Cache>()
const flights = new Map<string, Flight>()
process.once('exit', () => { for (const entry of cache.values()) { entry.database.close(); rmSync(entry.directory, { recursive: true, force: true }) } })

async function sourceAnchors(filePath: string, size: number, signal: AbortSignal): Promise<string> {
  const handle = await open(filePath, 'r')
  try {
    const hash = createHash('sha256')
    for (const offset of [0, Math.max(0, size - 4096)]) {
      const bytes = Buffer.alloc(Math.min(4096, size - offset))
      let read = 0
      while (read < bytes.length) {
        if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
        const result = await handle.read(bytes, read, bytes.length - read, offset + read)
        if (!result.bytesRead) throw new ApiError(409, 'History changed during context validation', 'HISTORY_CHANGED')
        read += result.bytesRead
      }
      hash.update(bytes)
    }
    return hash.digest('hex')
  } finally { await handle.close() }
}

/** 进程内存中保留的索引数：来回切换的会话多于这个数会反复重建索引。 */
const HISTORY_CONTEXT_CACHE_SIZE = 16

/** 持久索引目录中闲置多久可回收。 */
const HISTORY_INDEX_MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000

/** 索引根目录：跨重启持久（identity 校验失效会自动重建，安全无虞）。
 * 惰性求值：跟随当前 CLAUDE_CONFIG_DIR，测试隔离与多配置目录才正确。 */
function persistentIndexRoot(): string {
  return join(getCcHahaDir(), 'history-context')
}

/**
 * 按会话文件身份求出其索引目录名（与 readHistoryContexts 的命名一致）。
 * 会话删除时用它连带回收索引；identity 只含 dev/ino，无敏感信息。
 */
export function indexDirectoryNameForIdentity(identity: string): string {
  return identity.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** 删除一个会话文件的历史可见性索引（目录不存在时静默）。 */
export async function removeHistoryIndexForFile(filePath: string): Promise<void> {
  try {
    // 内存缓存中的同文件索引先关闭句柄（Windows 上打开着的 sqlite 文件删不掉），
    // 再按 identity 连目录删除
    const cached = cache.get(filePath)
    if (cached) {
      cache.delete(filePath)
      cached.database.close()
    }
    const info = await stat(filePath, { bigint: true })
    const directory = join(persistentIndexRoot(), indexDirectoryNameForIdentity(`${info.dev}:${info.ino}`))
    await rm(directory, { recursive: true, force: true })
  } catch {
    // 文件已消失或目录不可达：索引由闲置回收兜底，这里不外抛
  }
}

/**
 * 取索引目录：按会话文件的 identity 命名放在持久根目录下，重启后同名目录
 * 仍在（见 restoreIndexState 的校验回读）；持久根不可写时回退 %TEMP%。
 */
async function acquireIndexDirectory(identity: string): Promise<string> {
  const safeName = identity.replace(/[^a-zA-Z0-9._-]/g, '_')
  try {
    const root = persistentIndexRoot()
    const directory = join(root, safeName)
    await mkdir(root, { recursive: true })
    await mkdir(directory, { recursive: true })
    return directory
  } catch {
    return await mkdtemp(join(tmpdir(), 'claude-history-context-'))
  }
}

type PersistedIndexMeta = { fileSize: number, fileMtimeNs: string, offset: number }

function metaPathFor(directory: string): string {
  return join(directory, 'meta.json')
}

/** 把索引进度（文件大小/修改时刻/已扫偏移）落盘，供下次启动校验续用。 */
async function persistIndexMeta(directory: string, meta: PersistedIndexMeta): Promise<void> {
  try {
    await writeFile(metaPathFor(directory), JSON.stringify(meta), 'utf-8')
  } catch {
    // 落盘失败只损失复用机会，索引本身仍在本进程内有效
  }
}

/**
 * 尝试从持久目录恢复上一进程的索引进度：目录里有 meta 且记录的文件大小与
 * 修改时刻与当前文件一致时，认为 DB 内容仍然有效，返回已扫偏移；否则清掉
 * 旧内容从头建（错误不外抛——索引可再生，退化为一次全量扫描）。
 */
async function restoreIndexState(
  directory: string,
  filePath: string,
  currentSize: number,
  currentMtimeNs: string,
): Promise<number> {
  try {
    const raw = JSON.parse(await readFile(metaPathFor(directory), 'utf-8')) as Partial<PersistedIndexMeta>
    if (raw.fileSize !== currentSize || raw.fileMtimeNs !== currentMtimeNs
      || typeof raw.offset !== 'number' || !Number.isSafeInteger(raw.offset) || raw.offset <= 0
      || raw.offset > currentSize) {
      throw new Error('stale index meta')
    }
    return raw.offset
  } catch {
    // 校验失败：目录里的旧 DB 内容不可信，全部清掉从头建
    await rm(join(directory, 'context.sqlite'), { force: true }).catch(() => {})
    await rm(join(directory, 'context.sqlite-wal'), { force: true }).catch(() => {})
    await rm(join(directory, 'context.sqlite-shm'), { force: true }).catch(() => {})
    return 0
  }
}

/**
 * 预热一个会话文件的可见性索引（启动空闲期调用）：构建/续扫到文件当前
 * 大小为止。持久化后多数情况只补尾部增量。供 sessionService 的启动预热用。
 */
export async function warmUpHistoryIndexes(filePath: string, sourceVersion: string): Promise<void> {
  await readHistoryContexts({ filePath, sourceVersion, offsets: [] })
}

/** @internal 仅供测试：关闭并清空内存中的索引缓存（磁盘目录不动）。 */
export function resetHistoryContextCacheForTesting(): void {
  for (const entry of cache.values()) {
    try { entry.database.close() } catch { /* 已关闭的句柄忽略 */ }
  }
  cache.clear()
  flights.clear()
}

/** 周期性回收长期未用的持久索引目录（上限防止索引目录无限膨胀）。 */
let orphanCleanup: Promise<void> | null = null
function scheduleOrphanCleanup(): Promise<void> {
  orphanCleanup ??= (async () => {
    try {
      const cutoff = Date.now() - HISTORY_INDEX_MAX_IDLE_MS
      for (const entry of await readdir(persistentIndexRoot())) {
        const directory = join(persistentIndexRoot(), entry)
        const info = await stat(directory).catch(() => null)
        if (!info || !info.isDirectory()) continue
        if (info.mtimeMs < cutoff) {
          await rm(directory, { recursive: true, force: true }).catch(() => {})
        }
      }
    } catch {
      // 持久目录不存在（还没建）或不可读，下次再清
    }
  })()
  return orphanCleanup
}

/** Disk-backed visibility/ownership scalars. Payload records never enter this
 * index. Only append suffixes are scanned after the initial bounded build. */
export async function readHistoryContexts(options: {
  filePath: string
  sourceVersion: string
  offsets: number[]
  signal?: AbortSignal
  includeUnownedSidechains?: boolean
  agentToolId: (entry: Record<string, unknown>) => string | undefined
}): Promise<{ contexts: Map<number, Context>; scannedBytes: number }> {
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
  const [dev, ino, size, mtime] = options.sourceVersion.split(':')
  const targetSize = Number(size)
  const identity = `${dev}:${ino}`
  let scannedBytes = 0
  const ensure = async (signal: AbortSignal) => withHistoryReadBudget(signal, async () => {
    const current = await stat(options.filePath, { bigint: true })
    if (`${current.dev}:${current.ino}` !== identity || Number(current.size) < targetSize || (Number(current.size) === targetSize && String(current.mtimeNs) !== mtime)) {
      throw new ApiError(409, 'Session history changed during context lookup', 'HISTORY_CHANGED')
    }
    let state = cache.get(options.filePath)
    const rewrittenGrowth = state?.fingerprint && Number(current.size) > state.size
      ? state.fingerprint !== await sourceAnchors(options.filePath, state.size, signal) : false
    if (state && (rewrittenGrowth || state.identity !== identity || Number(current.size) < state.size || (Number(current.size) === state.size && String(current.mtimeNs) !== state.mtime))) {
      cache.delete(options.filePath)
      state.database.close()
      await rm(state.directory, { recursive: true, force: true })
      state = undefined
    }
    if (!state) {
      while (cache.size >= HISTORY_CONTEXT_CACHE_SIZE) {
        const key = cache.keys().next().value!
        const evicted = cache.get(key)!
        cache.delete(key)
        evicted.database.close()
        await rm(evicted.directory, { recursive: true, force: true })
      }
      void scheduleOrphanCleanup()
      const directory = await acquireIndexDirectory(identity)
      const database = new Database(join(directory, 'context.sqlite'))
      database.exec('PRAGMA journal_mode=OFF; PRAGMA cache_size=-512; PRAGMA temp_store=FILE; CREATE TABLE IF NOT EXISTS parents (id TEXT PRIMARY KEY, chain TEXT); CREATE TABLE IF NOT EXISTS context (offset INTEGER PRIMARY KEY, owner TEXT, unowned_sidechain INTEGER)')
      // 目录可能带着上一进程的有效索引：文件未变时从中断处续扫，免去
      // 冷启动的全量重扫（用户报告的重启后打开会话加载很久即此因）
      const restoredOffset = await restoreIndexState(directory, options.filePath, Number(current.size), String(current.mtimeNs))
      state = { database, directory, identity, size: restoredOffset, mtime: String(current.mtimeNs), offset: restoredOffset }
      cache.set(options.filePath, state)
    }
    cache.delete(options.filePath)
    cache.set(options.filePath, state)
    if (state.size >= targetSize) return
    const getParent = state.database.query('SELECT chain FROM parents WHERE id = ?')
    const saveParent = state.database.query('INSERT OR REPLACE INTO parents VALUES (?, ?)')
    const saveContext = state.database.query('INSERT OR REPLACE INTO context VALUES (?, ?, ?)')
    const originalOffset = state.offset
    try {
      const fingerprint = await sourceAnchors(options.filePath, targetSize, signal)
      state.database.exec('BEGIN')
      const result = await streamSessionMetadata(options.filePath, (entry, _completeLine, offset) => {
        const inherited = typeof entry.parentUuid === 'string' ? (getParent.get(entry.parentUuid) as { chain?: string } | null)?.chain : undefined
        const explicit = typeof entry.parent_tool_use_id === 'string' && entry.parent_tool_use_id ? entry.parent_tool_use_id : undefined
        const owner = explicit ?? (entry.isSidechain === true ? inherited : undefined)
        const chain = options.agentToolId(entry) ?? inherited
        if (typeof entry.uuid === 'string') saveParent.run(entry.uuid, chain ?? null)
        // Root-only ownership filtering: a dedicated child transcript legitimately
        // lacks its parent's Agent call, so the flag is kept per record.
        saveContext.run(offset, owner ?? null, entry.isSidechain === true && !owner ? 1 : 0)
      }, signal, { startOffset: originalOffset, endOffset: targetSize })
      if (fingerprint !== await sourceAnchors(options.filePath, targetSize, signal)) throw new ApiError(409, 'History was rewritten during context scan', 'HISTORY_CHANGED')
      state.database.exec('COMMIT')
      state.fingerprint = fingerprint
      state.size = targetSize
      state.mtime = mtime!
      state.offset = result.nextOffset
      scannedBytes += result.scannedBytes
      // 进度落盘：下次启动校验通过即可从中断处续扫
      void persistIndexMeta(state.directory, {
        fileSize: targetSize,
        fileMtimeNs: String(current.mtimeNs),
        offset: result.nextOffset,
      })
    } catch (error) {
      try { state.database.exec('ROLLBACK') } catch { /* Validation may fail before BEGIN. */ }
      // journal_mode=OFF cannot guarantee rollback restoration after a failed
      // build; discard this regenerable index entirely.
      cache.delete(options.filePath)
      state.database.close()
      await rm(state.directory, { recursive: true, force: true })
      throw error
    }
  }, 'context')
  // Join one file build. Each caller may cancel independently; the scan is
  // aborted when the final interested caller goes away.
  while (!cache.get(options.filePath) || cache.get(options.filePath)!.size < targetSize || cache.get(options.filePath)!.identity !== identity || (cache.get(options.filePath)!.size === targetSize && cache.get(options.filePath)!.mtime !== mtime)) {
    let flight = flights.get(options.filePath)
    if (flight?.controller.signal.aborted) {
      await flight.promise.catch(() => {})
      if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Aborted', 'AbortError')
      continue
    }
    if (!flight) {
      if (flights.size >= 5) throw new ApiError(429, 'History context reader is busy', 'HISTORY_BUSY')
      const controller = new AbortController()
      flight = { controller, users: 0, promise: Promise.resolve() }
      const currentFlight = flight
      flight.promise = ensure(controller.signal).finally(() => { if (flights.get(options.filePath) === currentFlight) flights.delete(options.filePath) })
      flights.set(options.filePath, flight)
    }
    flight.users++
    const joined = flight
    await new Promise<void>((resolve, reject) => {
      let done = false
      const finish = (error?: unknown) => {
        if (done) return
        done = true
        options.signal?.removeEventListener('abort', abort)
        joined.users--
        if (!joined.users && error) joined.controller.abort(error)
        if (error) reject(error); else resolve()
      }
      const abort = () => finish(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
      options.signal?.addEventListener('abort', abort, { once: true })
      joined.promise.then(() => finish(), error => finish(error))
      if (options.signal?.aborted) abort()
    })
  }
  const state = cache.get(options.filePath)!
  const query = state.database.query('SELECT owner, unowned_sidechain FROM context WHERE offset = ?')
  const contexts = new Map<number, Context>()
  for (const offset of options.offsets) {
    const row = query.get(offset) as { owner: string | null; unowned_sidechain: number } | null
    if (!row) throw new ApiError(409, 'History context is unavailable; reload the page', 'HISTORY_CHANGED')
    contexts.set(offset, { owner: row.owner ?? undefined, hidden: !options.includeUnownedSidechains && row.unowned_sidechain === 1 })
  }
  return { contexts, scannedBytes }
}
