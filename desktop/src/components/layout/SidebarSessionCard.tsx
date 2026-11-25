import { Check, Folder, GitBranch } from 'lucide-react'
import { SessionScheduleMark } from '@/components/tasks/SessionScheduleMark'
import { Spinner } from '@/components/ui/Spinner'
import { formatRelativeTime } from '@/lib/formatRelativeTime'
import { getSessionWorkspaceState } from '@/lib/sessionWorkspace'
import type { TranslationKey } from '@/i18n'
import type { SessionListItem } from '@/types/session'
import { SessionAttentionMark } from './SessionAttentionMark'
import { isWorktreeSession } from './sidebarTaskGroups'

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

/** Selected and open rows are cards lifted off the sidebar ground. */
const SIDEBAR_ROW_RAISED =
  'bg-[var(--color-sidebar-item-active)] text-[var(--color-text-primary)] shadow-[0_0_0_1px_var(--color-border),var(--shadow-raised)]'

export type SidebarSessionCardProps = {
  session: SessionListItem
  /** `project` is the single-line row under a project group; `task` adds the workspace line. */
  variant: 'project' | 'task'
  /** Owning project/workspace label, shown as the first line in task view. */
  workspaceLabel?: string
  isActive: boolean
  isSelected: boolean
  isRunning: boolean
  needsAttention: boolean
  isBatchMode: boolean
  onClick: (event: React.MouseEvent, session: SessionListItem) => void
  onContextMenu: (event: React.MouseEvent, sessionId: string) => void
  t: Translate
}

/**
 * 侧边栏会话行，项目分组视图与时间分组视图共用
 *
 * - 项目视图：单行，标题与运行状态、相对时间同排，`pl-8` 对齐项目名，
 *   行内另带缺失目录标记与定时标记
 * - 任务视图：首行是标题，次行是所属目录，状态只占用右侧一小块
 * - 批量模式下标题前置一个勾选框，行高随视图变化
 */
