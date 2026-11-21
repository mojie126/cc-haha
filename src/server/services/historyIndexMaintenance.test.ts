// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearHistoryIndexes, getHistoryIndexUsage, setHistoryIndexRootsForTesting } from './historyIndexMaintenance.js'

const roots: string[] = []
beforeEach(() => {
  const indexRoot = mkdtempSync(path.join(tmpdir(), 'history-index-root-'))
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'history-index-temp-'))
  roots.push(indexRoot, tempRoot)
  setHistoryIndexRootsForTesting({ indexRoot, tempRoot })
})
afterEach(() => {
  setHistoryIndexRootsForTesting()
  roots.splice(0).forEach(root => rmSync(root, { force: true, recursive: true }))
})

describe('history index maintenance', () => {
  it('measures persistent index and legacy temp orphans, then clears both', async () => {
    const indexDir = path.join(roots[0]!, 'dev-ino')
    mkdirSync(indexDir, { recursive: true })
    writeFileSync(path.join(indexDir, 'context.sqlite'), 'x'.repeat(2048))
    const legacyDir = path.join(roots[1]!, 'claude-history-context-orphan')
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(path.join(legacyDir, 'context.sqlite'), 'y'.repeat(1024))

    const usage = await getHistoryIndexUsage()
    expect(usage.indexCount).toBe(1)
    expect(usage.indexBytes).toBe(2048)
    expect(usage.legacyTempCount).toBe(1)
    expect(usage.legacyTempBytes).toBe(1024)

    const { removedBytes } = await clearHistoryIndexes()
    expect(removedBytes).toBe(2048 + 1024)
    const after = await getHistoryIndexUsage()
    expect(after.indexCount).toBe(0)
    expect(after.legacyTempCount).toBe(0)
  })

  it('tolerates missing directories and ignores non-legacy temp entries', async () => {
    // 空根目录
    await expect(getHistoryIndexUsage()).resolves.toMatchObject({
      indexCount: 0, legacyTempCount: 0,
    })
    await expect(clearHistoryIndexes()).resolves.toMatchObject({ removedBytes: 0 })
    // TEMP 里其他前缀的目录不被统计或删除
    const other = path.join(roots[1]!, 'other-tool-cache')
    mkdirSync(other, { recursive: true })
    writeFileSync(path.join(other, 'data'), 'z'.repeat(512))
    const usage = await getHistoryIndexUsage()
    expect(usage.legacyTempCount).toBe(0)
    expect(usage.legacyTempBytes).toBe(0)
  })
})
