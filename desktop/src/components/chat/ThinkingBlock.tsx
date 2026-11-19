import { useState, useEffect, useMemo, useRef } from 'react'
import { getDisclosure, setDisclosure } from '../../lib/disclosureMemory'
import { Brain, ChevronRight } from 'lucide-react'
import { useTranslation } from '../../i18n'
import { useSettingsStore } from '../../stores/settingsStore'
import { MarkdownRenderer } from '../markdown/MarkdownRenderer'
import {
  EMPTY_STREAMING_MARKDOWN_SEGMENTS,
  splitStreamingMarkdown,
  type StreamingMarkdownSegments,
} from '../../lib/streamingMarkdownSegments'

/**
 * One line: the label (with its duration when known) and the full text on demand.
 *
 * The Codex Responses flow keeps the reasoning on screen for the whole turn —
 * a block streams open and stays open after its deltas stop, because the turn
 * is still writing text or running tools. Only when the turn ends does it fold
 * back into its summary row. A reader's own click (kept in the local state or
 * the disclosure memory) always beats that default.
 *
 * There used to be a second, larger `standalone` form for a thinking block that
 * was the only thing in its run — it made sense when rows lived behind a
 * collapsed summary and a lone block needed to be findable. Now that every step
 * is a permanent row, the split only inverted the information: a turn's opening
 * reasoning is usually its most substantial, and it landed in the form that
 * showed no content at all, purely because no tool call happened to follow it in
 * the same run. Whether a thought is followed by a tool is not a fact about the
 * thought, so it no longer changes how one is drawn.
 */
export function ThinkingBlock({
  content,
  isActive = false,
  isTurnActive = false,
  disclosureKey,
  durationMs,
}: {
  content: string
  isActive?: boolean
  /** The turn this block belongs to is still running, so it stays open even after its deltas stop. */
  isTurnActive?: boolean
  /** Stable key that survives virtualized row unmount/remount. */
  disclosureKey?: string
  /** Streaming-to-next-event span, for the Codex-style 用时 summary on the collapsed row. */
  durationMs?: number
}) {
  const t = useTranslation()
  // 关闭推理折叠时，推理正文默认全部展开（含历史回合），手动点击仍可收起。
  const reasoningFoldEnabled = useSettingsStore((state) => state.reasoningFoldEnabled)
  // null means "the reader has not clicked this row in this mount"; a boolean
  // is their choice, which outranks both the memory and the turn default.
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null)
  const storedExpanded = disclosureKey ? getDisclosure(disclosureKey) : undefined
  const expanded = storedExpanded
    ?? localExpanded
    ?? (reasoningFoldEnabled ? (isActive || isTurnActive) : true)
  const contentRef = useRef<HTMLDivElement>(null)
  const displayContent = useMemo(() => content.replace(/\r\n?/g, '\n').trimEnd(), [content])
  const hasDisplayContent = displayContent.trim().length > 0

  useEffect(() => {
    if (expanded && isActive && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [displayContent, expanded, isActive])

  const durationSeconds = durationMs && durationMs > 0
    ? Math.max(1, Math.round(durationMs / 1000))
    : null
  const labelText = isActive
    ? t('thinking.label')
    : durationSeconds !== null
      ? t('thinking.duration', { seconds: durationSeconds })
      : t('thinking.labelDone')
  const label = (
    <>
      {labelText}
      {isActive && <span className="thinking-dots" />}
    </>
  )

  return (
    <div>
      <style>{thinkingStyles}</style>
      <button
        type="button"
        data-chat-disclosure="true"
        data-thinking-row="true"
        onClick={() => {
          const next = !expanded
          setLocalExpanded(next)
          if (disclosureKey) setDisclosure(disclosureKey, next)
        }}
        aria-expanded={expanded}
        className="-mx-2 flex h-7 w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[13px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
      >
        <Brain
          size={15}
          strokeWidth={1.75}
          aria-hidden="true"
          className="shrink-0"
        />
        <span className="shrink-0 font-medium text-[var(--color-text-secondary)]">
          {label}
        </span>
        {/* 折叠行只留标签与用时：思考正文片段容易与随后的最终回答混淆，
            完整推理展开后可见，这里用弹性占位把箭头推到行尾。 */}
        <span className="flex-1" />
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          className={`shrink-0 text-[var(--color-text-tertiary)] transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && hasDisplayContent && (
        <div
          ref={contentRef}
          data-thinking-content="expanded"
          className="relative mb-1.5 ml-[7px] mt-1 max-h-[300px] overflow-y-auto border-l border-[var(--color-outline)] py-0.5 pl-[15px] text-[var(--color-text-secondary)]"
        >
          {isActive ? (
            <StreamingThinkingMarkdown content={displayContent} />
          ) : (
            <MarkdownRenderer
              content={displayContent}
              variant="compact"
              className="thinking-markdown chat-reading-markdown text-[var(--color-text-secondary)]"
            />
          )}
          {isActive && <span className="thinking-cursor" />}
        </div>
      )}
    </div>
  )
}

const STREAMING_SEGMENT_CLASS = 'thinking-markdown thinking-markdown-segment chat-reading-markdown text-[var(--color-text-secondary)]'

/**
 * The body while it streams: the settled segments are rendered once and left
 * alone, only the tail is parsed again on each delta. One renderer over the
 * whole text re-parsed all of it on every delta, and a long deliberation left
 * the renderer thread with nothing for the paste or keystroke that arrived
 * during it (#1508). Once the block settles it is rendered whole again, so the
 * finished row is the same as it always was.
 */
function StreamingThinkingMarkdown({ content }: { content: string }) {
  const previous = useRef<StreamingMarkdownSegments>(EMPTY_STREAMING_MARKDOWN_SEGMENTS)
  const segments = useMemo(() => {
    const next = splitStreamingMarkdown(content, previous.current)
    previous.current = next
    return next
  }, [content])

  return (
    <div className="thinking-markdown-live" data-thinking-segments={segments.settled.length}>
      {segments.settled.map((segment, index) => (
        <MarkdownRenderer
          key={index}
          content={segment}
          variant="compact"
          cache={false}
          streaming
          className={STREAMING_SEGMENT_CLASS}
        />
      ))}
      <MarkdownRenderer
        key="live"
        content={segments.live}
        variant="compact"
        cache={false}
        streaming
        className={STREAMING_SEGMENT_CLASS}
      />
    </div>
  )
}

const thinkingStyles = `
@keyframes thinking-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes thinking-dots {
  0%, 20% { content: ''; }
  40% { content: '.'; }
  60% { content: '..'; }
  80%, 100% { content: '...'; }
}
.thinking-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: var(--color-text-tertiary);
  vertical-align: middle;
  margin-left: 1px;
  animation: thinking-cursor-blink 1s step-end infinite;
}
.thinking-dots::after {
  content: '';
  animation: thinking-dots 1.4s steps(1, end) infinite;
}
.thinking-markdown:not(.thinking-markdown-segment) > :first-child,
.thinking-markdown:not(.thinking-markdown-segment) > :first-child > :first-child {
  margin-top: 0;
}
.thinking-markdown:not(.thinking-markdown-segment) > :last-child,
.thinking-markdown:not(.thinking-markdown-segment) > :last-child > :last-child {
  margin-bottom: 0;
}
.thinking-markdown-live > :first-child > :first-child,
.thinking-markdown-live > :first-child > :first-child > :first-child {
  margin-top: 0;
}
.thinking-markdown-live > :last-child > :last-child,
.thinking-markdown-live > :last-child > :last-child > :last-child {
  margin-bottom: 0;
}
`