export function SidebarSessionCard({
  session,
  variant,
  workspaceLabel,
  isActive,
  isSelected,
  isRunning,
  needsAttention,
  isBatchMode,
  onClick,
  onContextMenu,
  t,
}: SidebarSessionCardProps) {
  const title = session.title || t('tabs.untitled')
  const isMissingDir = getSessionWorkspaceState(session) === 'missing'
  const isWorktree = isWorktreeSession(session)

  const stateClass = isSelected
    ? `sidebar-session-row--selected ${SIDEBAR_ROW_RAISED} font-medium`
    : isActive
      ? `sidebar-session-row--active ${SIDEBAR_ROW_RAISED} font-medium`
      : 'sidebar-session-row--idle text-[var(--color-text-secondary)] hover:bg-[var(--color-sidebar-item-hover)] hover:text-[var(--color-text-primary)]'

  const baseClass = variant === 'project'
    ? 'group/session flex h-[30px] w-full items-center rounded-[var(--radius-sm)] pl-8 pr-2 text-left text-[13px]'
    : 'group/session w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left'

  const batchCheckbox = isBatchMode ? (
    <span
      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[var(--radius-xs)] border transition-colors ${
        isSelected
          ? 'border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-on-primary)]'
          // Hairline `--color-border` only reaches 1.2:1 here, a control
          // boundary needs 3:1 (WCAG 1.4.11).
          : 'border-[var(--color-border-strong)] bg-[var(--color-surface)]'
      }`}
      aria-hidden="true"
    >
      {isSelected && <Check size={12} strokeWidth={2} aria-hidden="true" />}
    </span>
  ) : null

  return (
    <button
      type="button"
      onClick={(event) => onClick(event, session)}
      onContextMenu={(event) => onContextMenu(event, session.id)}
      className={`
        ${baseClass} transition-[background,color,box-shadow] duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-sidebar)]
        ${stateClass}
      `}
      aria-pressed={isBatchMode ? isSelected : undefined}
      title={title}
    >
      {variant === 'project' ? (
        <>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            {batchCheckbox}
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {isMissingDir && (
              <span
                className="flex-shrink-0 text-[11px] text-[var(--color-warning)]"
                title={session.workDir ?? ''}
              >
                {t('sidebar.missingDir')}
              </span>
            )}
            <SessionScheduleMark sessionId={session.id} />
            <SessionRowMeta
              isRunning={isRunning}
              needsAttention={needsAttention}
              isWorktree={isWorktree}
              modifiedAt={session.modifiedAt}
              t={t}
            />
          </span>
        </>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-1.5">
            {batchCheckbox}
            <span className={`min-w-0 flex-1 truncate text-[13px] ${isActive || isSelected ? 'font-medium' : ''}`}>
              {title}
            </span>
            <SessionScheduleMark sessionId={session.id} />
            <span className="ml-auto flex h-4 flex-shrink-0 items-center justify-end">
              {needsAttention ? (
                <span className="inline-flex h-4 w-4 items-center justify-center">
                  {/* 与标签栏、项目视图共用同一个标志，名字与 title 都在它自己身上 */}
                  <SessionAttentionMark label={t('sidebar.sessionNeedsAttention')} />
                </span>
              ) : isRunning ? (
                <span
                  className="inline-flex h-4 w-4 items-center justify-center text-[var(--color-info)]"
                  aria-label={t('sidebar.sessionRunning')}
                  title={t('sidebar.sessionRunning')}
                >
                  {/* 外层已经带名字，spinner 本身保持静默 */}
                  <Spinner size={12} />
                </span>
              ) : null}
            </span>
          </span>
          {/* 所属目录是这个视图存在的理由，不是装饰文字，所以用能过 4.5 的
              secondary，层级交给字号和字重 */}
          <span className="mt-0.5 flex min-w-0 items-center gap-1 pl-0.5 text-[11px] text-[var(--color-text-secondary)]">
            {isWorktree ? (
              <GitBranch size={12} strokeWidth={2} className="flex-shrink-0" aria-hidden="true" />
            ) : (
              <Folder size={12} strokeWidth={2} className="flex-shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">{workspaceLabel}</span>
            {isWorktree && <span className="sr-only">{t('sidebar.worktree')}</span>}
          </span>
        </>
      )}
    </button>
  )
}

/** 项目视图右侧的状态与时间，等你确认时用状态文字顶替相对时间 */
function SessionRowMeta({
  isRunning,
  needsAttention,
  isWorktree,
  modifiedAt,
  t,
}: {
  isRunning: boolean
  needsAttention: boolean
  isWorktree: boolean
  modifiedAt: string
  t: Translate
}) {
  const relativeTime = formatRelativeTime(modifiedAt, t)
  const updatedLabel = t('session.lastUpdated', { time: relativeTime })

  return (
    <span
      className="ml-auto flex h-5 flex-shrink-0 items-center justify-end gap-1 whitespace-nowrap text-[11px] font-normal tabular-nums text-[var(--color-text-tertiary)]"
      title={updatedLabel}
    >
      {/* 等人比在跑更要紧：停在卡片上的会话按 chatState 也算「在跑」，但转圈会
          让人以为可以不管它。等你确认时，状态文字顶替相对时间。 */}
      {needsAttention ? (
        <span className="flex min-w-0 items-center gap-1 font-medium text-[var(--color-on-warning-container)]">
          <SessionAttentionMark label={t('sidebar.sessionNeedsAttention')} />
          {/* The mark already names the state; the words are for the eye. */}
          <span aria-hidden="true" className="max-w-[88px] truncate">{t('sidebar.sessionStatus.attention')}</span>
        </span>
      ) : (
        <>
          {isRunning && (
            <span
              className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center text-[var(--color-info)]"
              aria-label={t('sidebar.sessionRunning')}
              title={t('sidebar.sessionRunning')}
            >
              {/* The wrapper already carries the name, so the spinner stays silent. */}
              <Spinner size={12} />
            </span>
          )}
          {/* Only a session that really runs in its own worktree gets the
              branch glyph; an ordinary session in its project needs no badge. */}
          {isWorktree && (
            <span
              className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center"
              title={t('sidebar.worktree')}
            >
              <GitBranch size={12} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">{t('sidebar.worktree')}</span>
            </span>
          )}
          <span className="flex-shrink-0">{relativeTime}</span>
        </>
      )}
    </span>
  )
}