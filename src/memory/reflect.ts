import { type ChatMessage, textMessage } from '../core/message.js'
import { bus } from '../core/events.js'
import { getProvider, subagentModel } from '../providers/registry.js'
import { getConfig } from '../config/index.js'
import { appendExperience, type Experience } from './store.js'
import { appendProjectMemory } from './projectMemory.js'
import { embedOne } from './embed.js'

let inProgress = false
let lastReflectedCount = 0
let pending: Promise<void> | null = null

/**
 * 任务结束后的自反思：用快速模型从最近对话中提炼可复用经验，
 * 写入经验库（带向量）与项目 MEMORY.md。fire-and-forget。
 */
export function reflectAfterTask(
  messages: ChatMessage[],
  cwd: string = process.cwd(),
): void {
  const cfg = getConfig()
  if (!cfg.autoMemory) return
  if (inProgress) return
  // 节流：自上次反思后新增消息不足 2 条则跳过
  if (messages.length - lastReflectedCount < 2) return

  inProgress = true
  pending = doReflect(messages, cwd)
    .catch(() => {})
    .finally(() => {
      inProgress = false
      lastReflectedCount = messages.length
    })
}

/** 退出前等待反思完成（带超时）。 */
export async function drainReflection(timeoutMs = 30_000): Promise<void> {
  if (!pending) return
  await Promise.race([
    pending,
    new Promise<void>(r => setTimeout(r, timeoutMs).unref?.()),
  ])
}

async function doReflect(messages: ChatMessage[], cwd: string): Promise<void> {
  const cfg = getConfig()
  const provider = getProvider(cfg)

  // 取最近的对话片段（避免过长）
  const recent = messages.slice(-20)
  const transcript = recent
    .map(m => {
      const text = m.content
        .map(b => {
          if (b.type === 'text') return b.text
          if (b.type === 'tool_use') return `[工具 ${b.name}: ${JSON.stringify(b.input).slice(0, 200)}]`
          if (b.type === 'tool_result')
            return `[结果: ${(b.is_error ? '❌ ' : '') + b.content.slice(0, 200)}]`
          return ''
        })
        .filter(Boolean)
        .join(' ')
      return `${m.role === 'user' ? '用户' : '助手'}: ${text}`
    })
    .join('\n')

  const prompt = `分析下面这次编程助手与用户的交互，提炼出**可复用的经验**用于以后类似任务。
只提炼真正有价值、可复用的内容：项目约定、有效的命令/解法、踩过的坑与规避方法、用户偏好、关键的代码结构发现。
如果这次交互没有值得长期记住的内容，返回空数组 []。

严格输出 JSON 数组，每个元素格式：
{"summary": "一句话摘要", "tags": ["标签1","标签2"], "content": "详细经验，包括场景/做法/结论"}

对话：
${transcript}

只输出 JSON，不要任何解释。`

  let raw = ''
  for await (const ev of provider.stream({
    system: '你是一个善于总结可复用工程经验的助手，只输出严格的 JSON。',
    messages: [textMessage('user', prompt)],
    tools: [],
    model: subagentModel(cfg),
    maxTokens: 2000,
    thinking: { enabled: false },
  })) {
    if (ev.type === 'text') raw += ev.delta
  }

  const experiences = parseExperiences(raw)
  if (!experiences.length) return

  const savedSummaries: string[] = []
  for (const exp of experiences) {
    const full: Experience = {
      ts: Date.now(),
      summary: exp.summary,
      tags: exp.tags ?? [],
      content: exp.content,
    }
    full.embedding = await embedOne(`${exp.summary} ${exp.content}`)
    await appendExperience(full, cwd)
    savedSummaries.push(exp.summary)
  }

  // 同步精炼摘要到项目 MEMORY.md
  if (savedSummaries.length) {
    const date = new Date().toISOString().slice(0, 10)
    await appendProjectMemory(
      `## 经验更新 ${date}\n${savedSummaries.map(s => `- ${s}`).join('\n')}`,
      cwd,
    )
    bus.emit('memory:saved', { paths: savedSummaries })
  }
}

function parseExperiences(
  raw: string,
): { summary: string; tags?: string[]; content: string }[] {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try {
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    return arr.filter(
      e => e && typeof e.summary === 'string' && typeof e.content === 'string',
    )
  } catch {
    return []
  }
}

/** 测试/重置用。 */
export function resetReflectState(): void {
  inProgress = false
  lastReflectedCount = 0
  pending = null
}
