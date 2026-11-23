import { getDisclosure } from '@/lib/disclosureMemory'
import { resolveUnreadCompletion } from '@/lib/unreadCompletion'
import { ScheduledTaskCard } from '@/components/tasks/ScheduledTaskCard'
import { ScheduledTaskTrigger } from '@/components/tasks/ScheduledTaskTrigger'
import { parseScheduledTaskResult } from '@/lib/scheduledTask'
import { openSideChat } from '@/lib/workspace/openSideChat'
import { ConversationImageGalleryContext } from '@/components/chat/conversationImageGallery'
import { resolveConversationImages } from '@/components/chat/conversationImages'
import { getServerBaseUrl } from '@/lib/desktopRuntime'
import { useWorkspaceContentStore } from '@/stores/workspaceContentStore'
import { Component, useRef, useEffect, useMemo, memo, useState, useCallback, useDeferredValue, useLayoutEffect, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { ArrowDown, BookMarked, Brain, ChevronDown, ChevronRight, FileStack, LoaderCircle, Settings, Target, Undo2 } from 'lucide-react'
import { ApiError } from '../../api/client'
import { sessionsApi, type SessionRewindMode, type SessionTurnCheckpoint, type WorkspaceChangedFile } from '../../api/sessions'
import { listPendingPermissions, useChatStore } from '../../stores/chatStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSideChatStore } from '../../stores/sideChatStore'
import { useWorkspaceChatContextStore } from '../../stores/workspaceChatContextStore'
import { useWorkspaceStore, type WorkspaceOrigin } from '../../stores/workspaceStore'
import { SETTINGS_TAB_ID, useTabStore } from '../../stores/tabStore'
import { teamTaskWindowsForSnapshot, useTeamStore } from '../../stores/teamStore'
import { interruptedTeamNameOf, useTeamPlanStore } from '../../stores/teamPlanStore'
import { useUIStore } from '../../stores/uiStore'
import { useChatAppearanceStore } from '../../stores/chatAppearanceStore'
import { t as translateNow, useTranslation } from '../../i18n'
import { prefersSelectionMenuAbove } from '../../stores/selectionMenuPlacementStore'
import type { TranslationKey } from '../../i18n/locales/en'
import { UserMessage } from './UserMessage'
import { AssistantMessage } from './AssistantMessage'
import { ThinkingBlock } from './ThinkingBlock'
import { BackgroundReplyFold } from './BackgroundReplyFold'
import { TurnCompletionStamp } from './TurnCompletionStamp'
import { ToolCallBlock } from './ToolCallBlock'
import {
  ToolCallGroup,
  type OpenAgentRunPayload,
  type ResolveAgentActivityTarget,
} from './ToolCallGroup'
import type { ActivityStep } from './activityGroupModel'
import { ToolResultBlock } from './ToolResultBlock'
import { PermissionDialog } from './PermissionDialog'
import { MagpieConnectionHint, isCliApiErrorText } from './MagpieConnectionHint'
import { AskUserQuestion } from './AskUserQuestion'
import { RenderItemBoundary } from './RenderItemBoundary'
import { StreamingIndicator } from './StreamingIndicator'
import { InlineTaskSummary } from './InlineTaskSummary'
import { CurrentTurnChangeCard } from './CurrentTurnChangeCard'
import { describeRewindResult, getApiErrorMessage, rewindToTurnCheckpoint } from './turnRewind'
import { useUserMessageEditResend, type EditableTurnCard } from './useUserMessageEditResend'
import type { UserMessageEditAction } from './UserMessage'
import { WorkspaceChangesFallback } from '@/components/chat/WorkspaceChangesFallback'
import { AgentTeamsInlineCard } from '../agentTeams/AgentTeamsSummary'
import { MEMBER_AVATARS, memberAccentColor } from '../agentTeams/agentTeamsAvatars'
import {
  endedPhase,
  getMemberAvatarKey,
  resolveTeamMemberIdentity,
  snapshotWithHistoricalMembers,
} from '../agentTeams/agentTeamsModel'
import {
  buildConversationNavigationItems,
  ConversationNavigator,
  type ConversationNavigationItem,
  type ConversationNavigationMode,
} from './ConversationNavigator'
import type { AgentTaskNotification, BackgroundAgentTask, UIMessage } from '../../types/chat'
import type { TeamDetail, TeamWorkbenchSnapshot } from '../../types/team'
import { formatTokenCount } from '../../lib/formatTokenCount'
import { hasRunningBackgroundTasks as hasAnyRunningBackgroundTasks } from '../../lib/backgroundTasks'
import { buildTurnCompletionByMessageId, type TurnCompletion } from '../../lib/turnCompletion'
import type { TurnOutputEvidence } from '../../lib/assistantOutputTargets'
import { isTouchH5Document } from '../../lib/touchH5'
import { findChatRenderTarget } from '../../lib/trajectory/chatTarget'
import { useTrajectoryViewStore } from '../../stores/trajectoryViewStore'
import {
  EMPTY_TEAM_LIFECYCLE_CURSOR,
  isTeamLifecycleScopedAt,
  updateTeamLifecycleCursor,
} from '../../lib/teamLifecycleScope'
import { Button } from '@/components/ui/Button'
import { ActionDialog, type ActionDialogAction } from '@/components/ui/ActionDialog'
import { clearWindowSelection, getSelectionPopoverPosition, useSelectionPopoverDismiss } from '../../hooks/useSelectionPopoverDismiss'
import {
  getHeightsForSession,
  getMetricsForSession,
  type VirtualRenderItemMetric,
} from './virtualHeightCache'
import {
  notifyConversationFindContentChanged,
  registerConversationFindController,
  type ConversationFindController,
} from '../search/conversationFindBridge'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>
type MemoryEvent = Extract<UIMessage, { type: 'memory_event' }>
type GoalEvent = Extract<UIMessage, { type: 'goal_event' }>
type CompactSummaryEvent = Extract<UIMessage, { type: 'compact_summary' }>

type RenderItem =
  /**
   * One contiguous activity run. `steps` is the run in transcript order —
   * thinking blocks included — and `toolCalls` is the tools-only projection the
   * agent/image/memory renderers still work from.
   */
  | { kind: 'tool_group'; toolCalls: ToolCall[]; steps: ActivityStep[]; id: string }
  /**
   * `wakeReply` 标出后台任务结束后自动继续那一轮里的助手回答，渲染时默认折叠，
   * 与用户自己提示词所开回合的最终回答区分开
   */
  | { kind: 'message'; message: UIMessage; wakeReply?: boolean }
  /**
   * Stands in for the TeamCreate call so the transcript records that this turn
   * handed work to a team, without expanding into the workbench inline.
   */
  | {
      kind: 'team_card'
      id: string
      teamName: string
      startedAt: number
      endedAt?: number
      /** Its lead deleted it, which it does once the work is done. */
      deletedByLead?: boolean
      coordinationToolCalls: ToolCall[]
    }

type RenderModel = {
  renderItems: RenderItem[]
  toolResultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  /** 后台任务的最终状态，按启动它的工具调用 id 关联。 */
  backgroundTasksByToolUseId: Map<string, BackgroundAgentTask>
  /**
   * Unresolved AskUserQuestion tool_use ids followed by a user message. The user
   * has already spoken past that question, so no live permission request can
   * still be on its way to it — the card is history, not a prompt.
   */
  supersededAskUserQuestionIds: ReadonlySet<string>
}

type RewindTurnTarget = {
  messageId: string
  /** The prompt's own transcript id; a live prompt has none until history reloads. */
  transcriptMessageId?: string
  /** The CLI never acknowledged this prompt, so the transcript may not hold it. */
  awaitingReplay?: boolean
  userMessageIndex: number
  content: string
  expectedContent: string
  attachments?: Extract<UIMessage, { type: 'user_text' }>['attachments']
}

type BranchableMessageTarget = {
  uiMessageId: string
  transcriptMessageId: string
}

type TurnChangeCardModel = {
  target: RewindTurnTarget
  checkpoint: SessionTurnCheckpoint
  workDir: string | null
  isLatest: boolean
}

const EMPTY_TURN_CHANGE_CARDS: TurnChangeCardModel[] = []

/**
 * 切换标签或重新打开会话时，检查点接口不必等新一轮请求返回才显示卡片
 *
 * 缓存按会话保存，命中条件为历史纪元与完成回合签名一致；命中时先渲染旧卡片，
 * 新结果返回后再替换，未命中则等接口返回。最多保留最近若干个会话，避免长期
 * 打开大量会话时无界增长
 */
type CachedTurnChangeCards = {
  epoch: number
  targetsKey: string
  cards: TurnChangeCardModel[]
}

const MAX_CACHED_TURN_CARD_SESSIONS = 16
const turnChangeCardCache = new Map<string, CachedTurnChangeCards>()

function turnTargetsKey(targets: readonly { transcriptMessageId?: string; messageId: string }[]): string {
  return targets.map((target) => target.transcriptMessageId ?? target.messageId).join('|')
}

function rememberTurnChangeCards(
  sessionId: string,
  epoch: number,
  targets: readonly { transcriptMessageId?: string; messageId: string }[],
  cards: TurnChangeCardModel[],
): void {
  turnChangeCardCache.delete(sessionId)
  turnChangeCardCache.set(sessionId, { epoch, targetsKey: turnTargetsKey(targets), cards })
  while (turnChangeCardCache.size > MAX_CACHED_TURN_CARD_SESSIONS) {
    const oldest = turnChangeCardCache.keys().next()
    if (oldest.done) break
    turnChangeCardCache.delete(oldest.value)
  }
}

type ChatMessageRole = 'user' | 'assistant'

type ChatSelectionState = {
  text: string
  x: number
  y: number
}

type SelectionPointer = {
  clientX: number
  clientY: number
}

// Business errors whose raw message carries evidence worth keeping under the
// translated explanation (e.g. what the stream received before it was cut).
const BUSINESS_ERRORS_WITH_RAW_DETAIL: ReadonlySet<string> = new Set([
  'upstream_stream_interrupted',
])

const CHAT_SELECTION_MENU_OFFSET = 10
const CHAT_SELECTION_MENU_WIDTH = 360
const CHAT_SELECTION_MENU_HEIGHT = 44

function getElementForNode(node: Node | null): Element | null {
  if (!node) return null
  return node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
}

function getChatSelectionPosition(
  range: Range,
  root: HTMLElement,
  selection: Selection,
  pointer: { clientX: number; clientY: number },
) {
  return getSelectionPopoverPosition(range, root, {
    menuWidth: CHAT_SELECTION_MENU_WIDTH,
    menuHeight: CHAT_SELECTION_MENU_HEIGHT,
    offset: CHAT_SELECTION_MENU_OFFSET,
    fallbackPointer: pointer,
    selectionFocus: { node: selection.focusNode, offset: selection.focusOffset },
    // Read from the store: the settled-selection listener that calls this is not
    // a render, so there is no hook to subscribe with.
    preferAbove: prefersSelectionMenuAbove(),
  })
}

function getChatSelectionFromContainer(
  root: HTMLElement | null,
  pointer: SelectionPointer,
): ChatSelectionState | null {
  if (!root) return null
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const startElement = getElementForNode(range.startContainer)
  const endElement = getElementForNode(range.endContainer)
  if (!startElement || !endElement || !root.contains(startElement) || !root.contains(endElement)) {
    return null
  }

  const text = selection.toString().trim()
  if (!text) return null

  return {
    ...getChatSelectionPosition(range, root, selection, pointer),
    text,
  }
}

function getSelectionPointer(event: SelectionPointer): SelectionPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
  }
}

function isPrimarySelectionPointer(event: Pick<PointerEvent, 'button' | 'ctrlKey' | 'pointerType'>) {
  return event.button === 0 && !(event.pointerType === 'mouse' && event.ctrlKey)
}

function isKeyboardSelectionKey(event: KeyboardEvent) {
  return event.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
}

function ChatSelectionMenu({
  selection,
  onAdd,
  onSideChat,
  popoverRef,
}: {
  selection: ChatSelectionState | null
  onAdd: () => void
  onSideChat?: () => void
  popoverRef: { current: HTMLDivElement | null }
}) {
  const t = useTranslation()
  if (!selection) return null
  return createPortal(
    <div ref={popoverRef} role="toolbar" aria-label={t('chat.selectionActions')}
      onMouseDown={event => { if (event.button === 0 && !event.ctrlKey) event.preventDefault() }}
      className="fixed z-[var(--z-popover)] inline-flex max-w-[calc(100vw-24px)] items-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1 shadow-[var(--shadow-overlay)]"
      style={{ left: selection.x, top: selection.y }}>
      <Button variant="ghost" onClick={onAdd}>{t('chat.addSelectionToChat')}</Button>
      {onSideChat && <Button variant="ghost" onClick={onSideChat}>{t('chat.askSelectionInSideChat')}</Button>}
    </div>, document.body,
  )
}

function getCompactSummaryTitle(message: CompactSummaryEvent, t: ReturnType<typeof useTranslation>) {
  if (message.trigger === 'auto') return t('chat.compactSummary.autoTitle')
  if (message.trigger === 'manual') return t('chat.compactSummary.manualTitle')
  if (!message.title || message.title === 'Context compacted' || message.title === 'Conversation compacted') {
    return t('chat.compactSummary.title')
  }
  return message.title
}

function formatCompactElapsed(elapsedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`
}

/**
 * Live meta for a running compaction: time since the divider appeared (its
 * timestamp is the compaction start) and how much summary has streamed so far.
 * Without it a slow compaction looks hung for minutes.
 */
function CompactingProgressMeta({ startedAt, outputChars }: { startedAt?: number; outputChars?: number }) {
  const t = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === undefined) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const parts = [
    startedAt !== undefined ? formatCompactElapsed(now - startedAt) : null,
    outputChars ? t('chat.compactSummary.generated', { count: formatTokenCount(outputChars) }) : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return null
  return (
    <span data-testid="compact-progress" className="shrink-0 whitespace-nowrap text-[12px] font-normal tabular-nums text-[var(--color-text-tertiary)]">
      {parts.map((part) => (
        <span key={part}>
          <span aria-hidden="true"> · </span>
          {part}
        </span>
      ))}
    </span>
  )
}

function CompactStatusDivider({ message, state }: { message?: CompactSummaryEvent; state: 'compacting' | 'complete' }) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const hasSummary = Boolean(message?.summary?.trim())
  const meta = [
    message?.trigger ? t(`chat.compactSummary.trigger.${message.trigger}` as TranslationKey) : null,
    typeof message?.preTokens === 'number'
      ? t('chat.compactSummary.tokens', { count: formatTokenCount(message.preTokens) })
      : null,
    typeof message?.messagesSummarized === 'number'
      ? t('chat.compactSummary.messages', { count: String(message.messagesSummarized) })
      : null,
  ].filter((item): item is string => Boolean(item))
  const hasDetails = hasSummary || meta.length > 0
  const title = state === 'compacting'
    ? t('chat.compactSummary.compacting')
    : message
      ? getCompactSummaryTitle(message, t)
      : t('chat.compactSummary.title')

  return (
    <section data-testid="compact-status-divider" className="my-4 w-full px-1">
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-[var(--color-border)]" aria-hidden="true" />
        <button
          type="button"
          aria-expanded={hasDetails ? expanded : undefined}
          onClick={() => hasDetails && setExpanded((value) => !value)}
          disabled={!hasDetails}
          className="group inline-flex min-h-8 max-w-[min(78vw,520px)] items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1 text-[13px] font-semibold text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:hover:text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]"
        >
          {state === 'compacting' ? (
            <LoaderCircle size={16} strokeWidth={2.1} className="shrink-0 animate-spin text-[var(--color-text-tertiary)]" aria-hidden="true" />
          ) : (
            <FileStack size={16} strokeWidth={2.05} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          )}
          <span className="min-w-0 truncate font-medium text-[var(--color-text-primary)]">
            {title}
          </span>
          {state === 'compacting' && (
            <CompactingProgressMeta startedAt={message?.timestamp} outputChars={message?.outputChars} />
          )}
        </button>
        <div className="h-px flex-1 bg-[var(--color-border)]" aria-hidden="true" />
      </div>
      {hasDetails && expanded && (
        <div className="mx-auto mt-1.5 w-full max-w-[620px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2">
          {meta.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium text-[var(--color-text-tertiary)]">
              {meta.map((item) => <span key={item}>{item}</span>)}
            </div>
          )}
          {message?.summary && (
            <div className="max-h-[220px] overflow-auto whitespace-pre-wrap break-words text-[12px] leading-5 text-[var(--color-text-secondary)]">
              {message.summary}
            </div>
          )}
          </div>
      )}
    </section>
  )
}

function GoalEventCard({ message }: { message: GoalEvent }) {
  const t = useTranslation()
  const [expanded, setExpanded] = useState(true)
  const titleKey = `chat.goalEvent.${message.action === 'status' ? 'statusTitle' : message.action}` as TranslationKey
  const title = t(titleKey) === titleKey ? t('chat.goalEvent.message') : t(titleKey)
  const metaDetails = [
    message.status ? t('chat.goalEvent.statusValue', { value: message.status }) : null,
    message.budget ? t('chat.goalEvent.budget', { value: message.budget }) : null,
    message.continuations ? t('chat.goalEvent.continuations', { value: message.continuations }) : null,
  ].filter((detail): detail is string => detail !== null)

  return (
    <div className="mb-2">
      <div
        data-testid="goal-event-card"
        className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-memory-border)] bg-[var(--color-memory-surface)]"
      >
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-hover)]"
        >
          {expanded ? (
            <ChevronDown size={15} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          ) : (
            <ChevronRight size={15} className="shrink-0 text-[var(--color-text-tertiary)]" aria-hidden="true" />
          )}
          <Target size={15} className="shrink-0 text-[var(--color-memory-accent)]" strokeWidth={2.25} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--color-text-primary)]">
            {title}
          </span>
          {message.status ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-memory-accent)]" aria-hidden="true" />
              {message.status}
            </span>
          ) : null}
        </button>

        {expanded ? (
          <div className="border-t border-[var(--color-border)] px-3 py-2.5">
            <div className="space-y-1.5">
              {message.objective ? (
                <div className="line-clamp-2 rounded-[var(--radius-md)] px-2 py-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                  {t('chat.goalEvent.objective', { value: message.objective })}
                </div>
              ) : message.message ? (
                <div className="whitespace-pre-wrap rounded-[var(--radius-md)] px-2 py-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                  {message.message}
                </div>
              ) : null}
              {metaDetails.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 px-2 pt-0.5">
                  {metaDetails.map((detail) => (
                    <span
                      key={detail}
                      className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]"
                    >
                      {detail}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function GoalContinuationDivider({ message }: { message: GoalEvent }) {
  const t = useTranslation()
  const reason = message.message?.replace(/^Goal continuing:\s*/i, '').trim()

  return (
    <section data-testid="goal-continuation-divider" className="my-4 w-full px-1">
      <div className="flex w-full items-center gap-3">
        <div className="h-px flex-1 bg-[var(--color-border)]" aria-hidden="true" />
        <div className="inline-flex min-h-8 max-w-[min(78vw,620px)] items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1 text-[13px] font-medium text-[var(--color-text-secondary)]">
          <Target size={16} strokeWidth={2.1} className="shrink-0 text-[var(--color-memory-accent)]" aria-hidden="true" />
          <span className="shrink-0 font-semibold text-[var(--color-text-primary)]">
            {t('chat.goalEvent.continuing')}
          </span>
          {reason ? (
            <span className="min-w-0 truncate text-[12px] text-[var(--color-text-tertiary)]" title={reason}>
              {reason}
            </span>
          ) : null}
        </div>
        <div className="h-px flex-1 bg-[var(--color-border)]" aria-hidden="true" />
      </div>
    </section>
  )
}

function SelectableChatMessage({
  sessionId,
  messageId,
  role,
  content,
  children,
}: {
  sessionId?: string | null
  messageId: string
  role: ChatMessageRole
  content: string
  children: ReactNode
}) {
  const isLean = useSessionStore(state => state.sessions.some(session => session.id === sessionId && session.agentProfile === 'lean'))
  const rootRef = useRef<HTMLDivElement>(null)
  const selectionMenuRef = useRef<HTMLDivElement>(null)
  const lastSelectionPointerRef = useRef<SelectionPointer | null>(null)
  const selectionGestureEpochRef = useRef(0)
  const selectionStartedInsideRef = useRef(false)
  const selectionUpdateAuthorizedRef = useRef(false)
  const selectionUpdateFrameRef = useRef<number | null>(null)
  const addReference = useWorkspaceChatContextStore((state) => state.addReference)
  const [selectionMenu, setSelectionMenu] = useState<(ChatSelectionState & { sessionId: string }) | null>(null)
  const currentSelectionMenu = selectionMenu?.sessionId === sessionId ? selectionMenu : null
  const t = useTranslation()
  const sourceName = role === 'assistant'
    ? t('chat.assistantMessageReference')
    : t('chat.userMessageReference')

  const cancelPendingSelectionMenuUpdate = useCallback(() => {
    selectionGestureEpochRef.current += 1
    if (selectionUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionUpdateFrameRef.current)
      selectionUpdateFrameRef.current = null
    }
  }, [])

  // A transcript entry can have the same id and content in multiple sessions.
  // Invalidate its gesture before another frame can commit into the new session.
  useLayoutEffect(() => {
    cancelPendingSelectionMenuUpdate()
    setSelectionMenu(null)
    lastSelectionPointerRef.current = null
    selectionStartedInsideRef.current = false
    selectionUpdateAuthorizedRef.current = false
  }, [cancelPendingSelectionMenuUpdate, content, messageId, sessionId])

  const dismissSelectionMenu = useCallback(() => {
    setSelectionMenu(null)
  }, [])

  const queueSelectionMenuUpdate = useCallback((pointer?: SelectionPointer) => {
    if (pointer) lastSelectionPointerRef.current = pointer

    if (selectionUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(selectionUpdateFrameRef.current)
    }

    const gestureEpoch = selectionGestureEpochRef.current
    selectionUpdateFrameRef.current = window.requestAnimationFrame(() => {
      if (gestureEpoch !== selectionGestureEpochRef.current) {
        selectionUpdateFrameRef.current = null
        return
      }
      selectionUpdateFrameRef.current = window.requestAnimationFrame(() => {
        selectionUpdateFrameRef.current = null
        if (gestureEpoch !== selectionGestureEpochRef.current || !selectionUpdateAuthorizedRef.current) return

        const root = rootRef.current
        const rootRect = root?.getBoundingClientRect()
        const fallbackPointer = lastSelectionPointerRef.current ?? {
          clientX: (rootRect?.left ?? 0) + 24,
          clientY: (rootRect?.top ?? 0) + 24,
        }
        const selection = getChatSelectionFromContainer(root, fallbackPointer)
        setSelectionMenu(selection && sessionId ? { ...selection, sessionId } : null)
      })
    })
  }, [sessionId])

  useEffect(() => {
    return () => {
      if (selectionUpdateFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionUpdateFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      cancelPendingSelectionMenuUpdate()
      const root = rootRef.current
      const target = event.target
      const startsInside = isPrimarySelectionPointer(event)
        && target instanceof Node
        && Boolean(root?.contains(target))
      selectionStartedInsideRef.current = startsInside
      selectionUpdateAuthorizedRef.current = startsInside
      if (startsInside) lastSelectionPointerRef.current = getSelectionPointer(event)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!selectionStartedInsideRef.current || !isPrimarySelectionPointer(event)) return
      selectionStartedInsideRef.current = false
      selectionUpdateAuthorizedRef.current = true
      queueSelectionMenuUpdate(getSelectionPointer(event))
    }

    const handleSelectionChange = () => {
      if (selectionStartedInsideRef.current || !selectionUpdateAuthorizedRef.current) return
      queueSelectionMenuUpdate()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isKeyboardSelectionKey(event)) return
      cancelPendingSelectionMenuUpdate()
      lastSelectionPointerRef.current = null
      selectionStartedInsideRef.current = false
      selectionUpdateAuthorizedRef.current = true
      queueSelectionMenuUpdate()
    }

    const handleContextMenu = () => {
      cancelPendingSelectionMenuUpdate()
      selectionStartedInsideRef.current = false
      selectionUpdateAuthorizedRef.current = false
      setSelectionMenu(null)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('pointerup', handlePointerUp, true)
    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('keyup', handleKeyUp, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('pointerup', handlePointerUp, true)
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('keyup', handleKeyUp, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
    }
  }, [cancelPendingSelectionMenuUpdate, queueSelectionMenuUpdate])

  useSelectionPopoverDismiss({
    active: Boolean(currentSelectionMenu),
    popoverRef: selectionMenuRef,
    onDismiss: dismissSelectionMenu,
  })

  const addCurrentSelectionToChat = useCallback(() => {
    if (!sessionId || !currentSelectionMenu) return
    addReference(sessionId, {
      kind: 'chat-selection',
      path: `chat://${role}/${messageId}`,
      name: sourceName,
      quote: currentSelectionMenu.text,
      sourceRole: role,
      messageId,
    })
    setSelectionMenu(null)
    clearWindowSelection()
  }, [addReference, messageId, role, currentSelectionMenu, sessionId, sourceName])

  const askSelectionInSideChat = useCallback(() => {
    if (!sessionId || !currentSelectionMenu) return
    void openSideChat(sessionId, { reference: {
      kind: 'chat-selection', path: `chat://${role}/${messageId}`,
      name: sourceName, quote: currentSelectionMenu.text, sourceRole: role, messageId,
    } })
    setSelectionMenu(null)
    clearWindowSelection()
  }, [messageId, role, currentSelectionMenu, sessionId, sourceName])

  return (
    <div
      ref={rootRef}
      data-chat-selectable-message={role}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setSelectionMenu(null)
      }}
    >
      {children}
      <ChatSelectionMenu selection={currentSelectionMenu} onAdd={addCurrentSelectionToChat} onSideChat={isLean ? undefined : askSelectionInSideChat} popoverRef={selectionMenuRef} />
    </div>
  )
}

