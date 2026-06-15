import type { ChatMessage, ToolUseBlock, Usage } from '../core/message.js'

export interface ToolSchema {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface ThinkingOptions {
  enabled: boolean
  /** 思考预算 token（effort 等级映射），仅 enabled 时有效。 */
  budgetTokens?: number
}

export interface ProviderRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolSchema[]
  model: string
  maxTokens: number
  signal?: AbortSignal
  /** 思考模式控制（DeepSeek/Anthropic 思考）。 */
  thinking?: ThinkingOptions
}

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'thinking_signature'; signature: string }
  | { type: 'tool_use'; block: ToolUseBlock }
  | { type: 'usage'; usage: Partial<Usage> }
  | { type: 'done'; stopReason: string }

export interface LLMProvider {
  readonly name: string
  /** 流式生成。逐步 yield 文本/思考/工具调用/用量事件。 */
  stream(req: ProviderRequest): AsyncGenerator<StreamEvent, void, unknown>
  /** 可选：文本嵌入（用于记忆向量召回）。返回每条文本的向量。 */
  embed?(texts: string[]): Promise<number[][]>
  /** 轻量连通性检测。 */
  ping(): Promise<{ ok: boolean; message: string }>
}
