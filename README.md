# ⚡ StrikeAgent-CLI

StrikeAgent-CLI（代号「打击手」）是一个从零自研、可实际运行的命令行 AI 编程助手。架构思路借鉴 Claude Code，但针对 DeepSeek 1M 上下文、Ollama 本地模型、自进化记忆、命令行宠物和飞书远程操控做了大量原创增强。
> 代号"打击手"——精准、果断、可靠。

---

## ✨ 功能特性

- **多后端模型**：DeepSeek（Anthropic 兼容端点，1M 上下文）、Ollama（本地）、官方 Anthropic，可随时 `/model` 切换。
- **强化上下文管理**：按模型档位（DeepSeek 自动识别 `[1m]`）做 token 预算，接近上限自动分段摘要压缩，大输出截断。
- **完整工具系统**：读/写/精确编辑文件、Glob、ripgrep 搜索、跨平台 Shell（Windows 走 PowerShell）、TodoWrite、子代理 Task、WebFetch/WebSearch、记忆读写；同一轮内**多个子智能体可并行运行**。
- **自进化记忆**：任务后用快速模型自动反思，把可复用经验写入经验库（支持向量召回），并维护项目 `MEMORY.md`；工具使用统计辅助决策。
- **命令行宠物 StrikeBuddy**：由用户标识确定性派生骨架（物种/稀有度/属性），首次运行由模型生成"灵魂"（名字+性格），随任务状态切换情绪动画与气泡。
- **飞书远程操控**：飞书长连接（WSClient，无需公网回调），发消息即可远程驱动本机 StrikeAgent，支持白名单与高危命令拦截。
- **技能系统（Skill）**：自动扫描 `.strike/skills/`、`~/.strike/skills/` 下的 `SKILL.md`，把技能清单注入系统提示；相关时模型调用 `Skill` 工具加载技能全文并遵循。
- **子智能体系统（Subagent）**：扫描 `.strike/agents/`、`~/.strike/agents/` 下的 `*.md` 角色定义，模型用 `Task` 传 `subagent_type` 调用对应角色（可指定模型档位）。
- **思考模式（DeepSeek）**：默认始终开启，强度只分 `high`/`max`，可 `/think` 切换或在全局配置持久化。
- **更多增强**：斜杠命令、权限模式（plan/default/bypassPermissions）、会话持久化与 `--resume` 选择器、文件检查点与 `/undo`、对话+代码同步回滚 `/rewind`、成本统计、MCP 客户端、`/doctor` 自检；启动自动生成 `~/.strike` 脚手架。

---

## 📦 安装

需要 Node.js 18+（Windows 用户建议安装 Git for Windows）。

```bash
cd StrikeAgent-CLI
npm install
npm run build
npm link        # 全局可用 strike 命令（可选）
```

开发模式直接运行（无需构建）：

```bash
npm run dev -- "你好"
```

---

## ⚙️ 配置

配置优先级：CLI 参数 > 环境变量 > 项目级 `.strike/config.json` > 全局 `~/.strike/config.json` > 内置默认。

### 方式一：环境变量（兼容 Claude Code）

复制 `.env.example` 为 `.env` 并填写，或在 shell 中导出。

**DeepSeek（默认，推荐）**：

```powershell
# Windows PowerShell
$env:ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"
$env:ANTHROPIC_AUTH_TOKEN="sk-你的DeepSeekKey"
$env:ANTHROPIC_MODEL="deepseek-v4-pro[1m]"
$env:CLAUDE_CODE_SUBAGENT_MODEL="deepseek-v4-flash"
```

```bash
# Linux / macOS
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN=sk-你的DeepSeekKey
export ANTHROPIC_MODEL='deepseek-v4-pro[1m]'
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
```

> 参考 [DeepSeek 接入文档](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code)。也可用 `DEEPSEEK_API_KEY` 代替 `ANTHROPIC_AUTH_TOKEN`。

**Ollama（本地）**：

```bash
export STRIKE_USE_OLLAMA=1
export OLLAMA_BASE_URL=http://localhost:11434/v1
export OLLAMA_MODEL=qwen2.5-coder:7b
```

**飞书远程**：

```bash
export FEISHU_APP_ID=cli_你的AppID
export FEISHU_APP_SECRET=你的AppSecret
```

