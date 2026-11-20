import { describe, expect, it } from 'vitest'
import {
  computeQueuedAttachmentEdit,
  queuedAttachmentEdit,
  queuedAttachmentEntries,
  removableQueuedAttachment,
} from './queuedMessageAttachments'
import type { QueuedUserMessage } from '../stores/chatStore'
import type { AttachmentRef } from '../types/chat'

function queued(overrides: Partial<QueuedUserMessage> = {}): QueuedUserMessage {
  return {
    id: 'q1',
    content: 'fix it',
    displayContent: 'fix it',
    createdAt: 1,
    ...overrides,
  }
}

const UPLOAD: AttachmentRef = { type: 'file', name: 'notes.md', path: '/repo/notes.md' }
const REFERENCE_DISPLAY: AttachmentRef = { type: 'file', name: 'app.ts', path: 'src/app.ts' }
const REFERENCE_TRANSPORT: AttachmentRef = { type: 'file', name: 'app.ts', path: '/repo/src/app.ts' }

describe('removableQueuedAttachment', () => {
  it('allows removing a plain upload and refuses one whose context is in the prompt', () => {
    expect(removableQueuedAttachment(UPLOAD)).toBe(true)
    expect(removableQueuedAttachment({ ...UPLOAD, lineStart: 4 })).toBe(false)
    expect(removableQueuedAttachment({ ...UPLOAD, note: 'why' })).toBe(false)
    expect(removableQueuedAttachment({ ...UPLOAD, quote: 'const x = 1' })).toBe(false)
    expect(removableQueuedAttachment({ ...UPLOAD, referenceKind: 'chat-selection' })).toBe(false)
  })
})

describe('queuedAttachmentEdit', () => {
  it('removes an upload from both the display and transport lists', () => {
    const message = queued({
      attachments: [UPLOAD, REFERENCE_TRANSPORT],
      displayAttachments: [UPLOAD, REFERENCE_DISPLAY],
    })
    const entries = queuedAttachmentEntries(message).filter((entry) => entry.attachment.name !== 'notes.md')

    expect(queuedAttachmentEdit(message, entries)).toEqual({
      attachments: [REFERENCE_TRANSPORT],
      displayAttachments: [REFERENCE_DISPLAY],
    })
  })

  it('keeps a workspace reference whose display path differs from the transport path', () => {
    const message = queued({
      attachments: [UPLOAD, REFERENCE_TRANSPORT],
      displayAttachments: [UPLOAD, REFERENCE_DISPLAY],
    })

    const edit = queuedAttachmentEdit(message, queuedAttachmentEntries(message))
    expect(edit.attachments).toEqual([UPLOAD, REFERENCE_TRANSPORT])
  })

  it('adds a new attachment to both lists', () => {
    const message = queued({ attachments: [UPLOAD], displayAttachments: [UPLOAD] })
    const added: AttachmentRef = { type: 'image', name: 'shot.png', data: 'data:image/png;base64,AAAA' }

    expect(queuedAttachmentEdit(message, [
      ...queuedAttachmentEntries(message),
      { key: 'added', attachment: added },
    ])).toEqual({
      attachments: [UPLOAD, added],
      displayAttachments: [UPLOAD, added],
    })
  })

  it('drops the UI-only selection number from a newly added attachment', () => {
    const message = queued()
    const added: AttachmentRef = { type: 'image', name: 'shot.png', data: 'data:image/png;base64,AAAA', selectionNumber: 2 }

    const edit = computeQueuedAttachmentEdit(message, [], [added])
    expect(edit.attachments[0]).not.toHaveProperty('selectionNumber')
    expect(edit.displayAttachments[0]).toHaveProperty('selectionNumber', 2)
  })

  it('removes only the matching duplicate when the same file was attached twice', () => {
    const message = queued({
      attachments: [UPLOAD, UPLOAD],
      displayAttachments: [UPLOAD, UPLOAD],
    })

    const edit = queuedAttachmentEdit(message, queuedAttachmentEntries(message).slice(1))
    expect(edit.attachments).toEqual([UPLOAD])
    expect(edit.displayAttachments).toEqual([UPLOAD])
  })

  it('returns empty lists when the last attachment is removed', () => {
    const message = queued({ attachments: [UPLOAD], displayAttachments: [UPLOAD] })
    expect(queuedAttachmentEdit(message, [])).toEqual({ attachments: [], displayAttachments: [] })
  })
})