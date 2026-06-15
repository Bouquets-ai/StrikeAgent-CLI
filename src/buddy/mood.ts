import { bus } from '../core/events.js'
import type { Mood } from './sprites.js'

type MoodListener = (mood: Mood, bubble: string | null) => void

/**
 * 宠物情绪状态机：订阅 agent 事件，切换情绪与气泡台词。
 */
export class BuddyMood {
  private mood: Mood = 'idle'
  private bubble: string | null = null
  private listeners = new Set<MoodListener>()
  private disposers: (() => void)[] = []
  private bubbleTimer: NodeJS.Timeout | null = null

  start(): void {
    this.disposers.push(
      bus.on('query:start', () => this.set('thinking', '收到，开干！')),
      bus.on('tool:start', ({ name }) => this.set('working', toolBubble(name))),
      bus.on('tool:end', ({ ok }) =>
        ok ? this.set('working', null) : this.set('error', '哎呀，工具报错了'),
      ),
      bus.on('error', () => this.set('error', '出错了，我帮你盯着')),
      bus.on('memory:saved', () => this.flash('celebrate', '又学到新东西啦！')),
      bus.on('query:end', ({ ok }) =>
        this.set('idle', ok ? '搞定~' : '这次没成，再来'),
      ),
    )
  }

  stop(): void {
    for (const d of this.disposers) d()
    this.disposers = []
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer)
  }

  onChange(fn: MoodListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  current(): { mood: Mood; bubble: string | null } {
    return { mood: this.mood, bubble: this.bubble }
  }

  /** 被直呼其名时的单行回应。 */
  greet(name: string): void {
    this.flash('talking', `我在！(${name})`)
  }

  private set(mood: Mood, bubble: string | null): void {
    this.mood = mood
    this.setBubble(bubble)
    this.emit()
  }

  private flash(mood: Mood, bubble: string): void {
    this.mood = mood
    this.setBubble(bubble)
    this.emit()
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer)
    this.bubbleTimer = setTimeout(() => {
      this.mood = 'idle'
      this.bubble = null
      this.emit()
    }, 3000)
  }

  private setBubble(bubble: string | null): void {
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer)
    this.bubble = bubble
    if (bubble) {
      this.bubbleTimer = setTimeout(() => {
        this.bubble = null
        this.emit()
      }, 4000)
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.mood, this.bubble)
  }
}

function toolBubble(name: string): string {
  const map: Record<string, string> = {
    ReadFile: '翻翻代码…',
    WriteFile: '动手写文件',
    EditFile: '改两笔',
    Shell: '敲命令中',
    Grep: '搜搜看',
    Glob: '找文件',
    WebFetch: '上网瞅瞅',
    WebSearch: '搜一下',
    Task: '叫帮手来',
    MemoryWrite: '记小本本',
  }
  return map[name] ?? `用 ${name}`
}
