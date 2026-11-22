import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { sessionsApi, type WorkspaceFileStat } from '@/api/sessions'
import { extractAssistantOutputTargets } from '@/lib/assistantOutputTargets'
import { resetWorkspaceFileStatsForTests } from '@/lib/workspaceFileStats'
import { useTurnWrittenTargets } from './useTurnWrittenTargets'

const TURN_STARTED = Date.parse('2026-10-04T08:00:00Z')

let statWorkspaceFiles: MockInstance<typeof sessionsApi.statWorkspaceFiles>

function onDisk(files: Record<string, number>) {
  statWorkspaceFiles.mockImplementation(async (_sessionId, paths) => ({
    files: paths.map((path): WorkspaceFileStat => path in files
      ? { path, state: 'file', mtimeMs: files[path] }
      : { path, state: 'missing' }),
  }))
}

// The turn wrote plan.md through an editing tool and ran a shell command too.
// Only what the reply names is under test, not the unmentioned-file fallback.
const outputs = (content: string) => extractAssistantOutputTargets(content, {
  workDir: '/w',
  changedFiles: ['/w/plan.md'],
  includeChangedFileFallback: false,
  outputEvidence: { unlistedWrites: true },
})
const hrefs = (targets: { href: string }[]) => targets.map((target) => target.href)

beforeEach(() => {
  resetWorkspaceFileStatsForTests()
  statWorkspaceFiles = vi.spyOn(sessionsApi, 'statWorkspaceFiles')
})

afterEach(() => {
  statWorkspaceFiles.mockRestore()
})

describe('useTurnWrittenTargets', () => {
  it('shows a shell-written file once the disk shows the turn wrote it', async () => {
    onDisk({ 'out/report.docx': TURN_STARTED + 30_000 })
    const targets = outputs('计划见 plan.md，报告已生成：out/report.docx')

    const { result } = renderHook(() => useTurnWrittenTargets('s1', targets, TURN_STARTED))

    // The checkpoint already vouches for plan.md; the report waits for the disk.
    expect(hrefs(result.current)).toEqual(['plan.md'])
    await waitFor(() => expect(hrefs(result.current)).toEqual(['plan.md', 'out/report.docx']))
    expect(result.current[1]?.awaitsTurnWrite).toBeUndefined()
    expect(statWorkspaceFiles).toHaveBeenCalledWith('s1', ['out/report.docx'])
  })

  it('hides a file that is not there', async () => {
    onDisk({})
    const { result } = renderHook(() => useTurnWrittenTargets('s1', outputs('报告已生成：out/report.docx'), TURN_STARTED))

    await waitFor(() => expect(statWorkspaceFiles).toHaveBeenCalled())
    await Promise.resolve()
    expect(result.current).toEqual([])
  })

  it('hides a file that existed before the turn, such as the input it converted', async () => {
    onDisk({
      'in/需求.docx': TURN_STARTED - 86_400_000,
      'out/需求.pdf': TURN_STARTED + 5_000,
    })
    const targets = outputs('已把 `in/需求.docx` 转成 `out/需求.pdf`')
    expect(hrefs(targets)).toEqual(['in/需求.docx', 'out/需求.pdf'])

    const { result } = renderHook(() => useTurnWrittenTargets('s1', targets, TURN_STARTED))

    await waitFor(() => expect(hrefs(result.current)).toEqual(['out/需求.pdf']))
  })

  it('allows for a file system that rounds the mtime down', async () => {
    onDisk({ 'out/report.docx': TURN_STARTED - 1_000 })
    const { result } = renderHook(() => useTurnWrittenTargets('s1', outputs('已生成 out/report.docx'), TURN_STARTED))

    await waitFor(() => expect(hrefs(result.current)).toEqual(['out/report.docx']))
  })

  it('settles for existence when the turn start is unknown', async () => {
    onDisk({ 'out/report.docx': 0 })
    const { result } = renderHook(() => useTurnWrittenTargets('s1', outputs('已生成 out/report.docx'), undefined))

    await waitFor(() => expect(hrefs(result.current)).toEqual(['out/report.docx']))
  })

  it('shows nothing it could not check', async () => {
    statWorkspaceFiles.mockRejectedValue(new Error('403'))
    const failed = renderHook(() => useTurnWrittenTargets('s1', outputs('已生成 out/a.docx'), TURN_STARTED))
    await waitFor(() => expect(statWorkspaceFiles).toHaveBeenCalled())
    await Promise.resolve()
    expect(failed.result.current).toEqual([])

    statWorkspaceFiles.mockResolvedValue({ files: [{ path: 'D:/资料/b.docx', state: 'unavailable' }] })
    const outside = renderHook(() => useTurnWrittenTargets('s2', outputs('已生成 `D:/资料/b.docx`'), TURN_STARTED))
    await waitFor(() => expect(statWorkspaceFiles).toHaveBeenCalledWith('s2', ['D:/资料/b.docx']))
    await Promise.resolve()
    expect(outside.result.current).toEqual([])
  })

  it('keeps a settled shell-written file visible when remounted after the cache TTL', async () => {
    onDisk({ 'out/report.docx': TURN_STARTED + 30_000 })
    const targets = outputs('计划见 plan.md，报告已生成：out/report.docx')
    const first = renderHook(() => useTurnWrittenTargets('s1', targets, TURN_STARTED))
    await waitFor(() => expect(hrefs(first.result.current)).toEqual(['plan.md', 'out/report.docx']))
    first.unmount()

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
    try {
      const second = renderHook(() => useTurnWrittenTargets('s1', targets, TURN_STARTED))
      // 过期缓存先画出来，再后台刷新，切回标签时卡片不闪
      expect(hrefs(second.result.current)).toEqual(['plan.md', 'out/report.docx'])
      await waitFor(() => expect(statWorkspaceFiles).toHaveBeenCalledTimes(2))
      expect(hrefs(second.result.current)).toEqual(['plan.md', 'out/report.docx'])
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('asks the disk nothing when the checkpoint already accounts for every file', () => {
    const targets = outputs('计划见 plan.md，预览 http://localhost:5173/')

    const { result } = renderHook(() => useTurnWrittenTargets('s1', targets, TURN_STARTED))

    expect(hrefs(result.current)).toEqual(['plan.md', 'http://localhost:5173/'])
    expect(statWorkspaceFiles).not.toHaveBeenCalled()
  })

  it('stats a path once for every message that names it, in batches the route accepts', async () => {
    const names = Array.from({ length: 25 }, (_, index) => `out/r${index}.docx`)
    onDisk(Object.fromEntries(names.map((name) => [name, TURN_STARTED + 1_000])))
    const many = extractAssistantOutputTargets(names.join('\n'), {
      workDir: '/w', changedFiles: [], outputEvidence: { unlistedWrites: true }, limit: 25,
    })

    const first = renderHook(() => useTurnWrittenTargets('s1', many, TURN_STARTED))
    const second = renderHook(() => useTurnWrittenTargets('s1', many.slice(0, 1), TURN_STARTED))

    await waitFor(() => expect(first.result.current).toHaveLength(25))
    await waitFor(() => expect(second.result.current).toHaveLength(1))
    expect(statWorkspaceFiles).toHaveBeenCalledTimes(2)
    expect(statWorkspaceFiles.mock.calls.map(([, paths]) => paths.length)).toEqual([20, 5])
  })
})
