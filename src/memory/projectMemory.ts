import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { projectConfigDir, globalMemoryPath } from '../config/paths.js'

const MAX_MEMORY_BYTES = 25_000
const MAX_MEMORY_LINES = 400

/** 项目记忆主文件路径 <cwd>/.strike/MEMORY.md */
export function memoryFilePath(cwd: string = process.cwd()): string {
  return path.join(projectConfigDir(cwd), 'MEMORY.md')
}

/** 兼容读取的其它记忆来源（项目根）。 */
function legacyMemoryFiles(cwd: string): string[] {
  return [
    path.join(cwd, 'STRIKE.md'),
    path.join(cwd, 'AGENTS.md'),
    path.join(cwd, 'CLAUDE.md'),
  ]
}

/** 读取全局指令 ~/.strike/STRIKE.md 的有效内容（去掉 HTML 注释后非空才返回）。 */
function getGlobalMemory(): string {
  try {
    const file = globalMemoryPath()
    if (!fs.existsSync(file)) return ''
    const raw = fs.readFileSync(file, 'utf8')
    const stripped = raw.replace(/<!--[\s\S]*?-->/g, '').trim()
    return stripped ? raw.trim() : ''
  } catch {
    return ''
  }
}

/** 读取并合并所有项目记忆来源，带行/字节截断。 */
export function getProjectMemory(cwd: string = process.cwd()): string {
  const parts: string[] = []
  const global = getGlobalMemory()
  if (global) {
    parts.push(`# 全局指令 (~/.strike/STRIKE.md，适用于所有项目)\n${global}`)
  }
  const main = memoryFilePath(cwd)
  if (fs.existsSync(main)) {
    parts.push(`# 项目记忆 (.strike/MEMORY.md)\n${fs.readFileSync(main, 'utf8')}`)
  }
  for (const f of legacyMemoryFiles(cwd)) {
    if (fs.existsSync(f)) {
      parts.push(`# ${path.basename(f)}\n${fs.readFileSync(f, 'utf8')}`)
    }
  }
  let combined = parts.join('\n\n')
  if (combined.length > MAX_MEMORY_BYTES) {
    combined = combined.slice(0, MAX_MEMORY_BYTES) + '\n... [记忆已截断]'
  }
  const lines = combined.split('\n')
  if (lines.length > MAX_MEMORY_LINES) {
    combined = lines.slice(0, MAX_MEMORY_LINES).join('\n') + '\n... [记忆行数已截断]'
  }
  return combined
}

export function hasProjectMemory(cwd: string = process.cwd()): boolean {
  if (fs.existsSync(memoryFilePath(cwd))) return true
  return legacyMemoryFiles(cwd).some(f => fs.existsSync(f))
}

/** 追加一段内容到项目 MEMORY.md（自动维护用）。 */
export async function appendProjectMemory(
  section: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const file = memoryFilePath(cwd)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const header = fs.existsSync(file) ? '' : '# 项目记忆 (StrikeAgent)\n\n'
  await fsp.appendFile(file, `${header}${section.trim()}\n\n`, 'utf8')
}

export async function writeProjectMemory(
  content: string,
  cwd: string = process.cwd(),
): Promise<void> {
  const file = memoryFilePath(cwd)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, content, 'utf8')
}
