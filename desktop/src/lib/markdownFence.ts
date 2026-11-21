/**
 * @brief 判断一行是否开启围栏代码块
 * @details 对齐 CommonMark，反引号围栏的信息串不能再包含反引号，所以同一行内闭合的
 * ` ```代码``` ` 属于行内代码，否则该行会被当成整行语法，后续行也会被吞进代码块
 * @param marker 围栏标记，三个及以上同类字符
 * @param suffix 标记之后的内容，含语言标签
 * @return 该行是否为围栏起始行
 */
export function startsMarkdownFence(marker: string, suffix: string): boolean {
  return marker[0] === '~' || !suffix.includes('`')
}