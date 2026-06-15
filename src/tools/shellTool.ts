// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
import { z } from 'zod'
import { spawn } from 'node:child_process'
import os from 'node:os'
import { defineTool, type Tool } from './tool.js'
import { truncateOutput } from './util.js'

const isWindows = os.platform() === 'win32'

/** 只读命令前缀白名单（不修改文件系统/状态）。 */
const READONLY_PREFIXES = [
  'ls',
  'dir',
  'cat',
  'type',
  'head',
  'tail',
  'pwd',
  'echo',
  'find',
  'grep',
  'rg',
  'wc',
  'stat',
  'git status',
  'git log',
  'git diff',
  'git show',
  'git branch',
  'node --version',
  'npm list',
  'npm view',
  'which',
  'where',
  'whoami',
  'date',
  'env',
]

/** 高危命令模式（需重点确认）。 */
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\b/i,
  /\bremove-item\b.*-recurse/i,
  /\bdel\s+\/[sf]/i,
  /\bformat\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{.*\}/, // fork bomb
  />\s*\/dev\/sd/i,
  /\bshutdown\b|\breboot\b/i,
  /\bcurl\b.*\|\s*(sh|bash|powershell)/i,
  /\biwr\b.*\|\s*iex/i,
  /\bInvoke-Expression\b/i,
]

function isReadOnlyCommand(cmd: string): boolean {
  const trimmed = cmd.trim().toLowerCase()
  return READONLY_PREFIXES.some(
    p => trimmed === p || trimmed.startsWith(p + ' '),
  )
}

function dangerLevel(cmd: string): 'low' | 'medium' | 'high' {
  if (DANGEROUS_PATTERNS.some(re => re.test(cmd))) return 'high'
  if (isReadOnlyCommand(cmd)) return 'low'
  return 'medium'
}

export const ShellTool = defineTool({
  name: 'Shell',
  description: isWindows
    ? '执行 PowerShell 命令（Windows）。'
    : '执行 shell 命令（bash/sh）。',
  prompt: `执行系统命令并返回标准输出/错误。当前平台：${os.platform()}。${
    isWindows ? '命令通过 PowerShell 执行。' : ''
  }避免长时间运行或交互式命令。高危命令（删除/格式化/远程执行）会要求确认。`,
  inputSchema: z.object({
    command: z.string().describe('要执行的命令'),
    timeout_ms: z.number().int().optional().describe('超时（毫秒，默认 120000）'),
  }),
  isReadOnly: i => isReadOnlyCommand(i.command),
  needsPermission: i => !isReadOnlyCommand(i.command),
  renderInput: i => i.command,
  async execute(input, ctx) {
    const danger = dangerLevel(input.command)
    if (danger === 'high') {
      const ok = await ctx.requestPermission({
        toolName: 'Shell',
        description: `高危命令: ${input.command}`,
        danger: 'high',
      })
      if (!ok) return { content: '用户拒绝执行该命令', isError: true }
    }

    const timeout = input.timeout_ms ?? 120_000
    const [shell, args] = isWindows
      ? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', input.command]]
      : ['/bin/sh', ['-c', input.command]]

    return await new Promise<{ content: string; isError?: boolean; summary?: string }>(
      resolve => {
        const child = spawn(shell as string, args as string[], {
          cwd: ctx.cwd,
          signal: ctx.signal,
        })
        let out = ''
        let err = ''
        const timer = setTimeout(() => {
          child.kill()
          resolve({
            content: truncateOutput(out + err) + `\n[超时 ${timeout}ms 已终止]`,
            isError: true,
          })
        }, timeout)

        child.stdout.on('data', d => (out += d.toString()))
        child.stderr.on('data', d => (err += d.toString()))
        child.on('error', e => {
          clearTimeout(timer)
          resolve({ content: `命令执行失败: ${e.message}`, isError: true })
        })
        child.on('close', code => {
          clearTimeout(timer)
          const combined = [out, err].filter(Boolean).join('\n').trim()
          resolve({
            content: truncateOutput(combined || `(无输出，退出码 ${code})`),
            isError: code !== 0,
            summary: `$ ${input.command.slice(0, 60)} → 退出码 ${code}`,
          })
        })
      },
    )
  },
}) as Tool
