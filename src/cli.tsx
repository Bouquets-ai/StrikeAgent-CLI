import React from 'react'
import { render } from 'ink'
import { Command } from 'commander'
import { App } from './ui/App.js'
import {
  loadConfig,
  getConfig,
  saveGlobalConfig,
  patchRuntimeConfig,
  type ProviderName,
  type PermissionMode,
} from './config/index.js'
import { connectConfiguredMcpServers } from './mcp/client.js'
import { drainReflection, reflectAfterTask } from './memory/reflect.js'
import { runDoctor } from './core/doctor.js'
import { AgentSession } from './core/agent.js'
import { previewBones, getCompanion } from './buddy/soul.js'
import { RARITY_LABEL } from './buddy/types.js'
import { loadSession, listSessions } from './session/session.js'
import { scanSkills } from './skills/skills.js'
import { scanAgents } from './agents/agents.js'
import { startFeishuRemote } from './remote/feishu.js'
import type { PermissionRequest } from './tools/tool.js'
import { AUTHOR, COPYRIGHT } from './core/watermark.js'

const program = new Command()

program
  .name('strike')
  .description(`StrikeAgent-CLI — 命令行 AI 编程助手（DeepSeek 1M / Ollama）\n${COPYRIGHT}`)
  .version(`0.1.0 · Powered by ${AUTHOR}`)

// 主命令：进入交互式 REPL
program
  .argument('[message...]', '直接发送一条消息（非交互打印模式需配合 -p）')
  .option('-p, --print', '非交互模式：打印结果后退出')
  .option('-m, --model <model>', '指定模型名')
  .option('--provider <name>', '指定后端 deepseek|ollama|anthropic')
  .option('--plan', '以计划模式启动（只读）')
  .option('--auto', '以自动模式启动（不确认）')
  .option(
    '--permission-mode <mode>',
    '权限模式：default | plan | acceptEdits | bypassPermissions（兼容 Claude，bypassPermissions=放行所有操作）',
  )
  .option('-r, --resume [id]', '恢复上一个或指定会话')
  .option('--remote', '同时启动飞书远程操控')
  .action(async (message: string[], opts) => {
    loadConfig()
    applyCliOptions(opts)

    // 非交互打印模式
    if (opts.print) {
      const text = message.join(' ').trim()
      if (!text) {
        console.error('请提供消息内容，例如：strike -p "总结 README"')
        process.exit(1)
      }
      await runPrintMode(text)
      return
    }

    // 交互式 REPL 需要 TTY（raw mode）。非 TTY 环境引导用打印模式。
    if (!process.stdin.isTTY) {
      console.error(
        '当前环境不是交互式终端（无法进入 REPL）。\n' +
          '请在真实终端中运行 `strike`，或使用非交互模式：strike -p "你的指令"',
      )
      process.exit(1)
    }

    // 连接 MCP（静默）
    await connectConfiguredMcpServers().catch(() => {})

    // 恢复会话：-r <id> 直接恢复指定会话；-r 不带 id 则在界面里列出会话供选择
    let initialSession
    let resumeSessions
    if (opts.resume) {
      if (typeof opts.resume === 'string') {
        initialSession = loadSession(opts.resume)
        if (!initialSession) console.log('未找到该会话，将开启新会话。')
      } else {
        resumeSessions = listSessions()
        if (!resumeSessions.length)
          console.log('当前项目暂无历史会话，将开启新会话。')
      }
    }

    if (opts.remote) {
      startFeishuRemote(new AgentSession(process.cwd()), process.cwd()).catch(e =>
        console.error('飞书远程启动失败:', e.message),
      )
    }

    const { waitUntilExit } = render(
      <App
        cwd={process.cwd()}
        initialSession={initialSession}
        resumeSessions={resumeSessions}
      />,
    )
    await waitUntilExit()
    await drainReflection(15_000)
  })

// 配置子命令
program
  .command('config')
  .description('查看或修改配置')
  .argument('[action]', 'show | set')
  .argument('[key]', '配置键')
  .argument('[value]', '配置值')
  .action((action?: string, key?: string, value?: string) => {
    loadConfig()
    if (!action || action === 'show') {
      const cfg = getConfig()
      const safe = { ...cfg, authToken: cfg.authToken ? '***已设置***' : '(空)' }
      console.log(JSON.stringify(safe, null, 2))
      return
    }
    if (action === 'set' && key && value !== undefined) {
      const patch = buildConfigPatch(key, value)
      saveGlobalConfig(patch)
      console.log(`已设置 ${key} = ${value}`)
      return
    }
    console.log('用法：strike config show | strike config set <key> <value>')
    console.log('可设置键：authToken, model, subagentModel, baseUrl, provider, ollamaModel, ollamaBaseUrl, feishuAppId, feishuAppSecret, permissionMode')
  })

// 宠物属性卡 / 改名
program
  .command('buddy')
  .description('查看命令行伙伴；buddy rename <名字> 可改名')
  .argument('[action]', 'rename')
  .argument('[name]', '新名字')
  .action((action?: string, name?: string) => {
    loadConfig()
    if (action === 'rename' && name) {
      const cfg = getConfig()
      saveGlobalConfig({ buddy: { ...cfg.buddy, name } })
      console.log(`已把伙伴改名为「${name}」`)
      return
    }
    const c = getCompanion() ?? { ...previewBones(), name: '(未孵化，启动 REPL 后自动孵化)', personality: '' }
    console.log(`\n⚡ StrikeBuddy ⚡`)
    console.log(`名字：${c.name}${c.shiny ? ' ✨' : ''}`)
    console.log(`物种：${c.species}  稀有度：${RARITY_LABEL[c.rarity]}`)
    if ('personality' in c && c.personality) console.log(`性格：${c.personality}`)
    console.log('属性：')
    for (const [k, v] of Object.entries(c.stats)) console.log(`  ${k}: ${v}`)
    console.log()
  })

