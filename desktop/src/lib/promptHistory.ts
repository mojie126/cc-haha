/**
 * Previously sent prompts, newest first.
 *
 * The composer recalls these with Up/Down, the way a shell does. They are kept
 * in localStorage so a restart does not erase the user's phrasing, and are
 * global rather than per session: the point is to reuse a prompt across chats.
 */
export const PROMPT_HISTORY_STORAGE_KEY = 'cc-haha-prompt-history'
const MAX_PROMPT_HISTORY = 100
/** One very long pasted prompt should not evict every other entry. */
const MAX_PROMPT_LENGTH = 8_000

function readRaw(): string[] {
  try {
    const raw = localStorage.getItem(PROMPT_HISTORY_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

/** Newest first, duplicates removed, empty or whitespace-only prompts dropped. */
export function readPromptHistory(): string[] {
  return readRaw()
}

/**
 * Records a sent prompt. Consecutive duplicates collapse, so holding Enter on
 * the same text does not fill the list with it.
 */
export function recordPromptHistory(prompt: string): void {
  const text = prompt.trim()
  if (!text) return
  const bounded = text.length > MAX_PROMPT_LENGTH ? text.slice(0, MAX_PROMPT_LENGTH) : text
  try {
    const history = readRaw()
    if (history[0] === bounded) return
    const next = [bounded, ...history.filter((entry) => entry !== bounded)]
      .slice(0, MAX_PROMPT_HISTORY)
    localStorage.setItem(PROMPT_HISTORY_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Quota or private-mode denial: history is a convenience, not state.
  }
}

export function clearPromptHistory(): void {
  try {
    localStorage.removeItem(PROMPT_HISTORY_STORAGE_KEY)
  } catch {
    // Nothing to do.
  }
}
