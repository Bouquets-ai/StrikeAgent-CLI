import fs from 'node:fs'
import dotenv from 'dotenv'
import {
  globalConfigPath,
  projectConfigPath,
  ensureDir,
  globalConfigDir,
} from './paths.js'
import { ensureGlobalScaffold } from './scaffold.js'

dotenv.config()

export type ProviderName = 'deepseek' | 'anthropic' | 'ollama'
export type PermissionMode = 'plan' | 'default' | 'auto'
/** 思考模式：on=始终思考（默认），off=从不思考。auto 为旧值，等同于 on。 */
export type ThinkingMode = 'auto' | 'on' | 'off'
/** 思考等级（effort），映射到思考预算 token。 */
export type EffortLevel = 'high' | 'max'

export interface BuddyConfig {
  /** 持久化的"灵魂"：名字与性格（骨架由 userId 确定性派生，不持久化）。 */
  name?: string
  personality?: string
  hatchedAt?: string
}

export interface StrikeConfig {
  provider: ProviderName
  /** 主模型（1M 上下文） */
  model: string
  /** 子代理/反思用的快速模型 */
  subagentModel: string
  /** Anthropic 兼容端点（DeepSeek/Claude） */
  baseUrl: string
  /** 鉴权 token（DeepSeek key 或 Anthropic key） */
  authToken: string
  /** Ollama 端点 */
  ollamaBaseUrl: string
  ollamaModel: string
  /** 模型上下文窗口（token），DeepSeek 1M 档位 */
  contextWindow: number
  /** 输出最大 token */
  maxTokens: number
  permissionMode: PermissionMode
  /** 思考模式 */
  thinkingMode: ThinkingMode
  /** 思考等级 */
  effort: EffortLevel
  /** 自动记忆与任务后反思开关 */
  autoMemory: boolean
  /** 命令行宠物开关 */
  buddyEnabled: boolean
  buddy: BuddyConfig
  /** 飞书凭证 */
  feishu: {
    appId: string
    appSecret: string
    /** 允许远程操控的 open_id 白名单（空表示允许所有该应用可见用户，谨慎使用） */
    allowList: string[]
  }
  /** 用户标识（用于宠物种子与记忆隔离） */
  userId: string
  /** MCP 服务器配置 */
  mcpServers: Record<string, McpServerConfig>
}

export interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

const DEEPSEEK_DEFAULT_BASE = 'https://api.deepseek.com/anthropic'

function defaults(): StrikeConfig {
  return {
    provider: 'deepseek',
    model: 'deepseek-v4-pro[1m]',
    subagentModel: 'deepseek-v4-flash',
    baseUrl: DEEPSEEK_DEFAULT_BASE,
    authToken: '',
    ollamaBaseUrl: 'http://localhost:11434/v1',
    ollamaModel: 'qwen2.5-coder:7b',
    contextWindow: 1_000_000,
    maxTokens: 16_384,
    permissionMode: 'default',
    // 思考默认始终开启；强度只分 high/max（不用 auto）。
    thinkingMode: 'on',
    effort: 'max',
    autoMemory: true,
    buddyEnabled: true,
    buddy: {},
    feishu: { appId: '', appSecret: '', allowList: [] },
    userId: '',
    mcpServers: {},
  }
}

function readJson(file: string): Partial<StrikeConfig> {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<StrikeConfig>
    }
  } catch {
    /* 忽略坏配置 */
  }
  return {}
}

