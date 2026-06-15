import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { defineTool, type Tool } from './tool.js'
import { autoMemoryDir } from '../config/paths.js'
import { truncateOutput } from './util.js'

/** 把记忆 topic 名规整为安全文件名。 */
function topicFile(cwd: string, topic: string): string {
  const safe = topic
    .replace(/[^\w\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return path.join(autoMemoryDir(cwd), `${safe || 'general'}.md`)
}

export const MemoryWriteTool = defineTool({
  name: 'MemoryWrite',
  description: '把可复用经验/项目知识写入长期记忆库。',
  prompt:
    '把值得长期记住的经验（项目约定、踩坑、有效命令、用户偏好、可复用解法）按主题写入记忆库。append=true 追加，否则覆盖该主题。',
  inputSchema: z.object({
    topic: z.string().describe('记忆主题（用作文件名），如 "build" "api-conventions"'),
    content: z.string().describe('记忆内容（Markdown）'),
    append: z.boolean().optional().describe('是否追加到该主题，默认覆盖'),
  }),
  isReadOnly: () => false,
  needsPermission: () => false,
  renderInput: i => i.topic,
  async execute(input, ctx) {
    const file = topicFile(ctx.cwd, input.topic)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    if (input.append && fs.existsSync(file)) {
      await fsp.appendFile(file, `\n\n${input.content}\n`, 'utf8')
    } else {
      await fsp.writeFile(file, `# ${input.topic}\n\n${input.content}\n`, 'utf8')
    }
    return {
      content: `已记忆主题 "${input.topic}"`,
      summary: `记忆 +${input.topic}`,
    }
  },
}) as Tool

export const MemoryReadTool = defineTool({
  name: 'MemoryRead',
  description: '读取长期记忆库中的内容。',
  prompt: '不带 topic 时列出所有记忆主题；带 topic 时返回该主题完整内容。',
  inputSchema: z.object({
    topic: z.string().optional().describe('记忆主题；省略则列出全部主题'),
  }),
  isReadOnly: () => true,
  needsPermission: () => false,
  renderInput: i => i.topic ?? '(全部)',
  async execute(input, ctx) {
    const dir = autoMemoryDir(ctx.cwd)
    if (!input.topic) {
      const files = fs.existsSync(dir)
        ? (await fsp.readdir(dir)).filter(f => f.endsWith('.md'))
        : []
      if (!files.length) return { content: '记忆库为空' }
      return {
        content: '记忆主题:\n' + files.map(f => `- ${f.replace(/\.md$/, '')}`).join('\n'),
      }
    }
    const file = topicFile(ctx.cwd, input.topic)
    if (!fs.existsSync(file)) {
      return { content: `没有主题 "${input.topic}" 的记忆`, isError: true }
    }
    return { content: truncateOutput(await fsp.readFile(file, 'utf8')) }
  },
}) as Tool
