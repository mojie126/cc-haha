/**
 * Live Markdown syntax marking for the composer editor.
 *
 * The composer document stays a flat list of plain-text paragraphs — the
 * projection, serialization and submit paths never see these tokens. This
 * module only lifts the visual layer: it scans each line for common Markdown
 * syntax and returns inline decorations that dim the markers and style the
 * content they delimit. Nothing here may change document text or its length.
 */
import { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { mentionToken, type ComposerMention } from '../../lib/composerMentions'
import { AT_MENTION_NODE } from './composerEditor'

export type ComposerMarkdownKind =
  | 'marker'
  | 'heading'
  | 'strong'
  | 'em'
  | 'strike'
  | 'code'
  | 'fence'
  | 'quote'
  | 'link'
  | 'linkUrl'
  | 'listMarker'
  | 'orderedMarker'

export type ComposerMarkdownToken = {
  kind: ComposerMarkdownKind
  /** Offset into the line, inclusive. */
  start: number
  /** Offset into the line, exclusive. */
  end: number
  /** atx 标题层级，一至六级 */
  headingLevel?: number
}

/** atx 标题：`#` 至 `######` 后须有空白或行尾 */
const HEADING = /^(#{1,6})(?:[ \t]+(.*))?$/
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const QUOTE_PREFIX = /^(?: {0,3}>[ \t]?)+/
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])(?=\s)/
/** 任务列表勾选框紧跟在列表标记之后（中间可有空白） */
const TASK_PREFIX = /^[ \t]*\[[ xX]\][ \t]+/
/** 三个及以上 `-`、`*`、`_`（可夹空格）单独成行 */
const HORIZONTAL_RULE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const INLINE_CODE = /(`+)([^`]+?)\1/g
const LINK = /!?\[[^\]\n]*\]\([^)\n]*\)/g
const STRONG_EM_STAR = /\*\*\*(?=\S)([^*\n]*?\S)\*\*\*/g
const STRONG_EM_UNDERSCORE = /___(?=\S)([^_\n]*?\S)___/g
const STRONG_STAR = /\*\*(?=\S)([^*\n]*?\S)\*\*/g
const STRONG_UNDERSCORE = /__(?=\S)([^_\n]*?\S)__/g
const EM_STAR = /\*(?=\S)([^*\n]*?\S)\*/g
const EM_UNDERSCORE = /_(?=\S)([^_\n]*?\S)_/g
const STRIKE = /~~(?=\S)([^~\n]*?\S)~~/g
/** 单波浪线删除线：聊天里很常见，放在 `~~` 之后扫描避免把双波浪拆开 */
const STRIKE_SINGLE = /~(?=\S)([^~\n]*?\S)~/g

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char)
}

/**
 * Inline syntax inside `[start, end)` of one line.
 *
 * Code spans win first so emphasis-looking characters inside them stay
 * literal, then strong, strike and emphasis scan the remaining text. A match
 * that touches an already masked span is dropped instead of nested, which
 * keeps the decoration set predictable while typing.
 */
