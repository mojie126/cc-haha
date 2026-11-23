import { diffLines } from 'diff'

/**
 * The edit distance `diffLines` may explore before it gives up.
 *
 * The cost of a line diff grows with the number of differing lines, not with
 * the file size: a 440k-character file with one hunk costs a handful of edits,
 * while a 5k-line file that changed everywhere once cost 37 s of CPU and
 * blocked the server event loop. Both the workspace-status card and the turn
 * checkpoint list run this over every changed file of a session, so the bound
 * is what keeps a long session's first open responsive.
 */
export const LINE_DIFF_MAX_EDIT_LENGTH = 200

export type LineDiffStats = { additions: number; deletions: number }

/** Number of lines a string spans, without materializing a split array. */
export function countLines(content: string): number {
  if (content.length === 0) return 0
  let lines = 1
  for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) {
    lines += 1
  }
  return content.endsWith('\n') ? lines - 1 : lines
}

/**
 * Added/removed line counts for one changed file.
 *
 * Past the edit budget `diffLines` returns `undefined`; the whole-file fallback
 * then reports every new line added and every old line removed. That is the
 * shape of a rewrite anyway, and a long session's cards only need the count to
 * be in the right order of magnitude.
 */
export function countLineDiffStats(oldContent: string, newContent: string): LineDiffStats {
  const changes = diffLines(oldContent, newContent, { maxEditLength: LINE_DIFF_MAX_EDIT_LENGTH })
  if (!changes) {
    return { additions: countLines(newContent), deletions: countLines(oldContent) }
  }
  let additions = 0
  let deletions = 0
  for (const change of changes) {
    if (change.added) additions += change.count || 0
    if (change.removed) deletions += change.count || 0
  }
  return { additions, deletions }
}