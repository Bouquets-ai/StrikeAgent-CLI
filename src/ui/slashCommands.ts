import type { AgentSession } from '../core/agent.js'
import type { Usage } from '../core/message.js'
import { formatUsage } from '../core/cost.js'
import {
  getConfig,
  patchRuntimeConfig,
  saveGlobalConfig,
  type PermissionMode,
  type ProviderName,
} from '../config/index.js'
import { resetProviderCache, activeModel } from '../providers/registry.js'
import { ContextManager } from '../core/context.js'
import { getProvider, subagentModel } from '../providers/registry.js'
import { effectiveContextWindow } from '../config/index.js'
import { getProjectMemory } from '../memory/projectMemory.js'
import { runDoctor } from '../core/doctor.js'
import { undo, checkpointCount } from '../checkpoint/checkpoint.js'
import { mcpStatus, connectConfiguredMcpServers } from '../mcp/client.js'
import { scanSkills } from '../skills/skills.js'
import { scanAgents } from '../agents/agents.js'
import { previewBones } from '../buddy/soul.js'
import { RARITY_LABEL, type Companion } from '../buddy/types.js'
import { clearTodos } from '../tools/todoTool.js'
import type { BuddyMood } from '../buddy/mood.js'
import { startFeishuRemote, stopFeishuRemote, remoteRunning } from '../remote/feishu.js'
import { COPYRIGHT } from '../core/watermark.js'

/** 可用斜杠命令清单（供 / 自动补全菜单与帮助共用）。 */
export const SLASH_COMMANDS: { name: string; desc: string }[] = [
  { name: 'help', desc: '显示帮助' },
  { name: 'clear', desc: '清空会话与待办' },
  { name: 'compact', desc: '手动压缩上下文' },
  { name: 'model', desc: '查看/切换模型 deepseek|ollama|anthropic' },
  { name: 'mode', desc: '权限模式 plan|default|auto' },
  { name: 'think', desc: '思考模式 high|max|off' },
  { name: 'effort', desc: '思考模式 high|max|off（同 /think）' },
  { name: 'memory', desc: '查看项目记忆' },
  { name: 'init', desc: '生成项目记忆引导' },
  { name: 'cost', desc: '查看 token 用量与成本' },
  { name: 'pet', desc: '查看命令行伙伴属性卡' },
  { name: 'skills', desc: '查看可用技能(Skill)' },
  { name: 'agents', desc: '查看可用子智能体(Subagent)' },
  { name: 'mcp', desc: '查看/连接 MCP 服务器' },
  { name: 'rewind', desc: '回到之前某段对话并还原其后的代码改动' },
  { name: 'undo', desc: '回滚最近的文件改动' },
  { name: 'checkpoints', desc: '查看可回滚快照数' },
  { name: 'doctor', desc: '环境与连通性自检' },
  { name: 'remote', desc: '启停飞书远程操控 on|off' },
  { name: 'exit', desc: '退出' },
]

export interface SlashContext {
  session: AgentSession
  cwd: string
  usage: Usage
  companion?: Companion
  setCompanion: (c: Companion | undefined) => void
  mood: BuddyMood
  clearLog: () => void
  exit: () => void
}

export interface SlashResult {
  message?: string
}