function scanInline(line: string, start: number, end: number, out: ComposerMarkdownToken[]): void {
  const masked: Array<[number, number]> = []
  const overlapsMasked = (from: number, to: number) =>
    masked.some(([maskFrom, maskTo]) => from < maskTo && to > maskFrom)

  const addDelimited = (
    from: number,
    to: number,
    delimiterLength: number,
    kind: 'strong' | 'em' | 'strike' | 'code',
  ) => {
    out.push({ kind: 'marker', start: from, end: from + delimiterLength })
    out.push({ kind: 'marker', start: to - delimiterLength, end: to })
    if (to - delimiterLength > from + delimiterLength) {
      out.push({ kind, start: from + delimiterLength, end: to - delimiterLength })
    }
    masked.push([from, to])
  }

  const scanPattern = (
    pattern: RegExp,
    kind: 'strong' | 'em' | 'strike',
    delimiterLength: number,
    accept?: (from: number, to: number) => boolean,
  ) => {
    for (const match of line.slice(start, end).matchAll(pattern)) {
      if (match.index === undefined) continue
      const from = start + match.index
      const to = from + match[0].length
      if (overlapsMasked(from, to)) continue
      if (accept && !accept(from, to)) continue
      addDelimited(from, to, delimiterLength, kind)
    }
  }

  for (const match of line.slice(start, end).matchAll(INLINE_CODE)) {
    if (match.index === undefined) continue
    const from = start + match.index
    const to = from + match[0].length
    if (overlapsMasked(from, to)) continue
    addDelimited(from, to, match[1]!.length, 'code')
  }
  // 链接与图片：标记符按装饰处理，地址与文字分别着色
  for (const match of line.slice(start, end).matchAll(LINK)) {
    if (match.index === undefined) continue
    const from = start + match.index
    const to = from + match[0].length
    if (overlapsMasked(from, to)) continue
    const raw = match[0]
    const image = raw.startsWith('!')
    const labelOpen = from + (image ? 1 : 0)
    const bracketClose = from + raw.indexOf('](')
    if (bracketClose <= labelOpen) continue
    if (image) out.push({ kind: 'marker', start: from, end: from + 1 })
    out.push({ kind: 'marker', start: labelOpen, end: labelOpen + 1 })
    out.push({ kind: 'marker', start: bracketClose, end: bracketClose + 1 })
    out.push({ kind: 'marker', start: bracketClose + 1, end: bracketClose + 2 })
    out.push({ kind: 'marker', start: to - 1, end: to })
    if (bracketClose > labelOpen + 1) {
      out.push({ kind: 'link', start: labelOpen + 1, end: bracketClose })
    }
    if (to - 1 > bracketClose + 2) {
      out.push({ kind: 'linkUrl', start: bracketClose + 2, end: to - 1 })
    }
    masked.push([from, to])
  }
  const scanTripleDelimiter = (pattern: RegExp) => {
    for (const match of line.slice(start, end).matchAll(pattern)) {
      if (match.index === undefined) continue
      const from = start + match.index
      const to = from + match[0].length
      if (overlapsMasked(from, to)) continue
      out.push({ kind: 'marker', start: from, end: from + 3 })
      out.push({ kind: 'marker', start: to - 3, end: to })
      if (to - 3 > from + 3) {
        out.push({ kind: 'strong', start: from + 3, end: to - 3 })
        out.push({ kind: 'em', start: from + 3, end: to - 3 })
      }
      masked.push([from, to])
    }
  }
  scanTripleDelimiter(STRONG_EM_STAR)
  scanTripleDelimiter(STRONG_EM_UNDERSCORE)
  scanPattern(STRONG_STAR, 'strong', 2)
  scanPattern(STRONG_UNDERSCORE, 'strong', 2, (from, to) =>
    !isWordChar(line[from - 1]) && !isWordChar(line[to]))
  scanPattern(STRIKE, 'strike', 2)
  scanPattern(STRIKE_SINGLE, 'strike', 1)
  scanPattern(EM_STAR, 'em', 1)
  // 下划线强调须落在词边界之外，避免把 snake_case 识别成斜体
  scanPattern(EM_UNDERSCORE, 'em', 1, (from, to) =>
    !isWordChar(line[from - 1]) && !isWordChar(line[to]))
}

type FenceState = { char: string; length: number } | null

