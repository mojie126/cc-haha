import { describe, expect, it } from 'vitest'
import { promptMarkdownRuns, PROMPT_MARKDOWN_BULLET } from './promptMarkdownRuns'

function visibleText(text: string): string {
  return promptMarkdownRuns(text)
    .filter((run) => run.type !== 'text' || !run.hidden)
    .map((run) => (run.type === 'bullet' ? PROMPT_MARKDOWN_BULLET : run.text))
    .join('')
}

describe('promptMarkdownRuns', () => {
  it('collapses strong markers and styles the content the composer styled', () => {
    const runs = promptMarkdownRuns('**bold** 尾巴')
    expect(runs).toEqual([
      { type: 'text', text: '**', classes: ['composer-md-marker'], hidden: true },
      { type: 'text', text: 'bold', classes: ['composer-md-strong'], hidden: false },
      { type: 'text', text: '**', classes: ['composer-md-marker'], hidden: true },
      { type: 'text', text: ' 尾巴', classes: [], hidden: false },
    ])
    expect(visibleText('**bold** 尾巴')).toBe('bold 尾巴')
  })

  it('styles headings, inline code, strike and quotes the same way as the composer', () => {
    expect(promptMarkdownRuns('## 标题')).toEqual([
      { type: 'text', text: '## ', classes: ['composer-md-marker'], hidden: true },
      { type: 'text', text: '标题', classes: ['composer-md-heading'], hidden: false },
    ])
    expect(promptMarkdownRuns('`code`')[1]).toEqual({ type: 'text', text: 'code', classes: ['composer-md-code'], hidden: false })
    expect(promptMarkdownRuns('~~gone~~')[1]).toEqual({ type: 'text', text: 'gone', classes: ['composer-md-strike'], hidden: false })
    expect(promptMarkdownRuns('> quoted')[1]).toEqual({ type: 'text', text: 'quoted', classes: ['composer-md-quote'], hidden: false })
  })

  it('replaces a collapsed unordered marker with a bullet and keeps ordered numbers', () => {
    const unordered = promptMarkdownRuns('- item')
    expect(unordered[0]).toEqual({ type: 'bullet' })
    expect(unordered[1]).toEqual({ type: 'text', text: '-', classes: ['composer-md-listMarker'], hidden: true })
    expect(unordered[2]).toEqual({ type: 'text', text: ' item', classes: [], hidden: false })
    const ordered = promptMarkdownRuns('1. item')
    expect(ordered[0]).toEqual({ type: 'text', text: '1.', classes: ['composer-md-orderedMarker'], hidden: false })
  })

  it('carries fenced blocks and their code lines', () => {
    const runs = promptMarkdownRuns('```js\nconst x = 1\n```')
    expect(runs[0]).toEqual({ type: 'text', text: '```js', classes: ['composer-md-marker'], hidden: true })
    expect(runs).toContainEqual({ type: 'text', text: 'const x = 1', classes: ['composer-md-fence'], hidden: false })
  })

  it('keeps a bare URL a single clickable run', () => {
    const runs = promptMarkdownRuns('看 http://localhost:3000 这里')
    expect(runs).toEqual([
      { type: 'text', text: '看 ', classes: [], hidden: false },
      { type: 'url', text: 'http://localhost:3000' },
      { type: 'text', text: ' 这里', classes: [], hidden: false },
    ])
    expect(visibleText('看 http://localhost:3000 这里')).toBe('看 http://localhost:3000 这里')
  })

  it('turns a Markdown link label and destination into clickable links', () => {
    const runs = promptMarkdownRuns('[docs](http://localhost:3000/x)')
    // 标签与地址都指向同一目标，分别成段，折叠括号后仍可点击
    expect(runs.filter((run) => run.type === 'link').map((run) => run.text)).toEqual([
      'docs',
      'http://localhost:3000/x',
    ])
    expect(runs.filter((run) => run.type === 'link').map((run) => run.href)).toEqual([
      'http://localhost:3000/x',
      'http://localhost:3000/x',
    ])
    expect(runs).toContainEqual({
      type: 'link',
      text: 'http://localhost:3000/x',
      href: 'http://localhost:3000/x',
      classes: ['composer-md-linkUrl'],
    })
  })

  it('does not link an unsafe destination such as javascript:', () => {
    const runs = promptMarkdownRuns('[click](javascript:alert(1))')
    expect(runs.some((run) => run.type === 'link')).toBe(false)
    expect(visibleText('[click](javascript:alert(1))')).toBe('clickjavascript:alert(1)')
  })

  it('leaves syntax-looking text inside a code span literal', () => {
    const runs = promptMarkdownRuns('`**not bold**`')
    expect(runs).toEqual([
      { type: 'text', text: '`', classes: ['composer-md-marker'], hidden: true },
      { type: 'text', text: '**not bold**', classes: ['composer-md-code'], hidden: false },
      { type: 'text', text: '`', classes: ['composer-md-marker'], hidden: true },
    ])
  })

  it('leaves a URL inside a code span literal instead of linking it', () => {
    const runs = promptMarkdownRuns('`http://localhost:3000`')
    expect(runs.some((run) => run.type === 'url')).toBe(false)
    expect(runs).toContainEqual({
      type: 'text',
      text: 'http://localhost:3000',
      classes: ['composer-md-code'],
      hidden: false,
    })
  })

  it('keeps multi-line prompts line-aligned with the source', () => {
    expect(visibleText('第一行\n- 第二行\n**第三行**')).toBe('第一行\n• 第二行\n第三行')
  })
})