import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ToolSchema } from '../providers/types.js'

export interface ToolContext {
  cwd: string
  signal: AbortSignal
  /** 是否为子代理上下文（子代理禁止再派生子代理、禁止远程等）。 */
  isSubagent?: boolean
  /** 请求一次工具权限确认；返回 true 表示允许。 */
  requestPermission: (req: PermissionRequest) => Promise<boolean>
  /** 派生一个子代理执行独立子任务（Task 工具用）。由 agent 注入。 */
  runSubagent?: (
    prompt: string,
    signal: AbortSignal,
    label?: string,
    options?: SubagentOptions,
  ) => Promise<string>
}

/** 子智能体可选项：角色指令与模型档位。 */
export interface SubagentOptions {
  /** 子智能体的角色/系统指令（来自 agents/ 定义）。 */
  instructions?: string
  /** 模型档位：main=主模型，fast=快速模型（默认 fast）。 */
  model?: 'main' | 'fast'
}

export interface PermissionRequest {
  toolName: string
  description: string
  /** 危险等级，用于 UI 高亮 */
  danger: 'low' | 'medium' | 'high'
}

export interface ToolResult {
  content: string
  isError?: boolean
  /** 供 UI 展示的简短摘要 */
  summary?: string
}

// 默认泛型用 any：工具集合需要异构存放（Tool[]），而 I 出现在函数参数位（逆变），
// 用 any 让具体工具可赋值给 Tool，同时保留各自定义处的精确类型推断。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Tool<I = any> {
  name: string
  description: string
  /** 给模型看的详细使用说明（拼进 description）。 */
  prompt: string
  inputSchema: z.ZodType<I>
  /** 只读工具不触发权限确认、可在 plan 模式下执行。 */
  isReadOnly: (input: I) => boolean
  /** 是否需要权限确认（受权限模式影响）。 */
  needsPermission: (input: I) => boolean
  execute: (input: I, ctx: ToolContext) => Promise<ToolResult>
  /** 一行渲染（UI 显示工具调用时用）。 */
  renderInput?: (input: I) => string
  /** 直接提供 JSON Schema（MCP 工具用），优先于 zod 转换。 */
  rawSchema?: Record<string, unknown>
}

export function defineTool<I>(tool: Tool<I>): Tool<I> {
  return tool
}

/** 把工具转成 provider 需要的 JSON Schema。 */
export function toToolSchema(tool: Tool): ToolSchema {
  if (tool.rawSchema) {
    return {
      name: tool.name,
      description: `${tool.description}\n\n${tool.prompt}`.trim(),
      input_schema: tool.rawSchema,
    }
  }
  const json = zodToJsonSchema(tool.inputSchema, {
    target: 'openApi3',
    $refStrategy: 'none',
  }) as Record<string, unknown>
  // 去掉 $schema 等无关字段
  delete (json as { $schema?: unknown }).$schema
  return {
    name: tool.name,
    description: `${tool.description}\n\n${tool.prompt}`.trim(),
    input_schema: json,
  }
}

export function safeParseInput<I>(
  tool: Tool<I>,
  input: unknown,
): { ok: true; data: I } | { ok: false; error: string } {
  const res = tool.inputSchema.safeParse(input)
  if (res.success) return { ok: true, data: res.data }
  return {
    ok: false,
    error: res.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
  }
}
