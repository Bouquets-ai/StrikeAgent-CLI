// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
import {
  type ChatMessage,
  type ContentBlock,
  type ToolResultBlock,
  type ToolUseBlock,
  type Usage,
  addUsage,
  emptyUsage,
  messageText,
  textMessage,
} from './message.js'
import { bus } from './events.js'
import { ContextManager } from './context.js'
import { buildSystemPrompt } from './systemPrompt.js'
import { getProvider, activeModel, subagentModel } from '../providers/registry.js'
import {
  getConfig,
  effectiveContextWindow,
  effortBudget,
  type StrikeConfig,
} from '../config/index.js'
import type { ThinkingOptions } from '../providers/types.js'
import { getTools, findTool } from '../tools/registry.js'
import { toToolSchema, safeParseInput, type Tool, type ToolContext, type PermissionRequest, type SubagentOptions } from '../tools/tool.js'
import { decidePermission, PLAN_MODE_DENY_MESSAGE } from '../tools/permission.js'
import { recordToolUse } from '../memory/store.js'

export type PermissionAsker = (req: PermissionRequest) => Promise<boolean>

export interface RunOptions {
  signal: AbortSignal
  requestPermission: PermissionAsker
}

/** 子智能体角色：来自 agents/ 定义的指令与模型档位。 */
interface SubagentRole {
  instructions?: string
  model?: 'main' | 'fast'
}

const MAX_TURNS = 50

