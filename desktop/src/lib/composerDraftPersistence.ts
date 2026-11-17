import type { ComposerMention } from './composerMentions'
import type { ComposerAttachment } from './composerAttachments'

/**
 * Unsent composer drafts survive a restart.
 *
 * The chat store keeps drafts in memory only, so closing the app or reloading
 * the page dropped whatever the user had typed. Session drafts are keyed by
 * session id; the retained new-session composer has none yet, so it uses the
 * reserved id below and is served from the same record.
 *
 * Base64 image payloads are dropped on save: they can be tens of megabytes and
 * would blow the localStorage quota, which would take the text down with them.
 */
export const COMPOSER_DRAFT_STORAGE_KEY = 'cc-haha-composer-drafts'
/** Record id for the composer that has not created a session yet. */
export const NEW_SESSION_DRAFT_SESSION_ID = '__new_session_draft__'
const STORAGE_VERSION = 1
/** Keep the newest N sessions; drafts are cheap but the quota is not. */
const MAX_PERSISTED_SESSIONS = 20
/**
 * 本次运行内最近被发送或转交的新会话草稿指纹
 *
 * 发送时立即删除落盘草稿，但其他仍持有旧快照的编辑器实例会在随后的防抖写入
 * 或卸载补写里把同一份内容写回，导致已发送的草稿在新建会话时复活，指纹用于
 * 拒绝这类回写，内容不同即视为新的未发送草稿并清除登记
 */
let consumedNewSessionDraftFingerprint: string | null = null

export type PersistedComposerDraft = {
  input: string
  mentions: ComposerMention[]
  attachments: ComposerAttachment[]
}

type StoredComposerDraft = PersistedComposerDraft & {
  /** Write order, so the oldest records can be dropped first. */
  updatedAt: number
}

type PersistedEnvelope = {
  version: number
  drafts: Record<string, StoredComposerDraft>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeMention(value: unknown): ComposerMention | null {
  if (!isRecord(value)) return null
  if (typeof value.label !== 'string' || typeof value.path !== 'string') return null
  const kind = value.kind === 'skill' || value.kind === 'plugin' || value.kind === 'session'
    ? value.kind
    : undefined
  return {
    label: value.label,
    path: value.path,
    isDirectory: value.isDirectory === true,
    tokenOrdinal: typeof value.tokenOrdinal === 'number' ? value.tokenOrdinal : 0,
    ...(kind ? { kind } : {}),
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(typeof value.icon === 'string' ? { icon: value.icon } : {}),
    ...(typeof value.modelText === 'string' ? { modelText: value.modelText } : {}),
  }
}

function normalizeAttachment(value: unknown): ComposerAttachment | null {
  if (!isRecord(value)) return null
  if (value.type !== 'file' && value.type !== 'image') return null
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null
  const attachment: ComposerAttachment = {
    id: value.id,
    name: value.name,
    type: value.type,
  }
  for (const key of [
    'path', 'mimeType', 'previewUrl', 'data', 'note', 'quote', 'hunkId',
  ] as const) {
    if (typeof value[key] === 'string') attachment[key] = value[key] as string
  }
  for (const key of ['lineStart', 'lineEnd'] as const) {
    if (typeof value[key] === 'number') attachment[key] = value[key] as number
  }
  if (value.diffSide === 'old' || value.diffSide === 'new') attachment.diffSide = value.diffSide
  if (value.referenceKind === 'chat-selection') attachment.referenceKind = 'chat-selection'
  if (typeof value.isDirectory === 'boolean') attachment.isDirectory = value.isDirectory
  return attachment
}

function normalizeDraft(value: unknown): PersistedComposerDraft | null {
  if (!isRecord(value) || typeof value.input !== 'string') return null
  const mentions = Array.isArray(value.mentions)
    ? value.mentions.map(normalizeMention).filter((item): item is ComposerMention => item !== null)
    : []
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.map(normalizeAttachment).filter((item): item is ComposerAttachment => item !== null)
    : []
  if (!value.input && mentions.length === 0 && attachments.length === 0) return null
  return { input: value.input, mentions, attachments }
}

function updatedAtOf(value: unknown): number {
  return isRecord(value) && typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
    ? value.updatedAt
    : 0
}

function readEnvelope(storage: Storage): PersistedEnvelope {
  const raw = storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)
  if (!raw) return { version: STORAGE_VERSION, drafts: {} }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
      return { version: STORAGE_VERSION, drafts: {} }
    }
    const drafts: Record<string, StoredComposerDraft> = {}
    if (isRecord(parsed.drafts)) {
      for (const [sessionId, value] of Object.entries(parsed.drafts)) {
        const draft = normalizeDraft(value)
        if (draft) drafts[sessionId] = { ...draft, updatedAt: updatedAtOf(value) }
      }
    }
    return { version: STORAGE_VERSION, drafts }
  } catch {
    return { version: STORAGE_VERSION, drafts: {} }
  }
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Draft without the payloads that cannot survive the storage quota. */
function toPersistable(draft: PersistedComposerDraft): PersistedComposerDraft {
  return {
    input: draft.input,
    mentions: draft.mentions,
    attachments: draft.attachments.map(({ data: _data, previewUrl: _previewUrl, ...rest }) => rest),
  }
}

