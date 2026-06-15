/** 远程通道统一接口。飞书先实现，微信/钉钉占位。 */
export interface IncomingMessage {
  text: string
  /** 发送者标识（用于白名单） */
  senderId: string
  /** 会话标识（用于回复） */
  chatId: string
}

export interface RemoteAdapter {
  readonly name: string
  /** 建立连接并开始接收消息。 */
  connect(onMessage: (msg: IncomingMessage) => Promise<void>): Promise<void>
  /** 回复一条文本到指定会话。 */
  reply(chatId: string, text: string): Promise<void>
  /** 断开连接。 */
  disconnect(): Promise<void>
  isRunning(): boolean
}