function scanLine(line: string, fence: FenceState): { tokens: ComposerMarkdownToken[]; fence: FenceState } {
  const tokens: ComposerMarkdownToken[] = []

  if (fence) {
    const closing = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
    if (closing && closing[1]!.startsWith(fence.char) && closing[1]!.length >= fence.length) {
      // 结束围栏整行都是语法，代码行本身不是
      tokens.push({ kind: 'marker', start: 0, end: line.length })
      return { tokens, fence: null }
    }
    tokens.push({ kind: 'fence', start: 0, end: line.length })
    return { tokens, fence }
  }

  const opening = FENCE_OPEN.exec(line)
  if (opening) {
    // 开围栏整行（含语言标签）都是语法，围栏内的代码行才用代码样式
    tokens.push({ kind: 'marker', start: 0, end: line.length })
    return { tokens, fence: { char: opening[1]![0]!, length: opening[1]!.length } }
  }

  if (HORIZONTAL_RULE.test(line)) {
    tokens.push({ kind: 'marker', start: 0, end: line.length })
    return { tokens, fence }
  }

  const heading = HEADING.exec(line)
  if (heading) {
    const level = heading[1]!.length
    const contentStart = Math.min(line.length, heading[0].length - (heading[2]?.length ?? 0))
    // 标记含其后的空白，隐藏时标题才贴齐左边缘
    tokens.push({ kind: 'marker', start: 0, end: contentStart })
    if (line.length > contentStart) {
      tokens.push({ kind: 'heading', start: contentStart, end: line.length, headingLevel: level })
      scanInline(line, contentStart, line.length, tokens)
    }
    return { tokens, fence }
  }

  const quote = QUOTE_PREFIX.exec(line)
  if (quote) {
    const contentStart = quote[0].length
    tokens.push({ kind: 'marker', start: 0, end: contentStart })
    if (line.length > contentStart) {
      tokens.push({ kind: 'quote', start: contentStart, end: line.length })
      scanInline(line, contentStart, line.length, tokens)
    }
    return { tokens, fence }
  }

  const list = LIST_MARKER.exec(line)
  if (list) {
    let contentStart = list[0].length
    // 任务列表的 `[ ]` / `[x]` 也是标记，跟随列表符号一起隐藏
    const task = TASK_PREFIX.exec(line.slice(contentStart))
    if (task) contentStart += task[0].length
    // 无序列表隐藏时替换成圆点，有序列表的序号本身有信息量，始终保留
    const ordered = /^\s*\d/.test(list[0])
    tokens.push({ kind: ordered ? 'orderedMarker' : 'listMarker', start: 0, end: contentStart })
    scanInline(line, contentStart, line.length, tokens)
    return { tokens, fence }
  }

  scanInline(line, 0, line.length, tokens)
  return { tokens, fence }
}

/** Scan every line, carrying fenced-code state across lines. */
export function scanComposerMarkdown(lines: string[]): ComposerMarkdownToken[][] {
  let fence: FenceState = null
  return lines.map((line) => {
    const scanned = scanLine(line, fence)
    fence = scanned.fence
    return scanned.tokens
  })
}

/** Scan one line outside any fenced code block. */
export function scanComposerMarkdownLine(line: string): ComposerMarkdownToken[] {
  return scanLine(line, null).tokens
}

type BlockProjection = {
  segments: Array<{ textStart: number; textEnd: number; pmStart: number }>
  atomSpans: Array<[number, number]>
  contentEnd: number
}

/**
 * Map projected text offsets of one paragraph onto ProseMirror positions.
 * Mention atoms project as their token text but occupy one PM position, so
 * the segment table remembers their text ranges for the overlap check.
 */
function projectBlock(block: PMNode, blockPos: number): BlockProjection {
  const segments: BlockProjection['segments'] = []
  const atomSpans: BlockProjection['atomSpans'] = []
  let textOffset = 0
  let pmPos = blockPos + 1
  block.forEach((child) => {
    if (child.isText) {
      const length = child.text?.length ?? 0
      segments.push({ textStart: textOffset, textEnd: textOffset + length, pmStart: pmPos })
      textOffset += length
      pmPos += length
      return
    }
    const token = mentionToken(child.attrs as ComposerMention)
    atomSpans.push([textOffset, textOffset + token.length])
    textOffset += token.length
    pmPos += child.nodeSize
  })
  return { segments, atomSpans, contentEnd: pmPos }
}

function textOffsetToPmPos(projection: BlockProjection, offset: number): number {
  for (const segment of projection.segments) {
    if (offset <= segment.textEnd) {
      return segment.pmStart + Math.max(0, offset - segment.textStart)
    }
  }
  return projection.contentEnd
}

/**
 * `hidden` marks the decorative delimiters of a line the caret is not on.
 * CSS collapses them so the draft reads like the rendered message; the line
 * being edited keeps its syntax visible, which is what makes boundary edits
 * possible at all.
 */
function decorationAttrs(token: ComposerMarkdownToken, hidden: boolean): Record<string, string> {
  const attrs: Record<string, string> = token.kind === 'heading' && token.headingLevel
    ? { class: 'composer-md-heading', 'data-md-heading': String(token.headingLevel) }
    : { class: `composer-md-${token.kind}` }
  if (hidden) attrs['data-md-hidden'] = 'true'
  return attrs
}

