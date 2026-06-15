import type { RemoteAdapter, IncomingMessage } from './adapter.js'

/**
 * 钉钉远程通道占位实现。
 * 接口已对齐 RemoteAdapter，后续补齐钉钉机器人 AppKey/AppSecret 与 Stream 模式即可启用。
 */
export class DingtalkAdapter implements RemoteAdapter {
  readonly name = 'dingtalk'
  async connect(_onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    throw new Error('钉钉通道尚未实现：请补充钉钉应用凭证后实现 connect()')
  }
  async reply(_chatId: string, _text: string): Promise<void> {
    /* 待实现 */
  }
  async disconnect(): Promise<void> {
    /* 待实现 */
  }
  isRunning(): boolean {
    return false
  }
}