### 方式二：配置命令

```bash
strike config show
strike config set authToken sk-你的Key
strike config set model "deepseek-v4-pro[1m]"
strike config set feishuAppId cli_xxx
strike config set feishuAppSecret xxx
```

> 注意：环境变量优先级高于配置文件。若你已在系统环境变量里设了 `ANTHROPIC_AUTH_TOKEN` 等（如曾给 Claude Code 配过），它会盖过 `~/.strike/config.json`。

### 全局目录脚手架（~/.strike）

首次运行时会自动在 `~/.strike` 生成一套可直接编辑的脚手架（幂等，只补缺失、不覆盖）：

```
~/.strike/
├── config.json           # 全局配置
├── config.example.json   # 配置项参考模板
├── STRIKE.md             # 全局指令/记忆：内容注入到所有项目
├── skills/               # 全局技能
├── agents/               # 全局子智能体
├── plans/                # 计划文档
└── projects/<项目slug>/  # 各项目隔离的记忆/会话/检查点
```

---

## 🚀 使用

> 在**任意目录**运行 `strike` 即以该目录为工作区（读写文件、记忆、会话都隔离到该目录）。没装全局命令时，可在本仓库用 `npm run dev -- "你的指令"`。

### 交互式 REPL

```bash
strike                                      # 进入交互界面
strike --resume                             # 列出本项目历史会话供选择（↑↓ 选，Enter 恢复，N 新建）
strike -r <id>                              # 直接恢复指定会话
strike --plan                               # 计划模式启动（只读）
strike --permission-mode bypassPermissions  # 完全放行模式（不询问，启动有红色提示）
strike --model deepseek-v4-flash
strike --remote                             # 同时启动飞书远程
```

### 输入区前缀

| 前缀 | 作用 | 示例 |
| --- | --- | --- |
| （无） | 与 AI 对话 / 让它干活 | `帮我修复登录接口的空指针` |
| `/` | 斜杠命令（输入 `/` 弹出菜单，↑↓ 选择、Tab 补全） | `/model` |
| `!` | 直接执行 shell 命令，不经过模型 | `!git status` |
| `#` | 一句话写入项目长期记忆 | `#接口统一返回 {code,data,msg}` |

### 非交互（脚本/管道）

```bash
strike -p "读取 package.json，告诉我项目名和版本"
```

### 其它命令

```bash
strike doctor          # 环境与连通性自检
strike buddy           # 查看命令行伙伴属性卡
strike sessions        # 列出历史会话
strike remote          # 仅启动飞书远程（无界面，常驻）
```

### 斜杠命令（REPL 内）

| 命令 | 说明 |
| --- | --- |
| `/help` | 显示帮助 |
| `/clear` | 清空会话与待办 |
| `/compact` | 手动压缩上下文 |
| `/model [后端\|模型]` | 查看/切换模型 |
| `/mode [plan\|default\|bypassPermissions]` | 切换权限模式 |
| `/think [high\|max\|off]` | 思考模式（默认 max） |
| `/memory` | 查看项目记忆 |
| `/init` | 生成项目记忆引导 |
| `/cost` | 查看 token 用量与成本 |
| `/pet` | 查看伙伴属性卡 |
| `/rewind` | 回到之前某段对话，并还原其后的代码改动 |
| `/undo` | 回滚最近的文件改动 |
| `/checkpoints` | 查看可回滚快照数 |
| `/doctor` | 环境自检 |
| `/mcp [connect]` | 查看/连接 MCP 服务器 |
| `/skills` | 查看可用技能（Skill） |
| `/agents` | 查看可用子智能体（Subagent） |
| `/remote [on\|off]` | 启停飞书远程 |
| `/exit` | 退出 |

### 交互快捷键

- `Esc`：中断当前正在运行的任务。
- 运行中**可继续输入**，新消息进入队列顺序处理（顶部显示排队条数）。
- 权限确认弹框：`↑↓` 选择、`Enter` 确认、数字 `1/2/3` 直选；选"本会话不再询问"可让该工具后续免确认。
- `/rewind` / `--resume` 选择器：`↑↓` 选择、`Enter` 确认、`Esc` 取消。
- 写文件/执行命令等操作在 `default` 模式下会弹出确认；`bypassPermissions` 模式全部放行。

