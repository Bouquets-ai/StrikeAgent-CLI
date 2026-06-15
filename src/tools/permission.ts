import type { Tool } from './tool.js'
import type { PermissionMode } from '../config/index.js'

export type PermissionDecision = 'allow' | 'confirm' | 'deny'

/**
 * 根据权限模式与工具属性决定如何处理一次工具调用。
 * - plan：只允许只读工具，其余拒绝（让模型先规划）。
 * - default：只读工具直接放行，写/执行类需用户确认。
 * - auto：全部放行（高危命令仍由 Shell 工具内部二次确认）。
 */
export function decidePermission<I>(
  tool: Tool<I>,
  input: I,
  mode: PermissionMode,
): PermissionDecision {
  const readOnly = safeIsReadOnly(tool, input)

  if (mode === 'plan') {
    return readOnly ? 'allow' : 'deny'
  }
  if (mode === 'auto') {
    return 'allow'
  }
  // default
  if (readOnly) return 'allow'
  return tool.needsPermission(input) ? 'confirm' : 'allow'
}

function safeIsReadOnly<I>(tool: Tool<I>, input: I): boolean {
  try {
    return tool.isReadOnly(input)
  } catch {
    return false
  }
}

export const PLAN_MODE_DENY_MESSAGE =
  '当前处于计划模式（plan），只能使用只读工具。请先规划方案，待用户批准后切换到执行模式。'
