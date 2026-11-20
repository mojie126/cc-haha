import { pathsReferToSameFile } from '../stores/chatStore'
import type { QueuedUserMessage } from '../stores/chatStore'
import type { AttachmentRef } from '../types/chat'

/**
 * 排队提示词附件编辑的纯函数
 *
 * 排队消息同时保存两份附件：发给模型的传输列表与气泡显示的展示列表，
 * 两者对工作区引用记录的路径不同（绝对路径与相对路径），移除时按文件与引用上下文配对
 */

/**
 * 是否能从排队消息里移除
 *
 * 带行号、评论、引用片段或聊天选区内容的引用会被写进提示词正文，
 * 只删附件不改正文会让模型仍看到已移除的内容，因此这一类不在排队卡片里提供移除
 */
export function removableQueuedAttachment(attachment: AttachmentRef): boolean {
  return !(
    attachment.lineStart ||
    attachment.note?.trim() ||
    attachment.quote?.trim() ||
    attachment.diffSide ||
    attachment.hunkId ||
    attachment.referenceKind === 'chat-selection'
  )
}

/** 展示附件与传输附件是否指同一份文件或同一个引用 */
function sameQueuedAttachment(display: AttachmentRef, transport: AttachmentRef): boolean {
  if (display.path && transport.path) return pathsReferToSameFile(display.path, transport.path)
  if (display.path || transport.path) return false
  return display.name === transport.name
    && display.quote === transport.quote
    && display.lineStart === transport.lineStart
    && display.referenceKind === transport.referenceKind
}

/** 新加入的展示附件转成传输附件，只去掉仅界面使用的序号 */
function toTransportAttachment(attachment: AttachmentRef): AttachmentRef {
  const { selectionNumber: _selectionNumber, ...rest } = attachment
  return { ...rest }
}

export type QueuedAttachmentEdit = {
  attachments: AttachmentRef[]
  displayAttachments: AttachmentRef[]
}

/**
 * 按移除与新增算出排队消息的两份新附件列表
 *
 * 移除项按配对规则从传输列表里一对一删除，同名同路径的重复附件只删掉对应的那一条，
 * 新增项原样补进传输列表，列表为空时也返回空数组，由调用方决定是否清空字段
 */
export function computeQueuedAttachmentEdit(
  original: { attachments?: AttachmentRef[]; displayAttachments?: AttachmentRef[] },
  removedDisplay: AttachmentRef[],
  addedDisplay: AttachmentRef[],
): QueuedAttachmentEdit {
  const originalDisplay = original.displayAttachments ?? []
  const pendingRemovals = [...removedDisplay]
  const transport: AttachmentRef[] = []
  for (const transportAttachment of original.attachments ?? []) {
    const match = pendingRemovals.findIndex((display) => sameQueuedAttachment(display, transportAttachment))
    if (match >= 0) {
      pendingRemovals.splice(match, 1)
      continue
    }
    transport.push(transportAttachment)
  }
  return {
    attachments: transport.concat(addedDisplay.map(toTransportAttachment)),
    displayAttachments: originalDisplay
      .filter((display) => !removedDisplay.includes(display))
      .concat(addedDisplay),
  }
}

/** 编辑态的一条附件，originIndex 标记它来自入队时的第几个展示附件 */
export type QueuedAttachmentEntry = {
  key: string
  attachment: AttachmentRef
  originIndex?: number
}

/** 入队附件转成编辑态条目，序号决定保存时能否识别出移除项 */
export function queuedAttachmentEntries(message: QueuedUserMessage): QueuedAttachmentEntry[] {
  return (message.displayAttachments ?? []).map((attachment, originIndex) => ({
    key: `queued-original-${originIndex}`,
    attachment,
    originIndex,
  }))
}

/** 按编辑后的条目算出两份新附件列表，移除项同步落到发给模型的传输列表 */
export function queuedAttachmentEdit(
  message: QueuedUserMessage,
  entries: QueuedAttachmentEntry[],
): QueuedAttachmentEdit {
  const original = message.displayAttachments ?? []
  const keptOrigins = new Set(entries.flatMap((entry) => entry.originIndex === undefined ? [] : [entry.originIndex]))
  // 按序号算移除项，重复附件的展示条目是同一个对象，不能用对象身份比较
  const removed = original.filter((_, index) => !keptOrigins.has(index))
  const added = entries.flatMap((entry) => entry.originIndex === undefined ? [entry.attachment] : [])
  const transport = computeQueuedAttachmentEdit(message, removed, [])
  return {
    attachments: transport.attachments.concat(added.map(toTransportAttachment)),
    displayAttachments: entries.map((entry) => entry.attachment),
  }
}