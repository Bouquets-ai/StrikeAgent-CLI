import type { Usage } from './message.js'
import { getConfig } from '../config/index.js'

/** 每百万 token 的粗略单价（美元）。Ollama 本地为 0。 */
const PRICING: Record<string, { input: number; output: number }> = {
  deepseek: { input: 0.28, output: 0.42 },
  anthropic: { input: 3, output: 15 },
  ollama: { input: 0, output: 0 },
}

export function estimateCost(usage: Usage): number {
  const cfg = getConfig()
  const price = PRICING[cfg.provider] ?? PRICING.deepseek
  const inputCost = ((usage.input_tokens + usage.cache_creation_input_tokens) / 1_000_000) * price.input
  const cacheCost = (usage.cache_read_input_tokens / 1_000_000) * price.input * 0.1
  const outputCost = (usage.output_tokens / 1_000_000) * price.output
  return inputCost + cacheCost + outputCost
}

export function formatUsage(usage: Usage): string {
  const cost = estimateCost(usage)
  return [
    `输入: ${usage.input_tokens.toLocaleString()} tok`,
    `输出: ${usage.output_tokens.toLocaleString()} tok`,
    `缓存读取: ${usage.cache_read_input_tokens.toLocaleString()} tok`,
    `预估成本: $${cost.toFixed(4)}`,
  ].join('  ')
}
