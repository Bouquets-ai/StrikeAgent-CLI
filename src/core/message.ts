// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
/**
 * 统一消息模型。
 * 采用 Anthropic 内容块风格（DeepSeek 兼容该协议），Ollama provider 内部做双向转换。
 */

export type TextBlock = { type: 'text'; text: string }
export type ThinkingBlock = {
  type: 'thinking'
  thinking: string
  /** Anthropic/DeepSeek 思考块签名，多轮带工具回传时必须保留，否则 400。 */
  signature?: string
}
export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
export type ToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock

export type Role = 'user' | 'assistant'

export interface ChatMessage {
  role: Role
  content: ContentBlock[]
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function emptyUsage(): Usage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }
}

export function addUsage(a: Usage, b: Partial<Usage>): Usage {
  return {
    input_tokens: a.input_tokens + (b.input_tokens ?? 0),
    output_tokens: a.output_tokens + (b.output_tokens ?? 0),
    cache_read_input_tokens:
      a.cache_read_input_tokens + (b.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens:
      a.cache_creation_input_tokens + (b.cache_creation_input_tokens ?? 0),
  }
}

export function textMessage(role: Role, text: string): ChatMessage {
  return { role, content: [{ type: 'text', text }] }
}

/** 提取一条消息中所有文本块拼接结果 */
export function messageText(msg: ChatMessage): string {
  return msg.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')
}

/** 粗略估算文本 token 数（中文按字符、英文按 ~4 字符/token 的折中估计）。 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let tokens = 0
  for (const ch of text) {
    // CJK 字符大致 1 token/字；其余按 0.3 token/字符累加
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) tokens += 1
    else tokens += 0.3
  }
  return Math.ceil(tokens)
}

export function estimateMessageTokens(msg: ChatMessage): number {
  let total = 0
  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        total += estimateTokens(block.text)
        break
      case 'thinking':
        total += estimateTokens(block.thinking)
        break
      case 'tool_use':
        total += estimateTokens(JSON.stringify(block.input)) + 10
        break
      case 'tool_result':
        total += estimateTokens(block.content) + 5
        break
    }
  }
  return total
}

export function estimateMessagesTokens(msgs: ChatMessage[]): number {
  return msgs.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
}
