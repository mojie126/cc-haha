/**
 * 后台任务结束后自动继续那一轮的回答
 *
 * 这一轮由任务结果唤醒，不是用户发的提示词，回答默认折叠成一行，
 * 点击展开；读者自己点过的选择记在 disclosure memory 里，跨虚拟滚动保留
 */
import { useState, type ReactNode } from 'react'
import { ChevronRight, CornerDownRight } from 'lucide-react'
import { getDisclosure, setDisclosure } from '../../lib/disclosureMemory'
import { useTranslation } from '../../i18n'

type Props = {
  /** Stable key that survives virtualized row unmount/remount. */
  disclosureKey?: string
  children: ReactNode
}

export function BackgroundReplyFold({ disclosureKey, children }: Props) {
  const t = useTranslation()
  // null 表示本次挂载还没点过，点过的选择优先于默认折叠
  const [localExpanded, setLocalExpanded] = useState<boolean | null>(null)
  const storedExpanded = disclosureKey ? getDisclosure(disclosureKey) : undefined
  const expanded = storedExpanded ?? localExpanded ?? false

  return (
    <div>
      <button
        type="button"
        data-chat-disclosure="true"
        onClick={() => {
          const next = !expanded
          setLocalExpanded(next)
          if (disclosureKey) setDisclosure(disclosureKey, next)
        }}
        aria-expanded={expanded}
        className="-mx-2 flex h-7 w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-[13px] text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
      >
        <CornerDownRight size={15} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span className="shrink-0 font-medium text-[var(--color-text-secondary)]">
          {t('chat.backgroundReplyFolded')}
        </span>
        <span className="flex-1" />
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          className={`shrink-0 transition-transform duration-150 motion-reduce:transition-none ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-1">
          {children}
        </div>
      )}
    </div>
  )
}