import { type Companion } from './types.js'
import { rollLaunchBones, buddyUserId } from './bones.js'
import { getConfig, saveGlobalConfig } from '../config/index.js'
import { getProvider, subagentModel } from '../providers/registry.js'
import { textMessage } from '../core/message.js'
import { RARITY_LABEL } from './types.js'

/** 读取当前宠物（外形每次启动随机变化 + 持久化的名字/性格）。未孵化返回 undefined。 */
export function getCompanion(): Companion | undefined {
  const cfg = getConfig()
  if (!cfg.buddy?.name) return undefined
  const bones = rollLaunchBones()
  return {
    ...bones,
    name: cfg.buddy.name,
    personality: cfg.buddy.personality ?? '忠诚、机灵',
  }
}

/** 预览骨架（本次启动的随机外形）。 */
export function previewBones() {
  return rollLaunchBones()
}

/** 首次孵化：用模型生成名字与性格并写入全局配置。失败则用确定性兜底。 */
export async function hatchCompanion(): Promise<Companion> {
  const bones = rollLaunchBones()
  let name = ''
  let personality = ''

  try {
    const cfg = getConfig()
    const provider = getProvider(cfg)
    const prompt = `给一只命令行宠物起名并赋予性格。它是一只"${bones.species}"，稀有度「${RARITY_LABEL[bones.rarity]}」，主要属性偏向：${Object.entries(
      bones.stats,
    )
      .sort((a, b) => b[1] - a[1])[0][0]}。
它陪伴一位程序员在终端里写代码。请输出严格 JSON：{"name":"一个简短有趣的名字","personality":"一句话性格描述"}。只输出 JSON。`
    let raw = ''
    for await (const ev of provider.stream({
      system: '你给虚拟宠物起名，输出严格 JSON。',
      messages: [textMessage('user', prompt)],
      tools: [],
      model: subagentModel(cfg),
      maxTokens: 200,
      thinking: { enabled: false },
    })) {
      if (ev.type === 'text') raw += ev.delta
    }
    const parsed = parseJson(raw)
    name = parsed?.name ?? ''
    personality = parsed?.personality ?? ''
  } catch {
    /* 兜底 */
  }

  if (!name) name = `${bones.species}-${buddyUserId().slice(-4)}`
  if (!personality) personality = '忠诚、机灵、爱在你写代码时偷瞄屏幕'

  saveGlobalConfig({
    buddy: {
      name,
      personality,
      hatchedAt: new Date().toISOString(),
    },
  })

  return { ...bones, name, personality }
}

function parseJson(raw: string): { name?: string; personality?: string } | null {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}
