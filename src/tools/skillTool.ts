import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { defineTool, type Tool } from './tool.js'
import { truncateOutput } from './util.js'
import { findSkill, scanSkills } from '../skills/skills.js'

export const SkillTool = defineTool({
  name: 'Skill',
  description: '加载并遵循一个技能（Skill）的完整说明。',
  prompt:
    '当某个可用技能与当前任务相关时，用本工具按技能名加载其 SKILL.md 全文与附带文件清单，然后严格按其中的指引执行。不带 name 时列出全部可用技能。',
  inputSchema: z.object({
    name: z.string().optional().describe('技能名；省略则列出全部可用技能'),
  }),
  isReadOnly: () => true,
  needsPermission: () => false,
  renderInput: i => i.name ?? '(列出全部)',
  async execute(input, ctx) {
    if (!input.name) {
      const all = scanSkills(ctx.cwd)
      if (!all.length) return { content: '没有可用技能' }
      return {
        content:
          '可用技能：\n' +
          all.map(s => `- ${s.name} [${s.source}]: ${s.description}`).join('\n'),
      }
    }

    const skill = findSkill(input.name, ctx.cwd)
    if (!skill) {
      const all = scanSkills(ctx.cwd)
      return {
        content: `未找到技能 "${input.name}"。可用：${all.map(s => s.name).join(', ') || '(无)'}`,
        isError: true,
      }
    }

    const body = await fsp.readFile(skill.file, 'utf8')

    // 列出技能目录下的辅助文件（脚本/模板等），供模型按需读取
    let extras = ''
    try {
      const files = fs
        .readdirSync(skill.dir, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.toUpperCase() !== 'SKILL.MD')
        .map(d => path.join(skill.dir, d.name))
      if (files.length) {
        extras =
          '\n\n## 本技能目录下的附带文件（可用 ReadFile 按需读取）\n' +
          files.map(f => `- ${f}`).join('\n')
      }
    } catch {
      /* 忽略 */
    }

    return {
      content: truncateOutput(
        `已加载技能 "${skill.name}"（路径 ${skill.file}）。请严格遵循以下说明执行：\n\n${body}${extras}`,
        50_000,
      ),
      summary: `技能 ${skill.name}`,
    }
  },
}) as Tool
