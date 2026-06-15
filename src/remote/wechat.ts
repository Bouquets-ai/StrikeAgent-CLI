import type { RemoteAdapter, IncomingMessage } from './adapter.js'

/**
 * 微信（企业微信）远程通道占位实现。
 * 接口已对齐 RemoteAdapter，后续补齐企业微信应用凭证与回调/长连接即可启用。
 */
export class WechatAdapter implements RemoteAdapter {
  readonly name = 'wechat'
  async connect(_onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void> {
    throw new Error('微信通道尚未实现：请补充企业微信 corpId/secret 后实现 connect()')
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
