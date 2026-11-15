import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { settingsApi } from '@/api/settings'
import { useSettingsStore } from '@/stores/settingsStore'
import { ReasoningFoldSettings } from './ReasoningFoldSettings'

describe('ReasoningFoldSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'zh', reasoningFoldEnabled: true })
    vi.spyOn(settingsApi, 'updateUser').mockResolvedValue({ ok: true })
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  })

  it('saves the toggle through the settings API', async () => {
    render(<ReasoningFoldSettings />)
    const toggle = screen.getByRole('switch', { name: '推理折叠' })
    expect(toggle).toBeChecked()

    fireEvent.click(toggle)

    await waitFor(() => expect(toggle).not.toBeChecked())
    expect(settingsApi.updateUser).toHaveBeenCalledWith({ reasoningFoldEnabled: false })
  })

  it('keeps the previous value and shows an error when saving fails', async () => {
    vi.mocked(settingsApi.updateUser).mockRejectedValueOnce(new Error('offline'))
    render(<ReasoningFoldSettings />)
    const toggle = screen.getByRole('switch', { name: '推理折叠' })

    fireEvent.click(toggle)

    expect(await screen.findByRole('alert')).toHaveTextContent('未能保存')
    expect(toggle).toBeChecked()
    expect(toggle).not.toBeDisabled()
  })
})
