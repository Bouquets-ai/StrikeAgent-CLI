import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

/** 全局配置目录，默认 ~/.strike，可用 STRIKE_CONFIG_DIR 覆盖。 */
export function globalConfigDir(): string {
  const custom = process.env.STRIKE_CONFIG_DIR
  const dir = custom && custom.trim() ? custom : path.join(os.homedir(), '.strike')
  ensureDir(dir)
  return dir
}

export function globalConfigPath(): string {
  return path.join(globalConfigDir(), 'config.json')
}

/** 项目级配置目录 <cwd>/.strike */
export function projectConfigDir(cwd: string = process.cwd()): string {
  return path.join(cwd, '.strike')
}

export function projectConfigPath(cwd: string = process.cwd()): string {
  return path.join(projectConfigDir(cwd), 'config.json')
}

/** 全局技能目录 ~/.strike/skills */
export function globalSkillsDir(): string {
  return path.join(globalConfigDir(), 'skills')
}

/** 项目级技能目录 <cwd>/.strike/skills */
export function projectSkillsDir(cwd: string = process.cwd()): string {
  return path.join(projectConfigDir(cwd), 'skills')
}

/** 全局子智能体目录 ~/.strike/agents */
export function globalAgentsDir(): string {
  return path.join(globalConfigDir(), 'agents')
}

/** 项目级子智能体目录 <cwd>/.strike/agents */
export function projectAgentsDir(cwd: string = process.cwd()): string {
  return path.join(projectConfigDir(cwd), 'agents')
}

/** 全局计划目录 ~/.strike/plans */
export function globalPlansDir(): string {
  return path.join(globalConfigDir(), 'plans')
}

/** 项目级计划目录 <cwd>/.strike/plans */
export function projectPlansDir(cwd: string = process.cwd()): string {
  return path.join(projectConfigDir(cwd), 'plans')
}

/** 全局指令/记忆文件 ~/.strike/STRIKE.md（注入到所有项目）。 */
export function globalMemoryPath(): string {
  return path.join(globalConfigDir(), 'STRIKE.md')
}

/** 把项目路径转成安全 slug，用于全局记忆/会话存储分项目隔离。 */
export function projectSlug(cwd: string = process.cwd()): string {
  return cwd.replace(/[:\\/]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

/** 全局按项目隔离的存储目录 ~/.strike/projects/<slug>/ */
export function projectStoreDir(cwd: string = process.cwd()): string {
  const dir = path.join(globalConfigDir(), 'projects', projectSlug(cwd))
  ensureDir(dir)
  return dir
}

/** 项目自动记忆目录 ~/.strike/projects/<slug>/memory/ */
export function autoMemoryDir(cwd: string = process.cwd()): string {
  const dir = path.join(projectStoreDir(cwd), 'memory')
  ensureDir(dir)
  return dir
}

/** 会话持久化目录 ~/.strike/projects/<slug>/sessions/ */
export function sessionsDir(cwd: string = process.cwd()): string {
  const dir = path.join(projectStoreDir(cwd), 'sessions')
  ensureDir(dir)
  return dir
}

/** 检查点目录 ~/.strike/projects/<slug>/checkpoints/ */
export function checkpointsDir(cwd: string = process.cwd()): string {
  const dir = path.join(projectStoreDir(cwd), 'checkpoints')
  ensureDir(dir)
  return dir
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}
