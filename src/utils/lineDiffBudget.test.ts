import { describe, expect, it } from 'bun:test'
import { countLineDiffStats, countLines } from './lineDiffBudget.js'

// The workspace-status card and the turn checkpoint list both count changed
// lines for every file of a session. An unbounded `diffLines` over one
// rewritten large file cost 37 s of CPU and blocked the server event loop, so
// the budget here is the thing that keeps a long session's first open fast.

function numberedLines(count: number, fill: string): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index} ${fill}`)
}

describe('countLines', () => {
  it('treats a trailing newline as a terminator, not an extra line', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('one')).toBe(1)
    expect(countLines('one\n')).toBe(1)
    expect(countLines('one\ntwo')).toBe(2)
    expect(countLines('one\ntwo\n')).toBe(2)
  })
})

describe('countLineDiffStats', () => {
  it('counts a small edit exactly', () => {
    const before = numberedLines(50, 'kept').join('\n') + '\n'
    const after = before.replace('line 25 kept', 'line 25 changed')

    expect(countLineDiffStats(before, after)).toEqual({ additions: 1, deletions: 1 })
  })

  it('keeps a large file with one changed line exact', () => {
    // The size alone must not push it onto the whole-file fallback: the cost of
    // the diff is the edit distance, and one hunk stays well inside the budget.
    const lines = numberedLines(12_000, 'stable')
    const before = lines.join('\n') + '\n'
    const after = lines.map((line, index) => (index === 6_000 ? `${line} edited` : line)).join('\n') + '\n'

    expect(countLineDiffStats(before, after)).toEqual({ additions: 1, deletions: 1 })
  })

  it('does not spend the diff budget on a large rewrite and still reports counts', () => {
    const before = numberedLines(12_000, 'alpha').join('\n') + '\n'
    const after = numberedLines(12_000, 'beta').join('\n') + '\n'

    const startedAt = Date.now()
    const stats = countLineDiffStats(before, after)
    const elapsed = Date.now() - startedAt

    // Whole-file fallback once the edit budget is exceeded.
    expect(stats.additions).toBeGreaterThan(11_000)
    expect(stats.deletions).toBeGreaterThan(11_000)
    // A regression to the unbounded diff takes tens of seconds on this input.
    expect(elapsed).toBeLessThan(5_000)
  })

  it('reports identical texts as unchanged', () => {
    const text = numberedLines(200, 'same').join('\n') + '\n'
    expect(countLineDiffStats(text, text)).toEqual({ additions: 0, deletions: 0 })
  })
})