import * as Lark from '@larksuiteoapi/node-sdk'
import type { RemoteAdapter, IncomingMessage } from './adapter.js'
import { AgentSession } from '../core/agent.js'
import { getConfig } from '../config/index.js'
import type { PermissionRequest } from '../tools/tool.js'

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[飞书 ${new Date().toLocaleTimeString()}] ${msg}`)
}

/** 飞书长连接适配器（WSClient，无需公网回调地址）。 */
export class FeishuAdapter implements RemoteAdapter {
  readonly name = 'feishu'
  private wsClient: Lark.WSClient | null = null
  private apiClient: Lark.Client | null = null
  private running = false
  private appId: string
  private appSecret: string
  /** 去重：飞书可能重复推送同一事件 */
  private seen = new Set<string>()

  constructor(appId: string, appSecret: string) {
    this.appId = appId
    this.appSecret = appSecret
  }

  async connect(
    onMessage: (msg: IncomingMessage) => Promise<void>,
  ): Promise<void> {
    if (!this.appId || !this.appSecret) {
      throw new Error('缺少飞书 App ID / App Secret')
    }
    this.apiClient = new Lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
    })
    this.wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      loggerLevel: Lark.LoggerLevel.info,
    })

    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (raw: unknown) => {
        // 兼容不同 SDK 版本：事件体可能直接是 event，也可能裹在 .event 下
        const data = (raw as { event?: unknown }).event ?? raw
        const d = data as {
          message?: {
            message_id?: string
            chat_id?: string
            message_type?: string
            content?: string
          }
          sender?: { sender_id?: { open_id?: string } }
        }
        if (!d.message) {
          log(`收到事件但无 message 字段: ${JSON.stringify(raw).slice(0, 200)}`)
          return
        }
        const msgId = d.message.message_id ?? ''
        if (msgId && this.seen.has(msgId)) return
        if (msgId) this.seen.add(msgId)
        if (this.seen.size > 500) this.seen.clear()

        let text = ''
        try {
          if (d.message.message_type === 'text') {
            // 去掉群里 @机器人 的占位符
            text = (JSON.parse(d.message.content ?? '{}').text ?? '')
              .replace(/@_user_\d+/g, '')
              .trim()
          } else {
            log(`收到非文本消息(type=${d.message.message_type})，已忽略`)
          }
        } catch {
          text = ''
        }
        log(`收到消息: chat=${d.message.chat_id} text="${text.slice(0, 60)}"`)
        if (!text) return

        await onMessage({
          text,
          senderId: d.sender?.sender_id?.open_id ?? '',
          chatId: d.message.chat_id ?? '',
        })
      },
    })

    await this.wsClient.start({ eventDispatcher: dispatcher })
    this.running = true
    log('长连接已建立，等待消息…（在飞书中给应用发单聊消息试试）')
  }

  async reply(chatId: string, text: string): Promise<void> {
    if (!this.apiClient) return
    // 飞书单条文本有长度上限，分段发送
    const chunks = splitText(text, 4000)
    for (const chunk of chunks) {
      try {
        const res = await this.apiClient.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text: chunk }),
          },
        })
        if ((res as { code?: number }).code && (res as { code?: number }).code !== 0) {
          log(`回复失败 code=${(res as { code?: number; msg?: string }).code} msg=${(res as { msg?: string }).msg}`)
        }
      } catch (e) {
        // 常见原因：缺少"给用户/群发消息"权限(im:message:send_as_bot)
        log(`回复异常: ${e instanceof Error ? e.message : String(e)}（请检查应用是否有发送消息权限）`)
      }
    }
  }

  async disconnect(): Promise<void> {
    this.running = false
    // WSClient 无显式 stop API；置空让其被 GC，进程退出时连接释放
    this.wsClient = null
    this.apiClient = null
  }

  isRunning(): boolean {
    return this.running
  }
}

function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max))
  return out
}

// -------------------- 远程桥接：飞书消息 → agent → 回复 --------------------

let adapter: FeishuAdapter | null = null
let processing = false

/** 远程会话用独立的 AgentSession，避免污染 REPL 状态，但共享 cwd/工具/记忆。 */
export async function startFeishuRemote(
  _replSession: AgentSession,
  cwd: string,
): Promise<void> {
  const cfg = getConfig()
  adapter = new FeishuAdapter(cfg.feishu.appId, cfg.feishu.appSecret)
  const remoteSession = new AgentSession(cwd)

  await adapter.connect(async msg => {
    // 白名单校验
    if (cfg.feishu.allowList.length && !cfg.feishu.allowList.includes(msg.senderId)) {
      await adapter?.reply(msg.chatId, '⛔ 你不在该 StrikeAgent 的远程白名单中。')
      return
    }
    if (processing) {
      await adapter?.reply(msg.chatId, '⏳ 正在处理上一条指令，请稍候…')
      return
    }
    processing = true
    try {
      if (msg.text === '/clear') {
        remoteSession.reset()
        await adapter?.reply(msg.chatId, '已清空远程会话上下文')
        return
      }
      await adapter?.reply(msg.chatId, '⚡ 收到，正在执行…')
      const ctrl = new AbortController()
      const { finalText } = await remoteSession.run(msg.text, {
        signal: ctrl.signal,
        requestPermission: remotePermission,
      })
      log(`执行完成，回复 ${finalText.length} 字`)
      await adapter?.reply(msg.chatId, finalText || '(无输出)')
    } catch (e) {
      log(`执行出错: ${e instanceof Error ? e.message : String(e)}`)
      await adapter?.reply(
        msg.chatId,
        `执行出错: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      processing = false
    }
  })
}

/** 远程权限策略：高危操作直接拒绝（无法交互确认），其余放行。 */
async function remotePermission(req: PermissionRequest): Promise<boolean> {
  return req.danger !== 'high'
}

export async function stopFeishuRemote(): Promise<void> {
  await adapter?.disconnect()
  adapter = null
}

export function remoteRunning(): boolean {
  return adapter?.isRunning() ?? false
}