/**
 * Stand-in for a collapsed unordered-list dash. A widget rather than CSS on the
 * hidden span: the span is collapsed to zero width, which would take the bullet
 * with it.
 */
function markdownListBullet(): HTMLElement {
  const bullet = document.createElement('span')
  bullet.className = 'composer-md-bullet'
  bullet.setAttribute('aria-hidden', 'true')
  bullet.textContent = '•'
  return bullet
}

/**
 * Decorations for the current document. Ranges that touch a mention atom are
 * dropped: the atom projects as a token, so a decoration boundary landing
 * inside it has no stable PM position.
 */
export function buildComposerMarkdownDecorations(
  doc: PMNode,
  activeBlockIndex: number | null = null,
): DecorationSet {
  const lines: string[] = []
  doc.forEach((block) => {
    lines.push(block.textBetween(0, block.content.size, '', (node) =>
      node.type.name === AT_MENTION_NODE ? mentionToken(node.attrs as ComposerMention) : ''))
  })
  const scanned = scanComposerMarkdown(lines)
  const decorations: Decoration[] = []
  doc.forEach((block, blockPos, index) => {
    const tokens = scanned[index] ?? []
    if (!tokens.length) return
    const projection = projectBlock(block, blockPos)
    // 光标所在行保留语法符号，其余行隐藏标记
    const hideMarkers = activeBlockIndex !== null && index !== activeBlockIndex
    for (const token of tokens) {
      if (token.end <= token.start) continue
      if (projection.atomSpans.some(([atomFrom, atomTo]) =>
        token.start < atomTo && token.end > atomFrom)) continue
      const hidden = hideMarkers && (token.kind === 'marker' || token.kind === 'listMarker')
      if (hidden && token.kind === 'listMarker') {
        // 列表符号折叠后留一个圆点，否则隐藏的 `-` 会让这一行读成普通段落
        decorations.push(Decoration.widget(
          textOffsetToPmPos(projection, token.start),
          markdownListBullet,
          { side: -1, key: `md-bullet:${index}:${token.start}` },
        ))
      }
      decorations.push(Decoration.inline(
        textOffsetToPmPos(projection, token.start),
        textOffsetToPmPos(projection, token.end),
        decorationAttrs(token, hidden),
      ))
    }
  })
  return DecorationSet.create(doc, decorations)
}

/**
 * Index of the paragraph holding `pos`. A caret exactly on a paragraph
 * boundary belongs to the one it is inside or just after, which is what the
 * decorations need: the block whose markers stay visible.
 */
function blockIndexAt(doc: PMNode, pos: number): number | null {
  const bounded = Math.max(0, Math.min(pos, doc.content.size))
  let found: number | null = null
  doc.forEach((block, blockPos, index) => {
    if (found !== null) return
    // Paragraph content spans (blockPos, blockPos + nodeSize - 1].
    if (bounded >= blockPos + 1 && bounded <= blockPos + block.nodeSize - 1) found = index
  })
  if (found !== null) return found
  // At a document edge: the first or last paragraph.
  let edge: number | null = null
  doc.forEach((_block, blockPos, index) => {
    if (blockPos <= bounded) edge = index
  })
  return edge
}

export const composerMarkdownPluginKey = new PluginKey<DecorationSet>('composer-markdown-highlight')

type CachedDecorations = {
  doc: PMNode
  activeBlockIndex: number | null
  decorations: DecorationSet
}

/**
 * Recomputes when the text or the caret's paragraph changes. Move-only
 * selections within one paragraph reuse the previous set, so arrowing through
 * a line does not rescan the whole draft.
 */
export function composerMarkdownPlugin(): Plugin<DecorationSet> {
  let cache: CachedDecorations | null = null
  return new Plugin<DecorationSet>({
    key: composerMarkdownPluginKey,
    props: {
      decorations: (state) => {
        const activeBlockIndex = blockIndexAt(state.doc, state.selection.from)
        if (cache && cache.doc === state.doc && cache.activeBlockIndex === activeBlockIndex) {
          return cache.decorations
        }
        const decorations = buildComposerMarkdownDecorations(state.doc, activeBlockIndex)
        cache = { doc: state.doc, activeBlockIndex, decorations }
        return decorations
      },
    },
  })
}
