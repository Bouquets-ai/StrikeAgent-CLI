// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
import { z } from 'zod'
import { defineTool, type Tool } from './tool.js'
import { findAgent, scanAgents } from '../agents/agents.js'

export const TaskTool = defineTool({
  name: 'Task',
  description: '派生子代理并行处理独立子任务（可指定子智能体角色）。',
  prompt:
    '当需要把一个相对独立、可自主完成的子任务（如搜索定位、批量信息收集、独立分析）交给子代理时使用。子代理拥有完整工具集但不能再派生子代理。可选 subagent_type 指定使用某个预定义子智能体（其角色指令与模型档位会生效）；省略则用通用快速子代理。返回子代理的最终结论。',
  inputSchema: z.object({
    description: z.string().describe('子任务简述（3-6 字）'),
    prompt: z.string().describe('给子代理的完整任务说明（它看不到当前对话）'),
    subagent_type: z
      .string()
      .optional()
      .describe('可选：预定义子智能体名字（见系统提示中的"可用子智能体"清单）'),
  }),
  isReadOnly: () => false,
  needsPermission: () => false,
  renderInput: i =>
    i.subagent_type ? `${i.description} @${i.subagent_type}` : i.description,
  async execute(input, ctx) {
    if (ctx.isSubagent || !ctx.runSubagent) {
      return { content: '子代理不能再派生子代理', isError: true }
    }

    let instructions: string | undefined
    let model: 'main' | 'fast' | undefined
    if (input.subagent_type) {
      const agent = findAgent(input.subagent_type, ctx.cwd)
      if (!agent) {
        const all = scanAgents(ctx.cwd)
        return {
          content: `未找到子智能体 "${input.subagent_type}"。可用：${
            all.map(a => a.name).join(', ') || '(无)'
          }`,
          isError: true,
        }
      }
      instructions = agent.instructions
      model = agent.model
    }

    try {
      const result = await ctx.runSubagent(
        input.prompt,
        ctx.signal,
        input.subagent_type
          ? `${input.description}(${input.subagent_type})`
          : input.description,
        { instructions, model },
      )
      return { content: result, summary: `子代理: ${input.description}` }
    } catch (e) {
      return {
        content: `子代理失败: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
      }
    }
  },
}) as Tool
