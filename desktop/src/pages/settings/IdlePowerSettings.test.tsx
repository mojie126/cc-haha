import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserHost } from '@/lib/desktopHost/browserHost'
import { DEFAULT_IDLE_POWER_SETTINGS, type IdlePowerState } from '@/lib/idlePower'
import { useIdlePowerStore } from '@/stores/idlePowerStore'
import { useOpenTargetStore } from '@/stores/openTargetStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { GeneralSettings } from './GeneralSettings'
import { IdlePowerSettings } from './IdlePowerSettings'

vi.mock('@/lib/desktopNotifications', () => ({
  getDesktopNotificationPermission: async () => 'unsupported',
  getDesktopNotificationPlatform: () => 'other',
  notifyDesktop: vi.fn(),
  openDesktopNotificationSettings: vi.fn(),
  requestDesktopNotificationPermission: async () => 'unsupported',
}))

describe('idle power settings', () => {
  let nativeState: IdlePowerState
  const getState = vi.fn()
  const configure = vi.fn()
  beforeEach(() => {
    vi.resetAllMocks()
    nativeState = {
      settings: { ...DEFAULT_IDLE_POWER_SETTINGS },
      capabilities: { lock: true, sleep: true, hibernate: false, shutdown: true },
      countdown: null, lastAction: null, notice: null,
    }
    getState.mockImplementation(async () => nativeState)
    configure.mockImplementation(async settings => (nativeState = { ...nativeState, settings }))
    window.desktopHost = {
      ...browserHost, kind: 'electron', isDesktop: true,
      power: { ...browserHost.power, getIdleActionState: getState, configureIdleAction: configure },
    }
    useIdlePowerStore.setState(useIdlePowerStore.getInitialState(), true)
    useSettingsStore.setState({ locale: 'en', fetchOutputStyles: async () => {}, fetchAppMode: async () => {} })
    useOpenTargetStore.setState({ ensureTargets: async () => {} })
  })
  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'desktopHost')
    useSettingsStore.setState(useSettingsStore.getInitialState(), true)
    useOpenTargetStore.setState(useOpenTargetStore.getInitialState(), true)
  })

  it('exposes default-off controls on General and saves action, scope, and countdown through the host', async () => {
    render(<GeneralSettings />)
    const action = screen.getByRole('combobox', { name: 'When all tasks finish' })
    await waitFor(() => expect(action).toBeEnabled())
    expect(action).toHaveTextContent('Do nothing')
    const scope = screen.getByRole('combobox', { name: 'Trigger after' })
    const countdown = screen.getByRole('combobox', { name: 'Countdown' })
    expect(scope).toBeDisabled()
    expect(countdown).toHaveTextContent('1 minute')
    fireEvent.click(action)
    expect(screen.getByRole('option', { name: 'Hibernate (unavailable)' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('option', { name: 'Sleep' }))
    await waitFor(() => expect(action).toHaveTextContent('Sleep'))
    fireEvent.click(scope)
    fireEvent.click(screen.getByRole('option', { name: 'Scheduled tasks only' }))
    await waitFor(() => expect(scope).toHaveTextContent('Scheduled tasks only'))
    fireEvent.click(countdown)
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Immediately', '30 seconds', '1 minute', '5 minutes',
    ])
    fireEvent.click(screen.getByRole('option', { name: '5 minutes' }))
    await waitFor(() => expect(countdown).toHaveTextContent('5 minutes'))
    expect(configure).toHaveBeenLastCalledWith({ action: 'sleep', scope: 'scheduled', countdownSeconds: 300 })
  })

  it('keeps the confirmed choice and a labelled retryable error after saving fails', async () => {
    configure.mockRejectedValueOnce(new Error('fixture persistence error'))
    render(<IdlePowerSettings />)
    const action = screen.getByRole('combobox', { name: 'When all tasks finish' })
    await waitFor(() => expect(action).toBeEnabled())
    fireEvent.click(action)
    fireEvent.click(screen.getByRole('option', { name: 'Shut down' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not save the idle action. Please try again.')
    expect(action).toHaveTextContent('Do nothing')
    expect(action).toBeEnabled()
    expect(action).toHaveAccessibleDescription(alert.textContent!)
    fireEvent.click(action)
    fireEvent.click(screen.getByRole('option', { name: 'Lock screen' }))
    await waitFor(() => expect(action).toHaveTextContent('Lock screen'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refreshes native settings and makes a previously configured unavailable action explicit', async () => {
    getState.mockRejectedValueOnce(new Error('fixture unavailable bridge'))
    render(<IdlePowerSettings />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the idle action. Refresh to try again.')
    nativeState = { ...nativeState, settings: { action: 'hibernate', scope: 'scheduled', countdownSeconds: 30 } }
    fireEvent.click(screen.getByRole('button', { name: 'Refresh idle action' }))
    const action = screen.getByRole('combobox', { name: 'When all tasks finish' })
    await waitFor(() => expect(action).toHaveTextContent('Hibernate (unavailable)'))
    expect(screen.getByText('This action is unavailable on this computer. Choose another action.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(configure).not.toHaveBeenCalled()
  })

  it('hides controls without calling the host in browser and H5 runtimes', async () => {
    window.desktopHost = { ...window.desktopHost!, isDesktop: false, kind: 'browser' }
    await act(async () => { render(<IdlePowerSettings />) })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(getState).not.toHaveBeenCalled()
  })
})
