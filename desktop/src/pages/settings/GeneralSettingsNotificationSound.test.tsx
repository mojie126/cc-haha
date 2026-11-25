import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOpenTargetStore } from '@/stores/openTargetStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { GeneralSettings } from './GeneralSettings'

describe('General settings notification sound', () => {
  const setDesktopNotificationSoundEnabled = vi.fn(async () => {})

  beforeEach(() => {
    useSettingsStore.setState({
      locale: 'zh',
      desktopNotificationsEnabled: true,
      desktopNotificationSoundEnabled: true,
      setDesktopNotificationSoundEnabled,
      fetchOutputStyles: async () => {},
      fetchAppMode: async () => {},
    })
    useOpenTargetStore.setState({ ensureTargets: async () => {} })
  })
  afterEach(() => {
    cleanup()
    setDesktopNotificationSoundEnabled.mockClear()
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useOpenTargetStore.setState(useOpenTargetStore.getInitialState(), true)
  })

  it('shows the sound switch only while notifications are on', () => {
    render(<GeneralSettings />)
    expect(screen.getByText('通知提示音')).toBeInTheDocument()
  })

  it('hides the sound switch with the notification switch turned off', () => {
    useSettingsStore.setState({ desktopNotificationsEnabled: false })
    render(<GeneralSettings />)
    expect(screen.queryByText('通知提示音')).not.toBeInTheDocument()
  })
})