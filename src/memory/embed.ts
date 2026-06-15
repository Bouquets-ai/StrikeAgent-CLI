import { getProvider } from '../providers/registry.js'

/** 余弦相似度。 */
export function cosineSim(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 尝试用当前 provider 生成嵌入；不支持时返回 []。 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  try {
    const provider = getProvider()
    if (!provider.embed) return []
    return await provider.embed(texts)
  } catch {
    return []
  }
}

export async function embedOne(text: string): Promise<number[] | undefined> {
  const res = await embedTexts([text])
  return res[0]
}
