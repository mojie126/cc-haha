import { afterEach, describe, expect, it } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { WorkspaceService } from '../services/workspaceService.js'
import type { FileHistorySnapshot } from '../../utils/fileHistory.js'

// The card's line counts come from a line diff of the backup against the file
// on disk. `diffLines` backtracks over both texts, so a whole-file rewrite of a
// large transcript cost 37 s of CPU on this path and stalled the server event
// loop for every other request. These cases keep that bounded.

const cleanupDirs: string[] = []
const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

async function makeWorkDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-diff-budget-'))
  cleanupDirs.push(dir)
  // File-history backups are read from `<CLAUDE_CONFIG_DIR>/file-history`; point
  // the config home at the workspace so each case owns one temp tree.
  process.env.CLAUDE_CONFIG_DIR = dir
  return dir
}

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
  await Promise.all(cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

function serviceWith(
  workDir: string,
  snapshots: (sessionId: string) => Promise<FileHistorySnapshot[]>,
): WorkspaceService {
  return new WorkspaceService(
    async () => workDir,
    async () => [],
    snapshots,
  )
}

function snapshotFor(backupFileName: string, relativePath: string): FileHistorySnapshot {
  return {
    messageId: 'snapshot-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    trackedFileBackups: {
      [relativePath]: { backupFileName, version: 1, backupTime: '2026-01-01T00:00:00.000Z' },
    },
  } as FileHistorySnapshot
}

function backupsDir(workDir: string, sessionId: string): string {
  return path.join(workDir, 'file-history', sessionId)
}

async function writeBackup(workDir: string, sessionId: string, name: string, content: string): Promise<void> {
  // The backup lives under the config home, not the workspace, so the test
  // points CLAUDE_CONFIG_DIR at the workspace to keep both in one temp tree.
  const dir = backupsDir(workDir, sessionId)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, name), content, 'utf-8')
}

describe('workspace status line counts stay bounded', () => {
  it('counts a small edit exactly', async () => {
    const workDir = await makeWorkDir()
    const original = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n') + '\n'
    const edited = original.replace('line 25', 'line twenty-five')
    await fs.writeFile(path.join(workDir, 'app.ts'), edited, 'utf-8')
    await writeBackup(workDir, 's1', 'backup-1', original)
    const service = serviceWith(workDir, async () => [snapshotFor('backup-1', 'app.ts')])

    const changes = await (service as unknown as {
      getFileHistoryChanges(id: string, root: string): Promise<Array<{ additions: number; deletions: number }>>
    }).getFileHistoryChanges('s1', workDir)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ additions: 1, deletions: 1 })
  })

  it('does not spend the diff budget on a large rewrite and still reports counts', async () => {
    const workDir = await makeWorkDir()
    // ~12k lines that differ everywhere: an exact LCS over this is what used to
    // block the event loop for tens of seconds.
    const before = Array.from({ length: 12_000 }, (_, i) => `alpha ${i} ` + 'x'.repeat(36)).join('\n') + '\n'
    const after = before.split('\n').map((line) => line.replace('alpha', 'beta')).join('\n')
    await fs.writeFile(path.join(workDir, 'big.ts'), after, 'utf-8')
    await writeBackup(workDir, 's1', 'backup-big', before)
    const service = serviceWith(workDir, async () => [snapshotFor('backup-big', 'big.ts')])

    const startedAt = Date.now()
    const changes = await (service as unknown as {
      getFileHistoryChanges(id: string, root: string): Promise<Array<{ additions: number; deletions: number }>>
    }).getFileHistoryChanges('s1', workDir)
    const elapsed = Date.now() - startedAt

    expect(changes).toHaveLength(1)
    // Whole-file fallback once the edit budget is exceeded: every line counts.
    expect(changes[0]!.additions).toBeGreaterThan(11_000)
    expect(changes[0]!.deletions).toBeGreaterThan(11_000)
    // The bound is defensive, not a benchmark: a regression to the unbounded
    // diff would take tens of seconds here.
    expect(elapsed).toBeLessThan(5_000)
  })

  it('counts a large file whose only change is one line exactly', async () => {
    const workDir = await makeWorkDir()
    // Same shape as the worst offender in a real session: a large file with a
    // handful of changed lines. The edit distance is small, so the diff must
    // stay exact rather than fall back to whole-file counts.
    const original = Array.from({ length: 12_000 }, (_, i) => `row ${i} ` + 'y'.repeat(36)).join('\n') + '\n'
    const edited = original.replace('row 6000 ', 'row 6000 changed ')
    await fs.writeFile(path.join(workDir, 'wide.ts'), edited, 'utf-8')
    await writeBackup(workDir, 's1', 'backup-wide', original)
    const service = serviceWith(workDir, async () => [snapshotFor('backup-wide', 'wide.ts')])

    const changes = await (service as unknown as {
      getFileHistoryChanges(id: string, root: string): Promise<Array<{ additions: number; deletions: number }>>
    }).getFileHistoryChanges('s1', workDir)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ additions: 1, deletions: 1 })
  })
})