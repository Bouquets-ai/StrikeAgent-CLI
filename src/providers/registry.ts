// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
import type { LLMProvider } from './types.js'
import { AnthropicCompatibleProvider } from './anthropicCompatible.js'
import { OllamaProvider } from './ollama.js'
import { getConfig, type StrikeConfig } from '../config/index.js'

let cachedProvider: { key: string; provider: LLMProvider } | null = null

function providerKey(cfg: StrikeConfig): string {
  return `${cfg.provider}|${cfg.baseUrl}|${cfg.ollamaBaseUrl}|${cfg.authToken.slice(0, 6)}|${cfg.model}`
}

/** 根据当前配置返回（缓存的）provider 实例。 */
export function getProvider(cfg: StrikeConfig = getConfig()): LLMProvider {
  const key = providerKey(cfg)
  if (cachedProvider?.key === key) return cachedProvider.provider

  let provider: LLMProvider
  switch (cfg.provider) {
    case 'ollama':
      provider = new OllamaProvider({ baseUrl: cfg.ollamaBaseUrl })
      break
    case 'anthropic':
    case 'deepseek':
    default:
      provider = new AnthropicCompatibleProvider({
        name: cfg.provider,
        baseUrl: cfg.baseUrl,
        authToken: cfg.authToken,
        model: cfg.model,
      })
      break
  }
  cachedProvider = { key, provider }
  return provider
}

/** 当前生效的主模型名。 */
export function activeModel(cfg: StrikeConfig = getConfig()): string {
  return cfg.provider === 'ollama' ? cfg.ollamaModel : cfg.model
}

/** 当前生效的子代理/反思模型名。 */
export function subagentModel(cfg: StrikeConfig = getConfig()): string {
  return cfg.provider === 'ollama' ? cfg.ollamaModel : cfg.subagentModel
}

export function resetProviderCache(): void {
  cachedProvider = null
}
