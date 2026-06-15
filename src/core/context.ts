// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
import {
  type ChatMessage,
  estimateMessagesTokens,
  textMessage,
} from './message.js'
import type { LLMProvider } from '../providers/types.js'
import type { ProviderRequest } from '../providers/types.js'

/**
 * 上下文管理器：当历史接近上下文窗口阈值时，对较旧的消息做摘要压缩，
 * 保留任务目标、关键决策与最近若干轮原文。
 */
export interface ContextManagerOptions {
  contextWindow: number
  /** 触发压缩的占用比例（0-1），默认 0.8 */
  compactThreshold?: number
  /** 压缩后保留的最近消息条数 */
  keepRecent?: number
  provider: LLMProvider
  summaryModel: string
  maxTokens: number
}

export interface CompactResult {
  messages: ChatMessage[]
  compacted: boolean
  beforeTokens: number
  afterTokens: number
}

export class ContextManager {
  constructor(private opts: ContextManagerOptions) {}

  budget(): number {
    return this.opts.contextWindow
  }

  usageRatio(messages: ChatMessage[]): number {
    return estimateMessagesTokens(messages) / this.opts.contextWindow
  }

  shouldCompact(messages: ChatMessage[]): boolean {
    const threshold = this.opts.compactThreshold ?? 0.8
    return this.usageRatio(messages) > threshold
  }

  /** 自动或手动压缩历史。 */
  async compact(
    messages: ChatMessage[],
    signal?: AbortSignal,
  ): Promise<CompactResult> {
    const beforeTokens = estimateMessagesTokens(messages)
    const keepRecent = this.opts.keepRecent ?? 6
    if (messages.length <= keepRecent + 2) {
      return { messages, compacted: false, beforeTokens, afterTokens: beforeTokens }
    }

    const toSummarize = messages.slice(0, messages.length - keepRecent)
    const recent = messages.slice(messages.length - keepRecent)

    const transcript = toSummarize
      .map(m => {
        const text = m.content
          .map(b => {
            if (b.type === 'text') return b.text
            if (b.type === 'tool_use') return `[调用工具 ${b.name}]`
            if (b.type === 'tool_result')
              return `[工具结果: ${b.content.slice(0, 200)}]`
            return ''
          })
          .filter(Boolean)
          .join(' ')
        return `${m.role === 'user' ? '用户' : '助手'}: ${text}`
      })
      .join('\n')

    const summaryPrompt = `请把下面的对话历史压缩成一段结构化摘要，必须保留：
1. 用户的总体目标与关键需求
2. 已完成的工作与关键决策/结论
3. 涉及的重要文件、函数、命令
4. 尚未完成的事项（TODO）
5. 重要的踩坑或约束

对话历史：
${transcript}

只输出摘要，不要寒暄。`

    try {
      const req: ProviderRequest = {
        system: '你是一个对话摘要器，输出精炼、信息密度高的中文摘要。',
        messages: [textMessage('user', summaryPrompt)],
        tools: [],
        model: this.opts.summaryModel,
        maxTokens: 2000,
        signal,
        thinking: { enabled: false },
      }
      let summary = ''
      for await (const ev of this.opts.provider.stream(req)) {
        if (ev.type === 'text') summary += ev.delta
      }
      const summaryMsg = textMessage(
        'user',
        `[历史摘要 — 之前对话的压缩]\n${summary.trim()}`,
      )
      const newMessages = [summaryMsg, ...recent]
      return {
        messages: newMessages,
        compacted: true,
        beforeTokens,
        afterTokens: estimateMessagesTokens(newMessages),
      }
    } catch {
      // 摘要失败：退化为直接丢弃最旧消息以释放空间
      return {
        messages: recent,
        compacted: true,
        beforeTokens,
        afterTokens: estimateMessagesTokens(recent),
      }
    }
  }
}
