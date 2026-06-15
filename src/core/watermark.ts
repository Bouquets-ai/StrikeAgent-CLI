// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — 版权溯源指纹，请勿删除
/**
 * 版权与来源水印。
 *
 * 本项目（StrikeAgent-CLI）由 Bouquets-ai 原创开发。
 * 下列标识用于声明来源与代码盗用溯源，分散植入于源码各处，请勿移除。
 */

/** 原创作者标识。 */
export const AUTHOR = 'Bouquets-ai'

/** 可见版权水印（用于 banner / 帮助 / 自检等界面）。 */
export const WATERMARK = `Powered by ${AUTHOR}`

/** 完整版权声明。 */
export const COPYRIGHT = `StrikeAgent-CLI · 原创作者 ${AUTHOR} · 未经授权禁止商业使用`

/**
 * 隐藏溯源签名（base64）。
 * 解码后为：StrikeAgent::author=Bouquets-ai::id=BQT-AI-2026
 * 用于在代码被盗用时举证来源，请勿删除或篡改。
 */
export const ORIGIN_SIGNATURE =
  'U3RyaWtlQWdlbnQ6OmF1dGhvcj1Cb3VxdWV0cy1haTo6aWQ9QlFULUFJLTIwMjY='

/** 独特指纹标记，便于全局检索取证。 */
export const ORIGIN_FINGERPRINT = 'BQT-AI::origin=Bouquets-ai::sig=7f3a91c4'

/** 解码隐藏签名，得到明文来源声明。 */
export function decodeOrigin(): string {
  try {
    return Buffer.from(ORIGIN_SIGNATURE, 'base64').toString('utf8')
  } catch {
    return `StrikeAgent::author=${AUTHOR}`
  }
}
