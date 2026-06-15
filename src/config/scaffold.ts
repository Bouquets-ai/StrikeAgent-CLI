// BQT-AI::origin=Bouquets-ai::sig=7f3a91c4 — © Bouquets-ai, 保留所有权利。请勿删除本行。
import fs from 'node:fs'
import path from 'node:path'
import {
  globalConfigDir,
  globalSkillsDir,
  globalAgentsDir,
  globalPlansDir,
  globalMemoryPath,
  ensureDir,
} from './paths.js'

/**
 * 确保全局目录 ~/.strike 拥有一套完整、可直接编辑的脚手架。
 *
 * 首次运行（或缺失时）自动生成目录与示例文件，
 * 让任何用户都能开箱即知“东西往哪放、怎么配置”。所有写入均为幂等：
 * 只创建缺失项，绝不覆盖用户已有内容。
 */
let done = false

export function ensureGlobalScaffold(): void {
  if (done) return
  done = true
  try {
    ensureDir(globalConfigDir())
    ensureDir(globalSkillsDir())
    ensureDir(globalAgentsDir())
    ensureDir(globalPlansDir())

    writeIfMissing(path.join(globalConfigDir(), 'README.md'), ROOT_README)
    writeIfMissing(globalMemoryPath(), GLOBAL_MEMORY)
    writeIfMissing(
      path.join(globalConfigDir(), 'config.example.json'),
      CONFIG_EXAMPLE,
    )
    writeIfMissing(path.join(globalSkillsDir(), 'README.md'), SKILLS_README)
    writeIfMissing(path.join(globalAgentsDir(), 'README.md'), AGENTS_README)
    writeIfMissing(path.join(globalPlansDir(), 'README.md'), PLANS_README)
  } catch {
    /* 脚手架是尽力而为，失败不影响主流程 */
  }
}

function writeIfMissing(file: string, content: string): void {
  try {
    if (!fs.existsSync(file)) {
      ensureDir(path.dirname(file))
      fs.writeFileSync(file, content, 'utf8')
    }
  } catch {
    /* 忽略单个文件写入失败 */
  }
}

const ROOT_README = `# ~/.strike — StrikeAgent 全局目录

本目录由 StrikeAgent-CLI 自动生成，用于存放跨项目通用的配置与资源。
（原创作者 Bouquets-ai）

\`\`\`
~/.strike/
├── config.json           # 全局配置（用 \`strike config set <键> <值>\` 修改）
├── config.example.json   # 配置项参考模板（可对照编辑 config.json）
├── STRIKE.md             # 全局指令/记忆：内容注入到所有项目的系统提示
├── skills/               # 全局技能（每个技能一个子目录，内含 SKILL.md）
├── agents/               # 全局子智能体（每个 *.md 一个角色）
├── plans/                # 计划文档（plan 模式产出/手写规划存放处）
└── projects/<项目slug>/  # 各项目隔离的记忆、会话、检查点
\`\`\`

## 快速配置

- 查看配置：\`strike config show\`
- 设置 Key：\`strike config set authToken sk-你的Key\`
- 切换模型：\`strike config set model "deepseek-v4-pro[1m]"\`
- 查看技能：\`strike skills\`   查看子智能体：\`strike agents\`

## 优先级

CLI 参数 > 环境变量 > 项目级 \`.strike/\` > 全局 \`~/.strike/\` > 内置默认。
项目级目录（\`<项目>/.strike/skills\`、\`/agents\`、\`/plans\`）会覆盖同名全局项。
`

const GLOBAL_MEMORY = `<!--
~/.strike/STRIKE.md — StrikeAgent 全局指令 / 记忆

本文件内容会注入到【所有项目】的系统提示中。
请在下方（注释之外）写入适用于所有项目的全局偏好与规则，例如：
- 始终用简体中文回复。
- 提交信息遵循 Conventional Commits。
- 不要擅自重构与任务无关的代码。

留空或仅保留本注释则不产生任何影响。
-->
`

const CONFIG_EXAMPLE = `{
  "//": "这是配置参考模板。真实配置在 config.json；可用 strike config set <键> <值> 修改。",
  "provider": "deepseek",
  "model": "deepseek-v4-pro[1m]",
  "subagentModel": "deepseek-v4-flash",
  "baseUrl": "https://api.deepseek.com/anthropic",
  "authToken": "sk-在此填入你的Key",
  "ollamaBaseUrl": "http://localhost:11434/v1",
  "ollamaModel": "qwen2.5-coder:7b",
  "permissionMode": "default",
  "//thinking": "思考模式：始终开启；强度只分 high/max。改 effort 即可（off 可关闭思考）。",
  "thinkingMode": "on",
  "effort": "max",
  "autoMemory": true,
  "buddyEnabled": true,
  "feishu": { "appId": "", "appSecret": "", "allowList": [] },
  "mcpServers": {}
}
`

const SKILLS_README = `# ~/.strike/skills — 全局技能

每个技能是一个子目录，内含 \`SKILL.md\`：

\`\`\`
skills/
└── my-skill/
    └── SKILL.md
\`\`\`

\`SKILL.md\` 开头写 YAML frontmatter：

\`\`\`markdown
---
name: my-skill
description: 何时以及如何使用这个技能。
---

# 技能标题
具体步骤与指引……
\`\`\`

相关时模型会自动调用 Skill 工具加载全文。查看：\`strike skills\` 或 REPL 内 \`/skills\`。
`

const AGENTS_README = `# ~/.strike/agents — 全局子智能体（Subagent）

每个子智能体是一个 \`*.md\` 文件，开头写 YAML frontmatter，正文即角色指令：

\`\`\`markdown
---
name: reviewer
description: 代码审查专家，专注找 bug 与安全问题。
model: fast        # fast=快速模型(默认) | main=主模型
---

你是一名严格的代码审查员……
\`\`\`

主代理会在合适的子任务上调用 Task 工具并传入 subagent_type=<名字> 来使用对应角色。
查看：\`strike agents\` 或 REPL 内 \`/agents\`。
`

const PLANS_README = `# ~/.strike/plans — 计划文档

存放规划/方案类文档（Markdown）。在 plan 模式（\`strike --plan\` 或 \`/mode plan\`）下
先产出方案、确认后再执行；你也可以把长期方案手动存放于此，便于跨会话查阅。
`
