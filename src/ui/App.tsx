import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Box, Text, Static, useApp, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { AgentSession } from '../core/agent.js'
import { bus } from '../core/events.js'
import { emptyUsage, type Usage } from '../core/message.js'
import { getConfig } from '../config/index.js'
import { activeModel } from '../providers/registry.js'
import { reflectAfterTask } from '../memory/reflect.js'
import { BuddyMood } from '../buddy/mood.js'
import { getCompanion, hatchCompanion } from '../buddy/soul.js'
import type { Companion } from '../buddy/types.js'
import { BuddySprite } from './BuddySprite.js'
import { formatUsage } from '../core/cost.js'
import { handleSlashCommand, SLASH_COMMANDS, type SlashResult } from './slashCommands.js'
import {
  saveSession,
  newSessionId,
  titleFrom,
  loadSession,
  type SessionData,
} from '../session/session.js'
import type { PermissionRequest } from '../tools/tool.js'
import { ShellTool } from '../tools/shellTool.js'
import { appendProjectMemory } from '../memory/projectMemory.js'
import {
  beginTurn,
  getTurnMarks,
  rewindToTurn,
  type TurnMark,
} from '../checkpoint/checkpoint.js'
import type { ChatMessage } from '../core/message.js'
import { WATERMARK, COPYRIGHT } from '../core/watermark.js'

interface LogItem {
  id: number
  kind: 'banner' | 'user' | 'assistant' | 'system' | 'tool' | 'error'
  text: string
  toolName?: string
  ok?: boolean
}

interface SubagentInfo {
  id: string
  description: string
  startedAt: number
  tokens: number
  durationMs?: number
  status: 'running' | 'done' | 'failed'
}

let itemSeq = 0
function nextId(): number {
  return ++itemSeq
}

function bannerItem(): LogItem {
  return { id: nextId(), kind: 'banner', text: '' }
}

function logFromMessages(messages: ChatMessage[]): LogItem[] {
  const out: LogItem[] = []
  for (const m of messages) {
    const text = m.content
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim()
    if (text) {
      out.push({
        id: nextId(),
        kind: m.role === 'user' ? 'user' : 'assistant',
        text,
      })
    }
  }
  return out
}

function restoredLog(session?: SessionData): LogItem[] {
  return [bannerItem(), ...(session ? logFromMessages(session.messages) : [])]
}

