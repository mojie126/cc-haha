import { beforeEach, describe, expect, it } from 'vitest'

import { useActivityPanelStore } from './activityPanelStore'

describe('activity panel store', () => {
  beforeEach(() => {
    useActivityPanelStore.setState({ openSessionIds: [] })
  })

  it('remembers each session separately so switching conversations keeps both open', () => {
    const store = useActivityPanelStore.getState()
    store.open('session-a')
    store.open('session-b')

    expect(useActivityPanelStore.getState().isOpen('session-a')).toBe(true)
    expect(useActivityPanelStore.getState().isOpen('session-b')).toBe(true)
  })

  it('toggles only the named session', () => {
    const store = useActivityPanelStore.getState()
    store.open('session-a')
    store.open('session-b')
    store.toggle('session-a')

    expect(useActivityPanelStore.getState().isOpen('session-a')).toBe(false)
    expect(useActivityPanelStore.getState().isOpen('session-b')).toBe(true)
  })

  it('closes one session or all of them', () => {
    const store = useActivityPanelStore.getState()
    store.open('session-a')
    store.open('session-b')

    store.close('session-a')
    expect(useActivityPanelStore.getState().isOpen('session-a')).toBe(false)
    expect(useActivityPanelStore.getState().isOpen('session-b')).toBe(true)

    store.close()
    expect(useActivityPanelStore.getState().openSessionIds).toEqual([])
  })
})
