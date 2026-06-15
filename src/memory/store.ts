import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { projectStoreDir } from '../config/paths.js'

export interface Experience {
  ts: number
  /** 一句话摘要 */
  summary: string
  /** 主题标签 */
  tags: string[]
  /** 详细经验（做对/做错/可复用模式） */
  content: string
  /** 可选向量（用于相似度召回） */
  embedding?: number[]
}

function experiencesFile(cwd: string): string {
  return path.join(projectStoreDir(cwd), 'experiences.jsonl')
}

function toolStatsFile(cwd: string): string {
  return path.join(projectStoreDir(cwd), 'tool-stats.json')
}

export async function appendExperience(
  exp: Experience,
  cwd: string = process.cwd(),
): Promise<void> {
  const file = experiencesFile(cwd)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.appendFile(file, JSON.stringify(exp) + '\n', 'utf8')
}

export function readExperiences(cwd: string = process.cwd()): Experience[] {
  const file = experiencesFile(cwd)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => {
      try {
        return JSON.parse(l) as Experience
      } catch {
        return null
      }
    })
    .filter((e): e is Experience => e !== null)
}

// -------------------- 工具使用统计（辅助决策 / 自进化） --------------------

export type ToolStats = Record<
  string,
  { calls: number; errors: number; lastUsed: number }
>

export function readToolStats(cwd: string = process.cwd()): ToolStats {
  const file = toolStatsFile(cwd)
  if (!fs.existsSync(file)) return {}
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ToolStats
  } catch {
    return {}
  }
}

export function recordToolUse(
  name: string,
  ok: boolean,
  cwd: string = process.cwd(),
): void {
  try {
    const stats = readToolStats(cwd)
    const entry = stats[name] ?? { calls: 0, errors: 0, lastUsed: 0 }
    entry.calls++
    if (!ok) entry.errors++
    entry.lastUsed = Date.now()
    stats[name] = entry
    const file = toolStatsFile(cwd)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(stats, null, 2), 'utf8')
  } catch {
    /* 统计失败不影响主流程 */
  }
}
