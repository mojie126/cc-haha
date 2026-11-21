import { describe, expect, it } from 'vitest'
import {
  buildComposerMarkdownDecorations,
  scanComposerMarkdown,
  scanComposerMarkdownLine,
  type ComposerMarkdownToken,
} from './composerMarkdown'
import { buildComposerDoc } from './composerEditor'
import type { ComposerMention } from '../../lib/composerMentions'

function tokensOf(line: string): ComposerMarkdownToken[] {
  return scanComposerMarkdownLine(line)
}

/** `Decoration.type` is private in the published types but present at runtime. */
function attrsOf(decoration: { from: number; to: number }): Record<string, string> {
  return (decoration as unknown as { type: { attrs: Record<string, string> } }).type.attrs
}

function ranges(line: string, kind: ComposerMarkdownToken['kind']): Array<[number, number]> {
  return tokensOf(line)
    .filter((token) => token.kind === kind)
    .map((token) => [token.start, token.end])
}

describe('scanComposerMarkdownLine', () => {
  it('marks atx headings with their level and leaves the text intact', () => {
    // 标记含其后的空白，隐藏后标题贴齐左边缘
    expect(tokensOf('## Title')).toEqual([
      { kind: 'marker', start: 0, end: 3 },
      { kind: 'heading', start: 3, end: 8, headingLevel: 2 },
    ])
    expect(tokensOf('#')).toEqual([{ kind: 'marker', start: 0, end: 1 }])
  })

  it('only treats a leading run as a heading when whitespace follows', () => {
    expect(tokensOf('#tag')).toEqual([])
  })

  it('marks strong, emphasis, strike and inline code delimiters separately from content', () => {
    expect(tokensOf('**bold**')).toEqual([
      { kind: 'marker', start: 0, end: 2 },
      { kind: 'marker', start: 6, end: 8 },
      { kind: 'strong', start: 2, end: 6 },
    ])
    expect(ranges('*em*', 'em')).toEqual([[1, 3]])
    expect(ranges('~~gone~~', 'strike')).toEqual([[2, 6]])
    // 单波浪线也按删除线处理，双波浪线优先整体命中
    expect(tokensOf('~gone~')).toEqual([
      { kind: 'marker', start: 0, end: 1 },
      { kind: 'marker', start: 5, end: 6 },
      { kind: 'strike', start: 1, end: 5 },
    ])
    expect(tokensOf('~/code ~/other')).toEqual([])
    expect(tokensOf('`code`')).toEqual([
      { kind: 'marker', start: 0, end: 1 },
      { kind: 'marker', start: 5, end: 6 },
      { kind: 'code', start: 1, end: 5 },
    ])
  })

  it('does not format syntax inside a code span', () => {
    expect(ranges('`**not bold**`', 'strong')).toEqual([])
    expect(ranges('`**not bold**`', 'code')).toEqual([[1, 13]])
  })

  it('requires word boundaries around underscore delimiters', () => {
    expect(ranges('snake_case_name', 'em')).toEqual([])
    expect(ranges('_emphasised_', 'em')).toEqual([[1, 11]])
    expect(ranges('__strong__', 'strong')).toEqual([[2, 8]])
  })

  it('marks blockquote and list prefixes and still scans their content', () => {
    expect(tokensOf('> quoted')).toEqual([
      { kind: 'marker', start: 0, end: 2 },
      { kind: 'quote', start: 2, end: 8 },
    ])
    expect(tokensOf('- item')).toEqual([{ kind: 'listMarker', start: 0, end: 1 }])
    expect(tokensOf('  12. item')).toEqual([{ kind: 'orderedMarker', start: 0, end: 5 }])
    expect(ranges('- **item**', 'strong')).toEqual([[4, 8]])
  })

  it('marks horizontal rules and task-list prefixes', () => {
    expect(tokensOf('---')).toEqual([{ kind: 'marker', start: 0, end: 3 }])
    expect(tokensOf('* * *')).toEqual([{ kind: 'marker', start: 0, end: 5 }])
    expect(tokensOf('- [x] done')).toEqual([{ kind: 'listMarker', start: 0, end: 6 }])
    expect(tokensOf('1. [ ] open')).toEqual([{ kind: 'orderedMarker', start: 0, end: 7 }])
  })

  it('marks link labels and addresses separately from their punctuation', () => {
    expect(tokensOf('see [docs](https://x) now')).toEqual([
      { kind: 'marker', start: 4, end: 5 },
      { kind: 'marker', start: 9, end: 10 },
      { kind: 'marker', start: 10, end: 11 },
      { kind: 'marker', start: 20, end: 21 },
      { kind: 'link', start: 5, end: 9 },
      { kind: 'linkUrl', start: 11, end: 20 },
    ])
    // 图片只多一个 `!`，标签与地址的着色规则相同
    expect(tokensOf('![alt](/a.png)')).toEqual([
      { kind: 'marker', start: 0, end: 1 },
      { kind: 'marker', start: 1, end: 2 },
      { kind: 'marker', start: 5, end: 6 },
      { kind: 'marker', start: 6, end: 7 },
      { kind: 'marker', start: 13, end: 14 },
      { kind: 'link', start: 2, end: 5 },
      { kind: 'linkUrl', start: 7, end: 13 },
    ])
  })

  it('marks triple delimiters as both strong and emphasis', () => {
    expect(tokensOf('***x***')).toEqual([
      { kind: 'marker', start: 0, end: 3 },
      { kind: 'marker', start: 4, end: 7 },
      { kind: 'strong', start: 3, end: 4 },
      { kind: 'em', start: 3, end: 4 },
    ])
  })

  it('keeps link syntax literal inside a code span', () => {
    expect(ranges('`[docs](https://x)`', 'link')).toEqual([])
    expect(ranges('`[docs](https://x)`', 'linkUrl')).toEqual([])
  })

  it('carries a fenced code block across lines until the matching close', () => {
    const scanned = scanComposerMarkdown(['before', '```js', 'const x = 1', '```', 'after'])
    // 围栏行整行是标记，围栏内的代码行保留代码样式
    expect(scanned.map((tokens) => tokens.map((token) => token.kind))).toEqual([
      [],
      ['marker'],
      ['fence'],
      ['marker'],
      [],
    ])
  })

  it('does not close a fence with a shorter or different delimiter', () => {
    const scanned = scanComposerMarkdown(['```', 'code', '~~', '```'])
    expect(scanned[2]!.map((token) => token.kind)).toEqual(['fence'])
    expect(scanned[3]).toEqual([{ kind: 'marker', start: 0, end: 3 }])
  })

  it('treats triple backticks closed on the same line as inline code, not a fence', () => {
    const scanned = scanComposerMarkdown(['报错如下', '```模型 qwen 不可用```', '下一行'])
    // 同一行开闭的三反引号是行内代码，既不开启围栏，也不影响后续行
    expect(scanned[1]!.map((token) => token.kind)).toEqual(['marker', 'marker', 'code'])
    expect(scanned[2]).toEqual([])
  })
})

