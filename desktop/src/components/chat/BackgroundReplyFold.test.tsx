import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { clearDisclosureMemory, getDisclosure } from '../../lib/disclosureMemory'
import { useSettingsStore } from '../../stores/settingsStore'
import { BackgroundReplyFold } from './BackgroundReplyFold'

describe('BackgroundReplyFold', () => {
  afterEach(() => {
    clearDisclosureMemory()
    useSettingsStore.setState({ locale: 'en' })
  })

  it('starts collapsed and reveals the reply when expanded', () => {
    useSettingsStore.setState({ locale: 'en' })
    render(
      <BackgroundReplyFold disclosureKey="wake-1">
        <p>后台任务没有新增信息。</p>
      </BackgroundReplyFold>,
    )

    const toggle = screen.getByRole('button', { name: /Automatic reply after a background task ended/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('后台任务没有新增信息。')).toBeNull()

    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('后台任务没有新增信息。')).toBeTruthy()
  })

  it('remembers a reader\u2019s choice across remounts', () => {
    useSettingsStore.setState({ locale: 'en' })
    const view = render(
      <BackgroundReplyFold disclosureKey="wake-2">
        <p>展开后的内容。</p>
      </BackgroundReplyFold>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Automatic reply/i }))
    expect(getDisclosure('wake-2')).toBe(true)

    view.unmount()
    render(
      <BackgroundReplyFold disclosureKey="wake-2">
        <p>展开后的内容。</p>
      </BackgroundReplyFold>,
    )
    expect(screen.getByText('展开后的内容。')).toBeTruthy()
  })

  it('translates the folded row label', () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<BackgroundReplyFold disclosureKey="wake-3"><p>内容</p></BackgroundReplyFold>)

    expect(screen.getByRole('button', { name: /后台任务结束后的自动回复/ })).toBeTruthy()
  })
})