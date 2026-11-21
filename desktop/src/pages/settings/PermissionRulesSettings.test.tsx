import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsApi } from '@/api/settings'
import { useSettingsStore } from '../../stores/settingsStore'
import { PermissionRulesSettings } from './PermissionRulesSettings'

vi.mock('@/api/settings', () => ({
  settingsApi: {
    getUser: vi.fn(),
    updateUser: vi.fn(),
  },
}))

const getUserMock = vi.mocked(settingsApi.getUser)
const updateUserMock = vi.mocked(settingsApi.updateUser)

function snapshotWith(rules: Record<string, string[]> = {}) {
  return {
    permissions: {
      defaultMode: 'default',
      ...Object.fromEntries(Object.entries(rules).map(([key, value]) => [key, [...value]])),
    },
  } as never
}

beforeEach(() => {
  useSettingsStore.setState({ locale: 'zh' })
  updateUserMock.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PermissionRulesSettings', () => {
  it('loads rules from the user settings snapshot into the three buckets', async () => {
    getUserMock.mockResolvedValue(snapshotWith({
      allow: ['Bash(git status:*)', 'Read'],
      deny: ['WebFetch(domain:evil.example)'],
      ask: [],
    }))

    render(<PermissionRulesSettings />)

    await waitFor(() => expect(getUserMock).toHaveBeenCalled())
    expect(screen.getByText('Bash(git status:*)')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('WebFetch(domain:evil.example)')).toBeInTheDocument()
  })

  it('adds a rule to the allow bucket and persists the whole permissions object', async () => {
    getUserMock.mockResolvedValue(snapshotWith({ allow: [] }))

    render(<PermissionRulesSettings />)
    await waitFor(() => expect(getUserMock).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('例如 Bash(git status:*) 或 Read')
    fireEvent.change(input, { target: { value: 'Bash(npm run build)' } })
    fireEvent.click(screen.getAllByRole('button', { name: '添加' })[0]!)

    await waitFor(() => expect(updateUserMock).toHaveBeenCalled())
    const payload = updateUserMock.mock.calls[0]![0] as { permissions: Record<string, unknown> }
    expect(payload.permissions.allow).toEqual(['Bash(npm run build)'])
    // 权限对象上的其他键（defaultMode 等）必须原样保留
    expect(payload.permissions.defaultMode).toBe('default')
    await waitFor(() => expect(screen.getByText('Bash(npm run build)')).toBeInTheDocument())
  })

  it('rejects malformed rules inline without calling the API', async () => {
    getUserMock.mockResolvedValue(snapshotWith())

    render(<PermissionRulesSettings />)
    await waitFor(() => expect(getUserMock).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('例如 Bash(git status:*) 或 Read')
    fireEvent.change(input, { target: { value: 'Bash(git status:*' } })
    expect(screen.getByRole('alert')).toHaveTextContent('括号不配对')
    expect(screen.getAllByRole('button', { name: '添加' })[0]).toBeDisabled()

    fireEvent.change(input, { target: { value: '(foo)' } })
    expect(screen.getByRole('alert')).toHaveTextContent('括号前缺少工具名')

    expect(updateUserMock).not.toHaveBeenCalled()
  })

  it('removes a rule and persists the deletion', async () => {
    // 第一次回读是初始快照，删除后的刷新回读必须不再包含该规则
    getUserMock.mockResolvedValueOnce(snapshotWith({ deny: ['WebFetch(domain:evil.example)'] }))
    getUserMock.mockResolvedValueOnce(snapshotWith({ deny: [] }))

    render(<PermissionRulesSettings />)
    await waitFor(() => expect(getUserMock).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '删除规则 WebFetch(domain:evil.example)' }))

    await waitFor(() => expect(updateUserMock).toHaveBeenCalled())
    const payload = updateUserMock.mock.calls[0]![0] as { permissions: Record<string, unknown> }
    expect(payload.permissions.deny).toEqual([])
    await waitFor(() => expect(screen.queryByText('WebFetch(domain:evil.example)')).toBeNull())
  })

  it('shows the failure message when the save request fails', async () => {
    getUserMock.mockResolvedValue(snapshotWith({ allow: [] }))
    updateUserMock.mockRejectedValueOnce(new Error('offline'))

    render(<PermissionRulesSettings />)
    await waitFor(() => expect(getUserMock).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('例如 Bash(git status:*) 或 Read')
    fireEvent.change(input, { target: { value: 'Read' } })
    fireEvent.click(screen.getAllByRole('button', { name: '添加' })[0]!)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('保存权限规则失败'))
  })

  it('skips duplicate rules instead of adding the same string twice', async () => {
    getUserMock.mockResolvedValue(snapshotWith({ allow: ['Read'] }))

    render(<PermissionRulesSettings />)
    await waitFor(() => expect(getUserMock).toHaveBeenCalled())

    const input = screen.getByPlaceholderText('例如 Bash(git status:*) 或 Read')
    fireEvent.change(input, { target: { value: 'Read' } })
    fireEvent.click(screen.getAllByRole('button', { name: '添加' })[0]!)

    expect(updateUserMock).not.toHaveBeenCalled()
    expect(screen.getByText('Read')).toBeInTheDocument()
  })
})
