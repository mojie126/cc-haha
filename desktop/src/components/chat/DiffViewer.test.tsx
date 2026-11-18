import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom'

const { diffViewerMock, getWorkspaceFile } = vi.hoisted(() => ({
  diffViewerMock: vi.fn(),
  getWorkspaceFile: vi.fn(),
}))

vi.mock('react-diff-viewer-continued', () => ({
  default: (props: { useDarkTheme: boolean }) => {
    diffViewerMock(props)
    return <div data-testid="diff-viewer" data-dark-theme={String(props.useDarkTheme)} />
  },
  DiffMethod: {
    WORDS: 'WORDS',
  },
}))

vi.mock('../../api/sessions', () => ({
  sessionsApi: { getWorkspaceFile },
}))

import { useUIStore } from '../../stores/uiStore'
import { DiffViewer } from './DiffViewer'

describe('DiffViewer', () => {
  beforeEach(() => {
    diffViewerMock.mockReset()
    getWorkspaceFile.mockReset()
    useUIStore.setState({ theme: 'white' })
  })

  it.each(['dark', 'ink-blue', 'neutral-dark'] as const)('uses the dark diff renderer on %s and returns to a light renderer', (theme) => {
    const { rerender } = render(
      <DiffViewer filePath="src/example.ts" oldString="const a = 1" newString="const a = 2" />,
    )

    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-dark-theme', 'false')

    act(() => {
      useUIStore.setState({ theme })
    })
    rerender(<DiffViewer filePath="src/example.ts" oldString="const a = 1" newString="const a = 2" />)

    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-dark-theme', 'true')
    expect(diffViewerMock).toHaveBeenLastCalledWith(expect.objectContaining({ useDarkTheme: true }))

    act(() => useUIStore.setState({ theme: 'white' }))
    expect(screen.getByTestId('diff-viewer')).toHaveAttribute('data-dark-theme', 'false')
  })

  it('shifts the diff onto the real file lines after reading the edited file', async () => {
    getWorkspaceFile.mockResolvedValue({
      state: 'ok',
      path: '/repo/src/app.ts',
      language: 'typescript',
      size: 64,
      content: 'one\ntwo\nthree\nfour\n',
    })

    render(
      <DiffViewer
        filePath="/repo/src/app.ts"
        oldString="three"
        newString="THREE"
        sessionId="s1"
        editPhase="after"
      />,
    )

    await waitFor(() => expect(diffViewerMock).toHaveBeenLastCalledWith(expect.objectContaining({ linesOffset: 2 })))
    expect(diffViewerMock).toHaveBeenLastCalledWith(expect.objectContaining({ hideLineNumbers: false }))
    expect(getWorkspaceFile).toHaveBeenCalledWith('s1', '/repo/src/app.ts', expect.anything())
  })

  it('anchors the permission preview on the pre-edit file', async () => {
    getWorkspaceFile.mockResolvedValue({
      state: 'ok',
      path: '/repo/src/app.ts',
      language: 'typescript',
      size: 64,
      content: 'one\ntwo\nthree\n',
    })

    render(
      <DiffViewer
        filePath="/repo/src/app.ts"
        oldString="three"
        newString="THREE"
        sessionId="s1"
        editPhase="before"
      />,
    )

    await waitFor(() => expect(diffViewerMock).toHaveBeenLastCalledWith(expect.objectContaining({ linesOffset: 2 })))
  })

  it('numbers a whole-file Write from line 1 without reading the disk', () => {
    render(<DiffViewer filePath="/repo/src/new.ts" oldString="" newString={'a\nb'} sessionId="s1" />)

    expect(diffViewerMock).toHaveBeenLastCalledWith(expect.objectContaining({ linesOffset: 0, hideLineNumbers: false }))
    expect(getWorkspaceFile).not.toHaveBeenCalled()
  })

  it('keeps the snippet numbering when no session is available', () => {
    render(<DiffViewer filePath="/repo/src/app.ts" oldString="three" newString="THREE" />)

    expect(diffViewerMock).toHaveBeenLastCalledWith(expect.objectContaining({ linesOffset: 0, hideLineNumbers: false }))
    expect(getWorkspaceFile).not.toHaveBeenCalled()
  })

  it('hides line numbers when the snippet cannot be placed in the file', async () => {
    getWorkspaceFile.mockResolvedValue({
      state: 'ok',
      path: '/repo/src/app.ts',
      language: 'typescript',
      size: 64,
      content: 'same\nsame\n',
    })

    render(
      <DiffViewer
        filePath="/repo/src/app.ts"
        oldString="same"
        newString="changed"
        sessionId="s1"
      />,
    )

    await waitFor(() => expect(getWorkspaceFile).toHaveBeenCalled())
    await waitFor(() => expect(diffViewerMock).toHaveBeenLastCalledWith(expect.objectContaining({ hideLineNumbers: true })))
  })
})
