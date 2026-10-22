/**
 * 旧 HTML 文本节点里的「换行 + N 个缩进空格」。
 *
 * 改造前的页面是手写 HTML，段落文本节点里带着原始的换行与缩进；浏览器布局时它们
 * 会被折叠，但在小数行高（例如 line-height:1.9 的 15px 文字 = 28.5px）与
 * .glass 的 backdrop-filter 毛玻璃背景下，文本节点的字符差异会挪动 1px 的
 * 栅格化落点，肉眼可见的就是卡片描边位置变化。
 *
 * 这些页面要求与改造前逐像素一致，所以用插值把旧文本节点的原始空白原样写回。
 * Vue 全局已启用 whitespace:'preserve'，这里补的是"模板被重排成单行"后
 * 相较旧 HTML 丢失的那部分空白。
 */
export function ws(indent: number): string {
  return '\n' + ' '.repeat(indent)
}
