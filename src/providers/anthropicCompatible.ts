import Anthropic from '@anthropic-ai/sdk'
import type {
  LLMProvider,
  ProviderRequest,
  StreamEvent,
  ToolSchema,
} from './types.js'
import type { ChatMessage, ContentBlock } from '../core/message.js'

/**
 * Anthropic 兼容 provider，同时服务 DeepSeek（https://api.deepseek.com/anthropic）
 * 与官方 Anthropic。仅通过 baseURL + authToken 区分。
 */
export class AnthropicCompatibleProvider implements LLMProvider {
  readonly name: string
  private client: Anthropic
  private pingModel: string

  constructor(opts: {
    name: string
    baseUrl: string
    authToken: string
    model: string
  }) {
    this.name = opts.name
    this.pingModel = opts.model
    this.client = new Anthropic({
      baseURL: opts.baseUrl,
      // DeepSeek 接受 Authorization: Bearer（authToken）也接受 x-api-key。
      authToken: opts.authToken,
      apiKey: opts.authToken,
      dangerouslyAllowBrowser: true,
    })
  }

  private toApiMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
    return messages.map(m => ({
      role: m.role,
      content: m.content
        .map(toApiBlock)
        .filter((b): b is ApiContentBlock => b !== null),
    }))
  }

  async *stream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const tools: Anthropic.Tool[] = req.tools.map((t: ToolSchema) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
    }))

    // 思考模式：DeepSeek/Anthropic 通过 thinking 参数控制。
    // 注意只发 thinking、绝不同时发 reasoning_effort，规避 DeepSeek 的 400 互斥校验。
    // 当前 SDK 版本未内置 thinking 类型，DeepSeek 端点接受该字段，故以透传方式发送。
    type ThinkingParam =
      | { type: 'enabled'; budget_tokens: number }
      | { type: 'disabled' }
    let thinkingParam: ThinkingParam | undefined
    let requestMaxTokens = req.maxTokens
    if (req.thinking?.enabled) {
      const budget = Math.max(1024, req.thinking.budgetTokens ?? 8192)
      thinkingParam = { type: 'enabled', budget_tokens: budget }
      // Anthropic 要求 max_tokens > budget_tokens（max_tokens 含思考+输出）
      requestMaxTokens = budget + req.maxTokens
    } else if (req.thinking && req.thinking.enabled === false) {
      thinkingParam = { type: 'disabled' }
    }

    const params: Record<string, unknown> = {
      model: req.model,
      max_tokens: requestMaxTokens,
      system: req.system,
      messages: this.toApiMessages(req.messages),
      tools: tools.length ? tools : undefined,
      stream: true,
    }
    if (thinkingParam) params.thinking = thinkingParam

    const stream = (await this.client.messages.create(
      params as unknown as Anthropic.MessageCreateParamsStreaming,
      { signal: req.signal },
    )) as AsyncIterable<Anthropic.RawMessageStreamEvent>

    // 累积进行中的 tool_use 块
    let curTool: { id: string; name: string; json: string } | null = null

    for await (const event of stream) {
      switch (event.type) {
        case 'message_start': {
          const u = event.message.usage
          yield {
            type: 'usage',
            usage: {
              input_tokens: u?.input_tokens ?? 0,
              cache_read_input_tokens:
                (u as { cache_read_input_tokens?: number })
                  ?.cache_read_input_tokens ?? 0,
              cache_creation_input_tokens:
                (u as { cache_creation_input_tokens?: number })
                  ?.cache_creation_input_tokens ?? 0,
            },
          }
          break
        }
        case 'content_block_start': {
          const block = event.content_block
          if (block.type === 'tool_use') {
            curTool = { id: block.id, name: block.name, json: '' }
          }
          break
        }
        case 'content_block_delta': {
          const delta = event.delta as {
            type: string
            text?: string
            thinking?: string
            signature?: string
            partial_json?: string
          }
          if (delta.type === 'text_delta') {
            yield { type: 'text', delta: delta.text ?? '' }
          } else if (delta.type === 'thinking_delta') {
            yield { type: 'thinking', delta: delta.thinking ?? '' }
          } else if (delta.type === 'signature_delta') {
            yield { type: 'thinking_signature', signature: delta.signature ?? '' }
          } else if (delta.type === 'input_json_delta' && curTool) {
            curTool.json += delta.partial_json ?? ''
          }
          break
        }
        case 'content_block_stop': {
          if (curTool) {
            let input: Record<string, unknown> = {}
            try {
              input = curTool.json ? JSON.parse(curTool.json) : {}
            } catch {
              input = {}
            }
            yield {
              type: 'tool_use',
              block: {
                type: 'tool_use',
                id: curTool.id,
                name: curTool.name,
                input,
              },
            }
            curTool = null
          }
          break
        }
        case 'message_delta': {
          if (event.usage) {
            yield {
              type: 'usage',
              usage: { output_tokens: event.usage.output_tokens ?? 0 },
            }
          }
          if (event.delta?.stop_reason) {
            yield { type: 'done', stopReason: event.delta.stop_reason }
          }
          break
        }
        default:
          break
      }
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Anthropic/DeepSeek 兼容端点暂不暴露 embeddings，返回空让上层回退到关键词召回。
    void texts
    return []
  }

  async ping(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.client.messages.create({
        model: this.pingModel,
        max_tokens: 4,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return { ok: true, message: `${this.name} 连通正常` }
    } catch (e) {
      return { ok: false, message: `${this.name} 连接失败: ${errMsg(e)}` }
    }
  }
}

type ApiContentBlock = Extract<Anthropic.MessageParam['content'], unknown[]>[number]

function toApiBlock(block: ContentBlock): ApiContentBlock | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'thinking':
      // 带签名的思考块原样回传（DeepSeek 多轮+工具时必须保留 reasoning_content）；
      // 无签名则丢弃，避免发出非法思考块导致 400。
      if (block.signature) {
        return {
          type: 'thinking',
          thinking: block.thinking,
          signature: block.signature,
        } as unknown as ApiContentBlock
      }
      return null
    case 'tool_use':
      return {
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error,
      }
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}
