// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { defineTool, type Tool } from './tool.js'
import { resolvePath, truncateOutput, relativeTo } from './util.js'
import { recordFileSnapshot } from '../checkpoint/checkpoint.js'

const MAX_READ_LINES = 2000

export const ReadFileTool = defineTool({
  name: 'ReadFile',
  description: '读取文件内容（带行号）。',
  prompt:
    '读取本地文件。优先用相对路径。大文件可用 offset/limit 分页。返回带行号的内容。',
  inputSchema: z.object({
    file_path: z.string().describe('文件路径（相对或绝对）'),
    offset: z.number().int().optional().describe('起始行（1-based）'),
    limit: z.number().int().optional().describe('读取行数'),
  }),
  isReadOnly: () => true,
  needsPermission: () => false,
  renderInput: i => i.file_path,
  async execute(input, ctx) {
    const abs = resolvePath(ctx.cwd, input.file_path)
    if (!fs.existsSync(abs)) {
      return { content: `文件不存在: ${input.file_path}`, isError: true }
    }
    const stat = await fsp.stat(abs)
    if (stat.isDirectory()) {
      return { content: `${input.file_path} 是目录，不是文件`, isError: true }
    }
    const raw = await fsp.readFile(abs, 'utf8')
    const allLines = raw.split('\n')
    const start = Math.max(0, (input.offset ?? 1) - 1)
    const limit = input.limit ?? MAX_READ_LINES
    const lines = allLines.slice(start, start + limit)
    const numbered = lines
      .map((l, i) => `${String(start + i + 1).padStart(6)}|${l}`)
      .join('\n')
    const truncatedNote =
      allLines.length > start + limit
        ? `\n... [文件共 ${allLines.length} 行，仅显示 ${start + 1}-${start + lines.length}] ...`
        : ''
    return {
      content: truncateOutput(numbered + truncatedNote),
      summary: `读取 ${relativeTo(ctx.cwd, abs)} (${lines.length} 行)`,
    }
  },
}) as Tool

export const WriteFileTool = defineTool({
  name: 'WriteFile',
  description: '创建或覆盖写入文件。',
  prompt:
    '把内容写入文件（覆盖已有内容）。会自动创建父目录。写入前会做检查点快照以便回滚。',
  inputSchema: z.object({
    file_path: z.string().describe('文件路径'),
    content: z.string().describe('要写入的完整内容'),
  }),
  isReadOnly: () => false,
  needsPermission: () => true,
  renderInput: i => i.file_path,
  async execute(input, ctx) {
    const abs = resolvePath(ctx.cwd, input.file_path)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    recordFileSnapshot(ctx.cwd, abs)
    await fsp.writeFile(abs, input.content, 'utf8')
    const lines = input.content.split('\n').length
    return {
      content: `已写入 ${relativeTo(ctx.cwd, abs)}（${lines} 行）`,
      summary: `写入 ${relativeTo(ctx.cwd, abs)}`,
    }
  },
}) as Tool

export const EditFileTool = defineTool({
  name: 'EditFile',
  description: '在文件中进行精确字符串替换。',
  prompt:
    '把文件中的 old_string 替换为 new_string。old_string 必须在文件中唯一出现（除非 replace_all=true）。替换前会做检查点快照。',
  inputSchema: z.object({
    file_path: z.string().describe('文件路径'),
    old_string: z.string().describe('要被替换的原文（需保留缩进，唯一）'),
    new_string: z.string().describe('替换后的新文本'),
    replace_all: z.boolean().optional().describe('是否替换全部匹配'),
  }),
  isReadOnly: () => false,
  needsPermission: () => true,
  renderInput: i => i.file_path,
  async execute(input, ctx) {
    const abs = resolvePath(ctx.cwd, input.file_path)
    if (!fs.existsSync(abs)) {
      return { content: `文件不存在: ${input.file_path}`, isError: true }
    }
    const original = await fsp.readFile(abs, 'utf8')
    if (input.old_string === input.new_string) {
      return { content: 'old_string 与 new_string 相同，无需修改', isError: true }
    }
    const count = original.split(input.old_string).length - 1
    if (count === 0) {
      return { content: '未找到 old_string，请检查内容是否完全匹配', isError: true }
    }
    if (count > 1 && !input.replace_all) {
      return {
        content: `old_string 出现 ${count} 次，不唯一。请提供更多上下文，或设 replace_all=true`,
        isError: true,
      }
    }
    recordFileSnapshot(ctx.cwd, abs)
    const updated = input.replace_all
      ? original.split(input.old_string).join(input.new_string)
      : original.replace(input.old_string, input.new_string)
    await fsp.writeFile(abs, updated, 'utf8')
    return {
      content: `已编辑 ${relativeTo(ctx.cwd, abs)}（替换 ${input.replace_all ? count : 1} 处）`,
      summary: `编辑 ${relativeTo(ctx.cwd, abs)}`,
    }
  },
}) as Tool