export function App({
  cwd,
  initialSession,
  resumeSessions,
}: {
  cwd: string
  initialSession?: SessionData
  resumeSessions?: SessionData[]
}) {
  const { exit } = useApp()
  const sessionRef = useRef<AgentSession>(new AgentSession(cwd))
  const moodRef = useRef<BuddyMood>(new BuddyMood())
  const sessionIdRef = useRef<string>(initialSession?.id ?? newSessionId())
  const createdAtRef = useRef<number>(initialSession?.createdAt ?? Date.now())
  const abortRef = useRef<AbortController | null>(null)

  const [log, setLog] = useState<LogItem[]>(() => restoredLog(initialSession))
  // Static 在数组缩短时不会重绘；/clear 时通过递增 gen 强制重挂载
  const [gen, setGen] = useState(0)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState('')
  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [runningTool, setRunningTool] = useState<string | null>(null)
  const [usage, setUsage] = useState<Usage>(emptyUsage())
  const [companion, setCompanion] = useState<Companion | undefined>(getCompanion())
  const [permission, setPermission] = useState<{
    req: PermissionRequest
    resolve: (ok: boolean) => void
  } | null>(null)
  const [permIndex, setPermIndex] = useState(0)
  const sessionAllowedToolsRef = useRef<Set<string>>(new Set())
  const [menuIndex, setMenuIndex] = useState(0)

  // 输入以 / 开头且尚未输入空格时，显示匹配的命令菜单
  const showMenu = input.startsWith('/') && !input.includes(' ') && !busy
  const menuMatches = showMenu
    ? SLASH_COMMANDS.filter(c => c.name.startsWith(input.slice(1).toLowerCase()))
    : []
  const clampedMenuIndex =
    menuMatches.length > 0 ? Math.min(menuIndex, menuMatches.length - 1) : 0

  const streamBufRef = useRef('')
  const toolDescRef = useRef<Record<string, string>>({})
  const queueRef = useRef<string[]>([])
  const drainingRef = useRef(false)
  const [queueCount, setQueueCount] = useState(0)
  const [rewind, setRewind] = useState<{ marks: TurnMark[]; index: number } | null>(null)
  const [subagents, setSubagents] = useState<SubagentInfo[]>([])
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sessionPick, setSessionPick] = useState<{
    list: SessionData[]
    index: number
  } | null>(() =>
    resumeSessions && resumeSessions.length
      ? { list: resumeSessions, index: 0 }
      : null,
  )

  const pushLog = useCallback((item: Omit<LogItem, 'id'>) => {
    setLog(prev => [...prev, { ...item, id: nextId() }])
  }, [])

  const flushStreaming = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current)
      streamTimerRef.current = null
    }
    const text = streamBufRef.current.trim()
    if (text) pushLog({ kind: 'assistant', text })
    streamBufRef.current = ''
    setStreaming('')
  }, [pushLog])

  // 已恢复会话：把历史消息载入 agent
  useEffect(() => {
    if (initialSession) sessionRef.current.loadMessages(initialSession.messages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 启动时根据权限模式给出醒目提示（尤其是完全放行模式）
  useEffect(() => {
    const m = getConfig().permissionMode
    if (m === 'auto') {
      pushLog({
        kind: 'error',
        text:
          '⚠ 已进入完全放行模式（bypassPermissions）：写文件、执行命令等所有操作将自动执行，不再询问确认。请谨慎使用。',
      })
    } else if (m === 'plan') {
      pushLog({
        kind: 'system',
        text: '📋 计划模式（plan）：仅允许只读操作，先规划方案，待你批准后再执行。',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 宠物孵化（首次运行）
  useEffect(() => {
    const cfg = getConfig()
    if (cfg.buddyEnabled && !companion) {
      hatchCompanion()
        .then(c => setCompanion(c))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 订阅 agent 事件驱动 UI
  useEffect(() => {
    const mood = moodRef.current
    mood.start()
    const offs = [
      bus.on('assistant:text', ({ delta }) => {
        streamBufRef.current += delta
        // 节流：合并高频 token，最多每 50ms 刷新一次，避免重渲染挤占键盘输入
        if (streamTimerRef.current) return
        streamTimerRef.current = setTimeout(() => {
          streamTimerRef.current = null
          setStreaming(streamBufRef.current)
        }, 50)
      }),
      bus.on('thinking', ({ active }) => setThinking(active)),
      bus.on('tool:start', ({ name, input }) => {
        // 把当前流式文本固化到历史，再显示"运行中工具"指示
        flushStreaming()
        const desc = describeInput(name, input)
        toolDescRef.current[name] = desc
        setRunningTool(`${name}${desc ? `(${desc})` : ''}`)
      }),
      bus.on('tool:end', ({ name, ok }) => {
        setRunningTool(null)
        const desc = toolDescRef.current[name] ?? ''
        // 工具完成后一次性写入历史（Static 友好：append-only）
        setLog(prev => [
          ...prev,
          { id: nextId(), kind: 'tool', toolName: name, text: desc, ok },
        ])
      }),
      bus.on('usage', u => setUsage({ ...u })),
      bus.on('subagent:start', ({ id, description }) => {
        setSubagents(prev => [
          ...prev,
          { id, description, startedAt: Date.now(), tokens: 0, status: 'running' },
        ])
      }),
      bus.on('subagent:progress', ({ id, tokens }) => {
        setSubagents(prev =>
          prev.map(s => (s.id === id ? { ...s, tokens } : s)),
        )
      }),
      bus.on('subagent:end', ({ id, ok, durationMs, tokens }) => {
        setSubagents(prev =>
          prev.map(s =>
            s.id === id
              ? { ...s, status: ok ? 'done' : 'failed', durationMs, tokens }
              : s,
          ),
        )
        // 完成的子代理保留 8 秒后移除
        setTimeout(() => {
          setSubagents(prev => prev.filter(s => s.id !== id))
        }, 8000)
      }),
      bus.on('error', ({ message }) => {
        flushStreaming()
        setRunningTool(null)
        pushLog({ kind: 'error', text: message })
      }),
    ]
    return () => {
      offs.forEach(off => off())
      mood.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const persist = useCallback(async () => {
    const data: SessionData = {
      id: sessionIdRef.current,
      title: titleFrom(sessionRef.current.messages),
      createdAt: createdAtRef.current,
      updatedAt: Date.now(),
      cwd,
      messages: sessionRef.current.messages,
    }
    await saveSession(data).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd])

  // 从会话选择器中选定一个会话并载入
  const chooseSession = useCallback((meta: SessionData) => {
    const data = loadSession(meta.id) ?? meta
    sessionRef.current.loadMessages(data.messages)
    sessionIdRef.current = data.id
    createdAtRef.current = data.createdAt ?? Date.now()
    setLog([bannerItem(), ...logFromMessages(data.messages)])
    setGen(g => g + 1)
    setSessionPick(null)
  }, [])

  const requestPermission = useCallback(
    (req: PermissionRequest): Promise<boolean> =>
      new Promise(resolve => {
        // 本会话已批准过的工具直接放行（来自"不再询问"选项）
        if (sessionAllowedToolsRef.current.has(req.toolName)) {
          resolve(true)
          return
        }
        setPermIndex(0)
        setPermission({ req, resolve })
      }),
    [],
  )

  const confirmPermission = useCallback(
    (kind: 'once' | 'always' | 'deny') => {
      setPermission(prev => {
        if (!prev) return null
        if (kind === 'always') sessionAllowedToolsRef.current.add(prev.req.toolName)
        prev.resolve(kind !== 'deny')
        return null
      })
      setPermIndex(0)
    },
    [],
  )

  const clearLog = useCallback(() => {
    setLog([bannerItem()])
    setGen(g => g + 1)
  }, [])

  // 执行回退：截断对话到该回合之前 + 还原该回合之后的所有文件改动
  const performRewind = useCallback(
    async (mark: TurnMark) => {
      setRewind(null)
      const { restoredFiles, messageLen } = await rewindToTurn(cwd, mark.turn)
      const truncated = sessionRef.current.messages.slice(0, messageLen)
      sessionRef.current.loadMessages(truncated)
      setLog([bannerItem(), ...logFromMessages(truncated)])
      setGen(g => g + 1)
      streamBufRef.current = ''
      setStreaming('')
      pushLog({
        kind: 'system',
        text:
          `已回到该回合之前的对话` +
          (restoredFiles.length
            ? `，并还原 ${restoredFiles.length} 个文件的改动:\n${restoredFiles.join('\n')}`
            : '（无文件改动需还原）'),
      })
      await persist()
    },
    [cwd, pushLog, persist],
  )

  // 处理一条输入（斜杠命令 / ! / # / 普通对话）。不管理 busy（由 drain 统一管理）。
  const processInput = useCallback(
    async (text: string) => {
      if (text.startsWith('!')) {
        const cmd = text.slice(1).trim()
        if (!cmd) return
        pushLog({ kind: 'user', text })
        const ctrl = new AbortController()
        const out = await runDirectShell(cmd, cwd, ctrl.signal)
        pushLog({ kind: 'system', text: out })
        return
      }
      if (text.startsWith('#')) {
        const note = text.slice(1).trim()
        if (!note) return
        pushLog({ kind: 'user', text })
        await appendProjectMemory(`- ${note}`, cwd)
        pushLog({ kind: 'system', text: '已写入项目记忆 (.strike/MEMORY.md)' })
        return
      }
      // /rewind 打开"回到上一段对话"选择器（交互式，单独处理）
      if (text === '/rewind' || text === '/back') {
        const marks = getTurnMarks()
        if (!marks.length) {
          pushLog({ kind: 'system', text: '还没有可回退的对话回合' })
          return
        }
        setRewind({ marks, index: marks.length - 1 })
        return
      }

      if (text.startsWith('/')) {
        const result: SlashResult = await handleSlashCommand(text, {
          session: sessionRef.current,
          cwd,
          usage,
          setCompanion,
          companion,
          mood: moodRef.current,
          clearLog,
          exit,
        })
        if (result.message) pushLog({ kind: 'system', text: result.message })
        return
      }

      if (companion && text.includes(companion.name)) {
        moodRef.current.greet(companion.name)
      }

      // 标记一个对话回合检查点（用于 /rewind 回退对话+还原代码）
      beginTurn(sessionRef.current.messages.length, text)
      pushLog({ kind: 'user', text })
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        await sessionRef.current.run(text, {
          signal: ctrl.signal,
          requestPermission,
        })
        flushStreaming()
        reflectAfterTask(sessionRef.current.messages, cwd)
        await persist()
      } finally {
        abortRef.current = null
      }
    },
    [companion, cwd, usage, requestPermission, pushLog, flushStreaming, persist, clearLog, exit],
  )

  // 提交：入队 + 顺序消费。运行中也可继续输入，新消息进入队列。
  const submit = useCallback(
    async (value: string) => {
      const text = value.trim()
      if (!text) return
      setInput('')
      queueRef.current.push(text)
      setQueueCount(queueRef.current.length)
      if (drainingRef.current) return
      drainingRef.current = true
      setBusy(true)
      try {
        while (queueRef.current.length) {
          const next = queueRef.current.shift()!
          setQueueCount(queueRef.current.length)
          await processInput(next)
        }
      } finally {
        drainingRef.current = false
        setBusy(false)
        setThinking(false)
        setRunningTool(null)
      }
    },
    [processInput],
  )

  // 键盘：会话选择器 / 回退选择器 / 权限确认 / 命令菜单导航 / 中断
  useInput((inputChar, key) => {
    if (sessionPick) {
      if (key.upArrow) {
        setSessionPick(s =>
          s ? { ...s, index: (s.index - 1 + s.list.length) % s.list.length } : s,
        )
      } else if (key.downArrow) {
        setSessionPick(s =>
          s ? { ...s, index: (s.index + 1) % s.list.length } : s,
        )
      } else if (key.return) {
        const m = sessionPick.list[sessionPick.index]
        if (m) chooseSession(m)
      } else if (key.escape || inputChar === 'n' || inputChar === 'N') {
        // 开启新会话
        setSessionPick(null)
      }
      return
    }
    if (rewind) {
      if (key.upArrow) {
        setRewind(r => (r ? { ...r, index: (r.index - 1 + r.marks.length) % r.marks.length } : r))
      } else if (key.downArrow) {
        setRewind(r => (r ? { ...r, index: (r.index + 1) % r.marks.length } : r))
      } else if (key.return) {
        const m = rewind.marks[rewind.index]
        if (m) void performRewind(m)
      } else if (key.escape) {
        setRewind(null)
      }
      return
    }
    if (permission) {
      // Claude 风格：方向键选择 + 回车确认；数字/快捷键直选
      if (key.upArrow || key.leftArrow) {
        setPermIndex(i => (i + 2) % 3)
      } else if (key.downArrow || key.rightArrow || key.tab) {
        setPermIndex(i => (i + 1) % 3)
      } else if (key.return) {
        confirmPermission((['once', 'always', 'deny'] as const)[permIndex])
      } else if (inputChar === '1' || inputChar === 'y' || inputChar === 'Y') {
        confirmPermission('once')
      } else if (inputChar === '2') {
        confirmPermission('always')
      } else if (inputChar === '3' || inputChar === 'n' || inputChar === 'N' || key.escape) {
        confirmPermission('deny')
      }
      return
    }
    // 命令菜单：上下选择，Tab 补全选中项
    if (showMenu && menuMatches.length > 0) {
      if (key.upArrow) {
        setMenuIndex(i => (i - 1 + menuMatches.length) % menuMatches.length)
        return
      }
      if (key.downArrow) {
        setMenuIndex(i => (i + 1) % menuMatches.length)
        return
      }
      if (key.tab) {
        setInput('/' + menuMatches[clampedMenuIndex].name + ' ')
        setMenuIndex(0)
        return
      }
    }
    if (key.escape && busy && abortRef.current) {
      abortRef.current.abort()
    }
  })

  const buddyEnabled = getConfig().buddyEnabled

  return (
    <Box flexDirection="column">
      {/* 历史区：用 Static 打印进终端滚动缓冲，可用滚轮上滑查看 */}
      <Static key={gen} items={log}>
        {item => <LogLine key={item.id} item={item} />}
      </Static>

      {/* 动态区：当前活动 / 宠物 / 输入框 / 状态栏 */}
      <Box flexDirection="column">
        {streaming ? (
          <Box flexDirection="column">
            {streamWasTruncated(streaming) ? (
              <Text dimColor>  … 上文已省略，回复完成后可向上滚动查看完整内容</Text>
            ) : null}
            <Box>
              <Text color="green">● </Text>
              <Text>{streamTail(streaming)}</Text>
            </Box>
          </Box>
        ) : null}
        {runningTool ? (
          <Text color="yellow">  ◌ 正在执行 {runningTool}…</Text>
        ) : thinking && !streaming ? (
          <Text color="yellow">● 思考中…（Esc 中断）</Text>
        ) : null}

        <SubagentPanel agents={subagents} />

        {buddyEnabled && companion && !showMenu && !rewind && !sessionPick && !busy ? (
          <Box marginTop={1}>
            <BuddySprite companion={companion} moodController={moodRef.current} />
          </Box>
        ) : null}

        {sessionPick ? (
          <SessionPicker
            list={sessionPick.list}
            selected={sessionPick.index}
          />
        ) : rewind ? (
          <RewindPicker marks={rewind.marks} selected={rewind.index} />
        ) : permission ? (
          <PermissionDialog req={permission.req} selected={permIndex} />
        ) : (
          <Box flexDirection="column">
            {showMenu && menuMatches.length > 0 ? (
              <SlashMenu matches={menuMatches} selected={clampedMenuIndex} />
            ) : null}
            {queueCount > 0 ? (
              <Text color="yellow">  ⧗ {queueCount} 条消息排队中（运行结束后依次处理）</Text>
            ) : null}
            <Box
              marginTop={1}
              borderStyle="round"
              borderColor={busy ? 'yellow' : 'cyan'}
              paddingX={1}
            >
              <Text color="cyan">{busy ? '… ' : '› '}</Text>
              <TextInput
                value={input}
                onChange={setInput}
                onSubmit={submit}
                placeholder={
                  busy
                    ? '处理中…可继续输入，消息将排队'
                    : '输入消息 · / 命令 · ! 执行命令 · # 记笔记'
                }
              />
            </Box>
          </Box>
        )}

        <StatusBar
          usage={usage}
          busy={busy}
          model={activeModel()}
          mode={getConfig().permissionMode}
          think={getConfig().thinkingMode === 'off' ? 'off' : getConfig().effort}
          companion={companion}
        />
      </Box>
    </Box>
  )
}

function SubagentPanel({ agents }: { agents: SubagentInfo[] }) {
  const [, tick] = useState(0)
  // 每秒刷新让运行时间走动
  useEffect(() => {
    if (!agents.some(a => a.status === 'running')) return
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [agents])
  if (!agents.length) return null
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="magenta" paddingX={1}>
      <Text color="magenta" bold>
        子智能体 ({agents.length})
      </Text>
      {agents.map(a => {
        const elapsed = ((a.durationMs ?? Date.now() - a.startedAt) / 1000).toFixed(1)
        const icon = a.status === 'running' ? '◌' : a.status === 'done' ? '✔' : '✘'
        const color = a.status === 'running' ? 'yellow' : a.status === 'done' ? 'green' : 'red'
        return (
          <Text key={a.id} color={color}>
            {'  '}
            {icon} {a.description}
            <Text dimColor>
              {'  '}⏱ {elapsed}s · {a.tokens} tok · {a.id}
            </Text>
          </Text>
        )
      })}
      <Text dimColor>  （子代理运行中；完成后结论会并入对话）</Text>
    </Box>
  )
}

function SessionPicker({
  list,
  selected,
}: {
  list: SessionData[]
  selected: number
}) {
  const WINDOW = 8
  const start = Math.max(
    0,
    Math.min(selected - 4, Math.max(0, list.length - WINDOW)),
  )
  const visible = list.slice(start, start + WINDOW)
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        选择要恢复的会话（共 {list.length} 个）
      </Text>
      {start > 0 ? <Text dimColor>  ▲ 更新…</Text> : null}
      {visible.map((s, i) => {
        const realIdx = start + i
        const active = realIdx === selected
        const when = new Date(s.updatedAt).toLocaleString()
        return (
          <Text key={s.id} color={active ? 'cyan' : undefined} bold={active}>
            {active ? '❯ ' : '  '}
            {s.title || '(无标题)'}
            <Text dimColor>
              {'  '}
              {when} · {s.id}
            </Text>
          </Text>
        )
      })}
      {start + WINDOW < list.length ? <Text dimColor>  ▼ 更多…</Text> : null}
      <Text dimColor>↑↓ 选择 · Enter 恢复 · N/Esc 开启新会话</Text>
    </Box>
  )
}

function RewindPicker({
  marks,
  selected,
}: {
  marks: TurnMark[]
  selected: number
}) {
  const WINDOW = 8
  const start = Math.max(0, Math.min(selected - 4, Math.max(0, marks.length - WINDOW)))
  const visible = marks.slice(start, start + WINDOW)
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="blue" paddingX={1}>
      <Text color="blue" bold>
        回到上一段对话（会同时还原该回合之后的代码改动）
      </Text>
      {start > 0 ? <Text dimColor>  ▲ 更早…</Text> : null}
      {visible.map((m, i) => {
        const realIdx = start + i
        const active = realIdx === selected
        return (
          <Text key={m.turn} color={active ? 'blue' : undefined} bold={active}>
            {active ? '❯ ' : '  '}#{m.turn} {m.label}
          </Text>
        )
      })}
      {start + WINDOW < marks.length ? <Text dimColor>  ▼ 更多…</Text> : null}
      <Text dimColor>↑↓ 选择 · Enter 回退 · Esc 取消</Text>
    </Box>
  )
}

function SlashMenu({
  matches,
  selected,
}: {
  matches: { name: string; desc: string }[]
  selected: number
}) {
  // 只显示一个窗口（最多 6 条），随选中项滚动，避免列表过高撑破终端导致重绘错乱
  const WINDOW = 6
  const start = Math.max(
    0,
    Math.min(selected - 2, Math.max(0, matches.length - WINDOW)),
  )
  const visible = matches.slice(start, start + WINDOW)
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      {start > 0 ? <Text dimColor>  ▲ 更多…</Text> : null}
      {visible.map((c, i) => {
        const realIdx = start + i
        const active = realIdx === selected
        return (
          <Text key={c.name} color={active ? 'cyan' : undefined}>
            {active ? '❯ ' : '  '}
            <Text bold>/{c.name}</Text>
            <Text dimColor> — {c.desc}</Text>
          </Text>
        )
      })}
      {start + WINDOW < matches.length ? <Text dimColor>  ▼ 更多…</Text> : null}
      <Text dimColor>↑↓ 选择 · Tab 补全 · Enter 执行</Text>
    </Box>
  )
}

function PermissionDialog({
  req,
  selected,
}: {
  req: PermissionRequest
  selected: number
}) {
  const options = [
    '允许一次',
    `允许，本会话内不再询问 ${req.toolName}`,
    '拒绝',
  ]
  const dangerColor =
    req.danger === 'high' ? 'red' : req.danger === 'medium' ? 'yellow' : 'cyan'
  return (
    <Box
      marginTop={1}
      flexDirection="column"
      borderStyle="round"
      borderColor={dangerColor}
      paddingX={1}
    >
      <Text>
        <Text color={dangerColor} bold>
          需要确认 
        </Text>
        <Text bold>{req.toolName}</Text>
        <Text dimColor> {req.description}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {options.map((label, i) => (
          <Text key={i} color={i === selected ? dangerColor : undefined} bold={i === selected}>
            {i === selected ? '❯ ' : '  '}
            {i + 1}. {label}
          </Text>
        ))}
      </Box>
      <Text dimColor>↑↓ 选择 · Enter 确认 · 数字直选 · Esc 拒绝</Text>
    </Box>
  )
}

function LogLine({ item }: { item: LogItem }) {
  switch (item.kind) {
    case 'banner':
      return (
        <Box borderStyle="round" borderColor="magenta" paddingX={1} marginBottom={1}>
          <Text>
            <Text color="magenta" bold>
              ⚡ StrikeAgent-CLI
            </Text>{' '}
            <Text dimColor>· 终端 AI 编程助手 · /help 查看命令 · Esc 中断</Text>
            {'\n'}
            <Text color="magentaBright">{WATERMARK}</Text>
            <Text dimColor> · {COPYRIGHT}</Text>
          </Text>
        </Box>
      )
    case 'user':
      // 高亮显示：带左侧色条 + 背景，便于在长输出中快速定位"我说了什么"
      return (
        <Box marginTop={1}>
          <Text color="cyanBright">▌ </Text>
          <Text backgroundColor="#22364a" color="whiteBright" bold>
            {' '}
            {item.text}
            {' '}
          </Text>
        </Box>
      )
    case 'assistant':
      return (
        <Box marginTop={1}>
          <Text color="green">● </Text>
          <Text>{item.text}</Text>
        </Box>
      )
    case 'tool': {
      const color = item.ok ? 'green' : 'red'
      const icon = item.ok ? '✔' : '✘'
      return (
        <Text color={color}>
          {'  '}
          {icon} {item.toolName}
          {item.text ? <Text dimColor>{` (${item.text})`}</Text> : null}
        </Text>
      )
    }
    case 'error':
      return <Text color="red">  ✖ {item.text}</Text>
    case 'system':
      return (
        <Box marginTop={1}>
          <Text dimColor>{item.text}</Text>
        </Box>
      )
    default:
      return null
  }
}

/** 把内部权限模式名转成状态栏友好标签。 */
function modeLabel(mode: string): string {
  if (mode === 'auto') return 'BYPASS·全部放行'
  if (mode === 'plan') return 'plan·只读'
  return 'default'
}

function StatusBar({
  usage,
  busy,
  model,
  mode,
  think,
  companion,
}: {
  usage: Usage
  busy: boolean
  model: string
  mode: string
  think: string
  companion?: Companion
}) {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {busy ? '⚙ 运行中  ' : ''}
        {model} ·{' '}
        <Text
          color={mode === 'auto' ? 'red' : mode === 'plan' ? 'cyan' : undefined}
          bold={mode === 'auto'}
        >
          {modeLabel(mode)}
        </Text>{' '}
        · 思考 {think}
        {companion ? ` · ${companion.name}` : ''}  |  {formatUsage(usage)}
      </Text>
    </Box>
  )
}

// 实时流式文本只在动态区显示末尾这么多行/字符，防止动态区高度超出终端
// 导致 Ink 差分重绘错乱、完成时输入框"跳到上方"。完整内容在完成后进入滚动区。
const STREAM_TAIL_LINES = 10
const STREAM_TAIL_CHARS = 700

function streamTail(text: string): string {
  let t = text
  if (t.length > STREAM_TAIL_CHARS) t = t.slice(t.length - STREAM_TAIL_CHARS)
  const lines = t.split('\n')
  if (lines.length > STREAM_TAIL_LINES) {
    return lines.slice(lines.length - STREAM_TAIL_LINES).join('\n')
  }
  return t
}

function streamWasTruncated(text: string): boolean {
  return text.length > STREAM_TAIL_CHARS || text.split('\n').length > STREAM_TAIL_LINES
}

/** ! 模式：直接执行 shell 命令（用户显式触发，自动放行）。 */
async function runDirectShell(
  cmd: string,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const res = await ShellTool.execute(
      { command: cmd },
      { cwd, signal, requestPermission: async () => true },
    )
    return `$ ${cmd}\n${res.content}`
  } catch (e) {
    return `$ ${cmd}\n执行失败: ${e instanceof Error ? e.message : String(e)}`
  }
}

function describeInput(name: string, input: Record<string, unknown>): string {
  const v =
    (input.file_path as string) ||
    (input.command as string) ||
    (input.pattern as string) ||
    (input.query as string) ||
    (input.url as string) ||
    (input.topic as string) ||
    (input.description as string) ||
    ''
  return String(v).slice(0, 80)
}