/** 从环境变量（兼容 Claude Code）解析配置覆盖。 */
function fromEnv(): Partial<StrikeConfig> {
  const env = process.env
  const out: Partial<StrikeConfig> = {}

  const authToken = env.ANTHROPIC_AUTH_TOKEN || env.DEEPSEEK_API_KEY || env.ANTHROPIC_API_KEY
  if (authToken) out.authToken = authToken
  if (env.ANTHROPIC_BASE_URL) out.baseUrl = env.ANTHROPIC_BASE_URL
  if (env.ANTHROPIC_MODEL) out.model = env.ANTHROPIC_MODEL
  if (env.CLAUDE_CODE_SUBAGENT_MODEL || env.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
    out.subagentModel =
      env.CLAUDE_CODE_SUBAGENT_MODEL || env.ANTHROPIC_DEFAULT_HAIKU_MODEL!
  }
  if (env.OLLAMA_BASE_URL) out.ollamaBaseUrl = env.OLLAMA_BASE_URL
  if (env.OLLAMA_MODEL) out.ollamaModel = env.OLLAMA_MODEL
  // 兼容 Claude Code 的 effort 等级环境变量
  const effortEnv = (env.CLAUDE_CODE_EFFORT_LEVEL || '').toLowerCase()
  if (effortEnv === 'max' || effortEnv === 'high') out.effort = effortEnv as EffortLevel
  if (env.STRIKE_USE_OLLAMA === '1' || env.STRIKE_USE_OLLAMA === 'true') {
    out.provider = 'ollama'
  }

  const feishu: Partial<StrikeConfig['feishu']> = {}
  if (env.FEISHU_APP_ID) feishu.appId = env.FEISHU_APP_ID
  if (env.FEISHU_APP_SECRET) feishu.appSecret = env.FEISHU_APP_SECRET
  if (Object.keys(feishu).length) out.feishu = feishu as StrikeConfig['feishu']

  return out
}

let cached: StrikeConfig | null = null

/** 合并：默认 < 全局 < 项目 < 环境变量。 */
export function loadConfig(cwd: string = process.cwd()): StrikeConfig {
  if (cached) return cached
  // 首次加载时确保 ~/.strike 拥有完整脚手架（目录 + 示例 + 说明）。
  ensureGlobalScaffold()
  const base = defaults()
  const global = readJson(globalConfigPath())
  const project = readJson(projectConfigPath(cwd))
  const env = fromEnv()

  const merged: StrikeConfig = {
    ...base,
    ...global,
    ...project,
    ...env,
    buddy: { ...base.buddy, ...(global.buddy ?? {}), ...(project.buddy ?? {}) },
    feishu: {
      ...base.feishu,
      ...(global.feishu ?? {}),
      ...(project.feishu ?? {}),
      ...(env.feishu ?? {}),
    },
    mcpServers: {
      ...base.mcpServers,
      ...(global.mcpServers ?? {}),
      ...(project.mcpServers ?? {}),
    },
  }

  if (!merged.userId) {
    merged.userId = global.userId || generateUserId()
    // 首次生成的 userId 必须落盘，否则宠物骨架（由 userId 派生）每次运行都会变化
    if (!global.userId) {
      try {
        const file = globalConfigPath()
        const current = readJson(file)
        ensureDir(globalConfigDir())
        fs.writeFileSync(
          file,
          JSON.stringify({ ...current, userId: merged.userId }, null, 2),
          'utf8',
        )
      } catch {
        /* 落盘失败不影响运行 */
      }
    }
  }

  cached = merged
  return merged
}

export function getConfig(): StrikeConfig {
  return cached ?? loadConfig()
}

/** 把变更写入全局配置文件并刷新缓存。 */
export function saveGlobalConfig(patch: Partial<StrikeConfig>): StrikeConfig {
  const current = readJson(globalConfigPath())
  const next = { ...current, ...patch }
  ensureDir(globalConfigDir())
  fs.writeFileSync(globalConfigPath(), JSON.stringify(next, null, 2), 'utf8')
  cached = null
  return loadConfig()
}

/** 更新内存中的运行时配置（例如 REPL 中 /model 切换，不写盘）。 */
export function patchRuntimeConfig(patch: Partial<StrikeConfig>): StrikeConfig {
  cached = { ...getConfig(), ...patch }
  return cached
}

function generateUserId(): string {
  return 'strike-' + Math.random().toString(36).slice(2, 10)
}

/** 思考等级 → 思考预算 token。 */
export function effortBudget(effort: EffortLevel): number {
  return effort === 'max' ? 16_384 : 8_192
}

/** 当前生效模型对应的有效上下文窗口（识别 [1m] 后缀）。 */
export function effectiveContextWindow(cfg: StrikeConfig): number {
  if (cfg.provider === 'ollama') return 32_768
  if (/\[1m\]/i.test(cfg.model)) return 1_000_000
  return cfg.contextWindow
}
