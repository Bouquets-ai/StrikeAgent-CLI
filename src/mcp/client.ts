import { z } from 'zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { defineTool, type Tool } from '../tools/tool.js'
import { truncateOutput } from '../tools/util.js'
import { getConfig, type McpServerConfig } from '../config/index.js'

interface ConnectedServer {
  name: string
  client: Client
  tools: Tool[]
}

const connected: ConnectedServer[] = []

/** 已连接 MCP 服务器暴露的全部工具。 */
export function getMcpTools(): Tool[] {
  return connected.flatMap(s => s.tools)
}

export function mcpStatus(): { name: string; toolCount: number }[] {
  return connected.map(s => ({ name: s.name, toolCount: s.tools.length }))
}

/** 连接所有配置中的 MCP 服务器（在启动时调用一次）。失败的服务器跳过。 */
export async function connectConfiguredMcpServers(): Promise<string[]> {
  const cfg = getConfig()
  const log: string[] = []
  for (const [name, server] of Object.entries(cfg.mcpServers)) {
    try {
      await connectOne(name, server)
      log.push(`MCP "${name}" 已连接（${connected.find(c => c.name === name)?.tools.length ?? 0} 个工具）`)
    } catch (e) {
      log.push(`MCP "${name}" 连接失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return log
}

async function connectOne(name: string, server: McpServerConfig): Promise<void> {
  if (connected.some(c => c.name === name)) return
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: { ...process.env, ...(server.env ?? {}) } as Record<string, string>,
  })
  const client = new Client(
    { name: 'strikeagent-cli', version: '0.1.0' },
    { capabilities: {} },
  )
  await client.connect(transport)
  const list = await client.listTools()
  const tools = list.tools.map(t => wrapMcpTool(name, client, t))
  connected.push({ name, client, tools })
}

function wrapMcpTool(
  serverName: string,
  client: Client,
  def: { name: string; description?: string; inputSchema?: unknown },
): Tool {
  const rawSchema = (def.inputSchema as Record<string, unknown>) ?? {
    type: 'object',
    properties: {},
  }
  return defineTool({
    name: `mcp__${serverName}__${def.name}`,
    description: def.description ?? `MCP 工具 ${def.name}`,
    prompt: `来自 MCP 服务器 "${serverName}" 的工具。`,
    inputSchema: z.record(z.unknown()),
    rawSchema,
    isReadOnly: () => false,
    needsPermission: () => true,
    renderInput: () => def.name,
    async execute(input) {
      const res = await client.callTool({
        name: def.name,
        arguments: input as Record<string, unknown>,
      })
      const content = Array.isArray(res.content)
        ? res.content
            .map((c: { type: string; text?: string }) =>
              c.type === 'text' ? c.text ?? '' : JSON.stringify(c),
            )
            .join('\n')
        : JSON.stringify(res.content)
      return {
        content: truncateOutput(content),
        isError: Boolean(res.isError),
      }
    },
  }) as Tool
}

export async function disconnectAllMcp(): Promise<void> {
  for (const s of connected) {
    await s.client.close().catch(() => {})
  }
  connected.length = 0
}
