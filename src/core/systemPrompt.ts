import os from 'node:os'
import { getProjectMemory } from '../memory/projectMemory.js'
import { formatExperiences, retrieveRelevant } from '../memory/retrieve.js'
import { formatSkillsForPrompt } from '../skills/skills.js'
import { formatAgentsForPrompt } from '../agents/agents.js'
import { getTodos } from '../tools/todoTool.js'
import type { PermissionMode } from '../config/index.js'

const BASE_PROMPT = `你是 StrikeAgent，一个运行在终端中的资深 AI 编程助手。你的代号是"打击手"——精准、果断、可靠。

工作准则：
- 直接行动：有足够信息就动手，不要反复确认已确定的事。优先用工具读代码、查文件、跑命令来获取事实，而不是凭空猜测。
- 最小改动：只做任务需要的改动，不擅自重构、不加多余抽象、不写无意义注释。
- 工具优先：需要读写文件、搜索、执行命令时，调用对应工具，而不是让用户手动操作。
- 完成闭环：复杂任务用 TodoWrite 拆解跟踪；任务完成后给出简洁结论。
- 安全：危险操作（删除、格式化、远程执行）需谨慎，会触发用户确认。
- 中文交流：默认用简体中文回复用户。

工具使用：
- 文件操作用 ReadFile/WriteFile/EditFile；搜索用 Glob/Grep；执行命令用 Shell。
- 把可复用的经验、项目约定、踩坑用 MemoryWrite 记录下来，越用越聪明。
- 独立子任务可用 Task 派生子代理并行处理。`

export interface SystemPromptOptions {
  cwd: string
  permissionMode: PermissionMode
  model: string
  /** 当前用户输入，用于召回相关记忆 */
  query?: string
  isSubagent?: boolean
  /** 子智能体角色指令（来自 agents/ 定义），仅子代理生效。 */
  agentInstructions?: string
}

export async function buildSystemPrompt(
  opts: SystemPromptOptions,
): Promise<string> {
  const sections: string[] = [BASE_PROMPT]

  // 子智能体角色指令（最高优先，紧跟基础人设）
  if (opts.isSubagent && opts.agentInstructions?.trim()) {
    sections.push(
      `# 你的角色（子智能体）\n你现在作为一个专门的子智能体执行任务，请严格遵循以下角色设定与指令：\n\n${opts.agentInstructions.trim()}`,
    )
  }

  // 环境信息
  sections.push(
    `# 环境\n操作系统: ${os.platform()} (${os.release()})\n工作目录: ${opts.cwd}\n当前模型: ${opts.model}\n权限模式: ${opts.permissionMode}${
      opts.permissionMode === 'plan'
        ? '（计划模式：只能用只读工具，先制定方案待用户批准）'
        : ''
    }`,
  )

  // 可用技能
  const skills = formatSkillsForPrompt(opts.cwd)
  if (skills) sections.push(skills)

  // 可用子智能体（仅主代理需要，子代理不能再派生）
  if (!opts.isSubagent) {
    const agents = formatAgentsForPrompt(opts.cwd)
    if (agents) sections.push(agents)
  }

  // 项目记忆
  const memory = getProjectMemory(opts.cwd)
  if (memory.trim()) {
    sections.push(`# 项目记忆\n以下是关于本项目的长期记忆，请遵循：\n\n${memory}`)
  }

  // 召回相关经验
  if (opts.query && !opts.isSubagent) {
    const exps = await retrieveRelevant(opts.query, { cwd: opts.cwd, topK: 5 })
    const formatted = formatExperiences(exps)
    if (formatted) {
      sections.push(
        `# 相关历史经验\n以下是你过去在类似任务中积累的经验，可作参考：\n\n${formatted}`,
      )
    }
  }

  // 当前待办
  const todos = getTodos()
  if (todos.length && !opts.isSubagent) {
    const rendered = todos
      .map(t => `- [${t.status}] ${t.content}`)
      .join('\n')
    sections.push(`# 当前待办\n${rendered}`)
  }

  return sections.join('\n\n')
}
