import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { describe, expect, it, vi } from 'vitest'
import { SidebarSessionCard } from './SidebarSessionCard'
import type { SessionListItem } from '@/types/session'
import type { TranslationKey } from '@/i18n'

vi.mock('@/components/tasks/SessionScheduleMark', () => ({
  SessionScheduleMark: () => null,
}))

const t = (key: TranslationKey, params?: Record<string, string | number>) => {
  const dict: Partial<Record<TranslationKey, string>> = {
    'tabs.untitled': 'Untitled',
    'sidebar.worktree': 'worktree',
    'sidebar.missingDir': 'Directory missing',
    'sidebar.sessionRunning': 'Session running',
    'sidebar.sessionNeedsAttention': 'Waiting for your approval',
    'sidebar.sessionStatus.attention': 'Needs you',
    'session.lastUpdated': 'last updated {time}',
  }
  const raw = dict[key] ?? key
  if (!params) return raw
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    raw,
  )
}

function makeSession(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: 'session-1',
    title: 'Fix sidebar layout',
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    modifiedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    messageCount: 3,
    projectPath: '/workspace/alpha',
    projectRoot: '/workspace/alpha',
    workDir: '/workspace/alpha',
    workDirExists: true,
    ...overrides,
  }
}

describe('SidebarSessionCard', () => {
  it('renders the single-line project row with the lifted selected card', () => {
    const onClick = vi.fn()
    render(
      <SidebarSessionCard
        session={makeSession()}
        variant="project"
        isActive
        isSelected={false}
        isRunning={false}
        needsAttention={false}
        isBatchMode={false}
        onClick={onClick}
        onContextMenu={vi.fn()}
        t={t}
      />,
    )

    const row = screen.getByRole('button', { name: /Fix sidebar layout/ })
    expect(row).toHaveClass('pl-8', 'h-[30px]', 'sidebar-session-row--active')
    expect(within(row).queryByText('worktree')).not.toBeInTheDocument()
    expect(within(row).queryByText('Directory missing')).not.toBeInTheDocument()

    fireEvent.click(row)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps the selected state on the same raised card as the open session', () => {
    render(
      <SidebarSessionCard
        session={makeSession()}
        variant="project"
        isActive={false}
        isSelected
        isRunning={false}
        needsAttention={false}
        isBatchMode={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        t={t}
      />,
    )

    expect(screen.getByRole('button', { name: /Fix sidebar layout/ })).toHaveClass(
      'sidebar-session-row--selected',
      'font-medium',
    )
  })

  it('shows the workspace line and badges in the task view', () => {
    render(
      <SidebarSessionCard
        session={makeSession({
          workDir: '/workspace/alpha/.claude/worktrees/ui-texture',
          workDirExists: false,
          workspaceState: 'missing',
        })}
        variant="task"
        workspaceLabel="alpha"
        isActive={false}
        isSelected={false}
        isRunning
        needsAttention={false}
        isBatchMode={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        t={t}
      />,
    )

    const row = screen.getByRole('button', { name: /^Fix sidebar layout/ })
    expect(within(row).getByText('alpha')).toBeInTheDocument()
    expect(within(row).getByText('worktree')).toHaveClass('sr-only')
    expect(within(row).getByLabelText('Session running')).toBeInTheDocument()
  })

  it('replaces the relative time with the attention words while waiting', () => {
    render(
      <SidebarSessionCard
        session={makeSession()}
        variant="project"
        isActive={false}
        isSelected={false}
        isRunning
        needsAttention
        isBatchMode={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        t={t}
      />,
    )

    expect(screen.getByLabelText('Waiting for your approval')).toBeInTheDocument()
    expect(screen.getByText('Needs you')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByLabelText('Session running')).not.toBeInTheDocument()
  })

  it('leads with the batch checkbox and reports the pressed state in batch mode', () => {
    render(
      <SidebarSessionCard
        session={makeSession()}
        variant="project"
        isActive={false}
        isSelected
        isRunning={false}
        needsAttention={false}
        isBatchMode
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        t={t}
      />,
    )

    const row = screen.getByRole('button', { name: /Fix sidebar layout/ })
    expect(row).toHaveAttribute('aria-pressed', 'true')
  })

  it('marks a missing workspace directory on the project row', () => {
    render(
      <SidebarSessionCard
        session={makeSession({ workDirExists: false })}
        variant="project"
        isActive={false}
        isSelected={false}
        isRunning={false}
        needsAttention={false}
        isBatchMode={false}
        onClick={vi.fn()}
        onContextMenu={vi.fn()}
        t={t}
      />,
    )

    expect(screen.getByText('Directory missing')).toBeInTheDocument()
  })
})