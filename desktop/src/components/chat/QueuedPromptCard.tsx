/**
 * 排队提示词的卡片，含文本与附件的展示和编辑
 *
 * 排队行原本只有一行文本，附件既看不到也改不了，这里把同一份排队消息渲染成
 * 文本行加上下方的附件区，编辑态复用附件托盘的移除与添加能力
 */
import { useCallback, useRef } from 'react'
import { CornerDownRight, Paperclip, Pencil, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '../../i18n'
import {
  filesToComposerAttachments,
  selectNativeFileAttachments,
  type ComposerAttachment,
} from '../../lib/composerAttachments'
import { isDesktopRuntime } from '../../lib/desktopRuntime'
import {
  removableQueuedAttachment,
  type QueuedAttachmentEntry,
} from '../../lib/queuedMessageAttachments'
import type { QueuedUserMessage } from '../../stores/chatStore'
import type { AttachmentRef } from '../../types/chat'
import { AttachmentGallery, type AttachmentPreview } from './AttachmentGallery'
import { PromptMarkdownTextView } from './PromptMarkdownTextView'

/**
 * 附件预览条目，`removable` 为 false 时不带 id，附件画廊据此不渲染移除按钮
 */
function previewOf(attachment: AttachmentRef, key: string, removable: boolean): AttachmentPreview {
  return {
    ...(removable ? { id: key } : {}),
    type: attachment.type,
    name: attachment.name || attachment.path || attachment.mimeType || attachment.type,
    path: attachment.path,
    data: attachment.data,
    mimeType: attachment.mimeType,
    isDirectory: attachment.isDirectory,
    lineStart: attachment.lineStart,
    lineEnd: attachment.lineEnd,
    diffSide: attachment.diffSide,
    hunkId: attachment.hunkId,
    note: attachment.note,
    quote: attachment.quote,
    referenceKind: attachment.referenceKind,
    selectionNumber: attachment.selectionNumber,
  }
}

function fromComposerAttachment(attachment: ComposerAttachment): AttachmentRef {
  return {
    type: attachment.type,
    name: attachment.name,
    path: attachment.path,
    data: attachment.data,
    mimeType: attachment.mimeType,
    isDirectory: attachment.isDirectory,
    lineStart: attachment.lineStart,
    lineEnd: attachment.lineEnd,
    note: attachment.note,
    quote: attachment.quote,
  }
}

type Props = {
  message: QueuedUserMessage
  sessionId?: string
  isEditing: boolean
  editingText: string
  editingAttachments: QueuedAttachmentEntry[]
  onEditingTextChange: (text: string) => void
  onEditingAttachmentsChange: (entries: QueuedAttachmentEntry[]) => void
  onStartEdit: () => void
  onSave: () => void
  onCancel: () => void
  onGuide: () => void
  guideDisabled: boolean
  onDelete: () => void
  /** 取消排队：文本与附件回填到输入框重新编辑，排队行移除 */
  onRecall: () => void
}

export function QueuedPromptCard({
  message,
  sessionId,
  isEditing,
  editingText,
  editingAttachments,
  onEditingTextChange,
  onEditingAttachmentsChange,
  onStartEdit,
  onSave,
  onCancel,
  onGuide,
  guideDisabled,
  onDelete,
  onRecall,
}: Props) {
  const t = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addAttachments = useCallback((attachments: ComposerAttachment[]) => {
    if (attachments.length === 0) return
    onEditingAttachmentsChange([
      ...editingAttachments,
      ...attachments.map((attachment) => ({
        key: `queued-added-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        attachment: fromComposerAttachment(attachment),
      })),
    ])
  }, [editingAttachments, onEditingAttachmentsChange])

  const pickAttachments = useCallback(() => {
    const fallbackToBrowserPicker = () => fileInputRef.current?.click()
    if (!isDesktopRuntime()) {
      fallbackToBrowserPicker()
      return
    }
    void selectNativeFileAttachments()
      .then((nativeAttachments) => {
        if (nativeAttachments) {
          addAttachments(nativeAttachments)
          return
        }
        fallbackToBrowserPicker()
      })
      .catch((error) => {
        console.warn('[attachments] Native file picker failed; falling back to browser file input', error)
        fallbackToBrowserPicker()
      })
  }, [addAttachments])

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    void filesToComposerAttachments(files).then(addAttachments)
    event.target.value = ''
  }

  const removeEntry = (key: string) => {
    onEditingAttachmentsChange(editingAttachments.filter((entry) => entry.key !== key))
  }

  const displayPreviews = (message.displayAttachments ?? []).map((attachment, index) =>
    previewOf(attachment, `queued-display-${index}`, true))
  const editPreviews = editingAttachments.map((entry) => previewOf(
    entry.attachment,
    entry.key,
    entry.originIndex === undefined || removableQueuedAttachment(entry.attachment),
  ))

  return (
    <div
      data-testid="pending-user-message"
      className={[
        'flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-md)] py-1 pl-3 pr-1',
        // `--color-outline` rather than `--color-border`: a dashed line at the
        // lighter weight all but disappears.
        'border border-dashed border-[var(--color-outline)]',
        'text-[13px] text-[var(--color-text-secondary)]',
      ].join(' ')}
    >
      <div className="flex min-h-7 min-w-0 items-center gap-2.5">
        {/* The handoff labels the row in words rather than with a glyph; the
            arrow icon here was a stand-in from before the string existed. */}
        <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">
          {t('chat.pendingMessageQueuedLabel')}
        </span>
        {isEditing ? (
          <>
            <input
              value={editingText}
              onChange={(event) => onEditingTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  onSave()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  onCancel()
                }
              }}
              aria-label={t('chat.pendingMessageEditInput')}
              className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-border-focus)]"
              autoFocus
            />
            <IconButton
              icon={<Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />}
              label={t('chat.pendingMessageAddAttachment')}
              size="sm"
              tone="muted"
              className="shrink-0"
              onClick={pickAttachments}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              disabled={!editingText.trim()}
              className="shrink-0"
            >
              {t('common.save')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="shrink-0"
            >
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <>
            {/* 与输入框中的排版一致：换行原样呈现；单行时是普通段落。
                truncate 会把多行压成一行省略，与用户写下的排版不符 */}
            <span
              className="min-w-0 flex-1 whitespace-pre-wrap break-words font-medium"
              title={message.displayContent}
            >
              <PromptMarkdownTextView text={message.displayContent} sessionId={sessionId} />
            </span>
            {/* The accent action of the three, per the handoff. Blocked
                while a question is waiting: sending now would race the
                prompt the model is blocked on. */}
            <Button
              variant="ghost"
              size="sm"
              disabled={guideDisabled}
              onClick={onGuide}
              aria-label={t('chat.pendingMessageGuideNow')}
              title={t('chat.pendingMessageGuideNow')}
              className="shrink-0"
              icon={<CornerDownRight size={14} strokeWidth={1.75} aria-hidden="true" />}
            >
              {t('chat.pendingMessageGuide')}
            </Button>
            <IconButton
              icon={<Pencil size={14} strokeWidth={1.75} aria-hidden="true" />}
              label={t('chat.pendingMessageEdit')}
              size="sm"
              tone="muted"
              onClick={onStartEdit}
            />
            <IconButton
              icon={<Undo2 size={14} strokeWidth={1.75} aria-hidden="true" />}
              label={t('chat.pendingMessageRecall')}
              size="sm"
              tone="muted"
              onClick={onRecall}
            />
            <IconButton
              icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />}
              label={t('chat.pendingMessageDelete')}
              size="sm"
              tone="muted"
              hoverTone="danger"
              onClick={onDelete}
            />
          </>
        )}
      </div>

      {isEditing
        ? editPreviews.length > 0 && (
          <div className="pr-2">
            <AttachmentGallery attachments={editPreviews} variant="composer" onRemove={removeEntry} />
          </div>
        )
        : displayPreviews.length > 0 && (
          // 排队条贴在输入框上方，用输入框的紧凑尺寸，避免一张大图把正文顶走
          <div className="pr-2">
            <AttachmentGallery attachments={displayPreviews} variant="composer" />
          </div>
        )}

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
    </div>
  )
}