function appendChildToolCall(
  childToolCallsByParent: Map<string, ToolCall[]>,
  parentToolUseId: string,
  toolCall: ToolCall,
) {
  const siblings = childToolCallsByParent.get(parentToolUseId)
  if (siblings) {
    siblings.push(toolCall)
  } else {
    childToolCallsByParent.set(parentToolUseId, [toolCall])
  }
}

function hasTeamMessageRouting(value: unknown): boolean {
  if (typeof value === 'string') {
    try {
      return hasTeamMessageRouting(JSON.parse(value))
    } catch {
      return false
    }
  }
  if (Array.isArray(value)) return value.some(hasTeamMessageRouting)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const routing = record.routing
  if (routing && typeof routing === 'object') {
    const route = routing as Record<string, unknown>
    if (typeof route.sender === 'string' && typeof route.target === 'string') return true
  }
  return 'content' in record && hasTeamMessageRouting(record.content)
}

function getSendMessageTarget(value: unknown): string | null {
  if (typeof value === 'string') {
    try {
      return getSendMessageTarget(JSON.parse(value))
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const target = (value as Record<string, unknown>).to
  return typeof target === 'string' ? target : null
}

function isTeamCoordinationSendMessage(
  input: unknown,
  result: unknown,
  teamMemberNames: ReadonlySet<string> | undefined,
  allowRosterFallback: boolean,
): boolean {
  if (hasTeamMessageRouting(result)) return true
  if (!allowRosterFallback) return false
  const target = getSendMessageTarget(input)
  return target === '*' || Boolean(target && teamMemberNames?.has(target))
}

function parseRecordValue(value: unknown): Record<string, unknown> | null {
  if (isRecordValue(value)) return value
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return isRecordValue(parsed) ? parsed : null
  } catch {
    return null
  }
}

function nestedStringField(value: unknown, field: string): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = nestedStringField(item, field)
      if (nested) return nested
    }
    return ''
  }
  const record = parseRecordValue(value)
  if (!record) return ''
  const direct = record[field]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  for (const child of [record.content, record.text]) {
    const nested = nestedStringField(child, field)
    if (nested) return nested
  }
  return ''
}

function explicitSuccessFlag(value: unknown): boolean | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = explicitSuccessFlag(item)
      if (nested !== undefined) return nested
    }
    return undefined
  }
  const record = parseRecordValue(value)
  if (!record) return undefined
  if (typeof record.success === 'boolean') return record.success
  if ('content' in record) return explicitSuccessFlag(record.content)
  if ('text' in record) return explicitSuccessFlag(record.text)
  return undefined
}

function canSummarizeCoordinationResult(result: ToolResult | undefined): boolean {
  return !result || (!result.isError && explicitSuccessFlag(result.content) !== false)
}

function lifecycleToolSucceeded(result: ToolResult | undefined): boolean {
  return Boolean(result) && canSummarizeCoordinationResult(result)
}

