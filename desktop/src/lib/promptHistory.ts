/**
 * Previously sent prompts, newest first, recalled with Up/Down like a shell.
 *
 * The list is scoped: a prompt sent in one project must not surface while Up is
 * held in another project or in a scheduled task, so each scope has its own
 * record. The pre-scope global list is still read for the fallback scope, so an
 * upgrade does not erase what the user already had.
 */
export const PROMPT_HISTORY_STORAGE_KEY = 'cc-haha-prompt-history'
export const PROMPT_HISTORY_SCOPES_STORAGE_KEY = 'cc-haha-prompt-history-scopes'
const STORAGE_VERSION = 1
const MAX_PROMPT_HISTORY = 100
/** One very long pasted prompt should not evict every other entry. */
const MAX_PROMPT_LENGTH = 8_000
/** Keep the newest N scopes; each is cheap, but the quota is not. */
const MAX_PROMPT_HISTORY_SCOPES = 30
/**
 * Total prompt characters kept across every scope. Per-scope caps alone would
 * allow `scopes × entries × 8KB` (tens of megabytes), which overruns the
 * localStorage quota and silently stops saving. Oldest prompts go first.
 */
export const MAX_PROMPT_HISTORY_TOTAL_CHARS = 400_000

export const GLOBAL_PROMPT_HISTORY_SCOPE = 'global'

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readLegacyGlobal(): string[] {
  try {
    const raw = getStorage()?.getItem(PROMPT_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

type ScopeEnvelope = {
  version: number
  scopes: Record<string, { prompts: string[]; updatedAt: number }>
}

function readEnvelope(): ScopeEnvelope {
  const empty: ScopeEnvelope = { version: STORAGE_VERSION, scopes: {} }
  try {
    const raw = getStorage()?.getItem(PROMPT_HISTORY_SCOPES_STORAGE_KEY)
    if (!raw) return empty
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty
    const record = parsed as { version?: unknown; scopes?: unknown }
    if (record.version !== STORAGE_VERSION || !record.scopes || typeof record.scopes !== 'object') return empty
    const scopes: ScopeEnvelope['scopes'] = {}
    for (const [scope, value] of Object.entries(record.scopes as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const entry = value as { prompts?: unknown; updatedAt?: unknown }
      if (!Array.isArray(entry.prompts)) continue
      const prompts = entry.prompts.filter((item): item is string => typeof item === 'string' && item.length > 0)
      if (prompts.length === 0) continue
      scopes[scope] = {
        prompts,
        updatedAt: typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0,
      }
    }
    return { version: STORAGE_VERSION, scopes }
  } catch {
    return empty
  }
}

function writeEnvelope(envelope: ScopeEnvelope): void {
  try {
    getStorage()?.setItem(PROMPT_HISTORY_SCOPES_STORAGE_KEY, JSON.stringify(envelope))
  } catch {
    // Quota or private-mode denial: history is a convenience, not state.
  }
}

function pruneScopes(envelope: ScopeEnvelope): ScopeEnvelope {
  const ordered = Object.entries(envelope.scopes)
    .sort(([, left], [, right]) => left.updatedAt - right.updatedAt)
  if (ordered.length <= MAX_PROMPT_HISTORY_SCOPES) return envelope
  const scopes: ScopeEnvelope['scopes'] = {}
  for (const [scope, entry] of ordered.slice(ordered.length - MAX_PROMPT_HISTORY_SCOPES)) {
    scopes[scope] = entry
  }
  return { ...envelope, scopes }
}

/** Enforces the total character budget by dropping the oldest prompts first. */
function pruneTotalChars(envelope: ScopeEnvelope): ScopeEnvelope {
  let total = 0
  for (const entry of Object.values(envelope.scopes)) {
    for (const prompt of entry.prompts) total += prompt.length
  }
  if (total <= MAX_PROMPT_HISTORY_TOTAL_CHARS) return envelope

  const byAge = Object.entries(envelope.scopes)
    .sort(([, left], [, right]) => left.updatedAt - right.updatedAt)
  for (const [scope, entry] of byAge) {
    while (entry.prompts.length > 0 && total > MAX_PROMPT_HISTORY_TOTAL_CHARS) {
      total -= entry.prompts.pop()!.length
    }
    if (entry.prompts.length === 0) delete envelope.scopes[scope]
    if (total <= MAX_PROMPT_HISTORY_TOTAL_CHARS) break
  }
  return envelope
}

/** Stable scope key for a project directory; blank falls back to the global list. */
export function promptHistoryScopeForProject(pathLike: string | null | undefined): string {
  const normalized = pathLike?.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized) return GLOBAL_PROMPT_HISTORY_SCOPE
  return `project:${normalized}`
}

/** Newest first, duplicates removed, empty or whitespace-only prompts dropped. */
export function readPromptHistory(scope: string = GLOBAL_PROMPT_HISTORY_SCOPE): string[] {
  const scoped = readEnvelope().scopes[scope]?.prompts
  if (scoped && scoped.length > 0) return scoped
  // Only the fallback scope inherits the pre-scope list; a project scope starts
  // empty rather than showing another project's prompts.
  return scope === GLOBAL_PROMPT_HISTORY_SCOPE ? readLegacyGlobal() : []
}

/**
 * Records a sent prompt. Consecutive duplicates collapse, so holding Enter on
 * the same text does not fill the list with it.
 */
export function recordPromptHistory(prompt: string, scope: string = GLOBAL_PROMPT_HISTORY_SCOPE): void {
  const text = prompt.trim()
  if (!text) return
  const bounded = text.length > MAX_PROMPT_LENGTH ? text.slice(0, MAX_PROMPT_LENGTH) : text
  const envelope = readEnvelope()
  const history = readPromptHistory(scope)
  if (history[0] === bounded) return
  const next = [bounded, ...history.filter((entry) => entry !== bounded)]
    .slice(0, MAX_PROMPT_HISTORY)
  envelope.scopes[scope] = { prompts: next, updatedAt: Date.now() }
  writeEnvelope(pruneTotalChars(pruneScopes(envelope)))
}

export function clearPromptHistory(scope?: string): void {
  try {
    if (scope === undefined) {
      getStorage()?.removeItem(PROMPT_HISTORY_SCOPES_STORAGE_KEY)
      getStorage()?.removeItem(PROMPT_HISTORY_STORAGE_KEY)
      return
    }
    const envelope = readEnvelope()
    if (!(scope in envelope.scopes)) return
    delete envelope.scopes[scope]
    writeEnvelope(envelope)
  } catch {
    // Nothing to do.
  }
}