---

## 🧠 自进化记忆机制

1. **项目记忆**：`.strike/MEMORY.md`（兼容读取项目根的 `AGENTS.md` / `CLAUDE.md` / `STRIKE.md`），启动时注入上下文；全局指令 `~/.strike/STRIKE.md` 会注入到所有项目。
2. **任务后反思**：每轮任务结束后用快速模型（`deepseek-v4-flash`）提炼可复用经验，写入 `~/.strike/projects/<项目>/memory/` 与经验库 `experiences.jsonl`（带向量）。
3. **召回**：新任务开始时按关键词 + 向量相似度召回相关经验注入系统提示。
4. **工具统计**：记录工具调用频率与成功率（`tool-stats.json`）。

---

## 🧩 技能系统（Skill）

StrikeAgent 启动时会扫描以下目录中的 `SKILL.md`（按优先级，去重）：

1. 项目级 `.strike/skills/<名字>/SKILL.md`
2. 全局 `~/.strike/skills/<名字>/SKILL.md`

每个技能的 `name` + `description` 会注入系统提示；当某技能与当前任务相关时，模型会调用 `Skill` 工具加载该 `SKILL.md` 全文（及目录下附带文件清单）并严格遵循。

- 查看：`strike skills` 或 REPL 内 `/skills`
- 新建技能：创建 `.strike/skills/my-skill/SKILL.md`，开头写 YAML frontmatter：

```markdown
---
name: my-skill
description: 何时以及如何使用这个技能。
---

# 技能标题
具体步骤与指引……
```

## 🤖 子智能体（Subagent）

与技能一样，子智能体也采用统一的目录约定，**所有用户开箱即用、无需改代码**。StrikeAgent 启动时会扫描以下目录中的 `*.md` 子智能体定义（按优先级，去重）：

1. 项目级 `.strike/agents/<名字>.md`
2. 全局 `~/.strike/agents/<名字>.md`

每个子智能体的 `name` + `description` 会注入系统提示；当某子任务适合交给它时，模型会调用 `Task` 工具并传入 `subagent_type=<名字>`，该子智能体的**角色指令**与**模型档位**随即生效。

- 查看：`strike agents` 或 REPL 内 `/agents`
- 新建子智能体：创建 `~/.strike/agents/reviewer.md`，开头写 YAML frontmatter，正文即角色指令：

```markdown
---
name: reviewer
description: 代码审查专家，专注找 bug 与安全问题。
model: fast        # fast=快速模型(默认) | main=主模型
---

你是一名严格的代码审查员。请聚焦：空指针、边界条件、并发与安全漏洞。
按"问题→影响→建议"输出，只报告确有把握的问题。
```

> `model: main` 让该子智能体使用主模型处理复杂任务；省略或 `fast` 则用快速模型求快省钱。

## 🛰️ 飞书远程操控

