import { readExperiences, type Experience } from './store.js'
import { cosineSim, embedOne } from './embed.js'

/**
 * 关键词分词（中英文混合）。
 * - 英文/数字：按词切分。
 * - 中文：因无空格，整段会被切成一个 token 难以匹配，故对每个 CJK 连续段
 *   额外生成 2-gram（二元组），显著提升中文关键词召回率。
 */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens: string[] = []
  // 英文/数字词
  for (const w of lower.split(/[^\w\u4e00-\u9fff]+/)) {
    if (/[a-z0-9]/.test(w) && w.length > 1) tokens.push(w)
  }
  // 中文连续段 → 2-gram
  const cjkRuns = lower.match(/[\u4e00-\u9fff]{2,}/g) ?? []
  for (const run of cjkRuns) {
    for (let i = 0; i < run.length - 1; i++) {
      tokens.push(run.slice(i, i + 2))
    }
  }
  return tokens
}

function keywordScore(query: string, exp: Experience): number {
  const qTokens = new Set(tokenize(query))
  if (!qTokens.size) return 0
  const text = `${exp.summary} ${exp.tags.join(' ')} ${exp.content}`
  const expTokens = tokenize(text)
  let hits = 0
  for (const t of expTokens) if (qTokens.has(t)) hits++
  return hits / Math.sqrt(expTokens.length + 1)
}

/**
 * 召回与 query 最相关的经验（向量优先，关键词兜底）。
 */
export async function retrieveRelevant(
  query: string,
  opts: { topK?: number; cwd?: string } = {},
): Promise<Experience[]> {
  const topK = opts.topK ?? 5
  const all = readExperiences(opts.cwd)
  if (!all.length) return []

  const withEmbedding = all.filter(e => e.embedding && e.embedding.length)
  let scored: { exp: Experience; score: number }[]

  if (withEmbedding.length >= 3) {
    const qVec = await embedOne(query)
    if (qVec) {
      scored = all.map(exp => ({
        exp,
        score: exp.embedding
          ? cosineSim(qVec, exp.embedding)
          : keywordScore(query, exp) * 0.5,
      }))
    } else {
      scored = all.map(exp => ({ exp, score: keywordScore(query, exp) }))
    }
  } else {
    scored = all.map(exp => ({ exp, score: keywordScore(query, exp) }))
  }

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(s => s.exp)
}

/** 把召回的经验格式化为可注入上下文的文本。 */
export function formatExperiences(exps: Experience[]): string {
  if (!exps.length) return ''
  return exps
    .map(e => `- [${e.tags.join(', ')}] ${e.summary}\n  ${e.content.replace(/\n/g, ' ').slice(0, 300)}`)
    .join('\n')
}
