import fs from 'node:fs'
import { rgPath } from '@vscode/ripgrep'
import { getConfig } from '../config/index.js'
import { getProvider, activeModel } from '../providers/registry.js'
import { AUTHOR, COPYRIGHT } from './watermark.js'

export interface DoctorResult {
  label: string
  ok: boolean
  detail: string
}

export async function runDoctor(): Promise<DoctorResult[]> {
  const cfg = getConfig()
  const results: DoctorResult[] = []

  // 来源/版权
  results.push({
    label: '来源',
    ok: true,
    detail: `${COPYRIGHT}（作者 ${AUTHOR}）`,
  })

  // 配置/鉴权
  if (cfg.provider === 'ollama') {
    results.push({
      label: '模型后端',
      ok: true,
      detail: `Ollama @ ${cfg.ollamaBaseUrl} (${cfg.ollamaModel})`,
    })
  } else {
    results.push({
      label: '模型后端',
      ok: Boolean(cfg.authToken),
      detail: cfg.authToken
        ? `${cfg.provider} @ ${cfg.baseUrl} (${cfg.model})`
        : '缺少 API Key（设置 ANTHROPIC_AUTH_TOKEN 或 DEEPSEEK_API_KEY）',
    })
  }

  // ripgrep
  results.push({
    label: 'ripgrep',
    ok: fs.existsSync(rgPath),
    detail: fs.existsSync(rgPath) ? rgPath : '未找到 ripgrep 二进制',
  })

  // 飞书
  results.push({
    label: '飞书凭证',
    ok: Boolean(cfg.feishu.appId && cfg.feishu.appSecret),
    detail:
      cfg.feishu.appId && cfg.feishu.appSecret
        ? `App ID: ${cfg.feishu.appId}`
        : '未配置（远程操控不可用）',
  })

  // provider 连通性
  try {
    const ping = await getProvider(cfg).ping()
    results.push({ label: '连通性', ok: ping.ok, detail: ping.message })
  } catch (e) {
    results.push({
      label: '连通性',
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    })
  }

  void activeModel
  return results
}