1. 在[飞书开放平台](https://open.feishu.cn/)创建自建应用，开启**长连接**模式与**接收消息**事件（`im.message.receive_v1`），并申请发消息权限。
2. 配置 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`（或 `strike config set`）。
3. 启动：REPL 内 `/remote on`，或 `strike remote`（常驻），或 `strike --remote`。
4. 在飞书中给应用发消息即可远程驱动本机 StrikeAgent，结果会回推到会话。
5. 安全：可在配置 `feishu.allowList` 填入允许的 `open_id` 白名单；远程下发的高危命令会被自动拒绝。

> 微信（企业微信）/钉钉已预留 `RemoteAdapter` 接口骨架，补齐凭证即可接入。

---

## 📖 项目完整解读

StrikeAgent-CLI 是一个从零自研、可实际运行的**命令行 AI 编程助手**。架构思路借鉴 Claude Code，但针对 DeepSeek 1M 上下文、Ollama 本地模型、自进化记忆、命令行宠物和飞书远程操控做了大量原创增强。核心能力：**读/写代码 → 工具调用 → 多轮 Agent 循环 → 上下文压缩 → 记忆沉淀 → 越用越聪明**。

### 技术栈

| 类别 | 技术 |
| --- | --- |
| 语言与 UI | TypeScript (ESM) + React 18 + Ink 5 |
| CLI | commander |
| 模型协议 | @anthropic-ai/sdk（DeepSeek/Anthropic）、openai（Ollama） |
| 工具校验 | zod + zod-to-json-schema |
| 扩展 | @modelcontextprotocol/sdk（MCP）、@vscode/ripgrep |
| 远程 | @larksuiteoapi/node-sdk（飞书长连接） |
| 打包 | tsup → `dist/cli.js` |

### Agent 主循环

`AgentSession.run()`（`src/core/agent.ts`）是项目心脏，流程如下：

```
用户输入
  → messages 追加 user 消息
  → bus.emit('query:start')
  → loop() 最多 50 轮：
      1. 检查上下文占用 → 超 80% 自动 compact（摘要压缩旧消息）
      2. buildSystemPrompt() 组装系统提示（记忆/技能/待办/经验召回）
      3. provider.stream() 流式调用 LLM
      4. 累积 text / thinking / tool_use 块
      5. 若无 tool_use → 返回最终文本，结束
      6. executeTools()：先串行校验+权限确认，再并发执行已批准的工具（多个子智能体可同时运行）
      7. 把 tool_result 作为 user 消息追加，进入下一轮
  → bus.emit('query:end')
  → reflectAfterTask() 异步反思写记忆
```

- **子代理**：`Task` 工具触发 `runSubagent()`，默认用快速模型（`subagentModel`，可由子智能体定义指定 `main`），不能再派生 Task；同一轮多个 `Task` 并发执行。
- **思考模式**：默认始终开启，强度只分 `high`/`max`（`/think high|max|off` 或全局 `~/.strike/config.json` 的 `effort` 配置）；子代理一律关思考求快；Ollama 不支持；DeepSeek 只发 `thinking` 参数，避免与 `reasoning_effort` 互斥导致 400。

### 模块详解

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| 入口 | `cli.tsx` | Commander 分发：REPL、`-p` 打印、config/doctor/buddy/remote 等 |
| 配置 | `config/` | 合并 CLI > env > 项目 `.strike/config.json` > 全局 `~/.strike/config.json` |
| Agent | `core/agent.ts` | 多轮 tool-use 循环、子代理、权限调度 |
| 上下文 | `core/context.ts` | token 估算，超 80% 用快速模型摘要压缩，保留最近 6 条 |
| 系统提示 | `core/systemPrompt.ts` | 注入环境、技能、子智能体、全局/项目记忆、经验召回、待办 |
| 事件总线 | `core/events.ts` | UI、宠物、成本、记忆反思解耦串联 |
| Provider | `providers/` | `LLMProvider` 抽象；DeepSeek/Anthropic 共用 SDK；Ollama 双向适配 |
| 工具 | `tools/` | Read/Write/Edit、Glob/Grep、Shell、Todo、Web、Memory、Task、Skill + MCP |
| 记忆 | `memory/` | 项目 MEMORY.md、经验库 JSONL（向量）、任务后反思、三路召回 |
| 宠物 | `buddy/` | 随机骨架 + LLM 生成灵魂，订阅 bus 切换情绪动画 |
| UI | `ui/` | Ink REPL、斜杠命令、权限弹框、消息队列、子代理面板 |
| 检查点 | `checkpoint/` | 写文件前快照；`/undo` 回滚；`/rewind` 对话+代码同步还原 |
| 会话 | `session/` | 持久化到 `~/.strike/projects/<slug>/sessions/`，支持 `--resume` |
| 远程 | `remote/` | 飞书 WSClient 长连接；微信/钉钉预留 `RemoteAdapter` 接口 |
| 技能 | `skills/` | 扫描 `.strike/skills`、`~/.strike/skills` |
| 子智能体 | `agents/` | 扫描 `.strike/agents`、`~/.strike/agents`，供 `Task` 按角色调用 |
| 脚手架 | `config/scaffold.ts` | 首次运行生成 `~/.strike` 目录与示例/说明 |
| MCP | `mcp/` | 启动连接，动态注册 MCP 工具 |

### 内置工具一览

| 工具 | 功能 |
| --- | --- |
| ReadFile / WriteFile / EditFile | 文件读写与精确编辑 |
| Glob / Grep | 文件搜索与 ripgrep |
| Shell | 跨平台命令（Windows 走 PowerShell） |
| TodoWrite | 任务拆解跟踪 |
| WebFetch / WebSearch | 网页抓取与搜索 |
| MemoryRead / MemoryWrite | 项目长期记忆 |
| Task | 派生子代理 |
| Skill | 加载 SKILL.md 全文 |
| MCP 动态工具 | 来自已连接 MCP 服务器 |

### 权限三档

| 模式 | 行为 |
| --- | --- |
| `plan` | 只读工具放行，写/执行拒绝（启动有提示） |
| `default` | 写/执行需用户确认（默认） |
| `bypassPermissions`（内部 `auto`） | 全部放行，不询问；启动/切换有红色警告，状态栏高亮 |

### 数据存储布局

```
~/.strike/                   # 全局用户目录（os.homedir()，所有用户通用，无硬编码）
├── config.json              # 全局配置、userId、宠物灵魂、飞书凭证
├── config.example.json      # 配置项参考模板
├── STRIKE.md                # 全局指令/记忆：注入到所有项目
├── skills/                  # 全局技能（含说明 README）
├── agents/                  # 全局子智能体（含说明 README）
├── plans/                   # 计划文档（含说明 README）
└── projects/
    └── <项目路径-slug>/
        ├── memory/
        │   ├── experiences.jsonl   # 经验库（带向量）
        │   └── tool-stats.json     # 工具统计
        ├── sessions/               # 会话历史
        └── checkpoints/            # 文件快照备份

<项目目录>/.strike/          # 项目级覆盖（随项目走）
├── config.json              # 项目级配置覆盖
├── MEMORY.md                # 项目长期记忆
├── skills/                  # 项目级技能
└── agents/                  # 项目级子智能体
```

### 事件总线

`core/events.ts` 定义的全局事件，供 UI、宠物、成本等订阅：

- `query:start` / `query:end`
- `assistant:text` / `assistant:thinking`
- `tool:start` / `tool:end` / `tool:permission`
- `thinking`（active 开关）
- `error` / `usage` / `memory:saved`
- `subagent:start` / `subagent:progress` / `subagent:end`

### 源码目录

```
src/
  cli.tsx          # commander 入口
  config/          # 配置加载（env 兼容 Claude + 全局/项目级）
  core/            # agent 主循环 / 上下文管理 / 系统提示 / 事件总线 / 成本 / doctor
  providers/       # LLMProvider 抽象 + DeepSeek/Anthropic + Ollama
  tools/           # 工具抽象 + 文件/搜索/Shell/Todo/Web/记忆/Task + 权限
  memory/          # 项目记忆 / 经验库 / 反思 / 召回 / 嵌入
  buddy/           # 命令行宠物：骨架/灵魂/精灵/情绪
  ui/              # Ink REPL UI + 斜杠命令 + 宠物组件
  session/         # 会话持久化与恢复
  checkpoint/      # 文件改动快照与回滚
  remote/          # 飞书长连接 + 适配器接口（微信/钉钉占位）
  mcp/             # MCP 客户端
  skills/          # Skill 扫描与加载
  agents/          # 子智能体扫描与加载
```

### 相对 Claude Code 的创新点

| 维度 | StrikeAgent-CLI |
| --- | --- |
| 模型后端 | 支持 DeepSeek 1M + Ollama，`/model` 热切换 |
| 自进化记忆 | 任务后反思 → JSONL 经验库 → 关键词+中文2gram+向量三路召回 |
| 命令行宠物 | 盲盒孵化像素宠物，随 Agent 状态变情绪 |
| 飞书远程 | 手机发消息驱动本机 CLI，无需公网回调 |

---

## 🧹 卸载

```powershell
# 移除全局命令（按当初安装方式二选一）
npm unlink -g strikeagent-cli     # 若用 npm link 安装
npm uninstall -g strikeagent-cli  # 若用 npm install -g . 安装

# 可选：删除全局数据（配置/记忆/会话/检查点，不可恢复）
Remove-Item -Recurse -Force "$env:USERPROFILE\.strike"
```

> 若曾设过 `ANTHROPIC_AUTH_TOKEN` 等环境变量，按需自行清理。

---

## 📄 许可

[PolyForm Noncommercial 1.0.0](LICENSE) —— 开源，允许自由使用/修改/再分发用于**非商业**目的；**禁止商业用途**。商业授权请联系作者。