function teamNameFromCreate(toolCall: ToolCall, result: ToolResult | undefined): string {
  const input = parseRecordValue(toolCall.input)
  // TeamCreate can uniquify a requested name. The successful result owns the
  // durable identity that the workbench will expose.
  for (const value of [nestedStringField(result?.content, 'team_name'), input?.team_name]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return translateNow('agentTeams.name')
}

function isExplicitTeamAgent(
  input: unknown,
  result: ToolResult | undefined,
  teamActive: boolean,
): boolean {
  const inputRecord = parseRecordValue(input)
  const inputTeamName = inputRecord?.team_name
  if (typeof inputTeamName === 'string' && inputTeamName.trim()) return true
  const inputName = inputRecord?.name
  if (teamActive && typeof inputName === 'string' && inputName.trim()) return true

  if (nestedStringField(result?.content, 'status') === 'teammate_spawned') return true
  if (typeof result?.content !== 'string') return false
  return /^\s*team_name:\s*\S+/m.test(result.content) && /^\s*name:\s*\S+/m.test(result.content)
}

export function buildRenderModel(
  messages: UIMessage[],
  activeAskUserQuestionToolUseId?: string | null,
  options: {
    hideTeamCoordinationTools?: boolean
    teamMemberNames?: ReadonlySet<string>
    teamTaskWindows?: Array<{ startedAt: number; endedAt?: number }>
    teamName?: string
    teamStartedAt?: number
  } = {},
): RenderModel {
  const items: RenderItem[] = []
  const toolResultMap = new Map<string, ToolResult>()
  const backgroundTasksByToolUseId = new Map<string, BackgroundAgentTask>()
  const childToolCallsByParent = new Map<string, ToolCall[]>()
  const toolUseIds = new Set<string>()
  const lastUnresolvedAskUserQuestionIndexByToolUseId = new Map<string, number>()
  let lastUnresolvedAskUserQuestionIndex: number | null = null
  let transcriptTeamCursor = EMPTY_TEAM_LIFECYCLE_CURSOR
  let activeTeamCard: Extract<RenderItem, { kind: 'team_card' }> | undefined
  let pendingSteps: ActivityStep[] = []
  let pendingToolCount = 0
  let pendingAgentCount = 0

  const flushGroup = () => {
    if (pendingSteps.length === 0) return
    const steps = pendingSteps
    const toolCount = pendingToolCount
    pendingSteps = []
    pendingToolCount = 0
    pendingAgentCount = 0

    if (toolCount === 0) {
      // A run of pure reasoning or commentary has no tool to count, but it is
      // still process: Codex folds it into one summary row with the rest of the
      // turn's work, so it does not compete with the final answer. Keep the
      // same row form instead of spilling standalone thinking blocks.
      items.push({
        kind: 'tool_group',
        toolCalls: [],
        steps,
        id: `group-${steps[0]!.kind === 'tool' ? steps[0]!.toolCall.id : steps[0]!.message.id}`,
      })
      return
    }

    const toolCalls = steps.flatMap((step) => (step.kind === 'tool' ? [step.toolCall] : []))
    items.push({
      kind: 'tool_group',
      toolCalls,
      steps,
      // Keyed off the first tool call, not the first step: a thinking block that
      // later gains tools must not remount the group under the reader.
      id: `group-${toolCalls[0]!.id}`,
    })
  }
  const appendRootToolCall = (toolCall: ToolCall) => {
    const nextIsAgent = toolCall.toolName === 'Agent'
    // Agent runs render as their own dispatch cards, so they never mix with
    // ordinary steps — including the thinking that preceded the dispatch.
    const pendingIsAgentGroup = pendingToolCount > 0 && pendingAgentCount === pendingToolCount
    const pendingBlocksAgent = nextIsAgent && pendingSteps.length > pendingAgentCount

    if (pendingBlocksAgent || (pendingToolCount > 0 && pendingIsAgentGroup !== nextIsAgent)) {
      flushGroup()
    }
    pendingSteps.push({ kind: 'tool', toolCall })
    pendingToolCount += 1
    if (nextIsAgent) pendingAgentCount += 1
    if (wakeTurn) wakeSegmentRanTools = true
  }
  const appendThinking = (message: Extract<UIMessage, { type: 'thinking' }>) => {
    if (pendingToolCount > 0 && pendingAgentCount === pendingToolCount) flushGroup()
    pendingSteps.push({ kind: 'thinking', message })
  }
  // Assistant prose is held until we know whether more work follows it. If a
  // tool or a thought comes next, it was commentary and joins the run; if the
  // turn ends instead, it is the final answer and stays in the transcript.
  let pendingCommentary: Array<Extract<UIMessage, { type: 'assistant_text' }>> = []
  // 后台任务结果开启的回合里，助手回答不是对用户提示词的最终答复，默认折叠
  let wakeTurn = false
  // 唤醒段里是否真的执行了工具：只有回执（含伴生思考）的唤醒段折起来是
  // 去噪，真正跑了任务的唤醒段是要读的过程与结论，不能折。每一段重置一次。
  let wakeSegmentRanTools = false
  const appendCommentaryToRun = () => {
    if (pendingCommentary.length === 0) return
    for (const message of pendingCommentary) pendingSteps.push({ kind: 'text', message })
    pendingCommentary = []
  }
  const flushCommentaryAsMessages = () => {
    if (pendingCommentary.length === 0) return
    // 唤醒段只有回执、没真正跑工具时才折叠：醒来后真的跑了命令、读了文件
    // 的回复是用户等待的结论，折成一行等于把它藏起来。
    const foldAsWake = wakeTurn && !wakeSegmentRanTools
    for (const message of pendingCommentary) {
      items.push(foldAsWake
        ? { kind: 'message', message, wakeReply: true }
        : { kind: 'message', message })
    }
    pendingCommentary = []
  }
  const ensureTeamCardForCoordination = (
    message: ToolCall,
    result: ToolResult | undefined,
  ) => {
    const input = parseRecordValue(message.input)
    const outputTeamName = nestedStringField(result?.content, 'team_name')
    const inputTeamName = typeof input?.team_name === 'string'
      ? input.team_name.trim()
      : ''
    const explicitTeamName = outputTeamName || inputTeamName
    if (
      activeTeamCard &&
      (!explicitTeamName || activeTeamCard.teamName === explicitTeamName)
    ) return activeTeamCard
    if (activeTeamCard) activeTeamCard = undefined

    const scopedTeamName = options.teamName?.trim() || ''
    const teamName = explicitTeamName || scopedTeamName
    if (!teamName) return undefined
    const usesDurableScope = !explicitTeamName || explicitTeamName === scopedTeamName

    flushGroup()
    activeTeamCard = {
      kind: 'team_card',
      id: `team-card-scope-${message.id}`,
      teamName,
      startedAt: usesDurableScope
        ? options.teamStartedAt ?? message.timestamp
        : message.timestamp,
      coordinationToolCalls: [],
    }
    items.push(activeTeamCard)
    return activeTeamCard
  }

  for (const msg of messages) {
    if (msg.type === 'tool_use') {
      toolUseIds.add(msg.toolUseId)
    }
    if (msg.type === 'tool_result') {
      toolResultMap.set(msg.toolUseId, msg)
    }
    if (msg.type === 'background_task' && msg.task.toolUseId) {
      // 同一工具可能先报运行中、后报终态；保留最新一条，供调用处显示结果。
      const existing = backgroundTasksByToolUseId.get(msg.task.toolUseId)
      if (!existing || msg.task.updatedAt >= existing.updatedAt) {
        backgroundTasksByToolUseId.set(msg.task.toolUseId, msg.task)
      }
    }
  }
  const hasTeamLifecycleEvidence = Boolean(options.teamTaskWindows?.length) || messages.some((msg) => (
    msg.type === 'tool_use' &&
    (msg.toolName === 'TeamCreate' || msg.toolName === 'TeamDelete') &&
    lifecycleToolSucceeded(toolResultMap.get(msg.toolUseId))
  ))
  // Two passes on purpose: a question is superseded by a user message *after*
  // it, so the last user message has to be known before judging any of them.
  let lastUserTextIndex = -1
  messages.forEach((msg, index) => {
    if (msg.type === 'user_text') lastUserTextIndex = index
  })
  const supersededAskUserQuestionIds = new Set<string>()
  messages.forEach((msg, index) => {
    if (
      msg.type === 'tool_use' &&
      msg.toolName === 'AskUserQuestion' &&
      !toolResultMap.has(msg.toolUseId)
    ) {
      lastUnresolvedAskUserQuestionIndexByToolUseId.set(msg.toolUseId, index)
      lastUnresolvedAskUserQuestionIndex = index
      if (lastUserTextIndex > index) supersededAskUserQuestionIds.add(msg.toolUseId)
    }
  })

  for (const msg of messages) {
    if (msg.type === 'assistant_text' && !msg.content.trim()) {
      continue
    }
    // Activity owns task lifecycle/status, including failures and stops. Keep
    // the records for task details and trajectory, but do not turn internal
    // wake-ups into conversation rows or split a contiguous tool activity run.
    if (msg.type === 'background_task') {
      continue
    }
    if (msg.type === 'system' && msg.backgroundContinueTaskIds !== undefined) {
      // 后台任务结果开启的是新一轮工作，紧挨在前面的回答已经是那一轮的
      // 最终答复，应留在对话里，而不是被并进接下来这一段的活动组。
      // 没有待定回答时保持连续的工具活动不被这条隐藏消息切断。
      if (pendingCommentary.length > 0) {
        flushGroup()
        flushCommentaryAsMessages()
      }
      // 这一轮由任务结果唤醒，后面到下一个用户提示词之前的回答默认折叠；
      // 折叠只对“回执”生效：醒来后真的跑了工具的段由 flushCommentaryAsMessages
      // 判断是否展开，这里标记段起点并重置本段的工具痕迹
      wakeTurn = true
      wakeSegmentRanTools = false
      continue
    }

    if (msg.type === 'tool_result' && toolUseIds.has(msg.toolUseId)) {
      continue
    }
    if (msg.type === 'tool_result' && msg.parentToolUseId && toolUseIds.has(msg.parentToolUseId)) {
      continue
    }

    if (msg.type === 'assistant_text') {
      // Hold it until the next message decides whether it was commentary for
      // the work that follows or the turn's final answer.
      pendingCommentary.push(msg)
      continue
    }
    if (msg.type === 'tool_use' || msg.type === 'thinking') {
      appendCommentaryToRun()
    }

    if (msg.type === 'tool_use') {
      if (msg.parentToolUseId && toolUseIds.has(msg.parentToolUseId)) {
        flushGroup()
        appendChildToolCall(childToolCallsByParent, msg.parentToolUseId, msg)
        continue
      }
      const toolResult = toolResultMap.get(msg.toolUseId)
      if (toolResult && parseScheduledTaskResult(msg.toolName, toolResult.content, toolResult.isError)) {
        flushGroup()
        items.push({ kind: 'message', message: msg })
        continue
      }
      let summarizedTeamDelete = false
      if (options.hideTeamCoordinationTools) {
        if (msg.toolName === 'TeamCreate' && lifecycleToolSucceeded(toolResult)) {
          transcriptTeamCursor = updateTeamLifecycleCursor(
            true,
            msg.timestamp,
          )
        } else if (msg.toolName === 'TeamDelete' && lifecycleToolSucceeded(toolResult)) {
          transcriptTeamCursor = updateTeamLifecycleCursor(
            false,
            msg.timestamp,
          )
          const deletedTeamCard = ensureTeamCardForCoordination(msg, toolResult)
          if (deletedTeamCard) {
            deletedTeamCard.endedAt = msg.timestamp
            deletedTeamCard.deletedByLead = true
            deletedTeamCard.coordinationToolCalls.push(msg)
            summarizedTeamDelete = true
          }
          // A later lifecycle can be present only in the durable workbench
          // window after transcript compaction. Do not attach that run's
          // coordination audit to the card from the lifecycle just deleted.
          activeTeamCard = undefined
        }

        const isTeamScopedAtMessage = isTeamLifecycleScopedAt(
          msg.timestamp,
          transcriptTeamCursor,
          options.teamTaskWindows,
        )
        const isTeamTask =
          (msg.toolName === 'TaskCreate' || msg.toolName === 'TaskUpdate') &&
          isTeamScopedAtMessage
        const explicitTeamAgent = msg.toolName === 'Agent' &&
          isExplicitTeamAgent(msg.input, toolResult, isTeamScopedAtMessage)
        const ambiguousTeamAgent = msg.toolName === 'Agent' &&
          isTeamScopedAtMessage &&
          !explicitTeamAgent &&
          msg.isPending === true
        const isTeamAgent = msg.toolName === 'Agent' && (
          explicitTeamAgent
        )
        const isTeamMessage = msg.toolName === 'SendMessage' && (
          isTeamScopedAtMessage ||
          isTeamCoordinationSendMessage(
            msg.input,
            toolResult?.content,
            options.teamMemberNames,
            !hasTeamLifecycleEvidence,
          )
        )

        // During an active Team lifecycle, a streamed Agent without
        // teammate identity is not yet classifiable: it can settle as a direct
        // SubAgent if `name` stays absent, or as a teammate once that identity
        // arrives. Keep it out of both projections during that partial state.
        if (ambiguousTeamAgent) continue

        // These records remain untouched in `messages` and `toolResultMap`.
        // The lead transcript projects them through the inline team card while
        // the workbench owns the roster, DAG, and communication presentation.
        // A failed coordination call stays visible because it changes what the
        // turn means and is not represented by successful workbench state.
        if (
          (isTeamTask || isTeamAgent || isTeamMessage) &&
          canSummarizeCoordinationResult(toolResult)
        ) {
          const teamCard = ensureTeamCardForCoordination(msg, toolResult)
          if (teamCard) {
            teamCard.coordinationToolCalls.push(msg)
            continue
          }
        }
      }
      if (summarizedTeamDelete) continue
      // The raw TeamCreate call and its JSON result say nothing a reader can
      // use; the team card in its place links to the workbench that does.
      if (
        options.hideTeamCoordinationTools &&
        msg.toolName === 'TeamCreate' &&
        canSummarizeCoordinationResult(toolResult)
      ) {
        flushGroup()
        // A lead leads one team at a time, so a new team means the previous
        // one ended, even when the host ended it (a cancelled or ended plan)
        // and no TeamDelete call here says so.
        if (activeTeamCard && activeTeamCard.endedAt === undefined) activeTeamCard.endedAt = msg.timestamp
        activeTeamCard = {
          kind: 'team_card',
          id: `team-card-${msg.id}`,
          teamName: teamNameFromCreate(msg, toolResult),
          startedAt: msg.timestamp,
          coordinationToolCalls: [],
        }
        items.push(activeTeamCard)
        continue
      }
      if (msg.toolName === 'AskUserQuestion') {
        const isResolved = toolResultMap.has(msg.toolUseId)
        const lastUnresolvedIndex = lastUnresolvedAskUserQuestionIndexByToolUseId.get(msg.toolUseId)
        if (!isResolved && lastUnresolvedIndex !== undefined && messages[lastUnresolvedIndex] !== msg) {
          continue
        }
        if (
          !isResolved &&
          activeAskUserQuestionToolUseId &&
          msg.toolUseId !== activeAskUserQuestionToolUseId
        ) {
          continue
        }
        if (
          !isResolved &&
          !activeAskUserQuestionToolUseId &&
          lastUnresolvedAskUserQuestionIndex !== null &&
          messages[lastUnresolvedAskUserQuestionIndex] !== msg
        ) {
          continue
        }
        flushGroup()
        items.push({ kind: 'message', message: msg })
      } else {
        appendRootToolCall(msg)
      }
    } else if (msg.type === 'thinking') {
      appendThinking(msg)
    } else {
      flushGroup()
      flushCommentaryAsMessages()
      // 用户提示词开启新回合，之后的回答回到正常呈现
      if (msg.type === 'user_text') wakeTurn = false
      items.push({ kind: 'message', message: msg })
    }
  }

  flushGroup()
  flushCommentaryAsMessages()
  return { renderItems: items, toolResultMap, childToolCallsByParent, backgroundTasksByToolUseId, supersededAskUserQuestionIds }
}

function coordinationToolSummary(toolCall: ToolCall): string | null {
  const input = parseRecordValue(toolCall.input)
  if (!input) return null
  const values = toolCall.toolName === 'TaskCreate'
    ? [input.subject]
    : toolCall.toolName === 'TaskUpdate'
      ? [input.taskId, input.status, input.owner]
      : toolCall.toolName === 'Agent'
        ? [input.name, input.description]
        : toolCall.toolName === 'SendMessage'
          ? [input.to, input.message]
          : []
  const summary = values
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .join(' · ')
  return summary || null
}

function TeamCoordinationAudit({ toolCalls }: { toolCalls: ToolCall[] }) {
  const t = useTranslation()
  if (toolCalls.length === 0) return null

  return (
    <details
      data-testid="agent-teams-coordination-audit"
      className="mx-2 border-x border-b border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)]"
    >
      <summary className="cursor-pointer select-none font-medium text-[var(--color-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]">
        {t('agentTeams.inline.coordination', { count: toolCalls.length })}
      </summary>
      <ol className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
        {toolCalls.map((toolCall) => {
          const summary = coordinationToolSummary(toolCall)
          return (
            <li key={toolCall.toolUseId} className="flex min-w-0 items-start gap-2">
              <code className="shrink-0 font-mono text-[11px] text-[var(--color-text-tertiary)]">
                {toolCall.toolName}
              </code>
              {summary ? <span className="min-w-0 break-words">{summary}</span> : null}
            </li>
          )
        })}
      </ol>
    </details>
  )
}

function teamTimestamp(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (!value) return undefined
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function snapshotForTeamCard(
  snapshot: TeamWorkbenchSnapshot | undefined,
  item: Extract<RenderItem, { kind: 'team_card' }>,
): TeamWorkbenchSnapshot | undefined {
  if (!snapshot || snapshot.team.name !== item.teamName) return undefined
  const startedAt = teamTimestamp(snapshot.team.createdAt)
  if (startedAt === undefined) return snapshot
  if (item.endedAt !== undefined && item.endedAt < startedAt) return undefined

  // The TeamCreate tool and server lifecycle event are emitted by separate
  // transports, so allow a small clock/order gap while still refusing to bind
  // an older card to a newer incarnation that reused the same team name.
  return Math.abs(item.startedAt - startedAt) <= 5_000 ? snapshot : undefined
}

function isTurnResponseMessage(message: UIMessage) {
  return (
    message.type === 'assistant_text' ||
    message.type === 'tool_use' ||
    message.type === 'tool_result' ||
    message.type === 'error' ||
    message.type === 'task_summary'
  )
}

function getBranchableMessageTargets(messages: UIMessage[]): Map<string, BranchableMessageTarget> {
  const branchableTargets = new Map<string, BranchableMessageTarget>()
  let currentTurnCandidates: Array<Extract<UIMessage, { type: 'user_text' | 'assistant_text' }>> = []
  let hasResponseForCurrentTurn = false

  const markCurrentTurnBranchable = () => {
    if (!hasResponseForCurrentTurn) return
    for (const candidate of currentTurnCandidates) {
      if (!candidate.transcriptMessageId) continue
      branchableTargets.set(candidate.id, {
        uiMessageId: candidate.id,
        transcriptMessageId: candidate.transcriptMessageId,
      })
    }
  }

  for (const message of messages) {
    if (message.type === 'user_text') {
      markCurrentTurnBranchable()
      currentTurnCandidates = []
      hasResponseForCurrentTurn = false
      if (!message.pending && message.transcriptMessageId) {
        currentTurnCandidates = [message]
      }
      continue
    }

    if (currentTurnCandidates.length === 0) continue

    if (isTurnResponseMessage(message)) {
      hasResponseForCurrentTurn = true
    }

    if (message.type === 'assistant_text' && message.transcriptMessageId) {
      currentTurnCandidates.push(message)
    }
  }

  markCurrentTurnBranchable()
  return branchableTargets
}

function collectTurnTargets(messages: UIMessage[]): Array<{ target: RewindTurnTarget; answered: boolean }> {
  let userMessageIndex = -1
  const turns: Array<{ target: RewindTurnTarget; answered: boolean }> = []
  let currentTarget: RewindTurnTarget | null = null
  let hasResponseForCurrentTarget = false

  for (const message of messages) {
    if (message.type === 'user_text' && !message.pending) {
      if (currentTarget) turns.push({ target: currentTarget, answered: hasResponseForCurrentTarget })
      userMessageIndex += 1
      currentTarget = {
        messageId: message.id,
        ...(message.transcriptMessageId ? { transcriptMessageId: message.transcriptMessageId } : {}),
        ...(message.awaitingReplay ? { awaitingReplay: true } : {}),
        userMessageIndex,
        content: message.content,
        expectedContent: message.modelContent ?? message.content,
        attachments: message.attachments,
      }
      hasResponseForCurrentTarget = false
      continue
    }

    if (currentTarget && isTurnResponseMessage(message)) {
      hasResponseForCurrentTarget = true
    }
  }

  if (currentTarget) turns.push({ target: currentTarget, answered: hasResponseForCurrentTarget })
  return turns
}

export function getCompletedTurnTargets(messages: UIMessage[]): RewindTurnTarget[] {
  return collectTurnTargets(messages).filter((turn) => turn.answered).map((turn) => turn.target)
}

/**
 * Prompts that never got a reply — a stop landed before the model answered.
 * The model has no output to protect there, so these stay editable even though
 * the server lists no checkpoint for a turn without a response.
 */
export function getUnansweredTurnTargets(
  messages: UIMessage[],
): Array<{ target: RewindTurnTarget; latest: boolean }> {
  const turns = collectTurnTargets(messages)
  return turns.flatMap((turn, index) =>
    turn.answered ? [] : [{ target: turn.target, latest: index === turns.length - 1 }])
}

export function getLatestCompletedTurnTarget(messages: UIMessage[]): RewindTurnTarget | null {
  const completedTurns = getCompletedTurnTargets(messages)
  return completedTurns.length > 0 ? completedTurns[completedTurns.length - 1] ?? null : null
}

function rebindTurnChangeCards(cards: TurnChangeCardModel[], messages: UIMessage[]): TurnChangeCardModel[] {
  if (cards.length === 0) return cards
  const recordedRows = new Map<string, string>()
  const liveRows = new Set<string>()
  for (const message of messages) {
    if (message.type !== 'user_text' || message.pending) continue
    recordedRows.set(message.transcriptMessageId ?? message.id, message.id)
    if (!message.transcriptMessageId) liveRows.add(message.id)
  }
  // 重连可能用落盘 ID 替换本地行；保留原绑定或按落盘 ID 重挂，不用序号或文案猜测。
  const rebound = cards.flatMap((card) => {
    const originalId = card.target.messageId
    const messageId = recordedRows.get(card.checkpoint.target.targetUserMessageId) ??
      (liveRows.has(originalId) ? originalId : undefined)
    if (messageId === undefined) return []
    return messageId === originalId ? [card] : [{ ...card, target: { ...card.target, messageId } }]
  })
  return rebound.length === cards.length && rebound.every((card, index) => card === cards[index]) ? cards : rebound
}

function buildTurnCardInsertionMap(
  renderItems: RenderItem[],
  turnChangeCards: TurnChangeCardModel[],
) {
  const lastResponseIndexByTurnId = new Map<string, number>()
  const userIndexByTurnId = new Map<string, number>()
  let activeTurnId: string | null = null

  renderItems.forEach((item, index) => {
    if (item.kind === 'message' && item.message.type === 'user_text' && !item.message.pending) {
      activeTurnId = item.message.id
      userIndexByTurnId.set(activeTurnId, index)
      return
    }

    if (activeTurnId) {
      lastResponseIndexByTurnId.set(activeTurnId, index)
    }
  })

  const cardsByRenderIndex = new Map<number, TurnChangeCardModel[]>()
  turnChangeCards.forEach((card) => {
    // Tool usage alone does not establish a file change. Omit empty change
    // cards even when Bash coverage is unverified; conversation-only targets
    // keep their separate lightweight action.
    if (
      card.checkpoint.code.available &&
      card.checkpoint.code.filesChanged.length === 0
    ) return
    const renderIndex =
      lastResponseIndexByTurnId.get(card.target.messageId) ??
      userIndexByTurnId.get(card.target.messageId)
    if (renderIndex === undefined) return
    const existing = cardsByRenderIndex.get(renderIndex)
    if (existing) {
      existing.push(card)
    } else {
      cardsByRenderIndex.set(renderIndex, [card])
    }
  })

  return cardsByRenderIndex
}

type TurnFileEvidence = TurnOutputEvidence & {
  changedFiles: string[]
  /** 本轮检查点的标识，用于把总结里的变更文件直接打开成差异 */
  turnChangeTarget?: { turnKey: string; userMessageIndex: number }
}

const UNKNOWN_TURN_OUTPUT_EVIDENCE: TurnOutputEvidence = { unlistedWrites: true }

/**
 * Map each render item to what its turn's checkpoint knows: the REAL changed
 * files, so an assistant message can anchor its output chips on files that were
 * actually written this turn instead of guessing paths from the prose, and
 * whether anything else could have written one. Items are attributed to the
 * most recent preceding non-pending user message (the turn boundary).
 */
function buildChangedFilesByRenderIndex(
  renderItems: RenderItem[],
  turnChangeCards: TurnChangeCardModel[],
): Map<number, TurnFileEvidence> {
  const filesByTurnId = new Map<string, TurnFileEvidence>()
  for (const card of turnChangeCards) {
    const { code, unverifiedChangeSources, startedAt } = card.checkpoint
    filesByTurnId.set(card.target.messageId, {
      changedFiles: code.filesChanged,
      // An older server does not say; assume the worst.
      unlistedWrites: unverifiedChangeSources === undefined || unverifiedChangeSources.length > 0,
      ...(typeof startedAt === 'number' ? { startedAt } : {}),
      ...(card.checkpoint.target.targetUserMessageId
        ? {
            turnChangeTarget: {
              turnKey: card.checkpoint.target.targetUserMessageId,
              userMessageIndex: card.checkpoint.target.userMessageIndex,
            },
          }
        : {}),
    })
  }
  if (filesByTurnId.size === 0) return new Map()

  const filesByRenderIndex = new Map<number, TurnFileEvidence>()
  let activeTurnId: string | null = null
  renderItems.forEach((item, index) => {
    if (item.kind === 'message' && item.message.type === 'user_text' && !item.message.pending) {
      activeTurnId = item.message.id
      return
    }
    if (activeTurnId) {
      const files = filesByTurnId.get(activeTurnId)
      if (files) filesByRenderIndex.set(index, files)
    }
  })

  return filesByRenderIndex
}

/**
 * Pick one assistant message per checkpointed turn to own generated-artifact
 * fallback cards. Every assistant message still receives changedFiles for path
 * reconciliation; only the last visible reply may append files absent from its
 * prose, otherwise each progress update repeats the same turn-wide artifacts.
 */
function buildTurnOutputOwnerIndexes(
  renderItems: RenderItem[],
  turnChangeCards: TurnChangeCardModel[],
): Set<number> {
  const checkpointTurnIds = new Set(
    turnChangeCards.map((card) => card.target.messageId),
  )
  if (checkpointTurnIds.size === 0) return new Set()

  const lastAssistantIndexByTurnId = new Map<string, number>()
  let activeTurnId: string | null = null
  renderItems.forEach((item, index) => {
    if (item.kind === 'message' && item.message.type === 'user_text' && !item.message.pending) {
      activeTurnId = item.message.id
      return
    }
    if (
      activeTurnId &&
      checkpointTurnIds.has(activeTurnId) &&
      item.kind === 'message' &&
      item.message.type === 'assistant_text'
    ) {
      lastAssistantIndexByTurnId.set(activeTurnId, index)
    }
  })

  return new Set(lastAssistantIndexByTurnId.values())
}

/**
 * Where a render item sits inside its turn, which is what decides its spacing.
 *
 * `none` is the user bubble: it opens an exchange, so it carries the large gap
 * that separates one turn from the last. Everything else is a response and takes
 * the tight within-turn gap. The names still read positionally because the
 * boundaries are what the spacing is derived from — see `.chat-turn-rail*`,
 * which owns the actual values and deliberately draws nothing.
 */
export type TurnRailPosition = 'none' | 'start' | 'middle' | 'end' | 'solo'

/**
 * Rail position for every render item, indexed alongside `renderItems`.
 *
 * Deliberately breaks on EVERY `user_text`, unlike the turn-attribution walks above
 * (`buildTurnCardInsertionMap`, `buildChangedFilesByRenderIndex`,
 * `buildTurnOutputOwnerIndexes`, `getBranchableMessageTargets`) which skip
 * `pending` ones. Those answer "which turn owns this checkpoint", and a member
 * session's pending echo must not steal
 * ownership. This answers "where does the line stop", and a pending message still
 * renders as a visible right-aligned bubble (see the `user_text` case in
 * `MessageBlock`) — a bubble mid-column is a break whatever it means for
 * attribution. Do not "fix" this to match the others.
 */
export function buildTurnRailPositions(
  renderItems: RenderItem[],
  options: { hasTrailingStreamingItem?: boolean } = {},
): TurnRailPosition[] {
  const positions: TurnRailPosition[] = new Array<TurnRailPosition>(renderItems.length).fill('none')
  let runStart = -1

  /** Label the open run [runStart, endExclusive). `continues` = the streaming
   *  block will pick the line up below, so the run must not cap itself. */
  const closeRun = (endExclusive: number, continues: boolean) => {
    if (runStart < 0) return
    const last = endExclusive - 1
    for (let index = runStart; index <= last; index += 1) {
      positions[index] = index === runStart ? 'start' : 'middle'
    }
    if (!continues) positions[last] = runStart === last ? 'solo' : 'end'
    runStart = -1
  }

  renderItems.forEach((item, index) => {
    if (item.kind === 'message' && item.message.type === 'user_text') {
      closeRun(index, false)
      positions[index] = 'none'
      return
    }
    if (runStart < 0) runStart = index
  })

  closeRun(renderItems.length, Boolean(options.hasTrailingStreamingItem))

  return positions
}

/**
 * Rail position for the live streaming reply, which renders outside the virtual
 * list. It caps whatever run the transcript left open, or stands alone when the
 * user has just sent and nothing else has landed yet.
 */
export function trailingStreamingRailPosition(positions: TurnRailPosition[]): TurnRailPosition {
  const last = positions[positions.length - 1]
  return last === 'start' || last === 'middle' ? 'end' : 'solo'
}

function isCheckpointPreviewBudgetError(error: unknown): boolean {
  return error instanceof ApiError &&
    error.status === 413 &&
    typeof error.body === 'object' &&
    error.body !== null &&
    'error' in error.body &&
    error.body.error === 'HISTORY_CHECKPOINT_PREVIEW_LIMIT'
}

function isSessionTurnCheckpoint(value: unknown): value is SessionTurnCheckpoint {
  if (!value || typeof value !== 'object') return false
  const checkpoint = value as Partial<SessionTurnCheckpoint>
  return (
    Boolean(checkpoint.target) &&
    typeof checkpoint.target?.targetUserMessageId === 'string' &&
    typeof checkpoint.target?.userMessageIndex === 'number' &&
    Boolean(checkpoint.code) &&
    typeof checkpoint.code?.available === 'boolean' &&
    Array.isArray(checkpoint.code?.filesChanged) &&
    (checkpoint.restoreAvailable === undefined ||
      typeof checkpoint.restoreAvailable === 'boolean') &&
    (checkpoint.unverifiedChangeSources === undefined ||
      (Array.isArray(checkpoint.unverifiedChangeSources) &&
        checkpoint.unverifiedChangeSources.every((source) => typeof source === 'string')))
  )
}

function normalizeTurnCheckpoints(response: unknown): SessionTurnCheckpoint[] {
  if (!response || typeof response !== 'object') return []
  const checkpoints = (response as { checkpoints?: unknown }).checkpoints
  if (!Array.isArray(checkpoints)) return []
  return checkpoints.filter(isSessionTurnCheckpoint)
}

function memoryFileLabel(path: string) {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

function openMemorySettings(path?: string) {
  const ui = useUIStore.getState()
  if (path) ui.setPendingMemoryPath(path)
  ui.setPendingSettingsTab('memory')
  useTabStore.getState().openTab(SETTINGS_TAB_ID, 'Settings', 'settings')
}

function MemoryEventCard({ message }: { message: MemoryEvent }) {
  const t = useTranslation()
  const visibleFiles = message.files.slice(0, 3)
  const hiddenCount = Math.max(0, message.files.length - visibleFiles.length)

  return (
    <div className="mb-3 flex justify-center px-3">
      <div className="w-full max-w-2xl rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3.5 py-3 text-xs">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-container)] text-[var(--color-text-secondary)]">
            <BookMarked size={15} strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[13px] font-medium text-[var(--color-text-primary)]">
                {t('chat.memorySavedTitle', { count: message.files.length })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openMemorySettings(message.files[0]?.path)}
                icon={<Settings size={13} aria-hidden="true" />}
              >
                {t('chat.memoryOpenSettings')}
              </Button>
            </div>
            {message.message ? (
              <div className="mt-1 text-[var(--color-text-tertiary)]">{message.message}</div>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {visibleFiles.map((file) => (
                <span
                  key={file.path}
                  title={file.path}
                  className="max-w-full truncate rounded-[var(--radius-xs)] bg-[var(--color-surface-container)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
                >
                  {memoryFileLabel(file.path)}
                </span>
              ))}
              {hiddenCount > 0 ? (
                <span className="rounded-[var(--radius-xs)] bg-[var(--color-surface-container)] px-1.5 py-0.5 text-[11px] text-[var(--color-text-tertiary)]">
                  {t('chat.memoryMoreFiles', { count: hiddenCount })}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

type MessageListProps = {
  sessionId?: string | null
  visible?: boolean
  compact?: boolean
  mobileLayout?: boolean
  /**
   * The host answers waiting requests from an approval bar in the composer's
   * place (the phone session page). Permission, plan and question cards then
   * shrink to a marker line here while they wait, so only one live copy exists.
   */
  decisionsInComposer?: boolean
  onOpenAgentRun?: (payload: OpenAgentRunPayload) => void
  /**
   * Lets a host that renders the list under a non-session id (an agent run's
   * own tab) tell an Agent card which session and tool ref its detail endpoint
   * lives behind. Defaults to the card's own ids.
   */
  resolveAgentActivityTarget?: ResolveAgentActivityTarget
}

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48
const SCROLL_BOTTOM_SENTINEL = 1_000_000_000
const MAX_SCROLL_SNAPSHOTS = 100
const VIRTUALIZE_MIN_RENDER_ITEMS = 120
const VIRTUALIZE_MIN_CONTENT_CHARS = 120_000
// Touch-H5 disables content-visibility paint skipping for selection
// correctness (globals.css), which makes virtualization the only paint bound
// for long transcripts there — so it kicks in at half the desktop thresholds.
const TOUCH_H5_VIRTUALIZE_MIN_RENDER_ITEMS = 60
const TOUCH_H5_VIRTUALIZE_MIN_CONTENT_CHARS = 60_000
const VIRTUAL_OVERSCAN_PX = 1200
const VIRTUAL_DEFAULT_VIEWPORT_HEIGHT = 720
/** Floor for both estimated AND measured item heights, so it has to sit under
 *  the shortest real item — a collapsed activity line at ~34px. Set above that
 *  and every such row is recorded too tall forever: the clamp is applied to the
 *  ResizeObserver's reading too, so no amount of measuring corrects it. */
const VIRTUAL_MIN_ITEM_HEIGHT = 24
const VIRTUAL_MAX_ITEM_HEIGHT = 24_000
// Chromium on Windows can report up to 2px ResizeObserver oscillations at
// fractional DPI. Keep the last accepted value as the baseline so cumulative
// real growth still crosses the band; only the back-and-forth noise is dropped.
const RESIZE_OBSERVER_JITTER_MAX_DELTA_PX = 2
// Native scroll anchoring and fractional DPI can leave the WebView a few CSS
// pixels shy of its computed bottom. Rewriting that correction on every live
// delta makes the two owners fight and turns the rounding into visible bounce.
const LIVE_FOLLOW_BOTTOM_GAP_TOLERANCE_PX = 4
const USER_SCROLL_INTENT_WINDOW_MS = 500
/**
 * Backstop for the disclosure suppression window. The window normally ends at
 * the next animation frame (see `handleDisclosureToggle`); this only bounds it
 * if that frame never runs, so a dropped rAF cannot leave follow off forever.
 */
const DISCLOSURE_FOLLOW_SUPPRESS_MS = 400
/** Collapse toggles inside the transcript, matched via event delegation. */
const CHAT_DISCLOSURE_SELECTOR = '[data-chat-disclosure="true"]'
// 有一条用户提示词就显示对话导航，读者不必等到第 4 条才发现它可用于定位
const CONVERSATION_NAVIGATION_MIN_ITEMS = 1
const CONVERSATION_NAVIGATION_FULL_MIN_WIDTH_PX = 960
const CONVERSATION_NAVIGATION_COMPACT_MIN_WIDTH_PX = 560
const STREAMING_ASSISTANT_NAVIGATION_KEY = 'streaming-assistant-message'
const EMPTY_MESSAGES: UIMessage[] = []
const EMPTY_AGENT_TASK_NOTIFICATIONS: Record<string, AgentTaskNotification> = {}
const CHAT_SCROLL_AREA_CLASS = [
  'chat-scroll-area',
  '[scrollbar-width:auto]',
  '[scrollbar-color:color-mix(in_srgb,var(--color-outline)_72%,transparent)_transparent]',
  '[&::-webkit-scrollbar]:w-2.5',
  '[&::-webkit-scrollbar-track]:bg-transparent',
  '[&::-webkit-scrollbar-thumb]:rounded-full',
  '[&::-webkit-scrollbar-thumb]:border-[3px]',
  '[&::-webkit-scrollbar-thumb]:border-transparent',
  '[&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--color-outline)_74%,transparent)]',
  '[&::-webkit-scrollbar-thumb]:bg-clip-content',
  '[&::-webkit-scrollbar-thumb:hover]:border-2',
  '[&::-webkit-scrollbar-thumb:hover]:bg-[color-mix(in_srgb,var(--color-outline)_90%,transparent)]',
].join(' ')
const CHAT_RENDER_ITEM_CLASS = [
  'chat-render-item',
].join(' ')

/**
 * Carries the turn rail. Kept separate from `chat-render-item` on purpose: the
 * streaming reply and the turn status line also sit on the rail but are not
 * transcript items, and `.chat-render-item` is counted exactly in tests.
 */
const CHAT_TURN_RAIL_CLASS = 'chat-turn-rail'

function turnRailClass(position: TurnRailPosition): string {
  return `${CHAT_TURN_RAIL_CLASS} chat-turn-rail--${position}`
}

export function isRenderItemFullyVisibleInChatScroller(renderItem: HTMLElement) {
  const scroller = renderItem.closest<HTMLElement>('.chat-scroll-area')
  if (!scroller) return false

  const itemRect = renderItem.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()
  return itemRect.top >= scrollerRect.top &&
    itemRect.bottom <= scrollerRect.bottom &&
    itemRect.left >= scrollerRect.left &&
    itemRect.right <= scrollerRect.right
}

type SessionScrollAnchor = {
  itemKey: string
  // CSS pixels relative to the scroller, including a partially clipped row.
  offset: number
}

type SessionScrollSnapshot = {
  scrollTop: number
  wasAtBottom: boolean
  anchor?: SessionScrollAnchor
}

type ScrollSnapshotBoundaryProps = {
  sessionId: string | null | undefined
  onLeave: () => void
  children: ReactNode
}

// Read the outgoing DOM before React replaces it. A scroll event snapshot can
// be stale after async layout; hook cleanups on updates run after DOM mutations.
class ScrollSnapshotBoundary extends Component<ScrollSnapshotBoundaryProps> {
  getSnapshotBeforeUpdate(previous: ScrollSnapshotBoundaryProps) {
    if (previous.sessionId !== this.props.sessionId) previous.onLeave()
    return null
  }

  componentDidUpdate() {
    // React requires this lifecycle when getSnapshotBeforeUpdate is used.
  }

  componentWillUnmount() {
    this.props.onLeave()
  }

  render() {
    return this.props.children
  }
}

type VirtualViewport = {
  scrollTop: number
  viewportHeight: number
}

type VirtualTranscriptItem = {
  item: RenderItem
  index: number
}

type VirtualTranscriptWindow = {
  enabled: boolean
  beforeHeight: number
  afterHeight: number
  items: VirtualTranscriptItem[]
  offsets: number[]
  totalHeight: number
}

type ConversationFindMatch = {
  renderIndex: number
  renderItemKey: string
  occurrenceIndex: number
  query: string
}

const MAX_CONVERSATION_FIND_MATCHES = 1_000
const CONVERSATION_FIND_CONTENT_REFRESH_MS = 80

const sessionScrollSnapshots = new Map<string, SessionScrollSnapshot>()

export function resetSessionScrollSnapshotsForTests() {
  sessionScrollSnapshots.clear()
}

function isNearScrollBottom(element: HTMLElement) {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <=
    AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  )
}

function rememberSessionScroll(sessionId: string, element: HTMLElement, wasAtBottom = isNearScrollBottom(element)) {
  if (sessionScrollSnapshots.size >= MAX_SCROLL_SNAPSHOTS && !sessionScrollSnapshots.has(sessionId)) {
    const oldestSessionId = sessionScrollSnapshots.keys().next().value
    if (oldestSessionId) {
      sessionScrollSnapshots.delete(oldestSessionId)
    }
  }

  const containerTop = element.getBoundingClientRect().top
  const firstVisibleRow = !wasAtBottom && [...element.querySelectorAll<HTMLElement>('[data-chat-render-item-key]')]
    .find((row) => {
      const rect = row.getBoundingClientRect()
      return rect.height > 0 && rect.bottom > containerTop && rect.top < containerTop + element.clientHeight
    })
  sessionScrollSnapshots.set(sessionId, {
    scrollTop: element.scrollTop,
    wasAtBottom,
    anchor: firstVisibleRow ? {
      itemKey: firstVisibleRow.dataset.chatRenderItemKey!,
      offset: firstVisibleRow.getBoundingClientRect().top - containerTop,
    } : undefined,
  })
}

function getBottomScrollTop(element: HTMLElement) {
  return Math.max(0, element.scrollHeight - element.clientHeight)
}

function setScrollTopWithoutLayoutRead(element: HTMLElement, scrollTop: number) {
  element.scrollTop = Math.max(0, scrollTop)
}

function setScrollToBottomWithoutLayoutRead(element: HTMLElement) {
  element.scrollTop = SCROLL_BOTTOM_SENTINEL

  // Browsers clamp the large value to the true bottom without needing us to
  // synchronously read layout metrics. JSDOM test doubles do not clamp, so keep
  // the old numeric behavior there as a fallback.
  if (element.scrollTop === SCROLL_BOTTOM_SENTINEL) {
    element.scrollTop = getBottomScrollTop(element)
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function getRenderItemKey(item: RenderItem) {
  if (item.kind === 'tool_group' || item.kind === 'team_card') return item.id
  return item.message.id
}

/**
 * The moment a render item entered the transcript, used to tell which turn it
 * belongs to. A run starts with its first step; a card starts when its team
 * did. `0` means "unknown", which never counts as part of the current turn
 * unless the turn has no boundary at all.
 */
function renderItemTimestamp(item: RenderItem): number {
  if (item.kind === 'message') return item.message.timestamp
  if (item.kind === 'team_card') return item.startedAt
  const firstStep = item.steps[0]
  if (!firstStep) return item.toolCalls[0]?.timestamp ?? 0
  return firstStep.kind === 'tool' ? firstStep.toolCall.timestamp : firstStep.message.timestamp
}

function findConversationMatches(
  renderItems: RenderItem[],
  streamingText: string,
  query: string,
): ConversationFindMatch[] {
  const needle = query.toLocaleLowerCase()
  if (!needle) return []
  const matches: ConversationFindMatch[] = []

  renderItems.forEach((item, renderIndex) => {
    if (matches.length >= MAX_CONVERSATION_FIND_MATCHES || item.kind !== 'message') return
    const message = item.message
    if (message.type !== 'user_text' && message.type !== 'assistant_text') return
    let occurrenceIndex = 0
    const text = message.content.toLocaleLowerCase()
    let offset = text.indexOf(needle)
    while (offset !== -1 && matches.length < MAX_CONVERSATION_FIND_MATCHES) {
      matches.push({
        renderIndex,
        renderItemKey: getRenderItemKey(item),
        occurrenceIndex,
        query,
      })
      occurrenceIndex += 1
      offset = text.indexOf(needle, offset + needle.length)
    }
  })

  if (matches.length < MAX_CONVERSATION_FIND_MATCHES && streamingText.trim()) {
    const text = streamingText.toLocaleLowerCase()
    let occurrenceIndex = 0
    let offset = text.indexOf(needle)
    while (offset !== -1 && matches.length < MAX_CONVERSATION_FIND_MATCHES) {
      matches.push({
        renderIndex: renderItems.length,
        renderItemKey: STREAMING_ASSISTANT_NAVIGATION_KEY,
        occurrenceIndex,
        query,
      })
      occurrenceIndex += 1
      offset = text.indexOf(needle, offset + needle.length)
    }
  }

  return matches
}

function collectConversationFindRanges(root: Node, query: string) {
  const ranges: Range[] = []
  const needle = query.toLocaleLowerCase()
  if (!needle) return ranges
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT
      if (node.parentElement?.closest('[data-find-bar], script, style, noscript')) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  let textNode = walker.nextNode() as Text | null
  while (textNode) {
    const text = textNode.nodeValue?.toLocaleLowerCase() ?? ''
    let offset = text.indexOf(needle)
    while (offset !== -1 && ranges.length < MAX_CONVERSATION_FIND_MATCHES) {
      const range = document.createRange()
      range.setStart(textNode, offset)
      range.setEnd(textNode, offset + needle.length)
      ranges.push(range)
      offset = text.indexOf(needle, offset + needle.length)
    }
    if (ranges.length >= MAX_CONVERSATION_FIND_MATCHES) break
    textNode = walker.nextNode() as Text | null
  }
  return ranges
}

function clearConversationFindHighlights() {
  const highlights = (globalThis.CSS as any)?.highlights as Map<string, unknown> | undefined
  highlights?.delete('cc-find-results')
  highlights?.delete('cc-find-active')
}

function paintConversationFindHighlights(root: HTMLElement, match: ConversationFindMatch) {
  const highlights = (globalThis.CSS as any)?.highlights as Map<string, unknown> | undefined
  const HighlightCtor = (globalThis as any).Highlight
  if (!highlights || !HighlightCtor) return

  const resultRanges = collectConversationFindRanges(root, match.query)
  const target = Array.from(root.querySelectorAll<HTMLElement>('[data-chat-render-item-key]'))
    .find((node) => node.dataset.chatRenderItemKey === match.renderItemKey)
  const targetRanges = target
    ? resultRanges.filter((range) => target.contains(range.startContainer))
    : []
  const activeRange = targetRanges[Math.min(match.occurrenceIndex, Math.max(0, targetRanges.length - 1))]

  const results = new HighlightCtor()
  for (const range of resultRanges) results.add(range)
  highlights.set('cc-find-results', results)

  if (activeRange) {
    const active = new HighlightCtor()
    active.add(activeRange)
    active.priority = 1
    highlights.set('cc-find-active', active)
  } else {
    highlights.delete('cc-find-active')
  }
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function getShallowStringWeight(value: unknown, depth = 0): number {
  if (typeof value === 'string') return value.length
  if (!value || depth > 1) return 0
  if (Array.isArray(value)) {
    return value.slice(0, 12).reduce((total, item) => total + getShallowStringWeight(item, depth + 1), 0)
  }
  if (!isRecordValue(value)) return 0

  let total = 0
  for (const item of Object.values(value).slice(0, 24)) {
    total += getShallowStringWeight(item, depth + 1)
    if (total >= VIRTUALIZE_MIN_CONTENT_CHARS) return total
  }
  return total
}

function getMessageContentWeight(message: UIMessage): number {
  switch (message.type) {
    case 'user_text':
    case 'assistant_text':
    case 'thinking':
    case 'system':
      return message.content.length
    case 'tool_use':
      return getShallowStringWeight(message.input) + (message.partialInput?.length ?? 0)
    case 'tool_result':
      return getShallowStringWeight(message.content)
    case 'permission_request':
      return getShallowStringWeight(message.input) + (message.description?.length ?? 0)
    case 'error':
      return message.message.length
    case 'compact_summary':
      return message.title.length + (message.summary?.length ?? 0)
    case 'goal_event':
      return (message.objective?.length ?? 0) + (message.message?.length ?? 0)
    case 'memory_event':
      return (message.message?.length ?? 0) + message.files.reduce((total, file) => total + file.path.length + (file.summary?.length ?? 0), 0)
    case 'background_task':
      return getShallowStringWeight(message.task)
    case 'task_summary':
      return message.tasks.reduce((total, task) => total + task.subject.length + (task.activeForm?.length ?? 0), 0)
  }
}

function getRenderItemContentWeight(item: RenderItem): number {
  if (item.kind === 'message') return getMessageContentWeight(item.message)
  // The team card is a fixed-height summary, so it contributes no text weight
  // to the virtualization heuristic.
  if (item.kind === 'team_card') return 0
  return item.steps.reduce(
    (total, step) => total + getMessageContentWeight(step.kind === 'tool' ? step.toolCall : step.message),
    0,
  )
}

export function shouldVirtualizeRenderItems(
  metrics: VirtualRenderItemMetric[],
  touchH5 = isTouchH5Document(),
) {
  const minRenderItems = touchH5 ? TOUCH_H5_VIRTUALIZE_MIN_RENDER_ITEMS : VIRTUALIZE_MIN_RENDER_ITEMS
  const minContentChars = touchH5 ? TOUCH_H5_VIRTUALIZE_MIN_CONTENT_CHARS : VIRTUALIZE_MIN_CONTENT_CHARS
  if (metrics.length >= minRenderItems) return true

  let totalWeight = 0
  for (const metric of metrics) {
    totalWeight += metric.contentWeight
    if (totalWeight >= minContentChars) return true
  }
  return false
}

function countLineBreaksCapped(content: string, maxLines: number) {
  let lineBreaks = 0
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lineBreaks += 1
      if (lineBreaks >= maxLines) return lineBreaks
    }
  }
  return lineBreaks
}

function estimateTextHeight(content: string, baseHeight: number) {
  const sample = content.length > 12_000 ? content.slice(0, 12_000) : content
  const sampledLineBreaks = countLineBreaksCapped(sample, 900)
  const explicitLines = content.length > sample.length
    ? Math.ceil((sampledLineBreaks + 1) * (content.length / sample.length))
    : sampledLineBreaks + 1
  const wrappedLines = Math.ceil(content.length / 76)
  const estimated = baseHeight + Math.max(explicitLines, wrappedLines) * 22
  return clampNumber(estimated, VIRTUAL_MIN_ITEM_HEIGHT, VIRTUAL_MAX_ITEM_HEIGHT)
}

/* Base heights are the non-text chrome of one item, measured as a border box so
 * they match what the ResizeObserver reports. Post-rail that is:
 *   prompt   24 rail padding-top (the turn gap) + 8 padding-bottom
 *            + 26 bubble padding + 36 action bar = 94
 *   reply    8 rail padding-bottom + 36 action bar = 44 (the card is gone)
 * The action bar is 36 (mt-2 + h-7) and always reserves its space — it must not
 * collapse on hover, or the transcript shifts under the reader's cursor. */
function estimateMessageHeight(message: UIMessage): number {
  switch (message.type) {
    case 'user_text':
      return estimateTextHeight(message.content, message.attachments?.length ? 160 : 94)
    case 'assistant_text':
      return estimateTextHeight(message.content, 44)
    case 'thinking':
      return estimateTextHeight(message.content, 40)
    case 'tool_use':
      return clampNumber(92 + Math.ceil(getMessageContentWeight(message) / 120) * 18, 72, 2200)
    case 'tool_result':
      return clampNumber(88 + Math.ceil(getMessageContentWeight(message) / 120) * 18, 64, 2200)
    case 'background_task':
    case 'goal_event':
    case 'memory_event':
    case 'permission_request':
    case 'task_summary':
      return 110
    case 'compact_summary':
      return message.summary ? clampNumber(92 + Math.ceil(message.summary.length / 90) * 20, 80, 1800) : 70
    case 'error':
    case 'system':
      return 64
  }
}

/** A collapsed activity group is one header line, however many steps it holds:
 *  py-1 (8) + a 12.5px line (~18) + the turn's padding-bottom (8).
 *
 *  A group only renders its rows while it is still running, and a running group
 *  sits at the scroll anchor where items are mounted and measured — so estimates
 *  are only ever consulted for the settled, collapsed form, which is this line. */
const ACTIVITY_GROUP_COLLAPSED_HEIGHT = 34
/** Avatar row plus two text lines, plus the turn's padding-bottom. */
const TEAM_CARD_HEIGHT = 86
/** Collapsed coordination disclosure below the card adds one compact row. */
const TEAM_CARD_WITH_AUDIT_HEIGHT = 116

export function estimateRenderItemHeight(item: RenderItem): number {
  if (item.kind === 'message') {
    // 后台任务结束后的自动回复默认折叠成一行，点开才按正文高度算
    if (item.wakeReply) {
      return getDisclosure(item.message.id) === true
        ? estimateMessageHeight(item.message)
        : ACTIVITY_GROUP_COLLAPSED_HEIGHT
    }
    return estimateMessageHeight(item.message)
  }
  if (item.kind === 'team_card') {
    return item.coordinationToolCalls.length > 0
      ? TEAM_CARD_WITH_AUDIT_HEIGHT
      : TEAM_CARD_HEIGHT
  }
  // Agent dispatch groups keep their taller per-agent cards; everything else
  // collapses to the single-line activity header.
  const isAgentGroup = item.toolCalls.length > 0 && item.toolCalls.every((toolCall) => toolCall.toolName === 'Agent')
  if (!isAgentGroup) return ACTIVITY_GROUP_COLLAPSED_HEIGHT
  const textWeight = getRenderItemContentWeight(item)
  return clampNumber(92 + item.toolCalls.length * 78 + Math.ceil(textWeight / 140) * 16, 88, 2600)
}

function getMessageMetricSignature(message: UIMessage): string {
  switch (message.type) {
    case 'user_text':
      return `${message.type}:${message.content.length}:${message.attachments?.length ?? 0}:${message.pending ? 1 : 0}`
    case 'assistant_text':
    case 'thinking':
    case 'system':
      return `${message.type}:${message.content.length}`
    case 'tool_use':
      return `${message.type}:${message.toolName}:${message.toolUseId}:${message.partialInput?.length ?? 0}:${message.isPending ? 1 : 0}:${message.status ?? ''}`
    case 'tool_result':
      return `${message.type}:${message.toolUseId}:${message.isError ? 1 : 0}`
    case 'compact_summary':
      return `${message.type}:${message.phase ?? ''}:${message.title.length}:${message.summary?.length ?? 0}`
    case 'goal_event':
      return `${message.type}:${message.action}:${message.status ?? ''}:${message.objective?.length ?? 0}:${message.message?.length ?? 0}`
    case 'memory_event':
      return `${message.type}:${message.event}:${message.files.length}:${message.message?.length ?? 0}`
    case 'background_task':
      return `${message.type}:${message.task.taskId}:${message.task.status}:${message.task.updatedAt}`
    case 'permission_request':
      return `${message.type}:${message.requestId}:${message.toolUseId ?? ''}:${message.description?.length ?? 0}`
    case 'error':
      return `${message.type}:${message.code}:${message.message.length}`
    case 'task_summary':
      return `${message.type}:${message.tasks.length}:${message.tasks.map((task) => task.id).join(',')}`
  }
}

/**
 * Move measured heights from rows that disappeared to rows that appeared with
 * the same reload signature, in order. Rows that kept their key are untouched.
 *
 * A transcript reload after a reply, or a checkpoint refresh, can hand the same
 * messages back under new ids. Heights are keyed by id, so those rows would
 * fall back to estimates, and in a tool-heavy session the estimates run far
 * above the collapsed rows that were measured: the same scrollTop then lands
 * many turns above the tail (#1652, #1662).
 */
export function carryMeasuredHeightsToRenamedItems(
  heights: Map<string, number>,
  previousKeys: string[],
  previousSignatures: string[],
  nextKeys: string[],
  nextSignatures: string[],
): number {
  if (previousKeys.length === 0 || previousKeys === nextKeys) return 0
  const nextKeySet = new Set(nextKeys)
  const orphanedHeightsBySignature = new Map<string, number[]>()
  previousKeys.forEach((key, index) => {
    if (nextKeySet.has(key)) return
    const height = heights.get(key)
    const signature = previousSignatures[index]
    if (height === undefined || signature === undefined) return
    const queue = orphanedHeightsBySignature.get(signature)
    if (queue) queue.push(height)
    else orphanedHeightsBySignature.set(signature, [height])
  })
  if (orphanedHeightsBySignature.size === 0) return 0

  const previousKeySet = new Set(previousKeys)
  let carried = 0
  nextKeys.forEach((key, index) => {
    if (previousKeySet.has(key) || heights.has(key)) return
    const height = orphanedHeightsBySignature.get(nextSignatures[index] ?? '')?.shift()
    if (height === undefined) return
    heights.set(key, height)
    carried += 1
  })
  return carried
}

// Metric signatures summarize lengths for cheap estimates, not row identity:
// equal-length Markdown can have different geometry. Include disclosure state
// because renamed thinking/result rows may remount collapsed after being open.
function getRenderItemReloadSignature(item: RenderItem): string {
  if (item.kind !== 'message') return JSON.stringify(item)
  const message = item.message
  const foldable = message.type === 'thinking' || message.type === 'tool_result' || item.wakeReply === true
  const expanded = foldable ? getDisclosure(message.id) ?? false : false
  return JSON.stringify([{ ...message, id: undefined, timestamp: undefined }, expanded])
}

function haveSameRenderItemKeys(previous: string[], next: string[]): boolean {
  if (previous === next) return true
  if (previous.length !== next.length) return false
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index] !== next[index]) return false
  }
  return true
}

function getRenderItemMetricSignature(item: RenderItem): string {
  if (item.kind === 'message') return getMessageMetricSignature(item.message)
  if (item.kind === 'team_card') {
    return `team_card:${item.id}:${item.coordinationToolCalls.length}`
  }
  return item.steps
    .map((step) => getMessageMetricSignature(step.kind === 'tool' ? step.toolCall : step.message))
    .join('|')
}

function findVirtualStartIndex(offsets: number[], target: number) {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if ((offsets[mid + 1] ?? offsets[mid] ?? 0) < target) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return Math.max(0, low)
}

function findVirtualEndIndex(offsets: number[], target: number) {
  let low = 0
  let high = offsets.length - 1
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if ((offsets[mid] ?? 0) <= target) {
      low = mid + 1
    } else {
      high = mid
    }
  }
  return clampNumber(low + 1, 0, offsets.length - 1)
}

export function buildVirtualItemOffsets(
  itemKeys: string[],
  metrics: VirtualRenderItemMetric[],
  measuredHeights: Map<string, number>,
) {
  const offsets = new Array<number>(itemKeys.length + 1)
  offsets[0] = 0
  for (let index = 0; index < itemKeys.length; index += 1) {
    const measuredHeight = measuredHeights.get(itemKeys[index]!)
    const height = measuredHeight && measuredHeight > 0
      ? measuredHeight
      : metrics[index]?.estimatedHeight ?? VIRTUAL_MIN_ITEM_HEIGHT
    offsets[index + 1] = offsets[index]! + height
  }
  return offsets
}

const CONVERSATION_NAVIGATION_READING_ANCHOR_RATIO = 0.25

export function getActiveConversationNavigationItemId(
  items: ConversationNavigationItem[],
  offsets: number[],
  scrollTop: number,
  viewportHeight: number,
) {
  if (items.length === 0) return null
  if (scrollTop <= 1) return items[0]!.id
  const readingAnchor = scrollTop + viewportHeight * CONVERSATION_NAVIGATION_READING_ANCHOR_RATIO
  let activeItem = items[0]!

  for (const item of items) {
    if ((offsets[item.renderIndex] ?? 0) > readingAnchor) break
    activeItem = item
  }

  return activeItem.id
}

export function getConversationNavigationTargetScrollTop(
  item: ConversationNavigationItem,
  offsets: number[],
  viewportHeight: number,
  totalHeight: number,
) {
  const targetTop = offsets[item.renderIndex] ?? 0
  const readingAnchor = viewportHeight * CONVERSATION_NAVIGATION_READING_ANCHOR_RATIO
  return clampNumber(targetTop - readingAnchor, 0, Math.max(0, totalHeight - viewportHeight))
}

function buildVirtualTranscriptWindow(
  renderItems: RenderItem[],
  itemKeys: string[],
  metrics: VirtualRenderItemMetric[],
  measuredHeights: Map<string, number>,
  viewport: VirtualViewport,
  overscanPx: number,
  anchor?: SessionScrollAnchor | null,
): VirtualTranscriptWindow {
  const offsets = buildVirtualItemOffsets(itemKeys, metrics, measuredHeights)
  const totalHeight = offsets[renderItems.length] ?? 0
  if (!shouldVirtualizeRenderItems(metrics)) {
    return {
      enabled: false,
      beforeHeight: 0,
      afterHeight: 0,
      items: renderItems.map((item, index) => ({ item, index })),
      offsets,
      totalHeight,
    }
  }

  const viewportHeight = viewport.viewportHeight || VIRTUAL_DEFAULT_VIEWPORT_HEIGHT
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight)
  const anchorIndex = anchor ? itemKeys.indexOf(anchor.itemKey) : -1
  // Keep the saved row mounted even if its async content is temporarily shorter
  // than the saved intra-row offset. DOM alignment below owns the final pixels.
  const anchorTop = anchorIndex >= 0
    ? offsets[anchorIndex]! + Math.min(-anchor!.offset, offsets[anchorIndex + 1]! - offsets[anchorIndex]! - 1)
    : viewport.scrollTop
  const scrollTop = clampNumber(anchorTop, 0, maxScrollTop)
  const windowTop = Math.max(0, scrollTop - overscanPx)
  const windowBottom = Math.min(totalHeight, scrollTop + viewportHeight + overscanPx)
  const startIndex = findVirtualStartIndex(offsets, windowTop)
  const endIndex = Math.min(renderItems.length, findVirtualEndIndex(offsets, windowBottom))

  return {
    enabled: true,
    beforeHeight: offsets[startIndex] ?? 0,
    afterHeight: totalHeight - (offsets[endIndex] ?? totalHeight),
    items: renderItems.slice(startIndex, endIndex).map((item, offset) => ({
      item,
      index: startIndex + offset,
    })),
    offsets,
    totalHeight,
  }
}

const VIRTUAL_SPACER_CHUNK_PX = 800

function VirtualSpacer({ height, position }: { height: number; position: 'top' | 'bottom' }) {
  if (height <= 0) return null
  if (height <= VIRTUAL_SPACER_CHUNK_PX) {
    return (
      <div
        data-virtual-spacer={position}
        aria-hidden="true"
        style={{ height }}
      />
    )
  }

  // Splitting the spacer into chunks lets the WebView keep painting placeholder
  // boxes via content-visibility:auto + contain-intrinsic-size, instead of
  // leaving a single huge area unpainted while React reconciles the window.
  const chunkCount = Math.max(1, Math.ceil(height / VIRTUAL_SPACER_CHUNK_PX))
  const chunkHeight = Math.floor(height / chunkCount)
  const remainder = height - chunkHeight * chunkCount
  const chunks: Array<{ key: string; px: number }> = []
  for (let i = 0; i < chunkCount; i++) {
    const px = i === chunkCount - 1 ? chunkHeight + remainder : chunkHeight
    chunks.push({ key: `${position}-${i}`, px })
  }

  return (
    <div
      data-virtual-spacer={position}
      aria-hidden="true"
      className="overflow-hidden"
      // Fractional zoom rounds each chunk independently. Keep their accumulated
      // error out of scrollHeight so native scrolling cannot toggle the window.
      style={{ height }}
    >
      {chunks.map((chunk) => (
        <div
          key={chunk.key}
          data-virtual-spacer-chunk={position}
          style={{
            height: chunk.px,
            contentVisibility: 'auto',
            containIntrinsicSize: `0 ${chunk.px}px`,
          }}
        />
      ))}
    </div>
  )
}

const MeasuredRenderItem = memo(function MeasuredRenderItem({
  itemKey,
  onHeightChange,
  highlighted,
  railPosition,
  children,
}: {
  itemKey: string
  onHeightChange: (itemKey: string, height: number, initial?: boolean) => void
  highlighted: boolean
  railPosition: TurnRailPosition
  children: ReactNode
}) {
  const itemRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const node = itemRef.current
    if (!node) return undefined

    const initialHeight = node.getBoundingClientRect().height
    if (initialHeight > 0) onHeightChange(itemKey, initialHeight, true)
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      // Border box, not `contentRect`: the rail's padding is the gap between
      // turns, so a content-box read would under-measure every item by that gap
      // and the virtualizer's offsets would drift low over a long transcript.
      // `borderBoxSize` predates every browser we ship on; the fallback is for
      // environments that stub ResizeObserver with `contentRect` alone.
      const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
      if (Number.isFinite(height) && height > 0) {
        // Keep the layout engine's fractional CSS-pixel measurement. Rounding
        // each sample upward creates a discontinuity at every integer boundary:
        // at fractional Windows DPI a stable row reported as 117.99/118.01px
        // then becomes 118/119px, bypasses the sub-pixel guard below, and makes
        // the virtual window repaint forever (#1223).
        onHeightChange(itemKey, height)
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [itemKey, onHeightChange])

  return (
    <div
      ref={itemRef}
      data-virtual-message-item={itemKey}
      data-chat-render-item-key={itemKey}
      data-turn-rail={railPosition}
      className={`${CHAT_RENDER_ITEM_CLASS} ${turnRailClass(railPosition)} ${highlighted ? 'chat-render-item--navigation-target' : ''}`}
    >
      {children}
    </div>
  )
})

export function MessageList({
  sessionId,
  visible = true,
  compact = false,
  mobileLayout = false,
  decisionsInComposer = false,
  onOpenAgentRun,
  resolveAgentActivityTarget,
}: MessageListProps = {}) {
  const activeTabId = useTabStore((s) => s.activeTabId)
  const resolvedSessionId = sessionId ?? activeTabId
  const isWorkspacePanelOpen = useWorkspaceStore((state) =>
    resolvedSessionId ? (state.bySession[resolvedSessionId]?.layout ?? 'hidden') !== 'hidden' : false,
  )
  const workspacePanelOrigin = useWorkspaceStore((state) =>
    resolvedSessionId ? state.bySession[resolvedSessionId]?.origin ?? null : null,
  )
  const sessionState = useChatStore((s) =>
    resolvedSessionId ? s.sessions[resolvedSessionId] : undefined,
  )
  const unreadCompletion = useChatStore((s) =>
    resolvedSessionId ? s.unreadCompletions.get(resolvedSessionId) : undefined,
  )
  const branchSession = useSessionStore((s) => s.branchSession)
  const reloadHistory = useChatStore((s) => s.reloadHistory)
  const loadOlderHistory = useChatStore((s) => s.loadOlderHistory)
  const queueComposerPrefill = useChatStore((s) => s.queueComposerPrefill)
  const memberSessionTeam = useTeamStore((s) => (
    resolvedSessionId ? s.getTeamByMemberSessionId(resolvedSessionId) : null
  ))
  const isMemberSession = Boolean(memberSessionTeam)
  const isAgentRunTab = useTabStore((s) => s.tabs.some((tab) => (
    tab.sessionId === resolvedSessionId &&
    (tab.type === 'subagent' || tab.type === 'team-member')
  )))
  const isDirectAgentSession = isMemberSession || isAgentRunTab
  const isSideChatSession = useSideChatStore((s) => Boolean(resolvedSessionId && s.entries[resolvedSessionId]))
  const teamWorkbench = useTeamStore((s) =>
    resolvedSessionId ? s.workbenchesBySession[resolvedSessionId] : undefined,
  )
  const activeTeamName = useTeamStore((s) => (
    resolvedSessionId ? s.teamNameBySession[resolvedSessionId] : undefined
  ))
  const activeTeamStartedAt = useTeamStore((s) => (
    resolvedSessionId ? s.activeTeamStartedAtBySession[resolvedSessionId] : undefined
  ))
  const interruptedTeamName = useTeamPlanStore(interruptedTeamNameOf(resolvedSessionId))
  const teamSnapshot = useMemo(() => {
    const snapshots = teamWorkbench?.snapshots
    return snapshots?.length
      ? snapshotWithHistoricalMembers(snapshots, snapshots.length - 1)
      : undefined
  }, [teamWorkbench?.snapshots])
  const teamTaskWindows = useMemo(
    () => teamTaskWindowsForSnapshot(teamSnapshot, activeTeamStartedAt),
    [activeTeamStartedAt, teamSnapshot],
  )
  const openTeamWorkbench = useCallback((leadSessionId: string, teamName: string) => {
    useTabStore.getState().openTeamWorkbenchTab(leadSessionId, teamName)
  }, [])
  const teamMemberNames = useMemo(() => {
    if (!teamSnapshot) return undefined
    return new Set(teamSnapshot.team.members.flatMap((member) =>
      member.name ? [member.name] : [],
    ))
  }, [teamSnapshot])
  const addToast = useUIStore((s) => s.addToast)
  const messages = sessionState?.messages ?? EMPTY_MESSAGES
  const checkpointHistoryReady = sessionState?.historyStatus === 'ready' && sessionState?.historyHydrated === true
  const chatState = sessionState?.chatState ?? 'idle'
  const isPreparingTurn = Boolean(sessionState?.isPreparingTurn)
  const historyMutationEpoch = sessionState?.historyMutationEpoch ?? 0
  const streamingText = sessionState?.streamingText ?? ''
  const streamingToolInput = sessionState?.streamingToolInput ?? ''
  const activeThinkingId = sessionState?.activeThinkingId ?? null
  // Codex 的 Responses 流程在整个回合期间都展示推理：增量停止后正文仍保持
  // 展开，回合结束（会话回到空闲）后才折叠为总结行，回合中途不因新推理开始
  // 而收起上一条，回合边界取最后一条用户消息。
  const isTurnRunning = chatState !== 'idle' || isPreparingTurn
  const lastUserMessageTimestamp = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const entry = messages[index]
      if (entry?.type === 'user_text') return entry.timestamp
    }
    return 0
  }, [messages])
  // Codex 风格的折叠摘要：思考块的时长取自它与下一条消息的时间戳差；
  // 流式中的末尾思考块没有下一条消息，折叠行退回「思考中」标签。
  const thinkingDurations = useMemo(() => {
    const durations = new Map<string, number>()
    for (let index = 0; index < messages.length - 1; index++) {
      const entry = messages[index]
      if (!entry || entry.type !== 'thinking') continue
      const durationMs = (messages[index + 1]?.timestamp ?? 0) - entry.timestamp
      if (durationMs > 0) durations.set(entry.id, durationMs)
    }
    return durations
  }, [messages])
  const hasApiRetry = Boolean(sessionState?.apiRetry)
  const hasStreamingFallback = Boolean(sessionState?.streamingFallback)
  const agentTaskNotifications = sessionState?.agentTaskNotifications ?? EMPTY_AGENT_TASK_NOTIFICATIONS
  const backgroundAgentTasks = sessionState?.backgroundAgentTasks
  const agentTaskStatuses = useMemo<Record<string, BackgroundAgentTask['status']>>(() => {
    const statuses: Record<string, BackgroundAgentTask['status']> = {}
    for (const task of Object.values(backgroundAgentTasks ?? {})) {
      if (task.toolUseId) statuses[task.toolUseId] = task.status
    }
    return statuses
  }, [backgroundAgentTasks])
  const hasRunningBackgroundTasks = hasAnyRunningBackgroundTasks(backgroundAgentTasks)
  const pendingPermissions = listPendingPermissions(sessionState)
  const activeAskUserQuestionToolUseId =
    pendingPermissions
      .find((permission) => permission.toolName === 'AskUserQuestion')?.toolUseId ?? null
  const hasPendingPermissionCard = pendingPermissions.some(
    (permission) => permission.toolName !== 'AskUserQuestion',
  )
  // Whether content growth belongs to the turn that is running. Idle growth is
  // usually something the reader opened, which must keep their place (#1177);
  // a shrink from collapsing a block still re-pins in either state.
  const shouldFollowContentGrowth =
    isPreparingTurn ||
    streamingText.trim().length > 0 ||
    chatState === 'streaming' ||
    chatState === 'compacting' ||
    chatState === 'tool_executing' ||
    hasPendingPermissionCard ||
    (chatState === 'thinking' && Boolean(activeThinkingId))
  const appearanceSignature = useChatAppearanceStore((state) =>
    `${state.appearance.font}:${state.appearance.fontSize}:${state.appearance.width}`,
  )
  const previousAppearanceSignature = useRef(appearanceSignature)
  const pendingAppearanceScrollTop = useRef<number | null>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  // Select session caches during render, before child layout effects measure.
  // Rebinding a shared ref in the parent effect writes the new rows into the
  // outgoing session's cache and loses their initial measurements.
  const virtualItemHeights = useMemo(() => resolvedSessionId
    ? getHeightsForSession(resolvedSessionId)
    : new Map<string, number>(), [resolvedSessionId])
  const virtualItemMetricCache = useMemo(() => resolvedSessionId
    ? getMetricsForSession(resolvedSessionId)
    : new Map<string, VirtualRenderItemMetric>(), [resolvedSessionId])
  const liveFollowFrameRef = useRef<number | null>(null)
  const navigationHighlightTimerRef = useRef<number | null>(null)
  const workspaceOriginRestoreFrameRef = useRef<number | null>(null)
  const conversationFindRefreshTimerRef = useRef<number | null>(null)
  const conversationFindLastRefreshAtRef = useRef(0)
  const workspaceOriginSessionRef = useRef(resolvedSessionId)
  const lastAutoScrollAtRef = useRef(0)
  const lastContentResizeFollowHeightRef = useRef<number | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const restoringBottomRef = useRef(false)
  const restoringScrollAnchorRef = useRef<SessionScrollAnchor | null>(null)
  const isProgrammaticScrollingRef = useRef(false)
  const ignoreProgrammaticScrollUntilRef = useRef(0)
  const ignoreProgrammaticScrollTopRef = useRef<number | null>(null)
  const userScrollIntentUntilRef = useRef(0)
  const disclosureLayoutUntilRef = useRef(0)
  // Content height at the moment a transcript disclosure was clicked, so the
  // follow decision can tell an expansion from a collapse.
  const disclosureHeightBeforeRef = useRef(0)
  // When the transcript or its scroller changed height. Native scroll anchoring
  // fires a scroll event for that adjustment; treating it as reader intent is
  // what used to switch follow off after any collapse.
  const layoutChangeAtRef = useRef(0)
  const lastSessionIdRef = useRef<string | null | undefined>(undefined)
  const lastTailMessageIdBySessionRef = useRef(new Map<string, string | null>())
  const lastLiveFollowInputRef = useRef({
    sessionId: resolvedSessionId,
    messageCount: messages.length,
    streamingText,
    streamingToolInput,
  })
  const t = useTranslation()
  // 展开状态按会话和落盘检查点保存，不随消息行 ID 变化。
  const [expandedChangeCards, setExpandedChangeCards] = useState<Record<string, boolean>>({})
  const [turnActionErrors, setTurnActionErrors] = useState<Record<string, string>>({})
  const [branchingMessageId, setBranchingMessageId] = useState<string | null>(null)
  const [rewindingTurnId, setRewindingTurnId] = useState<string | null>(null)
  const [turnUndoConfirmTarget, setTurnUndoConfirmTarget] = useState<{ sessionId: string; checkpointId: string } | null>(null)
  const [isAwayFromLatest, setIsAwayFromLatest] = useState(false)
  const [virtualViewport, setVirtualViewport] = useState<VirtualViewport>({
    scrollTop: SCROLL_BOTTOM_SENTINEL,
    viewportHeight: VIRTUAL_DEFAULT_VIEWPORT_HEIGHT,
  })
  const [measuredItemsVersion, setMeasuredItemsVersion] = useState(0)
  const [highlightedNavigationItemKey, setHighlightedNavigationItemKey] = useState<string | null>(null)
  /** The tool call inside the highlighted item a jump is about, if any. */
  const [highlightedNavigationToolUseId, setHighlightedNavigationToolUseId] = useState<string | null>(null)
  const [programmaticNavigationItemId, setProgrammaticNavigationItemId] = useState<string | null>(null)
  const [activeConversationFindMatch, setActiveConversationFindMatch] = useState<ConversationFindMatch | null>(null)
  const conversationFindMatchesRef = useRef<ConversationFindMatch[]>([])
  const [messageListWidth, setMessageListWidth] = useState<number | null>(null)
  const turnInProgress =
    isPreparingTurn ||
    chatState !== 'idle' ||
    streamingText.trim().length > 0 ||
    Boolean(activeThinkingId) ||
    Boolean(sessionState?.activeToolUseId) ||
    Boolean(sessionState?.activeToolName)
  const isLean = useSessionStore(state => state.sessions.some(session => session.id === resolvedSessionId && session.agentProfile === 'lean'))
  const branchActionsDisabled = isLean || isDirectAgentSession || turnInProgress || hasRunningBackgroundTasks
  const hasCompactingDivider = messages.some((message) =>
    message.type === 'compact_summary' && message.phase === 'compacting')

  useEffect(() => () => {
    if (liveFollowFrameRef.current !== null) {
      cancelAnimationFrame(liveFollowFrameRef.current)
    }
    if (navigationHighlightTimerRef.current !== null) {
      window.clearTimeout(navigationHighlightTimerRef.current)
    }
    if (workspaceOriginRestoreFrameRef.current !== null) {
      cancelAnimationFrame(workspaceOriginRestoreFrameRef.current)
    }
    if (conversationFindRefreshTimerRef.current !== null) {
      window.clearTimeout(conversationFindRefreshTimerRef.current)
    }
    clearConversationFindHighlights()
  }, [])

  useLayoutEffect(() => {
    const messageList = messageListRef.current
    if (!messageList) return

    const updateWidth = (width: number) => {
      const roundedWidth = Math.round(width)
      if (roundedWidth <= 0) return
      setMessageListWidth((current) => current === roundedWidth ? current : roundedWidth)
    }

    updateWidth(messageList.getBoundingClientRect().width || messageList.clientWidth)
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((candidate) => candidate.target === messageList)
      if (entry) updateWidth(entry.contentRect.width)
    })
    observer.observe(messageList)
    return () => observer.disconnect()
  }, [])

  const syncVirtualViewportFromContainer = useCallback((container: HTMLElement) => {
    const nextScrollTop = container.scrollTop
    const nextViewportHeight = container.clientHeight || VIRTUAL_DEFAULT_VIEWPORT_HEIGHT
    setVirtualViewport((current) => {
      if (
        Math.abs(current.scrollTop - nextScrollTop) < 1 &&
        Math.abs(current.viewportHeight - nextViewportHeight) < 1
      ) {
        return current
      }
      return {
        scrollTop: nextScrollTop,
        viewportHeight: nextViewportHeight,
      }
    })
  }, [])

  const scrollToBottom = useCallback(() => {
    restoringScrollAnchorRef.current = null
    restoringBottomRef.current = true
    shouldAutoScrollRef.current = true
    // An explicit return to the latest supersedes any older gesture: the
    // follow this asks for must not be suppressed by its 500ms intent window.
    userScrollIntentUntilRef.current = 0
    isProgrammaticScrollingRef.current = true
    ignoreProgrammaticScrollUntilRef.current = performance.now() + 250
    lastAutoScrollAtRef.current = performance.now()
    const container = scrollContainerRef.current
    if (container) {
      setScrollToBottomWithoutLayoutRead(container)
      ignoreProgrammaticScrollTopRef.current = container.scrollTop
    }
    setVirtualViewport((current) => ({
      scrollTop: SCROLL_BOTTOM_SENTINEL,
      viewportHeight: current.viewportHeight,
    }))
    if (container && resolvedSessionId) {
      sessionScrollSnapshots.set(resolvedSessionId, {
        scrollTop: container.scrollTop,
        wasAtBottom: true,
      })
    }
    setIsAwayFromLatest(false)
    // Keep this path to one native scroll write. A second write in the next
    // frame can fight Chromium's scroll anchoring at fractional Windows DPI.
    requestAnimationFrame(() => {
      isProgrammaticScrollingRef.current = false
    })
  }, [resolvedSessionId])

  const requestLiveFollow = useCallback(() => {
    if (!shouldAutoScrollRef.current || liveFollowFrameRef.current !== null) return

    liveFollowFrameRef.current = requestAnimationFrame(() => {
      liveFollowFrameRef.current = null
      const container = scrollContainerRef.current
      if (!container || !shouldAutoScrollRef.current) return

      const bottomScrollTop = getBottomScrollTop(container)
      const bottomGap = bottomScrollTop - container.scrollTop
      if (Math.abs(bottomGap) > LIVE_FOLLOW_BOTTOM_GAP_TOLERANCE_PX) {
        isProgrammaticScrollingRef.current = true
        ignoreProgrammaticScrollUntilRef.current = performance.now() + 250
        lastAutoScrollAtRef.current = performance.now()
        setScrollTopWithoutLayoutRead(container, bottomScrollTop)
        ignoreProgrammaticScrollTopRef.current = container.scrollTop
        setVirtualViewport((current) => ({
          scrollTop: container.scrollTop,
          viewportHeight: container.clientHeight || current.viewportHeight || VIRTUAL_DEFAULT_VIEWPORT_HEIGHT,
        }))
        requestAnimationFrame(() => {
          isProgrammaticScrollingRef.current = false
        })
      }

      if (resolvedSessionId) {
        sessionScrollSnapshots.set(resolvedSessionId, {
          scrollTop: container.scrollTop,
          wasAtBottom: true,
        })
      }
      setIsAwayFromLatest(false)
    })
  }, [resolvedSessionId])

  const releaseBottomRestoration = useCallback(() => {
    restoringBottomRef.current = false
    // A reader action can arrive between a layout observer and its queued
    // frame. Cancel that frame: the reader is taking the view back, and any
    // later height change schedules its own.
    if (liveFollowFrameRef.current !== null) {
      cancelAnimationFrame(liveFollowFrameRef.current)
      liveFollowFrameRef.current = null
    }
  }, [])

  const flushMeasuredHeightVersion = useCallback(() => {
    setMeasuredItemsVersion((version) => version + 1)
  }, [])

  const handleVirtualItemHeightChange = useCallback((itemKey: string, height: number, initial = false) => {
    const measuredHeight = clampNumber(height, VIRTUAL_MIN_ITEM_HEIGHT, VIRTUAL_MAX_ITEM_HEIGHT)
    const previousHeight = virtualItemHeights.get(itemKey)
    if (
      previousHeight !== undefined &&
      Math.abs(previousHeight - measuredHeight) <= RESIZE_OBSERVER_JITTER_MAX_DELTA_PX
    ) return

    virtualItemHeights.set(itemKey, measuredHeight)
    layoutChangeAtRef.current = performance.now()
    // A row changing height while the reader follows the tail moves the bottom.
    // Re-pin whatever caused it (a permission card, a reloaded transcript
    // measuring in after the reply, a tool result settling), not only live
    // output: content-resize follow is otherwise off in idle reading sessions.
    // Growth the reader just asked for by opening a block stays theirs (#1177).
    if (shouldAutoScrollRef.current && performance.now() >= disclosureLayoutUntilRef.current) {
      requestLiveFollow()
    }

    // Mount measurements commit before paint; observer measurements must update
    // offsets and restore the reading anchor in the same frame as the new height.
    if (initial) flushMeasuredHeightVersion()
    else flushSync(flushMeasuredHeightVersion)
  }, [flushMeasuredHeightVersion, requestLiveFollow, virtualItemHeights])

  const updateAutoScrollState = useCallback(() => {
    // Ignore scroll events triggered by our own programmatic scrolling to
    // prevent the jump-to-latest button from flickering during auto-scroll.
    const container = scrollContainerRef.current
    if (!container) return
    if (restoringScrollAnchorRef.current) {
      // Native anchoring/scroll clamping can emit scroll during remeasurement.
      // Only an explicit reader action ends restoration, not a timer or resize.
      syncVirtualViewportFromContainer(container)
      return
    }
    const matchesProgrammaticScrollTop =
      ignoreProgrammaticScrollTopRef.current !== null &&
      Math.abs(container.scrollTop - ignoreProgrammaticScrollTopRef.current) < 1
    const shouldIgnoreRecentProgrammaticScroll =
      matchesProgrammaticScrollTop &&
      (
        isProgrammaticScrollingRef.current ||
        performance.now() < ignoreProgrammaticScrollUntilRef.current
      )
    if (shouldIgnoreRecentProgrammaticScroll) {
      syncVirtualViewportFromContainer(container)
      return
    }
    const now = performance.now()
    const layoutChangedRecently =
      now - layoutChangeAtRef.current < 300 && now >= userScrollIntentUntilRef.current
    if (shouldAutoScrollRef.current && layoutChangedRecently) {
      // A block collapsing above the reader or an image settling changes the
      // content height; the browser then adjusts scrollTop and emits a scroll
      // event. That is not the reader leaving the tail, so keep following and
      // put the bottom back where it belongs.
      syncVirtualViewportFromContainer(container)
      requestLiveFollow()
      return
    }
    if (performance.now() < userScrollIntentUntilRef.current) {
      setProgrammaticNavigationItemId(null)
    }
    syncVirtualViewportFromContainer(container)
    const isAtBottom = isNearScrollBottom(container)
    const isFollowingLayoutShift =
      shouldAutoScrollRef.current &&
      !isAtBottom &&
      (restoringBottomRef.current || (
        hasPendingPermissionCard && performance.now() >= userScrollIntentUntilRef.current
      ))
    if (isFollowingLayoutShift) return

    shouldAutoScrollRef.current = isAtBottom
    setIsAwayFromLatest(!isAtBottom)

    if (resolvedSessionId) {
      rememberSessionScroll(resolvedSessionId, container, isAtBottom)
    }
  }, [hasPendingPermissionCard, requestLiveFollow, resolvedSessionId, syncVirtualViewportFromContainer])

  /**
   * Expanding a collapsed block is the reader rearranging their own view, not
   * the model producing output — so the live-follow must not treat the height
   * jump as new content and yank the transcript to the bottom (#1177). Browser
   * scroll anchoring already keeps the clicked row where it is; this only has to
   * stop `requestLiveFollow` from overriding it for that one frame.
   *
   * Deliberately not `userScrollIntentUntilRef`: that one is set by any
   * pointerdown on the scroller, so reusing it would suppress content-resize
   * follow on every stray click and turn "no jump" into "randomly stops
   * following".
   */
  const handleDisclosureToggle = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const disclosure = target.closest<HTMLElement>(CHAT_DISCLOSURE_SELECTOR)
    if (!disclosure) return

    releaseBottomRestoration()
    restoringScrollAnchorRef.current = null

    // A collapse above a reader who was following the tail must stay pinned;
    // an expansion made while reading older content keeps that spot. The click
    // handler runs before the layout change, so remember the current height for
    // the fallback when React has already swapped the row's DOM.
    const wasFollowing = shouldAutoScrollRef.current
    disclosureHeightBeforeRef.current = scrollContainerRef.current?.scrollHeight ?? 0
    disclosureLayoutUntilRef.current = performance.now() + DISCLOSURE_FOLLOW_SUPPRESS_MS

    // Suppression only covers the resize frame. Once the block is open the
    // container is no longer at the bottom, and the next streamed token would
    // pull it back down and throw the reader out again — so re-decide whether
    // we are still following, exactly as a wheel gesture would.
    requestAnimationFrame(() => {
      // The expansion's resize has landed by now, so hand follow back before the
      // next token arrives — suppression must never outlive the reader's click.
      disclosureLayoutUntilRef.current = 0
      const container = scrollContainerRef.current
      if (!container) return
      // `aria-expanded` was flipped by the click's re-render; it says which
      // direction the row went even when a late frame already changed the
      // measured height. A disclosure without the attribute falls back to the
      // height comparison below.
      const ariaExpanded = disclosure.isConnected
        ? disclosure.getAttribute('aria-expanded')
        : null
      const expanding = ariaExpanded === null
        ? container.scrollHeight > disclosureHeightBeforeRef.current + RESIZE_OBSERVER_JITTER_MAX_DELTA_PX
        : ariaExpanded === 'true'
      const atBottom = wasFollowing && !expanding ? true : isNearScrollBottom(container)
      shouldAutoScrollRef.current = atBottom
      setIsAwayFromLatest(!atBottom)
      syncVirtualViewportFromContainer(container)
      if (atBottom) requestLiveFollow()
    })
  }, [releaseBottomRestoration, requestLiveFollow, syncVirtualViewportFromContainer])

  const markUserScrollIntent = useCallback(() => {
    releaseBottomRestoration()
    restoringScrollAnchorRef.current = null
    userScrollIntentUntilRef.current = performance.now() + USER_SCROLL_INTENT_WINDOW_MS
  }, [releaseBottomRestoration])

  const handleWheelScrollIntent = useCallback((event: { deltaY: number }) => {
    markUserScrollIntent()
    if (event.deltaY < 0) {
      // Stop following; visibility is decided by the measured scroll position,
      // so a wheel tick while already at the bottom never shows the button.
      shouldAutoScrollRef.current = false
    }
  }, [markUserScrollIntent])

  const handleKeyDownScrollIntent = useCallback((event: { key: string; shiftKey: boolean }) => {
    const isUpwardScrollKey =
      event.key === 'ArrowUp' ||
      event.key === 'PageUp' ||
      event.key === 'Home' ||
      (event.key === ' ' && event.shiftKey)
    const isScrollKey = isUpwardScrollKey ||
      event.key === 'ArrowDown' ||
      event.key === 'PageDown' ||
      event.key === 'End' ||
      event.key === ' '
    if (!isScrollKey) return

    markUserScrollIntent()
    if (isUpwardScrollKey) {
      shouldAutoScrollRef.current = false
    }
  }, [markUserScrollIntent])

  useLayoutEffect(() => {
    if (lastSessionIdRef.current !== resolvedSessionId) {
      const snapshot = resolvedSessionId ? sessionScrollSnapshots.get(resolvedSessionId) : undefined
      restoringScrollAnchorRef.current = snapshot?.wasAtBottom ? null : snapshot?.anchor ?? null
      shouldAutoScrollRef.current = snapshot?.wasAtBottom ?? true
      restoringBottomRef.current = shouldAutoScrollRef.current
      lastSessionIdRef.current = resolvedSessionId
      setProgrammaticNavigationItemId(null)
      // Interaction intent belongs to the transcript the reader was looking
      // at; the next session restores its own bottom/reading intent.
      userScrollIntentUntilRef.current = 0
      if (resolvedSessionId) getHeightsForSession(resolvedSessionId, appearanceSignature)
      lastContentResizeFollowHeightRef.current = null
      if (liveFollowFrameRef.current !== null) {
        cancelAnimationFrame(liveFollowFrameRef.current)
        liveFollowFrameRef.current = null
      }
      setMeasuredItemsVersion((version) => version + 1)

      const container = scrollContainerRef.current
      if (container && snapshot && !snapshot.wasAtBottom) {
        if (!snapshot.anchor) {
          ignoreProgrammaticScrollUntilRef.current = performance.now() + 250
          ignoreProgrammaticScrollTopRef.current = snapshot.scrollTop
          setScrollTopWithoutLayoutRead(container, snapshot.scrollTop)
        }
        setVirtualViewport((current) => ({
          scrollTop: snapshot.scrollTop,
          viewportHeight: container.clientHeight || current.viewportHeight || VIRTUAL_DEFAULT_VIEWPORT_HEIGHT,
        }))
        setIsAwayFromLatest(true)
      } else if (container) {
        // Switch to a session we were at the bottom of (or first visit): write
        // the bottom sentinel without going through scrollToBottom's read path,
        // so we never force a layout flush during the switch's commit.
        ignoreProgrammaticScrollUntilRef.current = performance.now() + 250
        ignoreProgrammaticScrollTopRef.current = null
        lastAutoScrollAtRef.current = performance.now()
        shouldAutoScrollRef.current = true
        setScrollToBottomWithoutLayoutRead(container)
        setVirtualViewport((current) => ({
          scrollTop: SCROLL_BOTTOM_SENTINEL,
          viewportHeight: container.clientHeight || current.viewportHeight || VIRTUAL_DEFAULT_VIEWPORT_HEIGHT,
        }))
        setIsAwayFromLatest(false)
        if (resolvedSessionId) {
          sessionScrollSnapshots.set(resolvedSessionId, {
            scrollTop: container.scrollTop,
            wasAtBottom: true,
          })
        }
      } else {
        // No container yet (initial mount before ref settles): fall back to the
        // existing scrollToBottom path which is safe pre-mount.
        scrollToBottom()
      }
    }
  }, [appearanceSignature, resolvedSessionId, scrollToBottom])

  const tailMessage = messages[messages.length - 1] ?? null
  const tailMessageId = tailMessage?.id ?? null
  const tailMessageType = tailMessage?.type ?? null

  useEffect(() => {
    if (!resolvedSessionId) return

    const previousTailMessageId = lastTailMessageIdBySessionRef.current.get(resolvedSessionId)
    lastTailMessageIdBySessionRef.current.set(resolvedSessionId, tailMessageId)
    if (previousTailMessageId === undefined || previousTailMessageId === tailMessageId) return

    if (tailMessageType === 'user_text') {
      scrollToBottom()
    }
  }, [resolvedSessionId, scrollToBottom, tailMessageId, tailMessageType])

  useEffect(() => {
    const previousInput = lastLiveFollowInputRef.current
    lastLiveFollowInputRef.current = {
      sessionId: resolvedSessionId,
      messageCount: messages.length,
      streamingText,
      streamingToolInput,
    }
    // Session restoration already owns the initial/switch scroll. Only live
    // transitions within the same session enter the coalesced follow path.
    if (
      previousInput.sessionId !== resolvedSessionId ||
      (
        previousInput.messageCount === messages.length &&
        previousInput.streamingText === streamingText &&
        previousInput.streamingToolInput === streamingToolInput
      )
    ) {
      return
    }
    if (!shouldAutoScrollRef.current) {
      // The scroll handler already published the measured position; re-reading
      // it here would only risk showing the button while the reader is still at
      // the bottom.
      return
    }

    requestLiveFollow()
  }, [messages.length, requestLiveFollow, resolvedSessionId, streamingText, streamingToolInput])

  const handleJumpToLatest = useCallback(() => {
    setProgrammaticNavigationItemId(null)
    scrollToBottom()
  }, [scrollToBottom])

  // The scroller itself changes height: the composer grows with every typed
  // line, a permission card pushes it down, and on touch-H5 the soft keyboard
  // shrinks the visual viewport. Resizing does not emit a scroll event, so a
  // reader sitting at the tail silently loses it — the last message ends up
  // covered by the taller composer. Re-pin the tail whenever the container's
  // own height changes while follow is on.
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      layoutChangeAtRef.current = performance.now()
      if (!shouldAutoScrollRef.current) return
      requestLiveFollow()
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [requestLiveFollow])

  useEffect(() => {
    const content = scrollContentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect.height
      let grew = false
      if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
        const previousFollowHeight = lastContentResizeFollowHeightRef.current
        if (
          previousFollowHeight !== null &&
          Math.abs(nextHeight - previousFollowHeight) <= RESIZE_OBSERVER_JITTER_MAX_DELTA_PX
        ) {
          return
        }
        grew = previousFollowHeight !== null && nextHeight > previousFollowHeight
        lastContentResizeFollowHeightRef.current = nextHeight
      }
      if (restoringScrollAnchorRef.current) {
        // Non-virtual rows can settle after the switch's layout effect too.
        // Reapply the saved reading anchor before paint, as measured rows do.
        flushSync(flushMeasuredHeightVersion)
        return
      }
      // Any height change above a reader who is following the tail moves the
      // bottom — a reasoning block collapsing, an image settling, a reloaded
      // row measuring in. A shrink re-pins in idle sessions too: the old
      // live-only gate let every collapse above the tail leave it behind.
      layoutChangeAtRef.current = performance.now()
      if (!shouldAutoScrollRef.current) return
      // The reader is interacting with the transcript (selecting text, clicking
      // a control). Do not fight that gesture for its short window; a later
      // height change resumes following if they are still at the tail.
      if (performance.now() < userScrollIntentUntilRef.current) return
      // The reader just toggled something: the first frame of that growth is
      // theirs, not the model's (#1177). Collapses keep following in
      // handleDisclosureToggle.
      if (performance.now() < disclosureLayoutUntilRef.current) return
      // Growth while idle is usually the reader opening a block or lazily
      // loaded activity landing; keep the spot they are reading. A restored
      // tail is the exception: it is still settling into place.
      if (grew && !shouldFollowContentGrowth && !restoringBottomRef.current) return
      requestLiveFollow()
    })
    observer.observe(content)

    return () => observer.disconnect()
  }, [flushMeasuredHeightVersion, requestLiveFollow, shouldFollowContentGrowth])

  const {
    toolResultMap,
    childToolCallsByParent,
    backgroundTasksByToolUseId,
    renderItems,
    supersededAskUserQuestionIds,
  } = useMemo(
    () => buildRenderModel(messages, activeAskUserQuestionToolUseId, {
      hideTeamCoordinationTools: !isDirectAgentSession,
      teamMemberNames,
      teamTaskWindows,
      teamName: activeTeamName ?? teamSnapshot?.team.name,
      teamStartedAt: activeTeamStartedAt,
    }),
    [
      activeAskUserQuestionToolUseId,
      activeTeamName,
      activeTeamStartedAt,
      isDirectAgentSession,
      messages,
      teamMemberNames,
      teamSnapshot?.team.name,
      teamTaskWindows,
    ],
  )
  // Defer the per-message branchable / completed-turn computations so the first
  // commit on tab switch can render the virtualization window without doing two
  // additional O(N) walks synchronously. They re-run in a low-priority render
  // once the initial frame is painted.
  const deferredMessages = useDeferredValue(messages)
  const branchableMessageTargets = useMemo(
    () => branchActionsDisabled
      ? new Map<string, BranchableMessageTarget>()
      : getBranchableMessageTargets(deferredMessages),
    [branchActionsDisabled, deferredMessages],
  )
  const completedTurnTargets = useMemo(
    () => getCompletedTurnTargets(deferredMessages),
    [deferredMessages],
  )
  const turnCompletionByMessageId = useMemo(
    () => buildTurnCompletionByMessageId(deferredMessages, { turnActive: chatState !== 'idle' }),
    [deferredMessages, chatState],
  )
  // 回合尾件布局：收尾回复（带本轮 turnCompletion）之后跟着后台唤醒段的
  // 思考块与自动回复行。时间戳统一挪到全部尾件之后（回合真正结束的位置），
  // 尾件本身收进一层可折叠容器，收起时对话总结只剩一行摘要。
  const turnTailLayout = useMemo(() => {
    type TurnTailMeta = {
      /** 尾件折叠组 key（共享给同回合所有尾件），null 表示不属于任何尾件段。 */
      disclosureKey: string | null
      /** 本回合尾件总数（组内每项都拿到同一个数，折叠标题显示）。 */
      tailCount: number
      /** 尾件段里第一条 item：折叠摘要行只由它渲染。 */
      firstInGroup: boolean
      /** 尾件段里最后一条 item：时间戳行渲染在它之后。 */
      lastInGroup: boolean
      /** 段末时间信息行显示的完成时刻：取尾件中最后一条带完成信息的消息
       * （唤醒回复自己的），没有时回退到收尾回复的。 */
      stamp: TurnCompletion
    }
    const meta = new Map<number, TurnTailMeta>()
    /** 时间戳渲染位置：收尾回复 messageId → 承载时间戳行的尾件 item index（无尾件则不进表） */
    const stampHost = new Map<string, number>()
    // 扫描：记录每个收尾回复 item（turnCompletion 命中）的 index 与其后的
    // 尾件（thinking / wakeReply 消息）区间；工具组之外的任何 item 关闭该段。
    type Segment = { replyId: string; replyIndex: number; stamp: TurnCompletion; tail: number[] }
    const segments: Segment[] = []
    let current: Segment | null = null
    renderItems.forEach((item, index) => {
      if (item.kind === 'message' && item.message.type === 'user_text' && !item.message.pending) {
        current = null
        return
      }
      if (item.kind === 'message' && item.message.type === 'assistant_text') {
        const stamp = turnCompletionByMessageId.get(item.message.id) ?? null
        // 完成的收尾回复开启一个尾件段；唤醒回复自己是上一段的尾件
        if (stamp && !item.wakeReply) {
          current = { replyId: item.message.id, replyIndex: index, stamp, tail: [] }
          segments.push(current)
        } else if (current && item.wakeReply) {
          current.tail.push(index)
        } else {
          current = null
        }
        return
      }
      // 段内的活动组（唤醒段的思考与工具在组里）也是尾件；后台唤醒的
      // system 分隔不关段（它隔开总结与唤醒活动）；其余 item 关闭当前段
      if (current) {
        const isWakeDivider = item.kind === 'message'
          && item.message.type === 'system'
          && item.message.backgroundContinueTaskIds !== undefined
        if (isWakeDivider) return
        if (item.kind === 'tool_group') {
          current.tail.push(index)
        } else {
          current = null
        }
      }
    })
    for (const segment of segments) {
      const key = getRenderItemKey(renderItems[segment.replyIndex]!)
      // 尾件中的唤醒回复若自己带完成信息（它有独立的唤醒轮完成时刻），
      // 段末时间用它；否则回退到收尾回复的
      const lastTailReply = [...segment.tail]
        .reverse()
        .map((tailIndex) => renderItems[tailIndex])
        .find((tailItem): tailItem is Extract<RenderItem, { kind: 'message' }> =>
          tailItem?.kind === 'message' && tailItem.message.type === 'assistant_text')
      const inherited = lastTailReply
        ? turnCompletionByMessageId.get(lastTailReply.message.id)
        : undefined
      const stamp = inherited ?? segment.stamp
      segment.tail.forEach((tailIndex, position) => {
        meta.set(tailIndex, {
          disclosureKey: `turn-tail:${key}`,
          tailCount: segment.tail.length,
          firstInGroup: position === 0,
          lastInGroup: position === segment.tail.length - 1,
          stamp,
        })
      })
      if (segment.tail.length > 0) {
        stampHost.set(segment.replyId, segment.tail[segment.tail.length - 1]!)
      }
    }
    return { meta, stampHost }
  }, [renderItems, turnCompletionByMessageId])
  const turnTailMetaByIndex = turnTailLayout.meta
  const turnStampHostByMessageId = turnTailLayout.stampHost
  // 尾件折叠的统一展开状态：所有尾件 item 读同一份，点击摘要行整体切换。
  // 尾件是独立的虚拟 item，各自持有 useState 的话点击只重渲染当前实例，
  // 其余尾件留在旧状态；统一提到这里，切换时全部重渲染保持一致。
  // 重挂后回到收起态（与 BackgroundReplyFold 的 localExpanded 同一口径）。
  const [turnTailExpandedKeys, setTurnTailExpandedKeys] = useState<Set<string>>(new Set())
  const waitingForReconnect = sessionState?.connectionState === 'reconnecting' || sessionState?.awaitingReconnectSync === true
  // 本 fork 在运行中仍允许加载检查点：隐藏最新回合卡片即可避免中间态总结，
  // 排队自动续跑的窗口期里更早回合的卡片仍可见。后台任务写盘、重连与等待停止
  // 期间暂停查询，保留上一份已取结果。
  const turnCheckpointQueryPaused = !checkpointHistoryReady || isDirectAgentSession ||
    hasRunningBackgroundTasks || waitingForReconnect || sessionState?.awaitingStopIdle === true
  const historyWindowed = sessionState?.historyWindowed === true
  const turnTargetsCurrent = deferredMessages === messages
  const currentTargetsKey = useMemo(() => turnTargetsKey(getCompletedTurnTargets(messages)), [messages])
  const checkpointRequest = useMemo(() => {
    if (!resolvedSessionId || turnCheckpointQueryPaused || !turnTargetsCurrent || completedTurnTargets.length === 0) return null
    return { sessionId: resolvedSessionId, historyMutationEpoch, historyWindowed, targets: completedTurnTargets }
  }, [completedTurnTargets, historyMutationEpoch, historyWindowed, resolvedSessionId, turnCheckpointQueryPaused, turnTargetsCurrent])
  const [checkpointResult, setCheckpointResult] = useState<({ request: NonNullable<typeof checkpointRequest> } & (
    | { kind: 'ready'; cards: TurnChangeCardModel[] }
    | { kind: 'over-budget'; files: WorkspaceChangedFile[] | null }
    | { kind: 'error'; message: string }
  )) | null>(null)
  // 上次结果可以继续阅读；只有当前请求的结果才可以用于撤销。
  const currentCheckpointResult = checkpointResult?.request === checkpointRequest ? checkpointResult : null
  const turnUndoBlocked = currentCheckpointResult?.kind !== 'ready'
  const turnChangeLoadError = currentCheckpointResult?.kind === 'error' ? currentCheckpointResult.message : null
  const workspaceChangesFallback = currentCheckpointResult?.kind === 'over-budget' ? currentCheckpointResult : null
  // 断线会重置 historyHydrated，但不会清空正在显示的行；沿用这些行的只读卡片。
  const canRetainTurnCards = !isDirectAgentSession && (!turnTargetsCurrent || completedTurnTargets.length > 0)
  const turnChangeCards = useMemo(() => {
    const liveCards = checkpointResult?.kind === 'ready' && checkpointResult.request.sessionId === resolvedSessionId
      ? checkpointResult.cards
      : null
    const cached = liveCards === null ? turnChangeCardCache.get(resolvedSessionId ?? '') : undefined
    const cachedCards = cached && cached.epoch === historyMutationEpoch && cached.targetsKey === currentTargetsKey
      ? cached.cards
      : null
    const cards = liveCards ?? cachedCards
    if (!canRetainTurnCards || cards === null) {
      return EMPTY_TURN_CHANGE_CARDS
    }
    // 断线会替换消息行 ID，但保留的回合仍可阅读；按落盘检查点重挂旧卡片。
    return liveCards !== null && turnTargetsCurrent && checkpointResult?.request.targets === completedTurnTargets
      ? liveCards
      : rebindTurnChangeCards(cards, messages)
  }, [canRetainTurnCards, checkpointResult, completedTurnTargets, currentTargetsKey, historyMutationEpoch, messages, resolvedSessionId, turnTargetsCurrent])
  const getConversationImages = useCallback(() => resolvedSessionId ? resolveConversationImages(
    useChatStore.getState().sessions[resolvedSessionId]?.messages ?? EMPTY_MESSAGES,
    {
      sessionId: resolvedSessionId,
      baseUrl: getServerBaseUrl(),
      workDir: useWorkspaceContentStore.getState().statusBySession[resolvedSessionId]?.workDir,
      imageLabel: t('assistantOutputs.kind.image'),
      changedFilesByTurnId: new Map(turnChangeCards.map((card) => [card.target.messageId, card.checkpoint.code.filesChanged])),
    },
  ) : [], [resolvedSessionId, t, turnChangeCards])
  // 卡片是回合结束的总结。检查点接口对「已有部分响应的运行中回合」也返回差分，
  // 直接渲染会出现「回合没结束就出了总结」（中间态差分还带不完整的撤回警告）。
  // 运行中只隐藏最后一个回合的卡片（它可能是中间态），更早回合的卡片照常显示——
  // 排队自动续跑的窗口期里仍能看到上一轮的变更与撤回入口。后台任务写盘中时全部
  // 隐藏（差分同样是中间态）。
  const visibleTurnChangeCards = useMemo(() => {
    if (hasRunningBackgroundTasks) return EMPTY_TURN_CHANGE_CARDS
    if (chatState === 'idle') return turnChangeCards
    const lastTargetId = completedTurnTargets[completedTurnTargets.length - 1]?.messageId
    return lastTargetId
      ? turnChangeCards.filter((card) => card.target.messageId !== lastTargetId)
      : turnChangeCards
  }, [chatState, completedTurnTargets, hasRunningBackgroundTasks, turnChangeCards])
  const turnCardsByRenderIndex = useMemo(
    () => buildTurnCardInsertionMap(renderItems, visibleTurnChangeCards),
    [renderItems, visibleTurnChangeCards],
  )
  const changedFilesByRenderIndex = useMemo(
    () => buildChangedFilesByRenderIndex(renderItems, turnChangeCards),
    [renderItems, turnChangeCards],
  )
  // No checkpoint is coming for this view; the disk alone has to vouch for outputs.
  // While one is still loading, nothing unproven is shown instead.
  const turnEvidenceUnavailable = isDirectAgentSession || turnChangeLoadError !== null || workspaceChangesFallback !== null
  const turnOutputOwnerIndexes = useMemo(
    () => buildTurnOutputOwnerIndexes(renderItems, turnChangeCards),
    [renderItems, turnChangeCards],
  )
  const hasTrailingStreamingItem = streamingText.trim().length > 0
  const turnRailPositions = useMemo(
    () => buildTurnRailPositions(renderItems, { hasTrailingStreamingItem }),
    [renderItems, hasTrailingStreamingItem],
  )
  const streamingRailPosition = trailingStreamingRailPosition(turnRailPositions)
  // The rail is the progress indicator: whichever segment the turn is currently
  // working in carries the running state, so it sits next to the work it
  // describes instead of in a separate strip somewhere else on screen.
  const showsTurnStatusLine = hasApiRetry
    || hasStreamingFallback
    || isPreparingTurn
    || chatState === 'tool_executing'
    || (chatState === 'thinking' && !activeThinkingId)
  const renderItemKeys = useMemo(
    () => renderItems.map(getRenderItemKey),
    [renderItems],
  )
  const committedGroupKeys = useRef<{ sessionId: string | null | undefined; byTool: Map<string, string> }>({ sessionId: resolvedSessionId, byTool: new Map() })
  const groupMountKeys = useMemo(() => {
    const previous = committedGroupKeys.current.sessionId === resolvedSessionId
      ? committedGroupKeys.current.byTool : new Map<string, string>()
    const keys = new Map<string, string>()
    const byTool = new Map<string, string>()
    const used = new Set<string>()
    for (const item of renderItems) {
      if (item.kind !== 'tool_group') continue
      // Prepending a page can rename a group. Preserve its mounted disclosure
      // and inner rows through surviving tool identities in either direction.
      const retained = item.toolCalls.map((tool) => previous.get(tool.id)).find((key) => key && !used.has(key))
      const key = retained ?? `activity:${item.id}`
      const uniqueKey = used.has(key) ? `${key}:${keys.size}` : key
      used.add(uniqueKey)
      keys.set(item.id, uniqueKey)
      for (const tool of item.toolCalls) byTool.set(tool.id, uniqueKey)
    }
    return { keys, byTool }
  }, [renderItems, resolvedSessionId])
  useLayoutEffect(() => {
    committedGroupKeys.current = { sessionId: resolvedSessionId, byTool: groupMountKeys.byTool }
  }, [groupMountKeys, resolvedSessionId])
  const committedChangeCardRows = useRef<{
    sessionId: typeof resolvedSessionId
    hosts: Map<string, { itemKey: string; mountKey: string }>
  }>({ sessionId: resolvedSessionId, hosts: new Map() })
  const changeCardMounts = useMemo(() => {
    const hosts = new Map<string, { itemKey: string; mountKey: string }>()
    const aliases = new Map<string, string>()
    if (turnCardsByRenderIndex.size === 0) return { hosts, aliases }
    const previous = committedChangeCardRows.current
    const used = new Set([...renderItemKeys, ...groupMountKeys.keys.values()])
    for (const [index, cards] of turnCardsByRenderIndex) {
      const item = renderItems[index]!
      if (item.kind !== 'message' || item.message.type !== 'assistant_text') continue
      const card = cards.find(card => card.checkpoint.code.available)
      if (!card) continue
      const checkpointId = card.checkpoint.target.targetUserMessageId
      const itemKey = renderItemKeys[index]!
      const prior = previous.sessionId === resolvedSessionId ? previous.hosts.get(checkpointId) : undefined
      // 旧答复行已经被替换时，让同一检查点的卡片留在原 DOM，保住浏览器的滚动锚点。
      const retained = prior && (prior.itemKey === itemKey || !used.has(prior.itemKey)) && !used.has(prior.mountKey)
      const mountKey = retained ? prior.mountKey : itemKey
      if (retained) {
        used.add(mountKey)
        aliases.set(itemKey, mountKey)
      }
      hosts.set(checkpointId, { itemKey, mountKey })
    }
    return { hosts, aliases }
  }, [groupMountKeys, renderItemKeys, renderItems, resolvedSessionId, turnCardsByRenderIndex])
  useLayoutEffect(() => {
    committedChangeCardRows.current = { sessionId: resolvedSessionId, hosts: changeCardMounts.hosts }
  }, [changeCardMounts, resolvedSessionId])
  const renderItemMetrics = useMemo(
    () => renderItems.map((item, index) => {
      const key = renderItemKeys[index]!
      const signature = getRenderItemMetricSignature(item)
      const cached = virtualItemMetricCache.get(key)
      if (cached?.signature === signature) return cached

      const metric = {
        signature,
        contentWeight: getRenderItemContentWeight(item),
        estimatedHeight: estimateRenderItemHeight(item),
      }
      virtualItemMetricCache.set(key, metric)
      return metric
    }),
    [renderItemKeys, renderItems, virtualItemMetricCache],
  )
  // Compare against the last committed list, so an interrupted render cannot
  // become the source of measured geometry for a later history reload.
  const previousRenderItemsRef = useRef<{
    sessionId: string | null | undefined
    keys: string[]
    items: RenderItem[]
  }>({ sessionId: resolvedSessionId, keys: [], items: [] })
  useMemo(() => {
    const previous = previousRenderItemsRef.current
    if (previous.sessionId !== resolvedSessionId || haveSameRenderItemKeys(previous.keys, renderItemKeys)) return
    carryMeasuredHeightsToRenamedItems(
      virtualItemHeights,
      previous.keys,
      previous.items.map(getRenderItemReloadSignature),
      renderItemKeys,
      renderItems.map(getRenderItemReloadSignature),
    )
  }, [renderItemKeys, renderItems, resolvedSessionId, virtualItemHeights])
  useLayoutEffect(() => {
    previousRenderItemsRef.current = { sessionId: resolvedSessionId, keys: renderItemKeys, items: renderItems }
  }, [renderItemKeys, renderItems, resolvedSessionId])
  // A history reload or checkpoint refresh after a reply rewrites the rows while
  // the chat is idle, where neither the streaming follow nor the message-count
  // follow runs. A reader who was at the bottom stays there.
  const lastFollowedRenderItemKeysRef = useRef<{
    sessionId: string | null | undefined
    keys: string[]
  }>({ sessionId: resolvedSessionId, keys: renderItemKeys })
  useEffect(() => {
    const previous = lastFollowedRenderItemKeysRef.current
    lastFollowedRenderItemKeysRef.current = { sessionId: resolvedSessionId, keys: renderItemKeys }
    // Same rows under the same keys (a streaming delta, a status tick) are
    // followed by the live paths above; only rows added, removed or renamed
    // need this one.
    if (previous.sessionId !== resolvedSessionId || haveSameRenderItemKeys(previous.keys, renderItemKeys)) return
    if (!shouldAutoScrollRef.current) return
    requestLiveFollow()
  }, [renderItemKeys, requestLiveFollow, resolvedSessionId])
  const conversationNavigationItems = useMemo(() => {
    const sources = renderItems.flatMap((item, renderIndex) => item.kind === 'message'
      ? [{
          message: item.message,
          renderIndex,
          renderItemKey: getRenderItemKey(item),
        }]
      : [])

    return buildConversationNavigationItems(sources)
  }, [renderItems])
  const scrollAnchor = lastSessionIdRef.current !== resolvedSessionId
    ? (resolvedSessionId ? sessionScrollSnapshots.get(resolvedSessionId)?.anchor : null)
    : restoringScrollAnchorRef.current
  const virtualTranscriptWindow = useMemo(
    () => buildVirtualTranscriptWindow(
      renderItems,
      renderItemKeys,
      renderItemMetrics,
      virtualItemHeights,
      virtualViewport,
      VIRTUAL_OVERSCAN_PX,
      scrollAnchor,
    ),
    [measuredItemsVersion, renderItemKeys, renderItemMetrics, renderItems, scrollAnchor, virtualItemHeights, virtualViewport],
  )

  const unreadReplyId = useMemo(
    () => visible && unreadCompletion ? resolveUnreadCompletion(messages, unreadCompletion)?.id : undefined,
    [visible, messages, unreadCompletion],
  )
  useEffect(() => {
    if (!unreadReplyId || !unreadCompletion || !resolvedSessionId || typeof IntersectionObserver === 'undefined') return
    const row = Array.from(scrollContentRef.current?.querySelectorAll<HTMLElement>('[data-chat-render-item-key]') ?? [])
      .find(element => element.dataset.chatRenderItemKey === unreadReplyId)
    // 锚在行上而不是消息体：后台唤醒回合的回复默认折叠，消息体（含
    // data-chat-selectable-message）不渲染，锚它会导致已读观察永不建立、
    // 角标不清。行级元素在折叠与展开两种形态下都在视口判定上等价
    const reply = row?.querySelector('[data-chat-selectable-message="assistant"]') ?? row
    if (!reply) return

    // Hidden tabs and the trajectory view keep their transcripts mounted. Only
    // acknowledge a reply once its row enters the focused window's viewport.
    let active = true
    const observer = new IntersectionObserver(entries => {
      const entry = entries[entries.length - 1]
      if (active && entry?.isIntersecting && entry.intersectionRect.height > 0 && entry.intersectionRect.width > 0 &&
        document.visibilityState === 'visible' && document.hasFocus()) {
        useChatStore.getState().markSessionCompletionRead(resolvedSessionId, unreadCompletion)
      }
    }, { threshold: [0, 0.001] })
    const observeAgain = () => {
      observer.disconnect()
      observer.takeRecords()
      observer.observe(reply)
    }
    observer.observe(reply)
    window.addEventListener('focus', observeAgain)
    document.addEventListener('visibilitychange', observeAgain)
    return () => {
      active = false
      observer.disconnect()
      window.removeEventListener('focus', observeAgain)
      document.removeEventListener('visibilitychange', observeAgain)
    }
  }, [unreadCompletion, unreadReplyId, resolvedSessionId, virtualTranscriptWindow.items])

  useLayoutEffect(() => {
    const anchor = restoringScrollAnchorRef.current
    const container = scrollContainerRef.current
    if (!container || !resolvedSessionId || container.clientHeight <= 0) return
    if (!anchor) {
      // A large scrollbar jump mounts a different window after its scroll event.
      // Capture that committed DOM, not the old rows still mounted in onScroll.
      if (!shouldAutoScrollRef.current) rememberSessionScroll(resolvedSessionId, container, false)
      return
    }
    const row = [...container.querySelectorAll<HTMLElement>('[data-chat-render-item-key]')]
      .find((node) => node.dataset.chatRenderItemKey === anchor.itemKey)
    if (!row || row.getBoundingClientRect().height <= 0) return
    const correction = row.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset
    if (Math.abs(correction) >= 1) {
      setScrollTopWithoutLayoutRead(container, container.scrollTop + correction)
    }
    ignoreProgrammaticScrollTopRef.current = container.scrollTop
    // Do not enqueue a layout update on an already aligned render. The render
    // model can refresh without a geometry change (e.g. checkpoint hydration).
    if (Math.abs(virtualViewport.scrollTop - container.scrollTop) >= 1 || virtualViewport.viewportHeight !== container.clientHeight) {
      syncVirtualViewportFromContainer(container)
    }
    sessionScrollSnapshots.set(resolvedSessionId, { scrollTop: container.scrollTop, wasAtBottom: false, anchor })
  }, [measuredItemsVersion, resolvedSessionId, syncVirtualViewportFromContainer, virtualTranscriptWindow, virtualViewport])

  useLayoutEffect(() => {
    if (previousAppearanceSignature.current === appearanceSignature) return
    previousAppearanceSignature.current = appearanceSignature
    const container = scrollContainerRef.current
    if (resolvedSessionId) getHeightsForSession(resolvedSessionId, appearanceSignature)
    if (!container || !virtualTranscriptWindow.enabled) return

    // Off-screen rows retain no valid measurements after a font/measure change.
    // Re-measure mounted rows before paint and preserve the reader's row plus
    // its intra-row offset while the spacer above it returns to estimates.
    const oldOffsets = virtualTranscriptWindow.offsets
    const oldScrollTop = virtualViewport.scrollTop
    let anchorIndex = 0
    while (anchorIndex + 1 < renderItemKeys.length && oldOffsets[anchorIndex + 1]! <= oldScrollTop) anchorIndex += 1
    virtualItemHeights.clear()
    for (const node of container.querySelectorAll<HTMLElement>('[data-virtual-message-item]')) {
      const height = node.getBoundingClientRect().height
      if (height > 0) virtualItemHeights.set(node.dataset.virtualMessageItem!, clampNumber(height, VIRTUAL_MIN_ITEM_HEIGHT, VIRTUAL_MAX_ITEM_HEIGHT))
    }
    const offsets = buildVirtualItemOffsets(renderItemKeys, renderItemMetrics, virtualItemHeights)
    const intraRowOffset = Math.max(0, oldScrollTop - (oldOffsets[anchorIndex] ?? 0))
    const rowHeight = (offsets[anchorIndex + 1] ?? 0) - (offsets[anchorIndex] ?? 0)
    const nextScrollTop = shouldAutoScrollRef.current
      ? SCROLL_BOTTOM_SENTINEL
      : (offsets[anchorIndex] ?? 0) + Math.min(intraRowOffset, Math.max(0, rowHeight - 1))
    ignoreProgrammaticScrollUntilRef.current = performance.now() + 250
    ignoreProgrammaticScrollTopRef.current = nextScrollTop
    pendingAppearanceScrollTop.current = nextScrollTop
    setVirtualViewport((current) => ({ ...current, scrollTop: nextScrollTop }))
    setMeasuredItemsVersion((version) => version + 1)
  }, [appearanceSignature, renderItemKeys, renderItemMetrics, resolvedSessionId, virtualItemHeights, virtualTranscriptWindow, virtualViewport.scrollTop])

  useLayoutEffect(() => {
    const target = pendingAppearanceScrollTop.current
    if (target === null || !scrollContainerRef.current) return
    pendingAppearanceScrollTop.current = null
    setScrollTopWithoutLayoutRead(scrollContainerRef.current, target)
    ignoreProgrammaticScrollTopRef.current = scrollContainerRef.current.scrollTop
  }, [measuredItemsVersion])

  const activeConversationNavigationItemId = useMemo(
    () => isAwayFromLatest
      ? getActiveConversationNavigationItemId(
          conversationNavigationItems,
          virtualTranscriptWindow.offsets,
          virtualViewport.scrollTop,
          virtualViewport.viewportHeight,
        )
      : null,
    [conversationNavigationItems, isAwayFromLatest, virtualTranscriptWindow.offsets, virtualViewport],
  )
  const visibleConversationNavigationItemId =
    programmaticNavigationItemId && conversationNavigationItems.some((item) => item.id === programmaticNavigationItemId)
      ? programmaticNavigationItemId
      : activeConversationNavigationItemId
  const conversationNavigationMode: ConversationNavigationMode =
    messageListWidth === null || messageListWidth >= CONVERSATION_NAVIGATION_FULL_MIN_WIDTH_PX
      ? 'full'
      : messageListWidth >= CONVERSATION_NAVIGATION_COMPACT_MIN_WIDTH_PX
        ? 'compact'
        : 'edge'
  const showConversationNavigator =
    !mobileLayout &&
    !isTouchH5Document() &&
    conversationNavigationItems.length >= CONVERSATION_NAVIGATION_MIN_ITEMS
  // Match the composer/header gutters when no navigation rail is present.
  // The navigator deliberately reserves extra room outside the reading column.
  const chatScrollPaddingClass = mobileLayout
    ? 'px-3 py-4'
    : compact
      ? showConversationNavigator && conversationNavigationMode === 'full'
        ? 'pb-5 px-20 py-3'
        : showConversationNavigator && conversationNavigationMode === 'compact'
          ? 'pb-5 px-12 py-3'
          : showConversationNavigator && conversationNavigationMode === 'edge'
            ? 'pb-5 px-7 py-3'
            : 'px-4 py-3 pb-5'
      : showConversationNavigator && conversationNavigationMode === 'full'
        ? 'px-20 py-4'
        : showConversationNavigator && conversationNavigationMode === 'compact'
          ? 'px-12 py-4'
          : showConversationNavigator && conversationNavigationMode === 'edge'
            ? 'px-7 py-4'
            : 'px-6 py-4'
  const confirmTurnCard = useMemo(
    () => turnUndoConfirmTarget?.sessionId === resolvedSessionId
      ? turnChangeCards.find((card) => card.checkpoint.target.targetUserMessageId === turnUndoConfirmTarget?.checkpointId) ?? null
      : null,
    [resolvedSessionId, turnUndoConfirmTarget, turnChangeCards],
  )
  useEffect(() => {
    if (turnUndoConfirmTarget && !confirmTurnCard) setTurnUndoConfirmTarget(null)
  }, [confirmTurnCard, turnUndoConfirmTarget])
  // Undo is not reversible, so the dialog — not just the card — has to say which
  // changes it will leave behind when the checkpoint could not cover them all.
  const confirmUnverifiedSources = confirmTurnCard?.checkpoint.unverifiedChangeSources ?? []
  const confirmHasCodeCheckpoint = Boolean(confirmTurnCard?.checkpoint.code.available)
  const confirmCanRestoreCode = confirmHasCodeCheckpoint &&
    confirmTurnCard?.checkpoint.restoreAvailable !== false
  const confirmBodyText = confirmTurnCard?.isLatest
    ? t('chat.turnChangesLatestConfirmBody')
    : t('chat.turnChangesHistoricalConfirmBody')
  const confirmCaution = confirmHasCodeCheckpoint && !confirmCanRestoreCode
    ? t('chat.turnChangesConversationOnlyConfirmBody')
    : confirmUnverifiedSources.length > 0
      ? t('chat.turnChangesPartialCoverageConfirmBody', {
          sources: confirmUnverifiedSources.join(', '),
        })
      : null
  const confirmBody = !confirmHasCodeCheckpoint
    ? t('chat.conversationRewindConfirmBody')
    : confirmCaution === null
      ? confirmBodyText
      : (
          <div className="space-y-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            {confirmCanRestoreCode ? <p>{confirmBodyText}</p> : null}
            <p className="text-[var(--color-warning)]">{confirmCaution}</p>
          </div>
        )

  useEffect(() => {
    const liveKeys = new Set(renderItemKeys)
    let removed = false
    for (const key of virtualItemHeights.keys()) {
      if (!liveKeys.has(key)) {
        virtualItemHeights.delete(key)
        removed = true
      }
    }
    for (const key of virtualItemMetricCache.keys()) {
      if (!liveKeys.has(key)) {
        virtualItemMetricCache.delete(key)
      }
    }
    if (removed) setMeasuredItemsVersion((version) => version + 1)
  }, [renderItemKeys, virtualItemHeights, virtualItemMetricCache])

  useEffect(() => {
    if (!canRetainTurnCards) {
      setCheckpointResult(null)
      return
    }
    if (!checkpointRequest) return

    const { sessionId, targets, historyWindowed } = checkpointRequest
    const controller = new AbortController()
    // 全量检查点超限时，有界的工作区状态仍可作为当前文件列表，但不归属任何回合。
    Promise.allSettled([
      sessionsApi.getTurnCheckpoints(sessionId, { signal: controller.signal }),
      sessionsApi.getWorkspaceStatus(sessionId, controller.signal),
    ])
      .then(([checkpointResponse, workspaceResponse]) => {
        if (controller.signal.aborted) return
        const workspaceStatus = workspaceResponse.status === 'fulfilled' ? workspaceResponse.value : null
        if (checkpointResponse.status === 'rejected') {
          if (isCheckpointPreviewBudgetError(checkpointResponse.reason)) {
            const files = workspaceStatus?.state === 'ok' &&
              Array.isArray(workspaceStatus.changedFiles) &&
              workspaceStatus.changedFiles.every((file) => typeof file?.path === 'string' && file.path.trim().length > 0)
              ? workspaceStatus.changedFiles
              : null
            turnChangeCardCache.delete(sessionId)
            setCheckpointResult({ request: checkpointRequest, kind: 'over-budget', files })
          } else {
            turnChangeCardCache.delete(sessionId)
            setCheckpointResult({ request: checkpointRequest, kind: 'error', message: getApiErrorMessage(checkpointResponse.reason) })
          }
          return
        }
        const targetsById = new Map(targets.map((target) => [target.transcriptMessageId ?? target.messageId, target]))
        const liveTargetsByIndex = new Map(targets
          .filter((target) => !target.transcriptMessageId)
          .map((target) => [target.userMessageIndex, target]))
        const cards = normalizeTurnCheckpoints(checkpointResponse.value).flatMap((checkpoint) => {
          const target = targetsById.get(checkpoint.target.targetUserMessageId) ??
            (historyWindowed ? undefined : liveTargetsByIndex.get(checkpoint.target.userMessageIndex))
          if (!target) return []
          return [{
            target,
            checkpoint,
            workDir: checkpoint.workDir ?? workspaceStatus?.workDir ?? null,
            isLatest: target === targets.at(-1),
          }]
        })
        rememberTurnChangeCards(sessionId, historyMutationEpoch, targets, cards)
        setCheckpointResult({ request: checkpointRequest, kind: 'ready', cards })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        turnChangeCardCache.delete(sessionId)
        setCheckpointResult({ request: checkpointRequest, kind: 'error', message: getApiErrorMessage(error) })
      })

    return () => {
      controller.abort()
    }
  }, [canRetainTurnCards, checkpointRequest])

  // 新回合开始（排队自动续跑等）时上一轮的 workspace fallback 已过期：立即清掉，
  // 渲染层由 idle 条件兜住的显示随之消失。不清 turnChangeCards——续跑窗口期内
  // 上一轮的变更卡片与撤回入口保持可见，这正是运行中加载的意义。
  useEffect(() => {
    if (chatState !== 'idle') {
      setCheckpointResult(current => current?.kind === 'over-budget' ? null : current)
    }
  }, [chatState])

  const handleUndoCurrentTurn = useCallback(async (mode: SessionRewindMode = 'both') => {
    if (!resolvedSessionId || !confirmTurnCard || rewindingTurnId || hasRunningBackgroundTasks) return

    const target = confirmTurnCard.target
    setRewindingTurnId(target.messageId)
    setTurnActionErrors((current) => {
      if (!(target.messageId in current)) return current
      const next = { ...current }
      delete next[target.messageId]
      return next
    })

    try {
      const result = await rewindToTurnCheckpoint(resolvedSessionId, {
        checkpointTarget: confirmTurnCard.checkpoint.target,
        expectedContent: target.expectedContent,
      }, mode)

      await reloadHistory(resolvedSessionId)
      queueComposerPrefill(resolvedSessionId, {
        text: target.content,
        attachments: target.attachments,
      })
      addToast(describeRewindResult(result, mode, t))

      setTurnUndoConfirmTarget(null)
    } catch (error) {
      setTurnActionErrors((current) => ({
        ...current,
        [target.messageId]: getApiErrorMessage(error),
      }))
      setTurnUndoConfirmTarget(null)
    } finally {
      setRewindingTurnId(null)
    }
  }, [
    addToast,
    confirmTurnCard,
    queueComposerPrefill,
    reloadHistory,
    resolvedSessionId,
    rewindingTurnId,
    t,
    turnUndoBlocked,
  ])

  // Rolling the conversation back never depends on the checkpoint, so it stays
  // on offer even when restoring the files is impossible — that is the only
  // action left in that case, and losing it entirely was the whole complaint.
  const confirmActions: ActionDialogAction[] = [
    {
      label: t('common.cancel'),
      onClick: () => setTurnUndoConfirmTarget(null),
      variant: 'secondary',
    },
    {
      label: t('chat.turnChangesUndoConversationOnly'),
      onClick: () => { void handleUndoCurrentTurn('conversation') },
      variant: confirmCanRestoreCode ? 'secondary' : 'danger',
      disabled: turnUndoBlocked,
      loading: Boolean(rewindingTurnId),
    },
    ...(confirmCanRestoreCode
      ? [{
          label: confirmTurnCard?.isLatest
            ? t('chat.turnChangesLatestConfirmUndo')
            : t('chat.turnChangesHistoricalConfirmUndo'),
          onClick: () => { void handleUndoCurrentTurn('both') },
          variant: 'danger' as const,
          disabled: turnUndoBlocked,
          loading: Boolean(rewindingTurnId),
        }]
      : []),
  ]

  const handleBranchMessage = useCallback(async (target: BranchableMessageTarget) => {
    if (!resolvedSessionId || branchingMessageId) return

    setBranchingMessageId(target.uiMessageId)
    try {
      const result = await branchSession(resolvedSessionId, target.transcriptMessageId)
      const title = result.title.trim() || t('sidebar.newSession')
      useTabStore.getState().openTab(result.sessionId, title)
      useChatStore.getState().connectToSession(result.sessionId)
      addToast({
        type: 'success',
        message: t('chat.branchSuccess', { title }),
      })
    } catch (error) {
      addToast({
        type: 'error',
        message: t('chat.branchError', { detail: getApiErrorMessage(error) }),
      })
    } finally {
      setBranchingMessageId(null)
    }
  }, [addToast, branchSession, branchingMessageId, resolvedSessionId, t])

  // Pre-compute per-message branchAction + toolResult lookups so MessageBlock's
  // memo barrier is not broken by inline object literals on every render.
  const branchActionByMessageId = useMemo(() => {
    if (branchableMessageTargets.size === 0) {
      return new Map<string, { label: string; loading: boolean; onBranch: () => void }>()
    }
    const result = new Map<string, { label: string; loading: boolean; onBranch: () => void }>()
    const label = t('chat.branchFromHere')
    for (const [uiMessageId, target] of branchableMessageTargets) {
      result.set(uiMessageId, {
        label,
        loading: branchingMessageId === target.uiMessageId,
        onBranch: () => { void handleBranchMessage(target) },
      })
    }
    return result
  }, [branchableMessageTargets, branchingMessageId, handleBranchMessage, t])

  const completedTurnMessageIds = useMemo(
    () => new Set(completedTurnTargets.map((target) => target.messageId)),
    [completedTurnTargets],
  )
  const unansweredTurnTargets = useMemo(
    () => getUnansweredTurnTargets(deferredMessages),
    [deferredMessages],
  )
  const checkpointPreviewOverBudget = workspaceChangesFallback !== null
  // Past the preview budget the server lists no checkpoints at all, but one
  // rewind still resolves a prompt by its transcript id, so those prompts stay
  // editable. This mode tells the user file undo is unavailable, so the edit
  // rolls back the conversation only.
  const completedEditCards = useMemo<EditableTurnCard[]>(
    () => {
      if (!checkpointPreviewOverBudget) return turnUndoBlocked ? EMPTY_TURN_CHANGE_CARDS : turnChangeCards
      return completedTurnTargets.flatMap((target) => target.transcriptMessageId
        ? [{
            target: { messageId: target.messageId, expectedContent: target.expectedContent },
            checkpoint: {
              target: { targetUserMessageId: target.transcriptMessageId, userMessageIndex: target.userMessageIndex },
            },
            conversationOnly: true,
          }]
        : [])
    },
    [checkpointPreviewOverBudget, completedTurnTargets, turnChangeCards, turnUndoBlocked],
  )
  // A prompt stopped before any reply has no checkpoint but nothing to restore
  // either, so it rewinds the conversation only. One the CLI never
  // acknowledged is not in the transcript at all: it is dropped locally.
  // The prompt still being answered is not a stopped one.
  const unansweredEditCards = useMemo<EditableTurnCard[]>(
    () => unansweredTurnTargets.flatMap<EditableTurnCard>(({ target, latest }) => {
      if (latest && turnInProgress) return []
      const cardTarget = { messageId: target.messageId, expectedContent: target.expectedContent }
      if (target.transcriptMessageId) {
        return [{
          target: cardTarget,
          checkpoint: {
            target: { targetUserMessageId: target.transcriptMessageId, userMessageIndex: target.userMessageIndex },
          },
          conversationOnly: true,
        }]
      }
      return latest && target.awaitingReplay ? [{ target: cardTarget, unconfirmed: true as const }] : []
    }),
    [turnInProgress, unansweredTurnTargets],
  )
  const editTurnCards = useMemo(
    () => unansweredEditCards.length === 0 ? completedEditCards : [...completedEditCards, ...unansweredEditCards],
    [completedEditCards, unansweredEditCards],
  )
  const editBlockedReason = turnInProgress
    ? t('chat.editMessageWaitForTurn')
    : hasRunningBackgroundTasks
      ? t('chat.editMessageWaitForBackgroundTasks')
      : null
  const editPendingReason = !currentCheckpointResult
    ? t('chat.editMessageCheckingCheckpoints')
    : turnChangeLoadError !== null
      ? t('chat.editMessageCheckpointsUnavailable')
      : null

  const { editActionByMessageId, dialog: editResendDialog } = useUserMessageEditResend({
    sessionId: resolvedSessionId,
    messages,
    turnCards: editTurnCards,
    completedMessageIds: completedTurnMessageIds,
    blockedReason: editBlockedReason,
    pendingReason: editPendingReason,
    disabled: isDirectAgentSession || isSideChatSession || Boolean(confirmTurnCard),
    rewindingTurnId,
    setRewindingTurnId,
    t,
  })

  const toolResultByToolUseId = useMemo(() => {
    if (toolResultMap.size === 0) return new Map<string, { content: unknown; isError: boolean }>()
    const result = new Map<string, { content: unknown; isError: boolean }>()
    for (const [toolUseId, toolResult] of toolResultMap) {
      result.set(toolUseId, { content: toolResult.content, isError: toolResult.isError })
    }
    return result
  }, [toolResultMap])

  const handleNavigateToConversationItem = useCallback((
    item: ConversationNavigationItem,
    options: { toolUseId?: string } = {},
  ) => {
    const container = scrollContainerRef.current
    if (!container) return

    const viewportHeight = container.clientHeight || virtualViewport.viewportHeight || VIRTUAL_DEFAULT_VIEWPORT_HEIGHT
    restoringScrollAnchorRef.current = null
    userScrollIntentUntilRef.current = 0
    setProgrammaticNavigationItemId(item.id)
    setHighlightedNavigationItemKey(item.renderItemKey)
    // A tool call inside the item: its group opens onto it and the call itself
    // takes the highlight, since the item is mostly the rows around it.
    setHighlightedNavigationToolUseId(options.toolUseId ?? null)

    const scheduleHighlightClear = () => {
      if (navigationHighlightTimerRef.current !== null) {
        window.clearTimeout(navigationHighlightTimerRef.current)
      }
      navigationHighlightTimerRef.current = window.setTimeout(() => {
        setHighlightedNavigationItemKey((current) => current === item.renderItemKey ? null : current)
        navigationHighlightTimerRef.current = null
      }, 1400)
    }

    const targetScrollTop = getConversationNavigationTargetScrollTop(
      item,
      virtualTranscriptWindow.offsets,
      viewportHeight,
      virtualTranscriptWindow.totalHeight,
    )
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const isNearby = Math.abs(container.scrollTop - targetScrollTop) <= viewportHeight * 1.25

    shouldAutoScrollRef.current = false
    setIsAwayFromLatest(true)
    ignoreProgrammaticScrollUntilRef.current = performance.now() + 250
    ignoreProgrammaticScrollTopRef.current = targetScrollTop

    if (isNearby && !prefersReducedMotion && typeof container.scrollTo === 'function') {
      container.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
    } else {
      setScrollTopWithoutLayoutRead(container, targetScrollTop)
    }
    setVirtualViewport({ scrollTop: targetScrollTop, viewportHeight })

    const alignTarget = (retriesLeft: number) => {
      const itemNode = Array.from(
        scrollContentRef.current?.querySelectorAll<HTMLElement>('[data-chat-render-item-key]') ?? [],
      ).find((node) => node.dataset.chatRenderItemKey === item.renderItemKey)
      // Align the call itself, not the top of a group that may be thousands of
      // rows tall. The group opens in the render this navigation triggered, so
      // give it one more frame if the row is not in the DOM yet.
      const toolNode = options.toolUseId && itemNode
        ? Array.from(itemNode.querySelectorAll<HTMLElement>('[data-tool-use-id]'))
          .find((node) => node.dataset.toolUseId === options.toolUseId)
        : undefined
      if (options.toolUseId && itemNode && !toolNode && retriesLeft > 0) {
        requestAnimationFrame(() => alignTarget(retriesLeft - 1))
        return
      }
      const targetNode = toolNode ?? itemNode

      if (targetNode) {
        const targetRect = targetNode.getBoundingClientRect()
        const containerRect = container.getBoundingClientRect()
        if (targetRect.height > 0) {
          const correction = targetRect.top - containerRect.top - viewportHeight * CONVERSATION_NAVIGATION_READING_ANCHOR_RATIO
          if (Math.abs(correction) >= 1) {
            setScrollTopWithoutLayoutRead(container, container.scrollTop + correction)
            syncVirtualViewportFromContainer(container)
          }
        }
      }

      scheduleHighlightClear()
    }
    requestAnimationFrame(() => alignTarget(1))
  }, [
    syncVirtualViewportFromContainer,
    virtualTranscriptWindow.offsets,
    virtualTranscriptWindow.totalHeight,
    virtualViewport.viewportHeight,
  ])

  const navigateToConversationFindMatch = useCallback((match: ConversationFindMatch) => {
    const container = scrollContainerRef.current
    if (!container) return

    const viewportHeight = container.clientHeight || virtualViewport.viewportHeight || VIRTUAL_DEFAULT_VIEWPORT_HEIGHT
    const targetOffset = virtualTranscriptWindow.offsets[match.renderIndex] ?? virtualTranscriptWindow.totalHeight
    const targetScrollTop = clampNumber(
      targetOffset - viewportHeight * CONVERSATION_NAVIGATION_READING_ANCHOR_RATIO,
      0,
      Math.max(0, virtualTranscriptWindow.totalHeight - viewportHeight),
    )

    restoringScrollAnchorRef.current = null
    setActiveConversationFindMatch(match)
    shouldAutoScrollRef.current = false
    setIsAwayFromLatest(true)
    ignoreProgrammaticScrollUntilRef.current = performance.now() + 250
    ignoreProgrammaticScrollTopRef.current = targetScrollTop
    setScrollTopWithoutLayoutRead(container, targetScrollTop)
    setVirtualViewport({ scrollTop: targetScrollTop, viewportHeight })
  }, [virtualTranscriptWindow.offsets, virtualTranscriptWindow.totalHeight, virtualViewport.viewportHeight])
  const navigateToConversationFindMatchRef = useRef(navigateToConversationFindMatch)
  navigateToConversationFindMatchRef.current = navigateToConversationFindMatch
  const conversationFindRenderItemsRef = useRef(renderItems)
  conversationFindRenderItemsRef.current = renderItems
  const conversationFindStreamingTextRef = useRef(streamingText)
  conversationFindStreamingTextRef.current = streamingText
  const conversationFindControllerRef = useRef<ConversationFindController | null>(null)

  // "Locate in chat" from the trajectory view. The request arrives together
  // with the switch back to chat, so wait two frames for the list to have real
  // dimensions again before measuring offsets.
  const trajectoryNav = useTrajectoryViewStore((state) => (
    state.nav?.to === 'chat' && state.nav.sessionId === resolvedSessionId ? state.nav : null
  ))
  const consumeTrajectoryNav = useTrajectoryViewStore((state) => state.consumeNav)
  const handleNavigateToConversationItemRef = useRef(handleNavigateToConversationItem)
  handleNavigateToConversationItemRef.current = handleNavigateToConversationItem
  useEffect(() => {
    if (trajectoryNav?.to !== 'chat') return
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        consumeTrajectoryNav(trajectoryNav.nonce)
        const items = conversationFindRenderItemsRef.current
        const { index, toolUseId } = findChatRenderTarget(items, trajectoryNav.target)
        if (index < 0) return
        const key = getRenderItemKey(items[index]!)
        handleNavigateToConversationItemRef.current(
          { id: key, renderItemKey: key, renderIndex: index, turnNumber: 0, preview: '', attachmentCount: 0 },
          { toolUseId },
        )
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [consumeTrajectoryNav, trajectoryNav])

  useEffect(() => {
    if (!resolvedSessionId || resolvedSessionId !== activeTabId) return

    const controller: ConversationFindController = {
      search(query, preferredIndex = 0) {
        const matches = findConversationMatches(
          conversationFindRenderItemsRef.current,
          conversationFindStreamingTextRef.current,
          query,
        )
        conversationFindMatchesRef.current = matches
        const selectedMatch = matches[Math.min(preferredIndex, Math.max(0, matches.length - 1))]
        if (selectedMatch) {
          navigateToConversationFindMatchRef.current(selectedMatch)
        } else {
          setActiveConversationFindMatch(null)
          clearConversationFindHighlights()
        }
        return matches.length
      },
      navigate(index) {
        const match = conversationFindMatchesRef.current[index]
        if (match) navigateToConversationFindMatchRef.current(match)
      },
      clear() {
        conversationFindMatchesRef.current = []
        setActiveConversationFindMatch(null)
        clearConversationFindHighlights()
      },
    }
    conversationFindControllerRef.current = controller
    const unregister = registerConversationFindController(controller)
    return () => {
      if (conversationFindControllerRef.current === controller) {
        conversationFindControllerRef.current = null
      }
      unregister()
    }
  }, [activeTabId, resolvedSessionId])

  useEffect(() => {
    const controller = conversationFindControllerRef.current
    if (!controller) return
    const notify = () => {
      conversationFindRefreshTimerRef.current = null
      conversationFindLastRefreshAtRef.current = performance.now()
      notifyConversationFindContentChanged(controller)
    }
    if (conversationFindRefreshTimerRef.current !== null) return
    const remainingDelay = CONVERSATION_FIND_CONTENT_REFRESH_MS -
      (performance.now() - conversationFindLastRefreshAtRef.current)
    if (remainingDelay <= 0) {
      notify()
      return
    }
    conversationFindRefreshTimerRef.current = window.setTimeout(notify, remainingDelay)
  }, [renderItems, streamingText])

  useLayoutEffect(() => {
    if (!activeConversationFindMatch) {
      clearConversationFindHighlights()
      return
    }

    const root = scrollContentRef.current
    if (!root) return
    paintConversationFindHighlights(root, activeConversationFindMatch)
  }, [activeConversationFindMatch, virtualTranscriptWindow.items])

  const restoreWorkspaceOrigin = useCallback((origin: WorkspaceOrigin, attempt = 0) => {
    const container = scrollContainerRef.current
    const content = scrollContentRef.current
    if (!container || !content || !resolvedSessionId) return
    restoringScrollAnchorRef.current = null

    const renderItem = [...content.querySelectorAll<HTMLElement>('[data-chat-render-item-key]')]
      .find((node) => node.dataset.chatRenderItemKey === origin.sourceTurnKey)
    const opener = renderItem
      ? [...renderItem.querySelectorAll<HTMLElement>('[id]')]
          .find((node) => node.id === origin.sourceElementId)
          ?? (origin.sourceElementId.startsWith('turn-change-opener-')
            ? renderItem.querySelector<HTMLElement>('[data-turn-change-disclosure="true"]')
            : null)
      : null

    if (renderItem && opener) {
      if (!isRenderItemFullyVisibleInChatScroller(renderItem)) {
        renderItem.scrollIntoView({ block: 'nearest' })
      }
      opener.focus({ preventScroll: true })
      useWorkspaceStore.getState().setOrigin(resolvedSessionId, null)
      workspaceOriginRestoreFrameRef.current = null
      return
    }

    const renderIndex = renderItemKeys.indexOf(origin.sourceTurnKey)
    if (!renderItem && renderIndex >= 0) {
      const viewportHeight = container.clientHeight || virtualViewport.viewportHeight || VIRTUAL_DEFAULT_VIEWPORT_HEIGHT
      const targetScrollTop = clampNumber(
        (virtualTranscriptWindow.offsets[renderIndex] ?? 0) - viewportHeight * CONVERSATION_NAVIGATION_READING_ANCHOR_RATIO,
        0,
        Math.max(0, virtualTranscriptWindow.totalHeight - viewportHeight),
      )
      shouldAutoScrollRef.current = false
      setScrollTopWithoutLayoutRead(container, targetScrollTop)
      setVirtualViewport({ scrollTop: targetScrollTop, viewportHeight })
    }

    if (attempt >= 7 || renderIndex < 0) {
      useWorkspaceStore.getState().setOrigin(resolvedSessionId, null)
      workspaceOriginRestoreFrameRef.current = null
      return
    }

    workspaceOriginRestoreFrameRef.current = requestAnimationFrame(() => {
      restoreWorkspaceOrigin(origin, attempt + 1)
    })
  }, [
    renderItemKeys,
    resolvedSessionId,
    virtualTranscriptWindow.offsets,
    virtualTranscriptWindow.totalHeight,
    virtualViewport.viewportHeight,
  ])

  useEffect(() => {
    if (workspaceOriginSessionRef.current !== resolvedSessionId) {
      workspaceOriginSessionRef.current = resolvedSessionId
      if (workspaceOriginRestoreFrameRef.current !== null) {
        cancelAnimationFrame(workspaceOriginRestoreFrameRef.current)
        workspaceOriginRestoreFrameRef.current = null
      }
    }
    if (isWorkspacePanelOpen) {
      if (workspaceOriginRestoreFrameRef.current !== null) {
        cancelAnimationFrame(workspaceOriginRestoreFrameRef.current)
        workspaceOriginRestoreFrameRef.current = null
      }
      return
    }
    if (!workspacePanelOrigin || workspaceOriginRestoreFrameRef.current !== null) return

    workspaceOriginRestoreFrameRef.current = requestAnimationFrame(() => {
      workspaceOriginRestoreFrameRef.current = null
      restoreWorkspaceOrigin(workspacePanelOrigin)
    })
  }, [isWorkspacePanelOpen, resolvedSessionId, restoreWorkspaceOrigin, workspacePanelOrigin])


  /** Only the item a jump landed on hears about it, so other memoized items keep their props. */
  const navigationToolUseIdFor = (item: RenderItem): string | undefined => (
    highlightedNavigationToolUseId !== null && highlightedNavigationItemKey === getRenderItemKey(item)
      ? highlightedNavigationToolUseId
      : undefined
  )

  // A run stays open for the whole turn it belongs to, even after its own last
  // step resolves: the reply text that follows is not the end of the task, and
  // folding there hid reasoning the reader was still following.
  const turnActiveForItem = (item: RenderItem): boolean => (
    isTurnRunning && renderItemTimestamp(item) >= lastUserMessageTimestamp
  )

  const renderTranscriptItem = (item: RenderItem, index: number) => {
    const cardsForItem = turnCardsByRenderIndex.get(index) ?? []
    // 尾件段里有 message（唤醒回复）也有 tool_group（唤醒段的活动组）
    const tailMeta = turnTailMetaByIndex.get(index)
    // 时间戳已委托给尾件段末尾渲染的收尾回复，本体不再内嵌时间戳
    const stampDelegated = item.kind === 'message'
      && turnStampHostByMessageId.has(item.message.id)
    const messageBody = item.kind === 'message' ? (
      <MessageBlock
        sessionId={resolvedSessionId}
        message={item.message}
        team={memberSessionTeam ?? undefined}
        activeThinkingId={activeThinkingId}
        reasoningTurnActive={
          isTurnRunning && item.message.timestamp >= lastUserMessageTimestamp
        }
        thinkingDurationMs={thinkingDurations.get(item.message.id)}
        agentTaskNotifications={agentTaskNotifications}
        toolResult={
          item.message.type === 'tool_use'
            ? toolResultByToolUseId.get(item.message.toolUseId) ?? null
            : null
        }
        branchAction={branchActionByMessageId.get(item.message.id)}
        editAction={editActionByMessageId.get(item.message.id)}
        turnChangedFiles={changedFilesByRenderIndex.get(index)?.changedFiles}
        turnOutputEvidence={changedFilesByRenderIndex.get(index) ?? (turnEvidenceUnavailable ? UNKNOWN_TURN_OUTPUT_EVIDENCE : undefined)}
        turnChangeTarget={changedFilesByRenderIndex.get(index)?.turnChangeTarget}
        isTurnOutputOwner={turnOutputOwnerIndexes.has(index)}
        turnCompletion={stampDelegated ? undefined : turnCompletionByMessageId.get(item.message.id)}
        supersededAskUserQuestionIds={supersededAskUserQuestionIds}
        decisionsInComposer={decisionsInComposer}
        navigationHighlighted={
          item.message.type === 'tool_use' &&
          navigationToolUseIdFor(item) === item.message.toolUseId
        }
      />
    ) : null

    // 唤醒段尾件（思考块与后台自动回复行）统一收进折叠容器，时间戳行
    // 渲染在段末尾件之后——顺序成为：对话总结 → 折叠尾件 → 时间信息
    const tailContent = tailMeta
      ? (
        <TurnTailGroup
          expanded={turnTailExpandedKeys.has(tailMeta.disclosureKey!)}
          onToggle={() => {
            const key = tailMeta.disclosureKey!
            // 统一状态翻转；所有尾件 item 读同一 state 整体重渲染
            setTurnTailExpandedKeys(current => {
              const nextKeys = new Set(current)
              if (nextKeys.has(key)) nextKeys.delete(key)
              else nextKeys.add(key)
              return nextKeys
            })
          }}
          count={tailMeta.tailCount}
          firstInGroup={tailMeta.firstInGroup}
          lastInGroup={tailMeta.lastInGroup}
          stamp={tailMeta.lastInGroup ? tailMeta.stamp : null}
        >
          {item.kind === 'message' && item.wakeReply && item.message.type === 'assistant_text'
            ? <BackgroundReplyFold disclosureKey={getRenderItemKey(item)}>{messageBody}</BackgroundReplyFold>
            : messageBody}
        </TurnTailGroup>
      )
      : null

    return (
      <>
        <RenderItemBoundary>
          {tailContent !== null ? (
            // 唤醒段尾件（活动组与后台自动回复行）优先进入回合折叠容器
            tailContent
          ) : item.kind === 'tool_group' ? (
            <ToolCallGroup
              sessionId={resolvedSessionId}
              onOpenAgentRun={onOpenAgentRun}
              resolveAgentActivityTarget={resolveAgentActivityTarget}
              toolCalls={item.toolCalls}
              steps={item.steps}
              resultMap={toolResultMap}
              childToolCallsByParent={childToolCallsByParent}
              agentTaskNotifications={agentTaskNotifications}
              agentTaskStatuses={agentTaskStatuses}
              activeThinkingId={activeThinkingId}
              isStreaming={
                chatState === 'tool_executing' &&
                item.toolCalls.some((tc) => !toolResultMap.has(tc.toolUseId))
              }
              // Only the tail of a live turn can still grow. Everything above it
              // is finished, whatever any individual tool's state looks like this
              // instant. This drives the running marker; folding follows the
              // turn (`turnActive`), not the run's own tail.
              isLive={chatState !== 'idle' && index === renderItems.length - 1 && !hasTrailingStreamingItem}
              turnActive={turnActiveForItem(item)}
              disclosureKey={getRenderItemKey(item)}
              revealToolUseId={navigationToolUseIdFor(item)}
              backgroundTasksByToolUseId={backgroundTasksByToolUseId}
              activityPresentation={mobileLayout ? 'sheet' : 'inline'}
            />
          ) : item.kind === 'team_card' ? (
            resolvedSessionId ? (() => {
              const cardSnapshot = snapshotForTeamCard(teamSnapshot, item)
              const fallbackPhase = item.endedAt !== undefined || teamTaskWindows.some((window) => (
                item.startedAt >= window.startedAt &&
                window.endedAt !== undefined &&
                item.startedAt <= window.endedAt
              )) ? 'completed' : 'forming'
              // An ended team's tasks say how it ended. Without its record, a
              // team its lead deleted is taken as done, and one the host
              // removed (a cancelled or ended plan) only as ended.
              const ended = cardSnapshot ? endedPhase(cardSnapshot) : item.deletedByLead ? 'completed' : 'ended'
              return (
              <AgentTeamsInlineCard
                snapshot={cardSnapshot}
                teamName={item.teamName}
                fallbackPhase={fallbackPhase}
                phaseOverride={item.endedAt !== undefined
                  ? ended
                  : cardSnapshot && !cardSnapshot.deletedAt && cardSnapshot.team.name === interruptedTeamName ? 'interrupted' : undefined}
                onOpen={cardSnapshot
                  ? () => openTeamWorkbench(resolvedSessionId, cardSnapshot.team.name)
                  : undefined}
              >
                <TeamCoordinationAudit toolCalls={item.coordinationToolCalls} />
              </AgentTeamsInlineCard>
              )
            })() : null
          ) : item.kind === 'message' && item.wakeReply && item.message.type === 'assistant_text' ? (
            <BackgroundReplyFold disclosureKey={getRenderItemKey(item)}>
              {messageBody}
            </BackgroundReplyFold>
          ) : messageBody}
        </RenderItemBoundary>


        {resolvedSessionId && cardsForItem.map((card) => {
          const checkpointId = card.checkpoint.target.targetUserMessageId
          const disclosureKey = JSON.stringify([resolvedSessionId, checkpointId])
          const error = turnActionErrors[card.target.messageId] ?? null
          const openUndoDialog = () => {
            if (!turnUndoBlocked) setTurnUndoConfirmTarget({ sessionId: resolvedSessionId, checkpointId })
          }
          if (!card.checkpoint.code.available) {
            return (
              <div
                key={`conversation-rewind-${checkpointId}`}
                className="mt-1 flex flex-wrap items-center gap-2 px-1"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  loading={rewindingTurnId === card.target.messageId}
                  disabled={turnUndoBlocked}
                  onClick={openUndoDialog}
                  icon={<Undo2 size={13} strokeWidth={2} aria-hidden="true" />}
                >
                  {t('chat.conversationRewindAction')}
                </Button>
                {error ? (
                  <span role="alert" className="text-xs text-[var(--color-error)]">
                    {error}
                  </span>
                ) : null}
              </div>
            )
          }
          return (
            <CurrentTurnChangeCard
              key={`turn-change-${checkpointId}`}
              sessionId={resolvedSessionId}
              expanded={expandedChangeCards[disclosureKey] ?? false}
              onExpandedChange={(expanded) => setExpandedChangeCards((current) => ({
                ...current,
                [disclosureKey]: expanded,
              }))}
              checkpoint={card.checkpoint}
              workDir={card.workDir}
              error={error}
              isUndoing={rewindingTurnId === card.target.messageId}
              undoDisabled={turnUndoBlocked}
              isLatest={card.isLatest}
              onUndo={openUndoDialog}
            />
          )
        })}
      </>
    )
  }

  return (
    <ScrollSnapshotBoundary sessionId={resolvedSessionId} onLeave={() => {
      const container = scrollContainerRef.current
      if (resolvedSessionId && container && container.clientHeight > 0) {
        rememberSessionScroll(resolvedSessionId, container, shouldAutoScrollRef.current)
      }
    }}>
    <ConversationImageGalleryContext.Provider
      value={getConversationImages}
    >
    <div ref={messageListRef} data-testid="message-list" className="relative min-h-0 flex-1">
      <div
        ref={scrollContainerRef}
        onScroll={updateAutoScrollState}
        // Native scroll anchoring carries position across content growth; the
        // chat timeline mounts one array, so no page-boundary compensation is
        // needed and disabling the browser anchor only adds a frame of jump.
        onClickCapture={handleDisclosureToggle}
        onWheel={handleWheelScrollIntent}
        onPointerDown={markUserScrollIntent}
        onTouchStart={markUserScrollIntent}
        onFocusCapture={markUserScrollIntent}
        onKeyDown={handleKeyDownScrollIntent}
        className={`${CHAT_SCROLL_AREA_CLASS} h-full overflow-y-auto ${chatScrollPaddingClass}`}
      >
        <div
          // A malformed/replayed history can contain duplicate row identities.
          // React can leave those rows outside its tracked child list; replace
          // the transcript as a unit on session changes so none can follow the
          // user into another session. Keep the scroller outside this boundary
          // so its outgoing scroll snapshot is still captured before the swap.
          key={resolvedSessionId}
          ref={scrollContentRef}
          // The reading measure holds whether or not a right-hand panel is
          // open — `compact` only tightens padding. Dropping to `max-w-full`
          // was what made the transcript lose its centred structure the moment
          // the agent-teams workbench appeared.
          className="mx-auto max-w-[var(--chat-content-max-width)]"
        >
          {sessionState?.historyWindowed && sessionState?.historyPage?.nextCursor ? (
            // The server's byte budget cut history short; this is the only
            // remaining pagination seam, and it is user-driven.
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-[var(--color-text-tertiary)]">
              {sessionState.historyPageLoading ? (
                <div className="flex items-center gap-2" role="status">
                  <LoaderCircle size={12} className="animate-spin" />{t('chat.history.loading')}
                </div>
              ) : sessionState.historyError ? (
                <>
                  <span role="alert" className="text-[var(--color-text-secondary)]">{t('chat.history.loadFailed')}</span>
                  <Button variant="ghost" size="xs" onClick={() => resolvedSessionId && void loadOlderHistory(resolvedSessionId)}>{t('chat.history.retry')}</Button>
                </>
              ) : (
                <Button variant="ghost" size="xs" onClick={() => resolvedSessionId && void loadOlderHistory(resolvedSessionId)}>{t('chat.history.loadMore')}</Button>
              )}
            </div>
          ) : null}
          {virtualTranscriptWindow.enabled ? (
            <VirtualSpacer height={virtualTranscriptWindow.beforeHeight} position="top" />
          ) : null}

          {virtualTranscriptWindow.items.map(({ item, index }) => {
            const itemKey = getRenderItemKey(item)
            const mountKey = changeCardMounts.aliases.get(itemKey) ?? groupMountKeys.keys.get(itemKey) ?? itemKey
            const content = renderTranscriptItem(item, index)
            const railPosition = turnRailPositions[index] ?? 'none'
            // The prompt editor opens its slash and @ menus upward, past the
            // row's own box; paint containment would cut them off.
            const paintContained = !(item.kind === 'message' && editActionByMessageId.get(item.message.id)?.editing)

            return virtualTranscriptWindow.enabled ? (
              <MeasuredRenderItem
                key={mountKey}
                itemKey={itemKey}
                onHeightChange={handleVirtualItemHeightChange}
                highlighted={highlightedNavigationItemKey === itemKey}
                railPosition={railPosition}
              >
                {content}
              </MeasuredRenderItem>
            ) : (
              <div
                key={mountKey}
                data-chat-render-item-key={itemKey}
                data-turn-rail={railPosition}
                className={`${CHAT_RENDER_ITEM_CLASS} ${paintContained ? 'chat-render-item--cv ' : ''}${turnRailClass(railPosition)} ${highlightedNavigationItemKey === itemKey ? 'chat-render-item--navigation-target' : ''}`}
              >
                {content}
              </div>
            )
          })}

          {virtualTranscriptWindow.enabled ? (
            <VirtualSpacer height={virtualTranscriptWindow.afterHeight} position="bottom" />
          ) : null}

          {streamingText.trim() && (
            <div
              data-chat-render-item-key={STREAMING_ASSISTANT_NAVIGATION_KEY}
              data-turn-rail={streamingRailPosition}
              className={turnRailClass(streamingRailPosition)}
            >
              <AssistantMessage content={streamingText} isStreaming={chatState === 'streaming'} />
            </div>
          )}

          {chatState === 'compacting' && !hasCompactingDivider && (
            <CompactStatusDivider state="compacting" />
          )}

          {/* Show StreamingIndicator when:
              - tool_executing: background work is running
              - thinking but no active ThinkingBlock yet: the gap between
                sending a message and receiving the first thinking delta
              The live status stays in the transcript, next to the output it is
              describing — it is part of the conversation, not composer chrome. */}
          {showsTurnStatusLine && (
            // On the rail, so the lit line runs all the way down to the status
            // it explains — except while preparing a turn, when no transcript
            // item exists yet and the status has to stand on its own.
            <div className={renderItems.length === 0 ? undefined : turnRailClass('end')}>
              <StreamingIndicator />
            </div>
          )}

          {turnChangeLoadError && (
            <div className="mx-auto mb-5 w-full max-w-[var(--chat-content-max-width)] rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3.5 py-2.5 text-xs text-[var(--color-on-error-container)]">
              {turnChangeLoadError}
            </div>
          )}

          {chatState === 'idle' && !hasRunningBackgroundTasks &&
            workspaceChangesFallback ? (
              <WorkspaceChangesFallback
                key={workspaceChangesFallback.request.sessionId}
                sessionId={workspaceChangesFallback.request.sessionId}
                files={workspaceChangesFallback.files}
              />
            ) : null}

          <div />
        </div>
      </div>

      {showConversationNavigator ? (
        <ConversationNavigator
          mode={conversationNavigationMode}
          items={conversationNavigationItems}
          activeItemId={visibleConversationNavigationItemId}
          onNavigate={handleNavigateToConversationItem}
        />
      ) : null}

      {isAwayFromLatest && (
        <Button
          variant="secondary"
          size="md"
          onClick={handleJumpToLatest}
          title={t('chat.jumpToLatest')}
          aria-label={t('chat.jumpToLatest')}
          // `glass-panel` is unlayered CSS, so it wins over the variant's
          // layered background/border utilities without a tailwind-merge.
          // Centred over the composer, which the transcript column shares its
          // measure with: the button marks "there is more below", so it belongs
          // on the same axis as the input rather than in a corner.
          className="glass-panel absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full text-[13px] font-medium hover:-translate-y-px motion-reduce:hover:translate-y-0"
          icon={<ArrowDown size={15} aria-hidden="true" />}
        >
          {t('chat.jumpToLatest')}
        </Button>
      )}

      <ActionDialog
        open={Boolean(confirmTurnCard)}
        onClose={() => {
          if (!rewindingTurnId) {
            setTurnUndoConfirmTarget(null)
          }
        }}
        title={confirmTurnCard?.isLatest
          ? t('chat.turnChangesLatestConfirmTitle')
          : t('chat.turnChangesHistoricalConfirmTitle')}
        body={confirmBody}
        actions={confirmActions}
        width={520}
        loading={Boolean(rewindingTurnId)}
      />
      <ActionDialog
        open={editResendDialog.open}
        onClose={editResendDialog.onClose}
        title={editResendDialog.title}
        body={editResendDialog.body}
        actions={editResendDialog.actions}
        width={520}
        loading={editResendDialog.loading}
      />
    </div>
    </ConversationImageGalleryContext.Provider>
    </ScrollSnapshotBoundary>
  )
}

