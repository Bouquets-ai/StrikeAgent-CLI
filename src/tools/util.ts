import path from 'node:path'

/** 把可能的相对路径解析为绝对路径（相对 cwd）。 */
export function resolvePath(cwd: string, p: string): string {
  if (!p) return cwd
  return path.isAbsolute(p) ? p : path.resolve(cwd, p)
}

const MAX_OUTPUT_CHARS = 30_000

/** 截断过长的工具输出，保留头尾。 */
export function truncateOutput(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text
  const head = text.slice(0, Math.floor(max * 0.7))
  const tail = text.slice(-Math.floor(max * 0.2))
  const omitted = text.length - head.length - tail.length
  return `${head}\n\n... [省略 ${omitted} 个字符] ...\n\n${tail}`
}

export function relativeTo(cwd: string, p: string): string {
  const rel = path.relative(cwd, p)
  return rel.startsWith('..') ? p : rel || '.'
}
