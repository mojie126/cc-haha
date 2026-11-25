import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { getDisclosure, setDisclosure } from '../../lib/disclosureMemory'
import { toolResultImagesFor, type ToolResultImageExtraction } from '@/lib/toolResultContent'
import { Check, ChevronRight, CirclePause, CircleX, LoaderCircle } from 'lucide-react'
import { MobileBottomSheet } from '@/components/ui/MobileBottomSheet'
import { ToolCallBlock, formatDuration } from './ToolCallBlock'
import { ThinkingBlock } from './ThinkingBlock'
import { ToolResultImages } from './ToolResultImages'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import {
  activityDurationMs,
  activityStepToolCalls,
  buildActivitySegments,
  countFailedToolCalls,
  formatActivitySummary,
  hasUnresolvedToolCalls,
  toolCallDurationMs,
  type ActivityStep,
} from './activityGroupModel'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../stores/settingsStore'
import type { BackgroundAgentTask, UIMessage } from '../../types/chat'

type ToolCall = Extract<UIMessage, { type: 'tool_use' }>
type ToolResult = Extract<UIMessage, { type: 'tool_result' }>

type Props = {
  /** Session that owns the run, used to read edited files for real diff line numbers. */
  sessionId?: string | null
  steps: ActivityStep[]
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  activeThinkingId?: string | null
  /** When true, the last step is still executing. */
  isStreaming?: boolean
  /**
   * This run is the tail of a turn that is still going, so more steps may land
   * in it. Distinct from `isStreaming`: that one dips false in the gap between
   * one tool resolving and the next starting, many times inside a single run.
   */
  isLive?: boolean
  /**
   * The turn this run belongs to is still running. Folding keys off this, not
   * `isLive`: a handoff to the reply text or the next step ends the run while
   * the turn goes on, and folding there hid reasoning the reader was still
   * following.
   */
  turnActive?: boolean
  /** Stable key that survives virtualized row unmount/remount. */
  disclosureKey?: string
  /**
   * A "locate in chat" jump landed on this call. A folded run would hide it,
   * so the run opens (and stays open, as if the reader had clicked) and the
   * row is marked while the jump's highlight lasts.
   */
  revealToolUseId?: string
  /** Calls whose permission prompt is waiting on the user. */
  awaitingToolUseIds?: ReadonlySet<string>
  /**
   * 后台任务的最终状态，按启动它的工具调用 id 关联，让读者在调用处看到
   * 那个后台任务后来怎么样了，而不必去对话末尾找唤醒后的回复。
   */
  backgroundTasksByToolUseId?: ReadonlyMap<string, BackgroundAgentTask>
  /**
   * `inline` opens the run in place. `sheet` (the phone) keeps every run one
   * card: the counted summary, plus the step under way while it runs; a tap
   * opens the whole timeline in a sheet. A run unfolding in place on a phone
   * pushed the conversation off the screen a step at a time.
   */
  presentation?: 'inline' | 'sheet'
}

const MAX_HEADER_ICONS = 3

function isAwaiting(toolCall: ToolCall, awaiting?: ReadonlySet<string>): boolean {
  if (!awaiting || awaiting.size === 0) return false
  return awaiting.has(toolCall.toolUseId) ||
    (toolCall.originalToolUseId !== undefined && awaiting.has(toolCall.originalToolUseId))
}

/**
 * The vertical rail of a run: a 1px line through the centres of the rows'
 * 22px nodes. It runs behind the details too, so an opened diff or terminal
 * still reads as hanging off its step.
 */
export function ToolTimeline({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div data-tool-timeline="" className={`relative ${className}`}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-3 left-[11.5px] top-3 w-px bg-[var(--color-border)]"
      />
      {children}
    </div>
  )
}

/**
 * One contiguous run of thinking + tool calls.
 *
 * It plays open while it runs, so the reader can watch the work, then folds
 * itself into a single counted line the moment it finishes: `思考 2 次、读取
 * 1 个文件、运行 1 条命令`. Standing rows open forever flattened the transcript —
 * machinery took as much room as the sentences it produced, and nothing looked
 * more important than anything else. A counted digest is small enough to skip
 * and specific enough to be worth reading, which a vaguer "ran some commands"
 * never was.
 *
 * Clicking pins the reader's choice: from then on that run stays as they left
 * it, instead of snapping shut under them when the next step resolves.
 *
 * A run holding exactly one tool call never summarises: "Read 1 file" over a
 * hidden `Read MessageList.tsx` row is strictly less than the row itself.
 */
