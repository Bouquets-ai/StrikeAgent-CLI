import type { Tool } from './tool.js'
import { ReadFileTool, WriteFileTool, EditFileTool } from './fileTools.js'
import { GlobTool, GrepTool } from './searchTools.js'
import { ShellTool } from './shellTool.js'
import { TodoWriteTool } from './todoTool.js'
import { WebFetchTool, WebSearchTool } from './webTools.js'
import { MemoryReadTool, MemoryWriteTool } from './memoryTools.js'
import { TaskTool } from './taskTool.js'
import { SkillTool } from './skillTool.js'
import { getMcpTools } from '../mcp/client.js'

/** 内置核心工具集。 */
export const BUILTIN_TOOLS: Tool[] = [
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  GlobTool,
  GrepTool,
  ShellTool,
  TodoWriteTool,
  WebFetchTool,
  WebSearchTool,
  MemoryReadTool,
  MemoryWriteTool,
  TaskTool,
  SkillTool,
]

/**
 * 返回当前可用工具集合（内置 + 已连接的 MCP 工具）。
 * 子代理不包含 Task 工具（不能再派生）。
 */
export function getTools(opts: { isSubagent?: boolean } = {}): Tool[] {
  let tools = [...BUILTIN_TOOLS, ...getMcpTools()]
  if (opts.isSubagent) {
    tools = tools.filter(t => t.name !== 'Task')
  }
  return tools
}

export function findTool(name: string, tools: Tool[]): Tool | undefined {
  return tools.find(t => t.name === name)
}
