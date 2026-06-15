import { z } from 'zod'
import fg from 'fast-glob'
import { execFile } from 'node:child_process'
import { rgPath } from '@vscode/ripgrep'
import { defineTool, type Tool } from './tool.js'
import { resolvePath, truncateOutput } from './util.js'

export const GlobTool = defineTool({
  name: 'Glob',
  description: '按通配符模式查找文件。',
  prompt:
    '用 glob 模式查找文件路径，例如 "src/**/*.ts"。返回匹配的相对路径列表（按修改时间倒序）。',
  inputSchema: z.object({
    pattern: z.string().describe('glob 模式'),
    path: z.string().optional().describe('搜索根目录（默认当前目录）'),
  }),
  isReadOnly: () => true,
  needsPermission: () => false,
  renderInput: i => i.pattern,
  async execute(input, ctx) {
    const root = resolvePath(ctx.cwd, input.path ?? '.')
    const entries = await fg(input.pattern, {
      cwd: root,
      dot: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      stats: true,
      onlyFiles: true,
      suppressErrors: true,
    })
    const sorted = entries
      .sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0))
      .map(e => e.path)
    if (!sorted.length) return { content: '没有匹配的文件' }
    return {
      content: truncateOutput(sorted.join('\n')),
      summary: `找到 ${sorted.length} 个文件`,
    }
  },
}) as Tool

export const GrepTool = defineTool({
  name: 'Grep',
  description: '用 ripgrep 在代码中搜索文本/正则。',
  prompt:
    '在文件内容中搜索正则。支持 glob 过滤与忽略大小写。返回匹配的文件与行。',
  inputSchema: z.object({
    pattern: z.string().describe('正则表达式'),
    path: z.string().optional().describe('搜索目录或文件'),
    glob: z.string().optional().describe('文件过滤，如 "*.ts"'),
    ignore_case: z.boolean().optional(),
  }),
  isReadOnly: () => true,
  needsPermission: () => false,
  renderInput: i => i.pattern,
  async execute(input, ctx) {
    const root = resolvePath(ctx.cwd, input.path ?? '.')
    const args = ['--line-number', '--no-heading', '--color=never', '--max-count=200']
    if (input.ignore_case) args.push('-i')
    if (input.glob) args.push('--glob', input.glob)
    args.push('--', input.pattern, root)

    return await new Promise(resolve => {
      execFile(
        rgPath,
        args,
        { maxBuffer: 1024 * 1024 * 16, signal: ctx.signal },
        (err, stdout, stderr) => {
          // ripgrep exit code 1 = 无匹配
          if (err && (err as { code?: number }).code === 1 && !stdout) {
            resolve({ content: '没有匹配项' })
            return
          }
          if (err && !stdout) {
            resolve({ content: `搜索失败: ${stderr || err.message}`, isError: true })
            return
          }
          const lines = stdout.split('\n').filter(Boolean)
          resolve({
            content: truncateOutput(stdout || '没有匹配项'),
            summary: `匹配 ${lines.length} 行`,
          })
        },
      )
    })
  },
}) as Tool