export async function handleSlashCommand(
  raw: string,
  ctx: SlashContext,
): Promise<SlashResult> {
  const [cmd, ...rest] = raw.slice(1).trim().split(/\s+/)
  const arg = rest.join(' ')

  switch (cmd) {
    case 'help':
      return { message: HELP_TEXT }

    case 'clear':
      ctx.session.reset()
      clearTodos()
      ctx.clearLog()
      return { message: '已清空会话与待办' }

    case 'compact': {
      const cfg = getConfig()
      const mgr = new ContextManager({
        contextWindow: effectiveContextWindow(cfg),
        provider: getProvider(cfg),
        summaryModel: subagentModel(cfg),
        maxTokens: cfg.maxTokens,
      })
      const res = await mgr.compact(ctx.session.messages)
      ctx.session.loadMessages(res.messages)
      return {
        message: res.compacted
          ? `已压缩上下文：${res.beforeTokens} → ${res.afterTokens} tok`
          : '消息较少，无需压缩',
      }
    }

    case 'model':
      return handleModel(arg)

    case 'memory': {
      const mem = getProjectMemory(ctx.cwd)
      return { message: mem.trim() ? mem : '暂无项目记忆。用 /init 生成首版。' }
    }

    case 'init':
      return {
        message:
          '请直接对我说："扫描这个项目并把架构、约定、构建方式总结到 .strike/MEMORY.md"。我会用 MemoryWrite/WriteFile 自动生成。',
      }

    case 'cost':
      return { message: '本会话用量：\n' + formatUsage(ctx.usage) }

    case 'pet':
      return handlePet(ctx)

    case 'mode':
      return handleMode(arg)

    case 'think':
    case 'effort': {
      const cur = () => {
        const c = getConfig()
        return c.thinkingMode === 'off' ? 'off' : c.effort
      }
      if (arg === 'high' || arg === 'max') {
        patchRuntimeConfig({ thinkingMode: 'on', effort: arg })
        return { message: `思考模式已切换为 ${arg}` }
      }
      if (arg === 'off') {
        patchRuntimeConfig({ thinkingMode: 'off' })
        return { message: '思考已关闭' }
      }
      return {
        message: `当前思考模式：${cur()}\n切换：/think high（较快）| /think max（最深，默认）| /think off（关闭）`,
      }
    }

    case 'undo': {
      const restored = await undo(ctx.cwd)
      return {
        message: restored.length
          ? `已回滚 ${restored.length} 个文件：\n${restored.join('\n')}`
          : '没有可回滚的文件改动',
      }
    }

    case 'doctor': {
      const results = await runDoctor()
      return {
        message: results
          .map(r => `${r.ok ? '✔' : '✖'} ${r.label}: ${r.detail}`)
          .join('\n'),
      }
    }

    case 'mcp': {
      if (arg === 'connect') {
        const log = await connectConfiguredMcpServers()
        return { message: log.join('\n') || '没有配置 MCP 服务器' }
      }
      const status = mcpStatus()
      return {
        message: status.length
          ? '已连接 MCP：\n' +
            status.map(s => `- ${s.name}（${s.toolCount} 个工具）`).join('\n')
          : '未连接 MCP。在配置 mcpServers 后用 /mcp connect。',
      }
    }

    case 'remote': {
      if (arg === 'on' || arg === 'start') {
        if (remoteRunning()) return { message: '飞书远程已在运行' }
        try {
          await startFeishuRemote(ctx.session, ctx.cwd)
          return { message: '飞书远程已启动，可在飞书中给应用发消息操控' }
        } catch (e) {
          return { message: `飞书启动失败: ${e instanceof Error ? e.message : String(e)}` }
        }
      }
      if (arg === 'off' || arg === 'stop') {
        await stopFeishuRemote()
        return { message: '飞书远程已停止' }
      }
      return { message: `飞书远程状态：${remoteRunning() ? '运行中' : '未启动'}（/remote on 启动）` }
    }

    case 'checkpoints':
      return { message: `当前可回滚的文件快照：${checkpointCount()} 个（/undo 回滚）` }

    case 'skills': {
      const skills = scanSkills(ctx.cwd)
      return {
        message: skills.length
          ? '可用技能（对话中相关时会自动调用 Skill 工具加载）：\n' +
            skills.map(s => `- ${s.name} [${s.source}]: ${s.description}`).join('\n')
          : '没有可用技能。在 .strike/skills/<名字>/SKILL.md 或 ~/.strike/skills/ 下创建技能。',
      }
    }

    case 'agents': {
      const agents = scanAgents(ctx.cwd)
      return {
        message: agents.length
          ? '可用子智能体（用 Task 工具传 subagent_type 调用）：\n' +
            agents
              .map(a => `- ${a.name} [${a.source}] (模型:${a.model}): ${a.description}`)
              .join('\n')
          : '没有可用子智能体。在 .strike/agents/<名字>.md 或 ~/.strike/agents/ 下创建。',
      }
    }

    case 'exit':
    case 'quit':
      ctx.exit()
      return {}

    default:
      return { message: `未知命令 /${cmd}，输入 /help 查看全部命令` }
  }
}