export const MessageBlock = memo(function MessageBlock({
  sessionId,
  message,
  team,
  activeThinkingId,
  reasoningTurnActive = false,
  thinkingDurationMs,
  agentTaskNotifications,
  toolResult,
  branchAction,
  editAction,
  turnChangedFiles,
  turnOutputEvidence,
  turnChangeTarget,
  isTurnOutputOwner,
  turnCompletion,
  supersededAskUserQuestionIds,
  decisionsInComposer = false,
  navigationHighlighted = false,
}: {
  sessionId?: string | null
  message: UIMessage
  team?: TeamDetail
  activeThinkingId: string | null
  /** 该消息属于仍在运行的回合，思考正文在增量停止后继续保持展开。 */
  reasoningTurnActive?: boolean
  /** 该思考块从开始到下一条消息的时长，用于折叠行的「用时」摘要。 */
  thinkingDurationMs?: number
  agentTaskNotifications: Record<string, AgentTaskNotification>
  toolResult?: { content: unknown; isError: boolean } | null
  branchAction?: {
    label: string
    loading?: boolean
    onBranch: () => void
  }
  editAction?: UserMessageEditAction
  turnChangedFiles?: string[]
  turnOutputEvidence?: TurnOutputEvidence
  turnChangeTarget?: { turnKey: string; userMessageIndex: number }
  isTurnOutputOwner?: boolean
  turnCompletion?: TurnCompletion
  supersededAskUserQuestionIds?: ReadonlySet<string>
  decisionsInComposer?: boolean
  /** A "locate in chat" jump landed on this tool call. */
  navigationHighlighted?: boolean
}) {
  const t = useTranslation()
  const teammateVisual = message.type === 'user_text' && message.teammateFrom && team
    ? (() => {
        const { member, isLead } = resolveTeamMemberIdentity(team, message.teammateFrom)
        const avatarKey = getMemberAvatarKey(member, isLead)
        const memberIndex = Math.max(0, team.members.findIndex((candidate) => candidate.agentId === member.agentId))
        return {
          avatarKey,
          avatarSrc: MEMBER_AVATARS[avatarKey],
          accent: memberAccentColor(member.color, memberIndex),
        }
      })()
    : null

  switch (message.type) {
    case 'user_text':
      if (message.scheduledTask) return <ScheduledTaskTrigger trigger={message.scheduledTask} />
      return (
        <SelectableChatMessage
          sessionId={sessionId}
          messageId={message.id}
          role="user"
          content={message.content}
        >
          <UserMessage
            content={message.content}
            modelContent={message.modelContent}
            attachments={message.attachments}
            sessionReferences={message.sessionReferences}
            collaboration={message.collaboration}
            branchAction={branchAction}
            editAction={editAction}
            timestamp={message.timestamp}
            sessionId={sessionId ?? undefined}
            teammateFrom={message.teammateFrom}
            teammateAvatarSrc={teammateVisual?.avatarSrc}
            teammateAvatarKey={teammateVisual?.avatarKey}
            teammateAccent={teammateVisual?.accent}
          />
        </SelectableChatMessage>
      )
    case 'assistant_text':
      return (
        <SelectableChatMessage
          sessionId={sessionId}
          messageId={message.id}
          role="assistant"
          content={message.content}
        >
          <AssistantMessage
            content={message.content}
            branchAction={branchAction}
            sessionId={sessionId ?? undefined}
            turnChangedFiles={turnChangedFiles}
            turnOutputEvidence={turnOutputEvidence}
            turnChangeTarget={turnChangeTarget}
            isTurnOutputOwner={isTurnOutputOwner}
            turnCompletion={turnCompletion}
          />
          {isCliApiErrorText(message.content) && (
            <MagpieConnectionHint sessionId={sessionId} errorText={message.content} />
          )}
        </SelectableChatMessage>
      )
    case 'thinking':
      // No wrapper padding: the row's own `-mx-2 … px-2` already lands its text
      // on the column's left edge, the same as one inside a run.
      return (
        <ThinkingBlock
          content={message.content}
          isActive={message.id === activeThinkingId}
          isTurnActive={reasoningTurnActive}
          disclosureKey={message.id}
          durationMs={thinkingDurationMs}
        />
      )
    case 'tool_use': {
      const scheduledResult = toolResult && parseScheduledTaskResult(message.toolName, toolResult.content, toolResult.isError)
      if (scheduledResult) return <ScheduledTaskCard result={scheduledResult} />
      if (message.toolName === 'AskUserQuestion' && !message.isPending) {
        return (
          <AskUserQuestion
            sessionId={sessionId}
            toolUseId={message.toolUseId}
            input={message.input}
            result={toolResult?.content}
            supersededByUserMessage={supersededAskUserQuestionIds?.has(message.toolUseId)}
            markerWhenPending={decisionsInComposer}
          />
        )
      }
      // No durationMs prop here on purpose: buildRenderModel only emits a
      // standalone tool_use item for AskUserQuestion, and this branch is reached
      // only while such a call is still pending — so there is never a result to
      // measure against. The badge is wired in ToolCallGroup, the path every
      // other tool call takes.
      return (
        <ToolCallBlock
          toolName={message.toolName}
          input={message.input}
          result={toolResult}
          sessionId={sessionId}
          isPending={message.isPending}
          status={message.status}
          partialInput={message.partialInput}
          disclosureKey={message.toolUseId}
          toolUseId={message.parentToolUseId ? undefined : message.toolUseId}
          navigationHighlighted={navigationHighlighted}
          agentTaskNotification={
            message.toolName === 'Agent'
              ? agentTaskNotifications[message.toolUseId]
              : undefined
          }
        />
      )
    }
    case 'tool_result':
      return (
        <ToolResultBlock
          content={message.content}
          isError={message.isError}
          standalone
          disclosureKey={message.id}
        />
      )
    case 'permission_request':
      return (
        <PermissionDialog
          sessionId={sessionId}
          requestId={message.requestId}
          toolName={message.toolName}
          input={message.input}
          description={message.description}
          displayName={message.displayName}
          markerWhenPending={decisionsInComposer}
        />
      )
    case 'error': {
      const businessErrorKey = message.businessErrorCode
        ? `businessError.${message.businessErrorCode}` as TranslationKey
        : null
      const businessErrorText = businessErrorKey ? t(businessErrorKey) : null
      const errorKey = message.code ? `error.${message.code}` as TranslationKey : null
      const errorText = errorKey ? t(errorKey) : null
      const displayMessage =
        businessErrorText && businessErrorText !== businessErrorKey
          ? businessErrorText
          : (errorText && errorText !== errorKey)
            ? errorText
            : message.message
      const showRawDetail =
        (!message.businessErrorCode ||
          BUSINESS_ERRORS_WITH_RAW_DETAIL.has(message.businessErrorCode)) &&
        Boolean(message.message) &&
        message.message.trim() !== '' &&
        message.message !== displayMessage
      return (
        <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--color-error-container)] px-3.5 py-2.5 text-[13px] text-[var(--color-on-error-container)]">
          <strong>{t('common.error')}:</strong> {displayMessage}
          {showRawDetail && (
            <div className="mt-1 whitespace-pre-wrap text-xs text-[var(--color-on-error-container)]">
              {message.message}
            </div>
          )}
          <MagpieConnectionHint sessionId={sessionId} errorText={message.message} />
        </div>
      )
    }
    case 'task_summary':
      return <InlineTaskSummary tasks={message.tasks} />
    case 'memory_event':
      return <MemoryEventCard message={message} />
    case 'compact_summary':
      return <CompactStatusDivider message={message} state={message.phase === 'compacting' ? 'compacting' : 'complete'} />
    case 'goal_event':
      return message.action === 'status' && message.status === 'continuing'
        ? <GoalContinuationDivider message={message} />
        : <GoalEventCard message={message} />
    case 'background_task':
      return null
    case 'system':
      return (
        <div className="mb-3 text-center text-xs text-[var(--color-text-tertiary)]">
          {message.content}
        </div>
      )
  }
})