export const ActivityGroup = memo(function ActivityGroup({
  sessionId,
  steps,
  resultMap,
  childToolCallsByParent,
  activeThinkingId,
  isStreaming,
  isLive = false,
  turnActive = false,
  disclosureKey,
  revealToolUseId,
  awaitingToolUseIds,
  backgroundTasksByToolUseId,
  presentation = 'inline',
}: Props) {
  const t = useTranslation()
  const [sheetOpen, setSheetOpen] = useState(false)
  /** null = follow the run's own state; set = the reader decided. */
  const [pinnedCollapsedLocal, setPinnedCollapsedLocal] = useState<boolean | null>(null)
  const pinnedCollapsed = disclosureKey
    ? (getDisclosure(disclosureKey) ?? pinnedCollapsedLocal)
    : pinnedCollapsedLocal
  // 读者一旦手动开合，自动折叠就不再覆盖这次选择。
  const userPinnedRef = useRef(false)
  const setPinnedCollapsed = (next: boolean | null) => {
    userPinnedRef.current = next !== null
    setPinnedCollapsedLocal(next)
    if (disclosureKey && next !== null) setDisclosure(disclosureKey, next)
  }
  // 完成即折叠：回合结束自动折回摘要行（Responses 风格），
  // 此后手动展开仍会保留，直到下一次直播态开始。关闭推理折叠时不做这次
  // 自动折叠，历史回合的工具过程保持展开。
  const reasoningFoldEnabled = useSettingsStore((state) => state.reasoningFoldEnabled)
  const wasTurnActiveRef = useRef(turnActive)
  useEffect(() => {
    if (reasoningFoldEnabled && wasTurnActiveRef.current && !turnActive && !userPinnedRef.current) {
      setPinnedCollapsedLocal(true)
    }
    wasTurnActiveRef.current = turnActive
  }, [turnActive, reasoningFoldEnabled])
  // 开关切换时清掉自动折叠与读者 pin，让新的默认值立即生效。
  const previousFoldEnabledRef = useRef(reasoningFoldEnabled)
  useEffect(() => {
    if (previousFoldEnabledRef.current === reasoningFoldEnabled) return
    previousFoldEnabledRef.current = reasoningFoldEnabled
    userPinnedRef.current = false
    setPinnedCollapsedLocal(null)
  }, [reasoningFoldEnabled])

  const toolCalls = useMemo(() => activityStepToolCalls(steps), [steps])
  const revealsHere = revealToolUseId !== undefined && toolCalls.some((toolCall) => toolCall.toolUseId === revealToolUseId)
  useEffect(() => {
    if (revealsHere) setPinnedCollapsedLocal(false)
    // Pin once per request; `setPinnedCollapsedLocal` is recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealsHere, revealToolUseId])
  const failedCount = countFailedToolCalls(toolCalls, resultMap, childToolCallsByParent)
  const hasActiveThinking = Boolean(activeThinkingId) && steps.some(
    (step) => step.kind === 'thinking' && step.message.id === activeThinkingId,
  )
  const isRunning =
    Boolean(isStreaming) ||
    hasActiveThinking ||
    hasUnresolvedToolCalls(toolCalls, resultMap, childToolCallsByParent)
  // Only a run that is still being written to may claim to be in progress. A
  // transcript whose last call never got a result (the process died) is
  // unresolved forever, and a spinner on it would be a lie.
  const showsProgress = isRunning && (isLive || Boolean(isStreaming) || hasActiveThinking)
  const awaitingCount = toolCalls.filter((toolCall) => !resultMap.has(toolCall.toolUseId) && isAwaiting(toolCall, awaitingToolUseIds)).length
  // Keyed off the turn, never off "a tool is executing right now" or the run's
  // own tail. Both flicker inside a turn — a tool resolving and the next one
  // starting, or the reply text beginning to stream — and folding on either made
  // the block open and shut under the reader while they were watching it.
  // Open in the same render the request arrives in, so the row is in the DOM
  // for the scroll that follows; the effect above makes it stick.
  const collapsed = revealsHere
    ? false
    : (pinnedCollapsed ?? (reasoningFoldEnabled ? !turnActive : false))
  const rowProps = {
    resultMap,
    childToolCallsByParent,
    sessionId,
    revealToolUseId,
    awaitingToolUseIds,
    backgroundTasksByToolUseId,
    live: showsProgress,
  }

  const soleToolCall = steps.length === 1 && steps[0]?.kind === 'tool' ? steps[0].toolCall : null
  if (soleToolCall && presentation === 'inline') {
    return (
      <div>
        <div
          data-testid="activity-group"
          data-single-step="true"
        >
          <ToolTimeline>
            <ActivityToolRow toolCall={soleToolCall} {...rowProps} />
          </ToolTimeline>
        </div>
      </div>
    )
  }

  const segments = buildActivitySegments(steps, t)
  const elapsed = activityDurationMs(steps, resultMap)
  const durationLabel = !isRunning && typeof elapsed === 'number' ? formatDuration(elapsed) : ''
  const summaryText = formatActivitySummary(segments, t)
  // One glyph per kind of work: searching the web and reading a page share the
  // globe, and two globes side by side read as a rendering glitch.
  const headerIcons = segments
    .filter((segment, index) => segments.findIndex((other) => other.icon === segment.icon) === index)
    .slice(0, MAX_HEADER_ICONS)

  if (presentation === 'sheet') {
    const lastToolStep = [...steps].reverse().find((step) => step.kind === 'tool')
    const liveToolCall = showsProgress && lastToolStep?.kind === 'tool' ? lastToolStep.toolCall : null
    const timeline = (
      <ToolTimeline>
        {steps.map((step) => step.kind === 'thinking' ? (
          <TimelineThinking
            key={step.message.id}
            content={step.message.content}
            isActive={step.message.id === activeThinkingId}
            isTurnActive={turnActive}
          />
        ) : step.kind === 'text' ? (
          <TimelineCommentary key={step.message.id} content={step.message.content} />
        ) : (
          <ActivityToolRow key={step.toolCall.id} toolCall={step.toolCall} {...rowProps} />
        ))}
      </ToolTimeline>
    )
    return (
      <div
        data-testid="activity-group"
        data-presentation="sheet"
        data-running={isRunning ? 'true' : 'false'}
        className={`overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface-container-lowest)] ${
          showsProgress ? 'border-[var(--color-info)]' : 'border-[var(--color-border)]'
        }`}
      >
        <button
          type="button"
          data-chat-disclosure="true"
          aria-haspopup="dialog"
          onClick={() => setSheetOpen(true)}
          className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[13px] focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
        >
          <span
            aria-hidden="true"
            className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border ${
              awaitingCount > 0
                ? 'border-[var(--color-warning)] bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)]'
                : showsProgress
                ? 'border-[var(--color-info)] bg-[var(--color-info-container)] text-[var(--color-on-info-container)]'
                : failedCount > 0
                ? 'border-[var(--color-error-container)] bg-[var(--color-error-container)] text-[var(--color-on-error-container)]'
                : 'border-[var(--color-success)] bg-[var(--color-success-container)] text-[var(--color-on-success-container)]'
            }`}
          >
            {awaitingCount > 0 ? <CirclePause size={12} strokeWidth={2} />
              : showsProgress ? <LoaderCircle size={12} strokeWidth={2} className="animate-spin" />
              : failedCount > 0 ? <CircleX size={12} strokeWidth={2} />
              : <Check size={12} strokeWidth={2} />}
          </span>
          <span data-activity-summary="" className="min-w-0 flex-1 truncate font-medium text-[var(--color-text-primary)]">
            {summaryText}
          </span>
          {failedCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] tabular-nums text-[var(--color-error)]">
              {t('toolGroup.failedCount', { count: failedCount })}
            </span>
          )}
          {awaitingCount > 0 ? (
            <span className="shrink-0 whitespace-nowrap text-[12px] font-medium text-[var(--color-on-warning-container)]">
              {t('permission.awaitingApproval')}
            </span>
          ) : showsProgress ? (
            <span className="shrink-0 whitespace-nowrap text-[12px] text-[var(--color-info)]">{t('agentStatus.running')}</span>
          ) : durationLabel ? (
            <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{durationLabel}</span>
          ) : null}
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-[var(--color-text-tertiary)]" />
        </button>
        {liveToolCall ? (
          <div data-testid="activity-live-step" className="border-t border-[var(--color-border)] px-2 pb-1 pt-1">
            <ToolTimeline>
              <ActivityToolRow toolCall={liveToolCall} {...rowProps} />
            </ToolTimeline>
          </div>
        ) : null}
        {!liveToolCall ? <CollapsedRunImages toolCalls={toolCalls} resultMap={resultMap} /> : null}
        <MobileBottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={summaryText}
          closeLabel={t('common.close')}
          testId="activity-timeline-sheet"
          tall
          contentClassName="px-3 py-2"
        >
          {timeline}
        </MobileBottomSheet>
      </div>
    )
  }

  return (
    <div>
      <div
        data-testid="activity-group"
        data-expanded={collapsed ? 'false' : 'true'}
        data-running={isRunning ? 'true' : 'false'}
      >
        {/*
          One quiet line: the families' glyphs, the counted sentence, then what
          needs the reader — failures in red, a pending approval in amber, live
          work in blue — and otherwise the run's duration. The counts are what
          make it worth having at all.
        */}
        <button
          type="button"
          data-chat-disclosure="true"
          onClick={() => setPinnedCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          title={summaryText}
          className={[
            'group/activity -mx-1.5 flex min-h-6 w-[calc(100%+0.75rem)] items-center gap-1.5 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-left text-[13px] transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]',
            showsProgress ? 'border-b border-[var(--color-info-container)]' : '',
          ].filter(Boolean).join(' ')}
        >
          <span aria-hidden="true" className="flex min-w-6 shrink-0 items-center justify-center gap-0.5 text-[var(--color-text-tertiary)]">
            {headerIcons.map((segment) => {
              const Icon = segment.icon
              return <Icon key={segment.key} size={14} strokeWidth={1.75} />
            })}
          </span>
          <span
            data-activity-summary=""
            className="min-w-0 flex-1 truncate text-[var(--color-text-secondary)] transition-colors group-hover/activity:text-[var(--color-text-primary)]"
          >
            {summaryText}
          </span>
          {failedCount > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] tabular-nums text-[var(--color-error)]">
              <CircleX size={12} strokeWidth={1.75} aria-hidden="true" />
              {t('toolGroup.failedCount', { count: failedCount })}
            </span>
          )}
          {awaitingCount > 0 ? (
            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] font-medium text-[var(--color-on-warning-container)]">
              <CirclePause size={12} strokeWidth={1.75} aria-hidden="true" />
              {t('permission.awaitingApproval')}
            </span>
          ) : showsProgress ? (
            <span className="animate-stepped-pulse inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] text-[var(--color-info)]">
              <LoaderCircle size={12} strokeWidth={1.75} className="animate-spin" aria-hidden="true" />
              {t('agentStatus.running')}
            </span>
          ) : durationLabel ? (
            <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-[var(--color-text-tertiary)]">{durationLabel}</span>
          ) : null}
          <ChevronRight
            size={14}
            strokeWidth={1.75}
            aria-hidden="true"
            className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 ${collapsed ? '' : 'rotate-90'}`}
          />
        </button>

        {/* Folding hides the rows, and with them any picture a tool returned.
            Open, each row shows its own, so these exist only while folded. */}
        {collapsed ? <CollapsedRunImages toolCalls={toolCalls} resultMap={resultMap} /> : null}

        {!collapsed && (
          <ToolTimeline className="mt-0.5">
            {steps.map((step) => step.kind === 'thinking' ? (
              <TimelineThinking
                key={step.message.id}
                content={step.message.content}
                isActive={step.message.id === activeThinkingId}
                isTurnActive={turnActive}
              />
            ) : step.kind === 'text' ? (
              <TimelineCommentary key={step.message.id} content={step.message.content} />
            ) : (
              <ActivityToolRow key={step.toolCall.id} toolCall={step.toolCall} {...rowProps} />
            ))}
          </ToolTimeline>
        )}
      </div>
    </div>
  )
})

/** A thought on the rail: a small hollow stop, its row hung on the text column. */
const TimelineThinking = memo(function TimelineThinking({ content, isActive, isTurnActive }: { content: string; isActive: boolean; isTurnActive?: boolean }) {
  return (
    <div className="relative pl-7">
      <span
        aria-hidden="true"
        className="absolute left-[8px] top-[9px] h-2 w-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)]"
      />
      <ThinkingBlock content={content} isActive={isActive} isTurnActive={isTurnActive} />
    </div>
  )
})

/**
 * Assistant prose that sat between tool calls. Codex folds such commentary into
 * the process instead of leaving it in the transcript, where it would compete
 * with the final answer for attention.
 */
const TimelineCommentary = memo(function TimelineCommentary({ content }: { content: string }) {
  return (
    <div className="relative py-0.5 pl-[30px] text-[13px] text-[var(--color-text-secondary)]">
      <span
        aria-hidden="true"
        className="absolute left-[9px] top-[10px] h-1.5 w-1.5 rounded-full bg-[var(--color-outline)]"
      />
      <MarkdownRenderer
        content={content}
        variant="compact"
        className="chat-reading-markdown text-[var(--color-text-secondary)]"
      />
    </div>
  )
})

type RunImageStrip = ToolResultImageExtraction & {
  id: string
  toolName: string
  originalPath?: string
}

/**
 * The pictures a folded run's tools returned, under its summary line.
 *
 * A picture is what the tool was called for, not machinery to skim past, so it
 * does not vanish with the rows. One strip per top-level call, in step order, each
 * named for its own tool and offering its own original; calls the run dispatched
 * are left to their rows.
 *
 * Read from the result map on every render, but each result's content is
 * validated once: the map is rebuilt for every streamed token (and so is this
 * component's input), which is why the memoization sits on the content object in
 * `extractToolResultImages` rather than on the map or the calls.
 */
function CollapsedRunImages({
  toolCalls,
  resultMap,
}: {
  toolCalls: ToolCall[]
  resultMap: Map<string, ToolResult>
}) {
  const strips = useMemo(() => {
    const found: RunImageStrip[] = []
    for (const toolCall of toolCalls) {
      const result = resultMap.get(toolCall.toolUseId)
      if (!result) continue
      const shown = toolResultImagesFor({
        toolName: toolCall.toolName,
        input: toolCall.input,
        content: result.content,
      })
      if (shown.images.length > 0 || shown.dropped > 0) {
        found.push({ ...shown, id: toolCall.id, toolName: toolCall.toolName })
      }
    }
    return found
  }, [resultMap, toolCalls])

  return (
    <>
      {strips.map((strip) => (
        <ToolResultImages
          key={strip.id}
          images={strip.images}
          omitted={strip.dropped}
          originalPath={strip.originalPath}
          toolName={strip.toolName}
          className="pb-1 pt-1"
        />
      ))}
    </>
  )
}

type ActivityToolRowProps = {
  toolCall: ToolCall
  resultMap: Map<string, ToolResult>
  childToolCallsByParent: Map<string, ToolCall[]>
  sessionId?: string | null
  revealToolUseId?: string
  awaitingToolUseIds?: ReadonlySet<string>
  /** 该调用启动的后台任务及其最终状态。 */
  backgroundTasksByToolUseId?: ReadonlyMap<string, BackgroundAgentTask>
  /** The run is still being written to, so a resultless call is executing. */
  live?: boolean
}

const NO_CHILD_TOOL_CALLS: ToolCall[] = []

/**
 * Whether `toolCall`'s row, and the rows it dispatched, read the same inputs
 * from both prop sets. The maps themselves are rebuilt from the whole
 * transcript on every streamed token, so comparing them by identity would
 * re-render every row of a run on every token — a live /goal run reached 1,400
 * rows and stalled the window for seconds (#1480). The message objects inside
 * them keep their identity until that message itself changes.
 */
function sameRowInputs(
  toolCall: ToolCall,
  prev: ActivityToolRowProps,
  next: ActivityToolRowProps,
): boolean {
  if (prev.resultMap.get(toolCall.toolUseId) !== next.resultMap.get(toolCall.toolUseId)) return false
  if (prev.backgroundTasksByToolUseId?.get(toolCall.toolUseId) !== next.backgroundTasksByToolUseId?.get(toolCall.toolUseId)) return false
  if (isAwaiting(toolCall, prev.awaitingToolUseIds) !== isAwaiting(toolCall, next.awaitingToolUseIds)) return false
  const prevChildren = prev.childToolCallsByParent.get(toolCall.toolUseId) ?? NO_CHILD_TOOL_CALLS
  const nextChildren = next.childToolCallsByParent.get(toolCall.toolUseId) ?? NO_CHILD_TOOL_CALLS
  if (prevChildren.length !== nextChildren.length) return false
  return nextChildren.every((child, index) => (
    child === prevChildren[index] && sameRowInputs(child, prev, next)
  ))
}

/**
 * 后台任务结束后，在启动它的工具行下方补一行结果摘要：状态、耗时与任务自述。
 * 结果晚于原回合到达，末尾的唤醒回复仍会保留；这一行让读者在调用处就能
 * 知道那个任务后来怎么样了。
 */
function BackgroundTaskOutcomeRow({ task }: { task: BackgroundAgentTask }) {
  const t = useTranslation()
  if (task.status === 'running') return null
  const elapsed = task.usage?.durationMs ?? Math.max(0, task.updatedAt - task.startedAt)
  const summary = (task.summary ?? task.description ?? '').trim()
  const statusKey = task.status === 'completed'
    ? 'toolGroup.backgroundTaskCompleted'
    : task.status === 'failed'
      ? 'toolGroup.backgroundTaskFailed'
      : 'toolGroup.backgroundTaskStopped'

  return (
    <div
      data-testid="background-task-outcome"
      className={`ml-[30px] flex min-w-0 items-center gap-1.5 pb-1 pt-0.5 text-[12px] ${
        task.status === 'failed'
          ? 'text-[var(--color-error)]'
          : 'text-[var(--color-text-tertiary)]'
      }`}
    >
      <span className="shrink-0 font-medium">{t(statusKey)}</span>
      {elapsed > 0 && (
        <span className="shrink-0 font-mono tabular-nums">{formatDuration(elapsed)}</span>
      )}
      {summary && <span className="min-w-0 truncate">{summary}</span>}
    </div>
  )
}

/** A tool row plus, indented under it on its own rail, the rows of anything it dispatched. */
const ActivityToolRow = memo(function ActivityToolRow({
  toolCall,
  resultMap,
  childToolCallsByParent,
  sessionId,
  revealToolUseId,
  awaitingToolUseIds,
  backgroundTasksByToolUseId,
  live = false,
}: ActivityToolRowProps) {
  const result = resultMap.get(toolCall.toolUseId)
  const childToolCalls = childToolCallsByParent.get(toolCall.toolUseId) ?? NO_CHILD_TOOL_CALLS
  const backgroundTask = backgroundTasksByToolUseId?.get(toolCall.toolUseId)

  return (
    <div data-chat-anchor-id={toolCall.id}>
      <ToolCallBlock
        chrome="row"
        toolName={toolCall.toolName}
        input={toolCall.input}
        sessionId={sessionId}
        // The transcript's own result object, not a copy: `ToolCallBlock` is
        // memoized, and a fresh `{ content, isError }` here defeated it.
        result={result ?? null}
        isPending={toolCall.isPending}
        status={toolCall.status}
        partialInput={toolCall.partialInput}
        durationMs={toolCallDurationMs(toolCall, result)}
        toolUseId={toolCall.parentToolUseId ? undefined : toolCall.toolUseId}
        navigationHighlighted={revealToolUseId !== undefined && toolCall.toolUseId === revealToolUseId}
        awaitingApproval={!result && isAwaiting(toolCall, awaitingToolUseIds)}
        running={live && !result && toolCall.status !== 'stopped'}
      />
      {backgroundTask && <BackgroundTaskOutcomeRow task={backgroundTask} />}
      {childToolCalls.length > 0 && (
        <ToolTimeline className="ml-7">
          {childToolCalls.map((childToolCall) => (
            <ActivityToolRow
              key={childToolCall.id}
              toolCall={childToolCall}
              resultMap={resultMap}
              childToolCallsByParent={childToolCallsByParent}
              sessionId={sessionId}
              awaitingToolUseIds={awaitingToolUseIds}
              live={live}
            />
          ))}
        </ToolTimeline>
      )}
    </div>
  )
}, (prev, next) => (
  prev.toolCall === next.toolCall &&
  prev.live === next.live &&
  prev.sessionId === next.sessionId &&
  prev.revealToolUseId === next.revealToolUseId &&
  sameRowInputs(next.toolCall, prev, next)
))