/**
 * 草稿内容指纹，只覆盖决定恢复结果的部分，图片 payload 不参与
 *
 * @param draft 待比较的草稿
 * @returns 稳定可比较的指纹字符串
 */
function draftFingerprint(draft: PersistedComposerDraft): string {
  return JSON.stringify({
    input: draft.input,
    mentions: draft.mentions.map(mention => [mention.kind ?? '', mention.path, mention.label]),
    attachments: draft.attachments.map(attachment => [attachment.type, attachment.path ?? '', attachment.name]),
  })
}

/**
 * 登记新会话草稿已被消费（发送或转交），并删除落盘副本
 *
 * @param draft 被消费的草稿内容
 */
export function markNewSessionDraftConsumed(draft: PersistedComposerDraft): void {
  consumedNewSessionDraftFingerprint = draftFingerprint(draft)
  clearPersistedComposerDraft(NEW_SESSION_DRAFT_SESSION_ID)
}

/** 撤销消费登记，消费失败时调用，让草稿继续按未发送内容保存 */
export function forgetNewSessionDraftConsumed(): void {
  consumedNewSessionDraftFingerprint = null
}

/**
 * 判断草稿是否为本次运行内刚被消费的内容
 *
 * @param draft 待判断的草稿
 * @returns 内容与登记指纹一致时为真
 */
export function isNewSessionDraftConsumed(draft: PersistedComposerDraft): boolean {
  return consumedNewSessionDraftFingerprint !== null
    && draftFingerprint(draft) === consumedNewSessionDraftFingerprint
}

/** All persisted drafts, keyed by session id. */
export function readComposerDrafts(): Record<string, PersistedComposerDraft> {
  const storage = getStorage()
  if (!storage) return {}
  const { drafts } = readEnvelope(storage)
  return Object.fromEntries(
    Object.entries(drafts).map(([sessionId, draft]) => [
      sessionId,
      { input: draft.input, mentions: draft.mentions, attachments: draft.attachments },
    ]),
  )
}

/** One persisted draft, or undefined when nothing was left unsent. */
export function readComposerDraft(sessionId: string): PersistedComposerDraft | undefined {
  return readComposerDrafts()[sessionId]
}

/**
 * Stores one session's draft, or removes it when the draft is empty. The
 * oldest records go first once the session cap is reached, so a long-lived
 * install does not grow this key without bound.
 */
export function writeComposerDraft(sessionId: string, draft: PersistedComposerDraft): void {
  const storage = getStorage()
  if (!storage) return
  try {
    const normalized = normalizeDraft(toPersistable(draft))
    // 已消费的新会话草稿不能被旧快照写回，清空草稿不清除登记，否则紧随其后的
    // 防抖或卸载写入会把同一份已发送内容复活；内容不同即视为新的未发送草稿
    if (sessionId === NEW_SESSION_DRAFT_SESSION_ID && normalized) {
      if (isNewSessionDraftConsumed(normalized)) return
      consumedNewSessionDraftFingerprint = null
    }
    const envelope = readEnvelope(storage)
    if (!normalized) {
      delete envelope.drafts[sessionId]
    } else {
      envelope.drafts[sessionId] = { ...normalized, updatedAt: Date.now() }
    }
    const ordered = Object.entries(envelope.drafts)
      .sort(([, left], [, right]) => left.updatedAt - right.updatedAt)
    for (const [stale] of ordered.slice(0, Math.max(0, ordered.length - MAX_PERSISTED_SESSIONS))) {
      delete envelope.drafts[stale]
    }
    storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify(envelope))
  } catch {
    // Quota or a private-mode denial: keep the in-memory draft, drop persistence.
  }
}

export function clearPersistedComposerDraft(sessionId: string): void {
  const storage = getStorage()
  if (!storage) return
  try {
    const envelope = readEnvelope(storage)
    if (!(sessionId in envelope.drafts)) return
    delete envelope.drafts[sessionId]
    storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, JSON.stringify(envelope))
  } catch {
    // Ignore: the draft is already gone from the live store.
  }
}
