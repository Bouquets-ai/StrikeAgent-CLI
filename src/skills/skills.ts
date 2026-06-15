import fs from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'
import { parse as parseYaml } from 'yaml'
import { projectConfigDir, globalConfigDir } from '../config/paths.js'

export interface SkillMeta {
  name: string
  description: string
  /** SKILL.md 绝对路径 */
  file: string
  /** skill 所在目录 */
  dir: string
  /** 来源：project | global | claude */
  source: string
}

/** 扫描根目录及其来源标签（仅 StrikeAgent 自有目录）。 */
function skillRoots(cwd: string): { root: string; source: string }[] {
  const roots = [
    { root: path.join(projectConfigDir(cwd), 'skills'), source: 'project' },
    { root: path.join(globalConfigDir(), 'skills'), source: 'global' },
  ]
  return roots.filter(r => fs.existsSync(r.root))
}

let cache: SkillMeta[] | null = null

/** 解析单个 SKILL.md 的 frontmatter，得到 name/description。 */
function parseSkillFile(file: string): { name: string; description: string } {
  let content = ''
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return { name: path.basename(path.dirname(file)), description: '' }
  }
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/)
  let name = ''
  let description = ''
  if (fm) {
    try {
      const data = parseYaml(fm[1]) as { name?: string; description?: string }
      name = (data?.name ?? '').trim()
      description = (data?.description ?? '').trim()
    } catch {
      /* frontmatter 解析失败，走兜底 */
    }
  }
  if (!name) name = path.basename(path.dirname(file))
  if (!description) {
    const heading = content.match(/^#\s+(.+)$/m)
    description = heading ? heading[1].trim() : '(无描述)'
  }
  return { name, description }
}

/** 扫描所有技能（结果缓存）。 */
export function scanSkills(cwd: string = process.cwd()): SkillMeta[] {
  if (cache) return cache
  const found: SkillMeta[] = []
  const seen = new Set<string>()

  for (const { root, source } of skillRoots(cwd)) {
    let files: string[] = []
    try {
      files = fg.sync('**/SKILL.md', {
        cwd: root,
        absolute: true,
        deep: 4,
        suppressErrors: true,
        caseSensitiveMatch: false,
      })
    } catch {
      files = []
    }
    for (const file of files) {
      const { name, description } = parseSkillFile(file)
      if (seen.has(name)) continue // 高优先级来源先入为主
      seen.add(name)
      found.push({ name, description, file, dir: path.dirname(file), source })
    }
  }

  cache = found
  return found
}

export function findSkill(
  name: string,
  cwd: string = process.cwd(),
): SkillMeta | undefined {
  const all = scanSkills(cwd)
  return (
    all.find(s => s.name === name) ||
    all.find(s => s.name.toLowerCase() === name.toLowerCase())
  )
}

/** 把可用技能格式化为系统提示片段。 */
export function formatSkillsForPrompt(cwd: string = process.cwd()): string {
  const skills = scanSkills(cwd)
  if (!skills.length) return ''
  const lines = skills
    .map(s => `- ${s.name}: ${truncate(s.description, 200)}`)
    .join('\n')
  return `# 可用技能 (Skills)\n当某个技能与当前任务相关时，调用 Skill 工具（传入技能名）加载其完整说明并严格遵循。可用技能：\n${lines}`
}

export function resetSkillsCache(): void {
  cache = null
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