// 自检
program
  .command('doctor')
  .description('环境与连通性自检')
  .action(async () => {
    loadConfig()
    const results = await runDoctor()
    for (const r of results) {
      console.log(`${r.ok ? '✔' : '✖'} ${r.label}: ${r.detail}`)
    }
    process.exit(results.every(r => r.ok) ? 0 : 1)
  })

// 仅启动飞书远程（无 TUI，适合后台/服务器）
program
  .command('remote')
  .description('仅启动飞书远程操控（无界面，常驻）')
  .action(async () => {
    loadConfig()
    const cfg = getConfig()
    if (!cfg.feishu.appId || !cfg.feishu.appSecret) {
      console.error('请先配置飞书凭证：strike config set feishuAppId <id>; strike config set feishuAppSecret <secret>')
      process.exit(1)
    }
    await connectConfiguredMcpServers().catch(() => {})
    console.log('⚡ 正在启动飞书远程操控… 在飞书中给应用发消息即可操控本机 StrikeAgent。')
    await startFeishuRemote(new AgentSession(process.cwd()), process.cwd())
    console.log('已连接。按 Ctrl+C 退出。')
    await new Promise(() => {}) // 常驻
  })

// 列出技能
program
  .command('skills')
  .description('列出可用技能（Skill）')
  .action(() => {
    loadConfig()
    const list = scanSkills()
    if (!list.length) {
      console.log('没有可用技能。在 .strike/skills/<名字>/SKILL.md 或 ~/.strike/skills/ 下创建。')
      return
    }
    console.log(`共 ${list.length} 个技能：\n`)
    for (const s of list) {
      console.log(`• ${s.name} [${s.source}]`)
      console.log(`  ${s.description}`)
      console.log(`  ${s.file}\n`)
    }
  })

// 列出子智能体
program
  .command('agents')
  .description('列出可用子智能体（Subagent）')
  .action(() => {
    loadConfig()
    const list = scanAgents()
    if (!list.length) {
      console.log(
        '没有可用子智能体。在 .strike/agents/<名字>.md 或 ~/.strike/agents/ 下创建。',
      )
      return
    }
    console.log(`共 ${list.length} 个子智能体：\n`)
    for (const a of list) {
      console.log(`• ${a.name} [${a.source}] (模型: ${a.model})`)
      console.log(`  ${a.description}`)
      console.log(`  ${a.file}\n`)
    }
  })

// 列出会话
program
  .command('sessions')
  .description('列出可恢复的历史会话')
  .action(() => {
    loadConfig()
    const list = listSessions()
    if (!list.length) {
      console.log('暂无历史会话')
      return
    }
    for (const s of list.slice(0, 20)) {
      console.log(`${s.id}  ${new Date(s.updatedAt).toLocaleString()}  ${s.title}`)
    }
  })

/** 把 Claude 风格的权限模式名映射到内部三档（plan/default/auto）。 */
export function mapPermissionMode(s: string): PermissionMode | undefined {
  switch (s.toLowerCase()) {
    case 'plan':
      return 'plan'
    case 'default':
      return 'default'
    case 'auto':
    case 'accept':
    case 'acceptedits':
    case 'bypass':
    case 'bypasspermissions':
      return 'auto'
    default:
      return undefined
  }
}

function applyCliOptions(opts: {
  model?: string
  provider?: string
  plan?: boolean
  auto?: boolean
  permissionMode?: string
}): void {
  const patch: Record<string, unknown> = {}
  if (opts.provider) patch.provider = opts.provider as ProviderName
  if (opts.model) {
    const cfg = getConfig()
    if ((opts.provider ?? cfg.provider) === 'ollama') patch.ollamaModel = opts.model
    else patch.model = opts.model
  }
  if (opts.plan) patch.permissionMode = 'plan' as PermissionMode
  if (opts.auto) patch.permissionMode = 'auto' as PermissionMode
  if (opts.permissionMode) {
    const mapped = mapPermissionMode(opts.permissionMode)
    if (mapped) patch.permissionMode = mapped
    else console.error(`未知权限模式 "${opts.permissionMode}"，可选：default | plan | acceptEdits | bypassPermissions`)
  }
  if (Object.keys(patch).length) patchRuntimeConfig(patch)
}

function buildConfigPatch(key: string, value: string): Record<string, unknown> {
  switch (key) {
    case 'feishuAppId':
      return { feishu: { ...getConfig().feishu, appId: value } }
    case 'feishuAppSecret':
      return { feishu: { ...getConfig().feishu, appSecret: value } }
    default:
      return { [key]: value }
  }
}

async function runPrintMode(text: string): Promise<void> {
  await connectConfiguredMcpServers().catch(() => {})
  const session = new AgentSession(process.cwd())
  const ctrl = new AbortController()
  const requestPermission = async (req: PermissionRequest): Promise<boolean> =>
    req.danger !== 'high'
  const { finalText } = await session.run(text, {
    signal: ctrl.signal,
    requestPermission,
  })
  console.log(finalText)
  reflectAfterTask(session.messages, process.cwd())
  await drainReflection(20_000)
  process.exit(0)
}

program.parseAsync(process.argv).catch(e => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
