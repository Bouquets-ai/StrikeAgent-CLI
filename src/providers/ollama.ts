import OpenAI from 'openai'
import type {
  LLMProvider,
  ProviderRequest,
  StreamEvent,
} from './types.js'
import type { ChatMessage } from '../core/message.js'

type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam

/**
 * Ollama provider：走 OpenAI 兼容端点（http://localhost:11434/v1）。
 * 内部做 Anthropic 内容块 ↔ OpenAI function-calling 的双向转换。
 */
export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama'
  private client: OpenAI
  private embedModel: string

  constructor(opts: { baseUrl: string; embedModel?: string }) {
    this.client = new OpenAI({
      baseURL: opts.baseUrl,
      apiKey: 'ollama', // 占位，Ollama 不校验
      dangerouslyAllowBrowser: true,
    })
    this.embedModel = opts.embedModel ?? 'nomic-embed-text'
  }

  private toOpenAIMessages(
    system: string,
    messages: ChatMessage[],
  ): OAIMessage[] {
    const out: OAIMessage[] = []
    if (system) out.push({ role: 'system', content: system })

    for (const msg of messages) {
      if (msg.role === 'user') {
        // tool_result 块需要拆成 role:'tool' 消息；文本块合并为一条 user 消息
        const texts: string[] = []
        for (const block of msg.content) {
          if (block.type === 'tool_result') {
            out.push({
              role: 'tool',
              tool_call_id: block.tool_use_id,
              content: block.content,
            })
          } else if (block.type === 'text') {
            texts.push(block.text)
          }
        }
        if (texts.length) out.push({ role: 'user', content: texts.join('\n') })
      } else {
        // assistant：文本 + tool_use(转 tool_calls)
        const texts: string[] = []
        const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] =
          []
        for (const block of msg.content) {
          if (block.type === 'text') texts.push(block.text)
          else if (block.type === 'thinking') {
            /* 思考块不回传给 OpenAI 协议 */
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: {
                name: block.name,
                arguments: JSON.stringify(block.input ?? {}),
              },
            })
          }
        }
        const m: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
          role: 'assistant',
          content: texts.join('\n') || null,
        }
        if (toolCalls.length) m.tool_calls = toolCalls
        out.push(m)
      }
    }
    return out
  }

  async *stream(req: ProviderRequest): AsyncGenerator<StreamEvent> {
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = req.tools.map(
      t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as Record<string, unknown>,
        },
      }),
    )

    const stream = await this.client.chat.completions.create(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        messages: this.toOpenAIMessages(req.system, req.messages),
        tools: tools.length ? tools : undefined,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: req.signal },
    )

    // 累积工具调用（按 index）
    const toolAcc = new Map<
      number,
      { id: string; name: string; args: string }
    >()
    let stopReason = 'end_turn'

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0]
      if (choice) {
        const delta = choice.delta
        if (delta?.content) {
          yield { type: 'text', delta: delta.content }
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0
            const cur = toolAcc.get(idx) ?? { id: '', name: '', args: '' }
            if (tc.id) cur.id = tc.id
            if (tc.function?.name) cur.name = tc.function.name
            if (tc.function?.arguments) cur.args += tc.function.arguments
            toolAcc.set(idx, cur)
          }
        }
        if (choice.finish_reason) {
          stopReason =
            choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn'
        }
      }
      if (chunk.usage) {
        yield {
          type: 'usage',
          usage: {
            input_tokens: chunk.usage.prompt_tokens ?? 0,
            output_tokens: chunk.usage.completion_tokens ?? 0,
          },
        }
      }
    }

    // 流结束后吐出累积的工具调用
    for (const [, t] of toolAcc) {
      let input: Record<string, unknown> = {}
      try {
        input = t.args ? JSON.parse(t.args) : {}
      } catch {
        input = {}
      }
      yield {
        type: 'tool_use',
        block: {
          type: 'tool_use',
          id: t.id || `call_${Math.random().toString(36).slice(2)}`,
          name: t.name,
          input,
        },
      }
    }

    yield { type: 'done', stopReason }
  }

  async embed(texts: string[]): Promise<number[][]> {
    try {
      const res = await this.client.embeddings.create({
        model: this.embedModel,
        input: texts,
      })
      return res.data.map(d => d.embedding as number[])
    } catch {
      return []
    }
  }

  async ping(): Promise<{ ok: boolean; message: string }> {
    try {
      await this.client.models.list()
      return { ok: true, message: 'ollama 连通正常' }
    } catch (e) {
      return {
        ok: false,
        message: `ollama 连接失败: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
  }
}
