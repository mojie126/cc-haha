/**
 * md 语法在提示词文本中的呈现规则
 *
 * 输入框由 composerMarkdown.ts 扫描 md 语法并折叠标记符，已发送气泡与排队提示词复用同一套扫描结果，
 * 使输入、排队与上屏三处看到同样的语法与样式，这里只产出与渲染无关的文本段
 */
import { scanComposerMarkdown, type ComposerMarkdownKind, type ComposerMarkdownToken } from './composerMarkdown'
import { splitTextByUrls } from '../../lib/urlBoundary'

/** 一段连续文本，classes 为语法样式对应的类名 */
export type PromptMarkdownRun =
  | { type: 'text'; text: string; classes: string[]; hidden: boolean }
  | { type: 'url'; text: string }
  | { type: 'link'; text: string; href: string; classes: string[] }
  | { type: 'bullet' }

/** 折叠无序列表符号后补上的圆点，与输入框折叠时的替代字符一致 */
export const PROMPT_MARKDOWN_BULLET = '•'

const KIND_CLASS: Record<ComposerMarkdownKind, string> = {
  marker: 'composer-md-marker',
  heading: 'composer-md-heading',
  strong: 'composer-md-strong',
  em: 'composer-md-em',
  strike: 'composer-md-strike',
  code: 'composer-md-code',
  fence: 'composer-md-fence',
  quote: 'composer-md-quote',
  link: 'composer-md-link',
  linkUrl: 'composer-md-linkUrl',
  listMarker: 'composer-md-listMarker',
  orderedMarker: 'composer-md-orderedMarker',
}

/** 折叠的只有标记符与无序列表符号，有序列表序号保留信息量 */
function hidesOnSent(token: ComposerMarkdownToken): boolean {
  return token.kind === 'marker' || token.kind === 'listMarker'
}

/**
 * 逐行扫描，把行内偏移换算成整段文本的偏移，并记录需要补圆点的无序列表行首，
 * 同时把链接标签与其地址配对，供调用方渲染成可点击的链接
 */
function collectTokens(text: string): {
  tokens: ComposerMarkdownToken[]
  bullets: number[]
  labelHrefs: Map<number, string>
  addressHrefs: Map<number, string>
} {
  const lines = text.split('\n')
  const scanned = scanComposerMarkdown(lines)
  const tokens: ComposerMarkdownToken[] = []
  const bullets: number[] = []
  const labelHrefs = new Map<number, string>()
  const addressHrefs = new Map<number, string>()
  let offset = 0
  lines.forEach((_line, index) => {
    const lineTokens = (scanned[index] ?? []).map((token) => ({
      ...token,
      start: token.start + offset,
      end: token.end + offset,
    }))
    tokens.push(...lineTokens)
    let pendingLabel: ComposerMarkdownToken | null = null
    for (const token of lineTokens) {
      if (token.kind === 'link') pendingLabel = token
      if (token.kind === 'linkUrl') {
        const href = text.slice(token.start, token.end)
        addressHrefs.set(token.start, href)
        if (pendingLabel) labelHrefs.set(pendingLabel.start, href)
        pendingLabel = null
      }
      if (token.kind === 'listMarker') bullets.push(token.start)
    }
    // 行尾换行符也占一个字符
    offset += lines[index]!.length + 1
  })
  return { tokens, bullets, labelHrefs, addressHrefs }
}

/**
 * 只接受页面地址、文件地址与相对路径，其他协议（例如 `javascript:`）
 * 原样显示为文本，不生成可点击链接
 */
function safeHref(href: string): string | null {
  const raw = href.trim()
  if (!raw) return null
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(raw)?.[0].toLowerCase()
  if (!scheme) return raw
  if (/^[a-z]:[\\/]/i.test(raw)) return raw
  return scheme === 'http:' || scheme === 'https:' || scheme === 'file:' ? raw : null
}

function urlRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let offset = 0
  for (const segment of splitTextByUrls(text)) {
    if (segment.type === 'url') ranges.push([offset, offset + segment.value.length])
    offset += segment.value.length
  }
  return ranges
}

/** 整段提示词拆成带样式的文本段，地址与链接单独成段供调用方渲染为可点击链接 */
export function promptMarkdownRuns(text: string): PromptMarkdownRun[] {
  if (!text) return []
  const { tokens, bullets, labelHrefs, addressHrefs } = collectTokens(text)
  const urls = urlRanges(text)
  const points = new Set<number>([0, text.length])
  for (const token of tokens) {
    points.add(token.start)
    points.add(token.end)
  }
  for (const [from, to] of urls) {
    points.add(from)
    points.add(to)
  }
  for (const bullet of bullets) points.add(bullet)

  const bounds = [...points]
    .filter((point) => point >= 0 && point <= text.length)
    .sort((left, right) => left - right)
  const runs: PromptMarkdownRun[] = []
  const push = (run: PromptMarkdownRun) => {
    const last = runs[runs.length - 1]
    if (run.type === 'text' && last?.type === 'text'
      && last.hidden === run.hidden
      && last.classes.join(' ') === run.classes.join(' ')) {
      last.text += run.text
      return
    }
    if (run.type === 'link' && last?.type === 'link'
      && last.href === run.href
      && last.classes.join(' ') === run.classes.join(' ')) {
      last.text += run.text
      return
    }
    runs.push(run)
  }

  for (let index = 0; index < bounds.length - 1; index += 1) {
    const start = bounds[index]!
    const end = bounds[index + 1]!
    if (start >= end) continue
    if (bullets.includes(start)) push({ type: 'bullet' })
    const covering = tokens.filter((token) => token.start <= start && end <= token.end)
    // 代码里的地址原样保留，链接与普通裸地址都渲染为可点击的链接
    const code = covering.some((token) => token.kind === 'code' || token.kind === 'fence')
    if (!code) {
      const label = covering.find((token) => token.kind === 'link')
      const address = covering.find((token) => token.kind === 'linkUrl')
      const href = safeHref(
        label
          ? labelHrefs.get(label.start) ?? ''
          : address
            ? addressHrefs.get(address.start) ?? ''
            : '',
      )
      if (href) {
        push({
          type: 'link',
          text: text.slice(start, end),
          href,
          // 标签与地址沿用输入框的着色类名，链接文字与地址各有分量
          classes: [...new Set(covering.map((token) => KIND_CLASS[token.kind]))],
        })
        continue
      }
      if (urls.some(([from, to]) => from <= start && end <= to)) {
        push({ type: 'url', text: text.slice(start, end) })
        continue
      }
    }
    push({
      type: 'text',
      text: text.slice(start, end),
      classes: [...new Set(covering.map((token) => KIND_CLASS[token.kind]))],
      hidden: covering.some(hidesOnSent),
    })
  }
  return runs
}