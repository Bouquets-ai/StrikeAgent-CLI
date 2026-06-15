// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
import fs from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'
import { parse as parseYaml } from 'yaml'
import { projectConfigDir, globalConfigDir } from '../config/paths.js'

/** 子智能体（subagent）定义，来自 agents/ 目录下的 *.md 文件。 */
export interface AgentMeta {
  name: string
  description: string
  /** 子智能体的角色/系统指令（frontmatter 之后的正文）。 */
  instructions: string
  /** 期望模型：main=主模型，fast=快速模型（默认 fast）。 */
  model: 'main' | 'fast'
  /** 定义文件绝对路径 */
  file: string
  /** 来源：project | global | claude */
  source: string
}

/**
 * 子智能体扫描根目录（按优先级，仅 StrikeAgent 自有目录）：
 * 1. 项目级 <cwd>/.strike/agents
 * 2. 全局   ~/.strike/agents
 */
function agentRoots(cwd: string): { root: string; source: string }[] {
  const roots = [
    { root: path.join(projectConfigDir(cwd), 'agents'), source: 'project' },
    { root: path.join(globalConfigDir(), 'agents'), source: 'global' },
  ]
  return roots.filter(r => fs.existsSync(r.root))
}

let cache: AgentMeta[] | null = null

/** 解析单个子智能体定义文件。 */
function parseAgentFile(file: string): Omit<AgentMeta, 'file' | 'source'> {
  let content = ''
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return {
      name: path.basename(file).replace(/\.md$/i, ''),
      description: '',
      instructions: '',
      model: 'fast',
    }
  }

  let name = ''
  let description = ''
  let model: 'main' | 'fast' = 'fast'
  let body = content

  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (fm) {
    try {
      const data = parseYaml(fm[1]) as {
        name?: string
        description?: string
        model?: string
      }
      name = (data?.name ?? '').trim()
      description = (data?.description ?? '').trim()
      const m = (data?.model ?? '').toString().toLowerCase()
      if (m === 'main' || m === 'fast') model = m
    } catch {
      /* frontmatter 解析失败，走兜底 */
    }
    body = content.slice(fm[0].length)
  }

  if (!name) name = path.basename(file).replace(/\.md$/i, '')
  if (!description) {
    const heading = body.match(/^#\s+(.+)$/m)
    description = heading ? heading[1].trim() : '(无描述)'
  }

  return { name, description, instructions: body.trim(), model }
}

/** 扫描所有可用子智能体（结果缓存，高优先级来源先入为主）。 */
export function scanAgents(cwd: string = process.cwd()): AgentMeta[] {
  if (cache) return cache
  const found: AgentMeta[] = []
  const seen = new Set<string>()

  for (const { root, source } of agentRoots(cwd)) {
    let files: string[] = []
    try {
      files = fg.sync('**/*.md', {
        cwd: root,
        absolute: true,
        deep: 3,
        suppressErrors: true,
        caseSensitiveMatch: false,
      })
    } catch {
      files = []
    }
    for (const file of files) {
      // 跳过纯说明文档（README/_ 开头），它们不是子智能体定义。
      const base = path.basename(file).toLowerCase()
      if (base === 'readme.md' || base.startsWith('_')) continue
      const meta = parseAgentFile(file)
      const key = meta.name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ ...meta, file, source })
    }
  }

  cache = found
  return found
}

export function findAgent(
  name: string,
  cwd: string = process.cwd(),
): AgentMeta | undefined {
  const all = scanAgents(cwd)
  return (
    all.find(a => a.name === name) ||
    all.find(a => a.name.toLowerCase() === name.toLowerCase())
  )
}

/** 把可用子智能体格式化为系统提示片段。 */
export function formatAgentsForPrompt(cwd: string = process.cwd()): string {
  const agents = scanAgents(cwd)
  if (!agents.length) return ''
  const lines = agents
    .map(a => `- ${a.name}: ${truncate(a.description, 200)}`)
    .join('\n')
  return `# 可用子智能体 (Subagents)\n当某个子任务适合交给专门的子智能体时，调用 Task 工具并传入 subagent_type=<名字> 以使用对应角色与指令。可用子智能体：\n${lines}`
}

export function resetAgentsCache(): void {
  cache = null
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
