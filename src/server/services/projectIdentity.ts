import { readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'

export type ProjectIdentitySnapshot = { roots: string[]; revision: string }
const snapshots = new Map<string, { signature: string; snapshot: ProjectIdentitySnapshot }>()

/** Older preferences register no independent roots; folder aliases never imply one. */
export function normalizeExplicitProjectRoots(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((root): root is string => typeof root === 'string' && path.isAbsolute(root) && !root.includes('\0')))].slice(0, 2000)
    : []
}

/** Match path components, taking the nearest explicitly registered project. */
export function findExplicitProjectRoot(candidate: string, roots: readonly string[], paths: Pick<typeof path, 'relative' | 'sep' | 'isAbsolute'> = path): string | null {
  let selected: string | null = null
  for (const root of roots) {
    const relative = paths.relative(root, candidate)
    if (relative === '' || (relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative))) {
      if (!selected || root.length > selected.length) selected = root
    }
  }
  return selected
}

/** Project identity reads share one parsed preference snapshot across all rows.
 * Revision tracks only roots so unrelated preference edits do not expire history.
 * Identity only refines grouping: an unreadable preference file keeps the legacy
 * grouping instead of failing session listing. */
export function readProjectIdentity(configDir: string): ProjectIdentitySnapshot {
  const filePath = path.join(configDir, 'cc-haha', 'desktop-ui.json')
  let signature: string
  try {
    const stat = statSync(filePath)
    signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
  } catch {
    return { roots: [], revision: '[]' }
  }
  const previous = snapshots.get(filePath)
  if (previous?.signature === signature) return previous.snapshot
  let roots: string[] = []
  let cacheable = true
  try {
    const record = JSON.parse(readFileSync(filePath, 'utf8'))
    roots = normalizeExplicitProjectRoots(record?.explicitProjectRoots)
  } catch (error) {
    // Invalid JSON is recovered by its owning service, which rewrites the file.
    // A file that cannot be read at all is retried instead of pinning the empty
    // snapshot until its signature happens to change.
    cacheable = error instanceof SyntaxError
  }
  const snapshot = { roots, revision: JSON.stringify(roots) }
  if (!cacheable) return snapshot
  snapshots.delete(filePath)
  snapshots.set(filePath, { signature, snapshot })
  while (snapshots.size > 16) snapshots.delete(snapshots.keys().next().value!)
  return snapshot
}