describe('buildComposerMarkdownDecorations', () => {
  function decorationAt(docText: string, from: number, to: number) {
    const decorations = buildComposerMarkdownDecorations(buildComposerDoc(docText, [])).find(from, to)
    return decorations.map((decoration) => ({ from: decoration.from, to: decoration.to, ...attrsOf(decoration) }))
  }

  it('maps line offsets onto document positions across paragraphs', () => {
    // Paragraph 1 occupies positions 1..2, paragraph 2 starts at 3 (2 + 1).
    const found = decorationAt('a\n**b**', 4, 9)
    expect(found).toContainEqual({ from: 4, to: 6, class: 'composer-md-marker' })
    expect(found).toContainEqual({ from: 6, to: 7, class: 'composer-md-strong' })
    expect(found).toContainEqual({ from: 7, to: 9, class: 'composer-md-marker' })
  })

  it('drops the content style when a mention atom sits inside the range', () => {
    const mention: ComposerMention = {
      label: 'main.ts',
      path: '/repo/src/main.ts',
      isDirectory: false,
      tokenOrdinal: 0,
    }
    const doc = buildComposerDoc('**@main.ts**', [mention])
    const decorations = buildComposerMarkdownDecorations(doc).find()
    // The atom projects as a token, so only the two delimiter ranges survive.
    expect(decorations.map((decoration) => attrsOf(decoration).class)).toEqual([
      'composer-md-marker',
      'composer-md-marker',
    ])
  })

  it('keeps marker decorations around a mention untouched', () => {
    const mention: ComposerMention = {
      label: 'main.ts',
      path: '/repo/src/main.ts',
      isDirectory: false,
      tokenOrdinal: 0,
    }
    const doc = buildComposerDoc('- @main.ts', [mention])
    const decorations = buildComposerMarkdownDecorations(doc).find()
    expect(decorations).toHaveLength(1)
    expect(decorations[0]!.from).toBe(1)
    expect(decorations[0]!.to).toBe(2)
    expect(attrsOf(decorations[0]!).class).toBe('composer-md-listMarker')
  })

  it('keeps a bullet where a folded unordered-list dash used to be', () => {
    const doc = buildComposerDoc('- item\nsecond line', [])
    const decorations = buildComposerMarkdownDecorations(doc, 1).find()
    const widgets = decorations.filter((decoration) => decoration.from === decoration.to)
    expect(widgets).toHaveLength(1)
    expect(widgets[0]!.from).toBe(1)
    expect(decorations.filter((decoration) => decoration.from !== decoration.to).some((decoration) =>
      attrsOf(decoration).class === 'composer-md-listMarker' &&
      attrsOf(decoration)['data-md-hidden'] === 'true')).toBe(true)
  })

  it('keeps an ordered-list number visible when the line is not active', () => {
    const doc = buildComposerDoc('1. first\nsecond line', [])
    const decorations = buildComposerMarkdownDecorations(doc, 1).find()
    const ordered = decorations.filter((decoration) => attrsOf(decoration).class === 'composer-md-orderedMarker')
    expect(ordered).toHaveLength(1)
    expect(attrsOf(ordered[0]!)['data-md-hidden']).toBeUndefined()
    expect(decorations.some((decoration) => decoration.from === decoration.to)).toBe(false)
  })

  it('hides the markers of every line except the one holding the caret', () => {
    // 两段都带标记；光标在第一段时，只有第二段的标记折叠
    const doc = buildComposerDoc('## Title\n**bold**', [])
    const decorations = buildComposerMarkdownDecorations(doc, 0).find()
    const hidden = decorations
      .filter((decoration) => attrsOf(decoration)['data-md-hidden'] === 'true')
      .map((decoration) => ({ from: decoration.from, to: decoration.to, class: attrsOf(decoration).class }))
    // 第二段（`**bold**`）的两个星号标记；第一段占 0..9，故第二段内容从 11 开始
    expect(hidden).toEqual([
      { from: 11, to: 13, class: 'composer-md-marker' },
      { from: 17, to: 19, class: 'composer-md-marker' },
    ])
  })

  it('keeps every marker visible when no active block is given', () => {
    const doc = buildComposerDoc('## Title\n**bold**', [])
    const decorations = buildComposerMarkdownDecorations(doc).find()
    expect(decorations.every((decoration) => attrsOf(decoration)['data-md-hidden'] === undefined)).toBe(true)
  })

  it('keeps the caret line visible while hiding the heading markers above it', () => {
    const doc = buildComposerDoc('## Title\n**bold**', [])
    const decorations = buildComposerMarkdownDecorations(doc, 1).find()
    const hidden = decorations.filter((decoration) => attrsOf(decoration)['data-md-hidden'] === 'true')
    // 只有第一段的 `## ` 标记被折叠
    expect(hidden.map((decoration) => [decoration.from, decoration.to])).toEqual([[1, 4]])
  })
})