/**
 * 回合尾件折叠容器：收尾回复之后的后台唤醒段（思考块与自动回复行）按回合
 * 收进一层折叠，收起时只显示一行摘要。展开状态记在 disclosureMemory 的
 * 同一个组 key 上——尾件是独立的虚拟 item，各实例靠它保持一致。
 * 段末尾件负责渲染本轮的时间信息行（从收尾回复处挪过来的完成时间戳）。
 */
function TurnTailGroup({
  expanded,
  onToggle,
  count,
  firstInGroup,
  lastInGroup,
  stamp,
  children,
}: {
  expanded: boolean
  onToggle: () => void
  count: number
  firstInGroup: boolean
  lastInGroup: boolean
  stamp: TurnCompletion | null
  children: ReactNode
}) {
  const t = useTranslation()

  return (
    <div className="min-w-0">
      {firstInGroup && (
        <button
          type="button"
          data-chat-disclosure="true"
          onClick={onToggle}
          aria-expanded={expanded}
          className="-mx-2 flex h-7 min-w-[calc(100%+1rem)] items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[13px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
        >
          <Brain size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span className="min-w-0 truncate">{t('chat.turnTailSummary', { count })}</span>
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
          />
        </button>
      )}
      {expanded && (
        <div className="min-w-0">
          {children}
        </div>
      )}
      {lastInGroup && stamp ? (
        <div className="mt-1 pl-1">
          <TurnCompletionStamp completion={stamp} />
        </div>
      ) : null}
    </div>
  )
}
