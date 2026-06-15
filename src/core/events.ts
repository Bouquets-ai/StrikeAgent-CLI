import { EventEmitter } from 'node:events'

/**
 * 全局 agent 生命周期事件总线。
 * 宠物、记忆反思、UI、成本统计都订阅这些事件，实现"越用越聪明"与"宠物有反应"。
 */
export type AgentEventMap = {
  'query:start': { prompt: string }
  'query:end': { ok: boolean }
  'assistant:text': { delta: string }
  'assistant:thinking': { delta: string }
  'tool:start': { name: string; input: Record<string, unknown> }
  'tool:end': { name: string; ok: boolean; durationMs: number }
  'tool:permission': { name: string }
  thinking: { active: boolean }
  error: { message: string }
  'memory:saved': { paths: string[] }
  'usage': {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
  'subagent:start': { id: string; description: string }
  'subagent:progress': { id: string; tokens: number; activity: string }
  'subagent:end': { id: string; ok: boolean; durationMs: number; tokens: number }
}

type Handler<K extends keyof AgentEventMap> = (payload: AgentEventMap[K]) => void

class AgentBus {
  private emitter = new EventEmitter()

  constructor() {
    // agent 循环可能有很多并发订阅者（UI/宠物/记忆/成本）
    this.emitter.setMaxListeners(100)
  }

  on<K extends keyof AgentEventMap>(event: K, handler: Handler<K>): () => void {
    this.emitter.on(event, handler as (p: unknown) => void)
    return () => this.emitter.off(event, handler as (p: unknown) => void)
  }

  emit<K extends keyof AgentEventMap>(event: K, payload: AgentEventMap[K]): void {
    this.emitter.emit(event, payload)
  }
}

export const bus = new AgentBus()
