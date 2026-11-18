import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { settingsApi } from '@/api/settings'
import { useSessionStore } from '@/stores/sessionStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { RespectGitignoreSettings } from './RespectGitignoreSettings'

function makeSession(id: string, projectRoot: string) {
  return {
    id,
    title: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 1,
    projectPath: projectRoot,
    projectRoot,
    workDir: projectRoot,
    workDirExists: true,
  }
}

describe('RespectGitignoreSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      locale: 'zh',
      respectGitignore: true,
    })
    useSessionStore.setState({ sessions: [], activeSessionId: null })
    vi.spyOn(settingsApi, 'updateUser').mockResolvedValue({ ok: true })
    vi.spyOn(settingsApi, 'getProject').mockResolvedValue({})
    vi.spyOn(settingsApi, 'updateProject').mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useSessionStore.setState(useSessionStore.getInitialState(), true)
  })

  it('saves the global switch and disables the project override without a session', async () => {
    render(<RespectGitignoreSettings />)

    const globalSwitch = screen.getByRole('switch', { name: '全局：遵循 .gitignore' })
    expect(globalSwitch).toBeChecked()

    fireEvent.click(globalSwitch)

    await waitFor(() => expect(settingsApi.updateUser).toHaveBeenCalledWith({ respectGitignore: false }))
    expect(globalSwitch).not.toBeChecked()
    expect(screen.getByText('打开一个项目会话后才能设置项目级覆盖。')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '跟随全局' })).toBeDisabled()
  })

  it('reads and writes the project override for the active project', async () => {
    useSessionStore.setState({
      sessions: [makeSession('session-1', '/workspace/project')],
      activeSessionId: 'session-1',
    })
    vi.mocked(settingsApi.getProject).mockResolvedValue({ respectGitignore: false })

    render(<RespectGitignoreSettings />)

    const off = await screen.findByRole('radio', { name: '不遵循' })
    await waitFor(() => expect(off).toHaveAttribute('aria-checked', 'true'))
    expect(settingsApi.getProject).toHaveBeenCalledWith('/workspace/project')

    fireEvent.click(screen.getByRole('radio', { name: '跟随全局' }))
    await waitFor(() => expect(settingsApi.updateProject).toHaveBeenCalledWith(
      { respectGitignore: null },
      '/workspace/project',
    ))

    fireEvent.click(screen.getByRole('radio', { name: '遵循' }))
    await waitFor(() => expect(settingsApi.updateProject).toHaveBeenCalledWith(
      { respectGitignore: true },
      '/workspace/project',
    ))
  })

  it('keeps the previous project choice and reports a failed save', async () => {
    useSessionStore.setState({
      sessions: [makeSession('session-1', '/workspace/project')],
      activeSessionId: 'session-1',
    })
    vi.mocked(settingsApi.getProject).mockResolvedValue({ respectGitignore: false })
    vi.mocked(settingsApi.updateProject).mockRejectedValue(new Error('fixture failure'))

    render(<RespectGitignoreSettings />)

    const off = await screen.findByRole('radio', { name: '不遵循' })
    await waitFor(() => expect(off).toHaveAttribute('aria-checked', 'true'))

    fireEvent.click(screen.getByRole('radio', { name: '遵循' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存失败，请重试。'))
    expect(off).toHaveAttribute('aria-checked', 'true')
  })
})
