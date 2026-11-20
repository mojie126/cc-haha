/**
 * 提示词文本的 md 呈现，已发送气泡与排队提示词共用
 *
 * 语法符号折叠为样式时仍留在 DOM 中，文本内容与复制结果保持原样，
 * 链接点击统一交给 openPreviewLink，与助手正文走同一套路由
 */
import { memo, useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import { openPreviewLink } from '../../lib/openPreviewLink'
import type { PreviewLinkTarget } from '@/lib/previewLinkRouter'
import { promptMarkdownRuns, PROMPT_MARKDOWN_BULLET } from './promptMarkdownRuns'

type Props = {
  /** 提示词原文，按原样保存与复制，只有视觉呈现带语法样式 */
  text: string
  /** 所属会话，用来路由链接；没有会话时退回浏览器默认行为 */
  sessionId?: string
}

export const PromptMarkdownTextView = memo(function PromptMarkdownTextView({ text, sessionId }: Props) {
  const handleLinkClick = useCallback(
    (href: PreviewLinkTarget, event: ReactMouseEvent<HTMLElement>): boolean => {
      if (!sessionId) return false
      const handled = openPreviewLink(href, sessionId)
      if (handled) event.preventDefault()
      return handled
    },
    [sessionId],
  )

  const runs: ReactNode[] = promptMarkdownRuns(text).map((run, index) => {
    if (run.type === 'bullet') {
      return <span key={index} className="composer-md-bullet" aria-hidden="true">{PROMPT_MARKDOWN_BULLET}</span>
    }
    // 裸地址与 md 链接都渲染为可点击链接，没有会话时退回浏览器默认行为
    if (run.type === 'url' || run.type === 'link') {
      const href = run.type === 'url' ? run.text : run.href
      const className = run.type === 'link'
        ? `${run.classes.join(' ')} [overflow-wrap:anywhere]`
        : 'text-[var(--color-text-accent)] underline decoration-[1px] underline-offset-[3px] decoration-[var(--color-text-accent)] [overflow-wrap:anywhere] hover:decoration-[2px]'
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className={className}
          onClick={(event) => handleLinkClick(href, event)}
        >
          {run.text}
        </a>
      )
    }
    return (
      <span
        key={index}
        className={run.classes.join(' ') || undefined}
        data-md-hidden={run.hidden ? 'true' : undefined}
      >
        {run.text}
      </span>
    )
  })

  return <>{runs}</>
})