export class AgentSession {
  messages: ChatMessage[] = []
  totalUsage: Usage = emptyUsage()
  private cwd: string

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd
  }

  reset(): void {
    this.messages = []
  }

  loadMessages(msgs: ChatMessage[]): void {
    this.messages = msgs
  }

  /** 运行一轮完整查询循环，直到模型给出无工具调用的最终回复。 */
  async run(
    userInput: string,
    opts: RunOptions,
  ): Promise<{ ok: boolean; finalText: string }> {
    this.messages.push(textMessage('user', userInput))
    bus.emit('query:start', { prompt: userInput })

    try {
      const finalText = await this.loop(userInput, opts, false)
      bus.emit('query:end', { ok: true })
      return { ok: true, finalText }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (opts.signal.aborted) {
        bus.emit('query:end', { ok: false })
        return { ok: false, finalText: '[已中断]' }
      }
      bus.emit('error', { message })
      bus.emit('query:end', { ok: false })
      this.messages.push(textMessage('assistant', `出错了: ${message}`))
      return { ok: false, finalText: `出错了: ${message}` }
    }
  }

  private async loop(
    query: string,
    opts: RunOptions,
    isSubagent: boolean,
    agentId?: string,
    subagent?: SubagentRole,
  ): Promise<string> {
    const cfg = getConfig()
    const provider = getProvider(cfg)
    // 子代理默认用快速模型；若子智能体定义要求 main 则用主模型。
    const useMainModel = !isSubagent || subagent?.model === 'main'
    const model = useMainModel ? activeModel(cfg) : subagentModel(cfg)
    const tools = getTools({ isSubagent })
    const toolSchemas = tools.map(toToolSchema)

    const ctxMgr = new ContextManager({
      contextWindow: effectiveContextWindow(cfg),
      provider,
      summaryModel: subagentModel(cfg),
      maxTokens: cfg.maxTokens,
    })

    // 思考模式：按配置 + 任务复杂度自动决定本轮查询是否开启思考（整轮保持一致）
    const thinking = decideThinking(cfg, isSubagent, query)

    let finalText = ''

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (opts.signal.aborted) throw new Error('aborted')

      // 自动压缩
      if (ctxMgr.shouldCompact(this.messages)) {
        const result = await ctxMgr.compact(this.messages, opts.signal)
        if (result.compacted) {
          this.messages = result.messages
        }
      }

      const system = await buildSystemPrompt({
        cwd: this.cwd,
        permissionMode: cfg.permissionMode,
        model,
        query,
        isSubagent,
        agentInstructions: subagent?.instructions,
      })

      bus.emit('thinking', { active: true })

      // 流式调用 provider，累积内容块
      const blocks: ContentBlock[] = []
      let curText = ''
      let curThinking = ''
      let curThinkingSig = ''
      const toolUses: ToolUseBlock[] = []

      for await (const ev of provider.stream({
        system,
        messages: this.messages,
        tools: toolSchemas,
        model,
        maxTokens: cfg.maxTokens,
        signal: opts.signal,
        thinking,
      })) {
        switch (ev.type) {
          case 'text':
            curText += ev.delta
            if (!isSubagent) bus.emit('assistant:text', { delta: ev.delta })
            break
          case 'thinking':
            curThinking += ev.delta
            if (!isSubagent) bus.emit('assistant:thinking', { delta: ev.delta })
            break
          case 'thinking_signature':
            curThinkingSig += ev.signature
            break
          case 'tool_use':
            toolUses.push(ev.block)
            break
          case 'usage':
            this.totalUsage = addUsage(this.totalUsage, ev.usage)
            // 子代理的用量单独上报，避免覆盖主会话的累计用量显示
            if (isSubagent && agentId) {
              bus.emit('subagent:progress', {
                id: agentId,
                tokens:
                  this.totalUsage.input_tokens + this.totalUsage.output_tokens,
                activity: 'running',
              })
            } else {
              bus.emit('usage', this.totalUsage)
            }
            break
          case 'done':
            break
        }
      }

      bus.emit('thinking', { active: false })

      if (curThinking.trim()) {
        blocks.push({
          type: 'thinking',
          thinking: curThinking,
          signature: curThinkingSig || undefined,
        })
      }
      if (curText.trim()) blocks.push({ type: 'text', text: curText })
      for (const tu of toolUses) blocks.push(tu)

      if (!blocks.length) {
        blocks.push({ type: 'text', text: '(无输出)' })
      }
      this.messages.push({ role: 'assistant', content: blocks })
      finalText = curText

      // 没有工具调用 → 本轮查询结束
      if (toolUses.length === 0) {
        return finalText
      }

      // 执行工具，收集结果
      const results = await this.executeTools(toolUses, opts, isSubagent)
      this.messages.push({ role: 'user', content: results })
    }

    return finalText || '(达到最大轮数)'
  }

  private async executeTools(
    toolUses: ToolUseBlock[],
    opts: RunOptions,
    isSubagent: boolean,
  ): Promise<ToolResultBlock[]> {
    const cfg = getConfig()
    const tools = getTools({ isSubagent })
    // 预分配，保证结果顺序与 toolUses 一致（并发执行后按下标写回）。
    const results: ToolResultBlock[] = new Array(toolUses.length)

    const errBlock = (tu: ToolUseBlock, content: string): ToolResultBlock => ({
      type: 'tool_result',
      tool_use_id: tu.id,
      content,
      is_error: true,
    })

    interface ReadyCall {
      index: number
      tool: Tool
      data: unknown
      tu: ToolUseBlock
    }
    const ready: ReadyCall[] = []

    // 阶段一：校验 + 权限确认（串行，确保确认弹框按顺序、不重叠）
    for (let i = 0; i < toolUses.length; i++) {
      const tu = toolUses[i]
      if (opts.signal.aborted) {
        results[i] = errBlock(tu, '[已中断]')
        continue
      }

      const tool = findTool(tu.name, tools)
      if (!tool) {
        results[i] = errBlock(tu, `未知工具: ${tu.name}`)
        continue
      }

      const parsed = safeParseInput(tool, tu.input)
      if (!parsed.ok) {
        results[i] = errBlock(tu, `参数错误: ${parsed.error}`)
        continue
      }

      const decision = decidePermission(tool, parsed.data, cfg.permissionMode)
      if (decision === 'deny') {
        results[i] = errBlock(tu, PLAN_MODE_DENY_MESSAGE)
        continue
      }
      if (decision === 'confirm') {
        bus.emit('tool:permission', { name: tool.name })
        const allowed = await opts.requestPermission({
          toolName: tool.name,
          description: tool.renderInput?.(parsed.data) ?? tool.name,
          danger: tool.isReadOnly(parsed.data) ? 'low' : 'medium',
        })
        if (!allowed) {
          results[i] = errBlock(tu, '用户拒绝了该工具调用')
          continue
        }
      }

      ready.push({ index: i, tool, data: parsed.data, tu })
    }

    const toolCtx: ToolContext = {
      cwd: this.cwd,
      signal: opts.signal,
      isSubagent,
      requestPermission: opts.requestPermission,
      runSubagent: isSubagent
        ? undefined
        : (prompt, signal, label, options) =>
            this.runSubagent(prompt, signal, opts.requestPermission, label, options),
    }

    // 阶段二：并发执行已批准的工具——多个子智能体（Task）可同时运行。
    await Promise.all(
      ready.map(async ({ index, tool, data, tu }) => {
        const start = Date.now()
        bus.emit('tool:start', { name: tool.name, input: tu.input })
        try {
          const res = await tool.execute(data, toolCtx)
          recordToolUse(tool.name, !res.isError, this.cwd)
          bus.emit('tool:end', {
            name: tool.name,
            ok: !res.isError,
            durationMs: Date.now() - start,
          })
          results[index] = {
            type: 'tool_result',
            tool_use_id: tu.id,
            content: res.content,
            is_error: res.isError,
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          recordToolUse(tool.name, false, this.cwd)
          bus.emit('tool:end', {
            name: tool.name,
            ok: false,
            durationMs: Date.now() - start,
          })
          results[index] = errBlock(tu, `工具执行异常: ${msg}`)
        }
      }),
    )

    return results
  }

  /** 派生子代理：独立消息历史 + 快速模型（可选角色指令/模型），返回最终文本。 */
  private async runSubagent(
    prompt: string,
    signal: AbortSignal,
    requestPermission: PermissionAsker,
    label?: string,
    options?: SubagentOptions,
  ): Promise<string> {
    const id = `sub_${Math.random().toString(36).slice(2, 8)}`
    const description = label || prompt.slice(0, 20)
    const start = Date.now()
    bus.emit('subagent:start', { id, description })
    const sub = new AgentSession(this.cwd)
    sub.messages.push(textMessage('user', prompt))
    let ok = true
    let text = ''
    try {
      text = await sub.loop(prompt, { signal, requestPermission }, true, id, {
        instructions: options?.instructions,
        model: options?.model,
      })
    } catch (e) {
      ok = false
      text = `子代理失败: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      this.totalUsage = addUsage(this.totalUsage, sub.totalUsage)
      bus.emit('subagent:end', {
        id,
        ok,
        durationMs: Date.now() - start,
        tokens: sub.totalUsage.input_tokens + sub.totalUsage.output_tokens,
      })
    }
    return text || '(子代理无输出)'
  }
}

/**
 * 决定本轮查询的思考模式。
 * - 对 DeepSeek/Anthropic：思考默认始终开启，强度只分 high/max（由 effort 决定预算）。
 * - off：显式关闭思考。
 * - 子代理一律不思考（求快省钱）。
 * - Ollama 不支持思考，直接关闭。
 * 说明：旧配置里的 'auto' 现等同于 'on'（始终思考）。
 */
function decideThinking(
  cfg: StrikeConfig,
  isSubagent: boolean,
  _query: string,
): ThinkingOptions {
  void _query
  if (cfg.provider === 'ollama') return { enabled: false }
  if (cfg.thinkingMode === 'off') return { enabled: false }
  if (isSubagent) return { enabled: false }
  return { enabled: true, budgetTokens: effortBudget(cfg.effort) }
}

/** 一次性（非交互）运行：返回最终文本，自动放行只读、确认走回调。 */
export async function runOnce(
  userInput: string,
  cwd: string,
  requestPermission: PermissionAsker,
  signal: AbortSignal,
): Promise<string> {
  const session = new AgentSession(cwd)
  const { finalText } = await session.run(userInput, { signal, requestPermission })
  void messageText
  return finalText
}
