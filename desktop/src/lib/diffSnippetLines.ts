/**
 * 把编辑工具报告的片段对回文件里的真实行号
 *
 * 编辑工具只给出 `old_string` 与 `new_string`，不带块级行号，直接在片段上做差异会从 1 开始编号，
 * 看起来像是文件开头，这里通过在当前文件内容里定位片段来得到片段起始行
 */

export type SnippetStartLineOptions = {
  /** `before` 表示文件仍是编辑前状态（权限确认），优先按旧片段定位，`after` 表示编辑已完成 */
  phase?: 'before' | 'after'
  /** 替换全部时片段会出现多次，首处就是第一处改动 */
  replaceAll?: boolean
}

/**
 * 返回片段在文件中的起始行（从 1 起），无法唯一定位时返回 null
 *
 * @param content 文件当前文本
 * @param oldString 编辑替换掉的片段
 * @param newString 编辑写入的片段
 * @param options 定位顺序与多次出现时的取舍
 */
export function resolveSnippetStartLine(
  content: string,
  oldString: string,
  newString: string,
  options: SnippetStartLineOptions = {},
): number | null {
  const haystack = normalizeNewlines(content)
  const candidates = options.phase === 'before'
    ? [oldString, newString]
    : [newString, oldString]

  for (const candidate of candidates) {
    if (!candidate) continue
    const needle = normalizeNewlines(candidate)
    const firstIndex = haystack.indexOf(needle)
    if (firstIndex < 0) continue
    if (!options.replaceAll && haystack.indexOf(needle, firstIndex + 1) >= 0) continue
    return lineNumberAt(haystack, firstIndex)
  }

  return null
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function lineNumberAt(text: string, index: number): number {
  let line = 1
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1
  }
  return line
}
