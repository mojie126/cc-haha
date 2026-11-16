import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

const { promptsApiMock } = vi.hoisted(() => ({
  promptsApiMock: {
    listDocs: vi.fn(),
    readDoc: vi.fn(),
    saveDoc: vi.fn(),
  },
}))

vi.mock('../../api/prompts', () => ({
  promptsApi: promptsApiMock,
}))

import { PromptDocSettings } from './PromptDocSettings'
import { useSessionStore } from '@/stores/sessionStore'

const WORK_DIR = 'E:/workspace/demo'

function mockSession() {
  useSessionStore.setState({
    sessions: [
      { id: 'session-1', workDir: WORK_DIR, projectPath: WORK_DIR },
    ],
    activeSessionId: 'session-1',
  } as never)
}

function mockDocs() {
  promptsApiMock.listDocs.mockResolvedValue({
    docs: [
      { id: 'global', scope: 'global', name: 'CLAUDE.md', exists: true, bytes: 15, updatedAt: '2026-11-15T00:00:00.000Z' },
      { id: 'project:AGENTS.md', scope: 'project', name: 'AGENTS.md', exists: false, bytes: 0, updatedAt: null },
      { id: 'project:CLAUDE.md', scope: 'project', name: 'CLAUDE.md', exists: false, bytes: 0, updatedAt: null },
      { id: 'project:.claude/CLAUDE.md', scope: 'project', name: '.claude/CLAUDE.md', exists: false, bytes: 0, updatedAt: null },
    ],
  })
}

describe('PromptDocSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession()
    mockDocs()
    promptsApiMock.readDoc.mockResolvedValue({
      doc: { id: 'global', name: 'CLAUDE.md', content: '# 全局约定', bytes: 15, updatedAt: '2026-11-15T00:00:00.000Z' },
    })
  })

  it('defaults to the global doc and shows its content in the editor', async () => {
    render(<PromptDocSettings />)

    await waitFor(() => expect(promptsApiMock.readDoc).toHaveBeenCalledWith('global', WORK_DIR))
    await waitFor(() => expect(screen.getByRole('button', { name: /edit/i })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await waitFor(() => expect(editor).toHaveValue('# 全局约定'))
    // Reading text, not code: same face and reader-controlled size as the
    // composer, and never the monospace reserved for paths and identifiers.
    expect(editor).toHaveClass('chat-reading-text')
    expect(editor.className).not.toContain('font-mono')
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('saves the edited doc with the loaded revision and refreshes the doc list', async () => {
    promptsApiMock.saveDoc.mockResolvedValue({
      ok: true,
      doc: { id: 'global', name: 'CLAUDE.md', bytes: 18, updatedAt: '2026-11-15T01:00:00.000Z' },
    })
    render(<PromptDocSettings />)

    await waitFor(() => expect(screen.getByRole('button', { name: /edit/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await waitFor(() => expect(editor).toHaveValue('# 全局约定'))

    fireEvent.change(editor, { target: { value: '# 修改后的全局约定' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(promptsApiMock.saveDoc).toHaveBeenCalledTimes(1))
    expect(promptsApiMock.saveDoc).toHaveBeenCalledWith(expect.objectContaining({
      id: 'global',
      cwd: WORK_DIR,
      content: '# 修改后的全局约定',
      expectedUpdatedAt: '2026-11-15T00:00:00.000Z',
      expectedBytes: 15,
    }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    await waitFor(() => expect(promptsApiMock.listDocs).toHaveBeenCalledTimes(2))
  })

  it('surfaces a conflict when the doc changed externally', async () => {
    promptsApiMock.saveDoc.mockRejectedValue(
      new Error('Prompt doc changed before it could be saved: CLAUDE.md'),
    )
    render(<PromptDocSettings />)

    await waitFor(() => expect(screen.getByRole('button', { name: /edit/i })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /edit/i }))
    const editor = await screen.findByRole('textbox')
    await waitFor(() => expect(editor).toHaveValue('# 全局约定'))
    fireEvent.change(editor, { target: { value: '# 并发修改' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