function handleModel(arg: string): SlashResult {
  if (!arg) {
    return {
      message: `当前模型：${activeModel()}\n切换：/model deepseek | /model ollama | /model anthropic | /model <模型名>`,
    }
  }
  const known: ProviderName[] = ['deepseek', 'ollama', 'anthropic']
  if (known.includes(arg as ProviderName)) {
    patchRuntimeConfig({ provider: arg as ProviderName })
    resetProviderCache()
    return { message: `已切换后端为 ${arg}，当前模型 ${activeModel()}` }
  }
  // 视为具体模型名
  const cfg = getConfig()
  if (cfg.provider === 'ollama') patchRuntimeConfig({ ollamaModel: arg })
  else patchRuntimeConfig({ model: arg })
  resetProviderCache()
  return { message: `已设置模型为 ${arg}` }
}

function handleMode(arg: string): SlashResult {
  // 兼容 Claude 风格名：bypassPermissions/acceptEdits → auto
  const alias: Record<string, PermissionMode> = {
    plan: 'plan',
    default: 'default',
    auto: 'auto',
    accept: 'auto',
    acceptedits: 'auto',
    bypass: 'auto',
    bypasspermissions: 'auto',
  }
  const mapped = alias[arg.toLowerCase()]
  if (!mapped) {
    return {
      message: `当前权限模式：${getConfig().permissionMode}\n切换：/mode plan | /mode default | /mode auto | /mode bypassPermissions`,
    }
  }
  patchRuntimeConfig({ permissionMode: mapped })
  if (mapped === 'auto') {
    return {
      message:
        '⚠ 已进入完全放行模式（bypassPermissions）：写文件、执行命令等所有操作将自动执行，不再询问确认。请谨慎使用。',
    }
  }
  if (mapped === 'plan') {
    return { message: '📋 已进入计划模式（plan）：仅只读操作，先规划方案待批准。' }
  }
  return { message: '权限模式已切换为 default（写/执行类操作会弹确认）' }
}

function handlePet(ctx: SlashContext): SlashResult {
  const c = ctx.companion
  const bones = c ?? { ...previewBones(), name: '(未孵化)', personality: '' }
  const stats = Object.entries(bones.stats)
    .map(([k, v]) => `${k} ${v}`)
    .join('  ')
  return {
    message: [
      `🐾 ${bones.name}${bones.shiny ? ' ✨' : ''}`,
      `物种：${bones.species}  稀有度：${RARITY_LABEL[bones.rarity]}`,
      c ? `性格：${c.personality}` : '',
      `属性：${stats}`,
    ]
      .filter(Boolean)
      .join('\n'),
  }
}

const HELP_TEXT = `可用命令：
/help              显示帮助
/clear             清空会话与待办
/compact           手动压缩上下文
/model [后端|模型]  查看/切换模型（deepseek/ollama/anthropic）
/mode [模式]       权限模式（plan/default/auto）
/think [模式]      思考模式（high/max/off，默认 max）
/memory            查看项目记忆
/init              生成项目记忆引导
/cost              查看 token 用量与成本
/pet               查看命令行伙伴属性卡
/undo              回滚最近的文件改动
/checkpoints       查看可回滚快照数
/doctor            环境自检
/mcp [connect]     查看/连接 MCP 服务器
/skills            查看可用技能（Skill）
/agents            查看可用子智能体（Subagent）
/remote [on|off]   启停飞书远程操控
/exit              退出

提示：处理中按 Esc 可中断；危险命令会弹出确认。

${COPYRIGHT}`
