# Tiller

> Tiller is a command deck for your ACP coding-agent fleet.

Tiller 是你的 ACP Coding Agent 舰队指挥甲板。

## 它解决什么问题

Tiller 关注的不是“跟 AI 聊天”，而是“远程控制 Coding Agent 工作流”：

- Agent 需要执行命令，但你不在电脑前
- Agent 改了一批文件，你想先看 diff
- Agent 卡在权限审批上，任务停住了
- 你想在手机端恢复、推进、取消或审查开发任务

所以 Tiller 是 **Command Deck（指挥甲板）**，不是 Bot Hub。

品牌隐喻保持轻量：

```text
Commander
  ↓
Command Deck
  ↓
Fleet
  ↓
Helm Node A
     ├── Crew: opencode acp
     └── Crew: codex-acp
```

对应关系：Deck = Web/App，Fleet = 多 Helm 集合，Helm = 单机 host process，Crew = ACP Agent，Mission = Session/Task，Logbook = event / command output，Beacon = relay / notification channel。

### 当前会话绑定模型

当前 Deck 创建 Mission 的选择链路为：

```text
Project -> Helm -> Workspace -> ACP Agent -> runtimeSessionId
```

- **Project**：业务归属对象；一个 Project 绑定一个 Helm
- **Helm**：服务器/宿主节点；一个 Helm 可承载多个 Project
- **Workspace**：Project 下的执行目录 / cwd
- **ACP Agent**：归属于 Helm，Project 仅约束 allowed/default agent
- **runtimeSessionId**：ACP 返回的真实会话身份；一旦出现即锁定绑定关系

## 为什么是 ACP-first

Tiller 不硬编码 Codex、Claude、Gemini、OpenCode 或任何特定 Agent。

```text
Command Deck (Web / Mobile)
    ↓
Tiller Sync Protocol
    ↓
Tiller Helm
    ↓
ACP Client Runtime
    ↓
ACP-compatible Crew Process
```

- **ACP**：Agent 协议层
- **Tiller Sync**：Command Deck 与 Helm 的同步协议层

## 当前 MVP 范围

当前仓库实现的是 **真实 ACP 本地闭环优先**：

```text
Command Deck → localhost Helm → ACP Crew Runtime
```

包含：

- pnpm monorepo skeleton
- `apps/deck`：Vite + React，Command Deck
- `apps/helm`：Node.js + ws，Helm host process
- `packages/shared`：共享类型
- `packages/sync-protocol`：Deck ↔ Helm 协议
- `packages/agent-registry`：provider 配置与本地加载
- `packages/acp-runtime`：ACP session runtime 与事件归一化
- real mission / permission request / logbook / diff summary 的统一 UI 入口

## 本地开发

### 环境

- Node.js 22+
- pnpm 10+

### 启动

```bash
pnpm install
pnpm dev
```

- Web: [http://127.0.0.1:5173](http://127.0.0.1:5173)
- Helm WebSocket: `ws://127.0.0.1:47631`
- 运行期 Helm 日志：`D:/myProject/tools/Tiller/logs/daemon.log`

### 第一次连接 / 配对

当前 Helm 启动后会在终端里打印：

- 6 位 pairing code
- 一段可扫码的本地 QR code

第一次打开 Web UI 时，先做这一步：

1. 在 Helm 终端里查看 6 位 pairing code
2. 在 Web 的 **设备配对** 区输入 pairing code
3. 配对成功后，浏览器会保存 Helm token
4. 之后同一浏览器会自动 `device.auth`

如果你清除了浏览器本地存储，或 Helm 重启后 pairing token 失效，就重新输入 pairing code 即可。

### 日志约定

- 仓库内统一使用 `D:/myProject/tools/Tiller/logs/` 存放本地调试日志
- Helm 启动、监听失败、未处理异常等会自动追加到 `logs/daemon.log`
- ACP connection test 与 real mission 运行日志会自动写到 `logs/acp/`
- 手动重定向出来的调试日志也建议统一写到 `logs/` 下，避免散落在仓库根目录

当前默认约定示例：

- `logs/daemon.log`
- `logs/acp/connection-test-opencode.log`
- `logs/acp/session-session-1712345678901.log`

### 验证 happy path

1. 打开 Web 页面
2. 先完成 Helm 配对
3. 确认显示 `connected`
4. 在 Mission 页依次选择 `Project -> Workspace -> Crew`
5. 点击 `Create Mission` 或直接发送第一条 Order
6. 等状态进入 `idle / running / waiting`
7. 输入 order / prompt 并发送
8. 观察真实流式输出
9. 如 agent 发出权限卡片，则点击 `Allow once` 或 `Deny`
10. 观察 Logbook、diff summary 和最终状态

> 注意：是否真的出现权限卡片，还取决于 ACP Agent 自己的权限策略。
> 以 OpenCode 为例，只有当对应工具权限被配置成 `ask` 时，才会弹审批；如果当前权限默认是 `allow`，那 Tiller UI 不出现权限卡片并不一定是前端故障。

### 手动验证 permission 卡片（不改仓库代码）

如果你想专门验证 Tiller 的权限卡片链路，建议按这个顺序手动测试：

1. 先确认 Web 已完成 Helm 配对，并且能正常 `Create Mission`
2. 先发一个普通 prompt，确认 `Crew message` / `agent.message` 正常返回
3. 再发一个更明确要求工具执行的 prompt，例如：
   - `请先运行 pwd（或等价命令）确认当前工作目录，再告诉我结果`
   - `请列出当前工作区根目录文件名，再总结目录结构`
4. 如果仍然没有权限卡片，优先检查 ACP Agent 本身的权限策略是不是默认 `allow`
5. 只有在 Agent 对应工具权限被设成 `ask` 的情况下，Tiller 才有机会收到真实 `permission.request`

如果你后续要**强测**这条链路，最稳的是临时把 OpenCode 某类工具权限改成 `ask`，再重复上面的 prompt。

## Monorepo 结构

```text
tiller/
  apps/
    deck/
    helm/
  packages/
    shared/
    sync-protocol/
    agent-registry/
    acp-runtime/
```

## 未来配置文件

计划配置路径：

```text
~/.tiller/config.json
```

示例：

```json
{
  "workspaces": [
    {
      "id": "my-app",
      "name": "My App",
      "path": "D:/projects/my-app"
    }
  ],
  "agents": [
    {
      "id": "opencode",
      "name": "OpenCode",
      "kind": "native-acp",
      "command": "opencode",
      "args": ["acp"],
      "transport": "stdio",
      "protocol": "acp"
    }
  ],
  "daemon": {
    "host": "127.0.0.1",
    "port": 47631
  }
}
```

## 怎么接入 ACP（以 OpenCode 为例）

Tiller 的接入方式不是硬编码某个 Agent，而是让 Helm 读取 provider 配置，然后按统一插槽启动一个 **ACP-compatible process**。

以 OpenCode 为例：

```json
{
  "id": "opencode",
  "name": "OpenCode",
  "kind": "native-acp",
  "command": "opencode",
  "args": ["acp"],
  "transport": "stdio",
  "protocol": "acp",
  "installHint": "Install OpenCode and ensure `opencode acp` works in your terminal."
}
```

未来真实接入路径会是：

1. Helm 读取 `~/.tiller/config.json`
2. `agent-registry` 解析 provider
3. `acp-runtime` 用 `command + args + env + cwd` 启动进程
4. 通过 stdio 完成 ACP initialize / request / notification
5. 再把 ACP 原始事件规范化成 Tiller 的 sync events 给 Web UI

当前仓库已经具备真实 ACP provider slot；如果某个 provider 在插件态下存在 agent 语义兼容问题，可先用可工作的纯净命令（例如 `opencode acp --pure`）验证主链路。

如果后续需要快速验证一个外部 ACP adapter / wrapper，推荐把 **adapter 原型** 用 Python 编写；但 **Tiller 核心仓库本身仍保持 TypeScript + pnpm monorepo**，不改变当前架构边界。

## Session config / capability matrix

Tiller 现在把 `Model / Reasoning` 能力拆成三层，尽量复用标准 ACP，再兜底 provider 特化：

1. **ACP-native path**：如果 agent 在 `session/new` / `session/load` / `session/resume` 返回 `configOptions`，或后续通过 `config_option_update` 推送配置变化，Tiller 会优先走标准 ACP `session/set_config_option`。
2. **Provider adapter path**：如果 agent 没暴露标准 `configOptions`，就走 `acp-runtime` 里的 provider adapter：
   - `codex-acp`：通过 `-c model=...` / `-c model_reasoning_effort=...`
   - `opencode`：通过 `-m provider/model` + `OPENCODE_CONFIG_CONTENT`
3. **Stored-only fallback**：如果既没有标准 ACP config option，也没有 provider adapter，Tiller 仍会把配置保存在 session summary 中，等待后续 provider 支持。

当前推荐的分层职责：

- `shared`：定义通用 session-config 语义与 `SessionConfigSupport`
- `agent-registry`：给 provider 注入 `capabilities.sessionConfig`
- `acp-runtime`：维护 `SessionConfigAdapter` 映射和 ACP-native bridge
- `deck`：消费通用能力，不直接绑定某个 provider 的命令细节

这条路径参考了 ACP 官方文档里对 `configOptions` / `session/set_config_option` 的约定，以及 Zed 对 ACP `session config options` 的通用 UI/adapter 处理思路。

## 安全提醒

MVP 默认保持保守：

- Helm 仅监听 `127.0.0.1`
- workspace 走 allowlist 思路
- 不默认静默批准危险操作
- 日志避免记录敏感代码细节

## Roadmap

- `v0.1` ACP 本地真实闭环 ✅
- `v0.2` 真实 ACP provider slot + config loading
- `v0.3` 更完整的 cancel / diff / git / error recovery
- `v0.4` 远程访问、认证、E2EE 设计
- `v0.5` preset / adapter / quirks layer

## Mission persistence / reconnect model

Tiller 把 Mission 的“重连/恢复”拆成两层，避免把 UI history 误当成 ACP runtime resume：

### A. Command Deck ↔ Helm 重连

这是手机断网、锁屏、WebSocket 断开后的常见路径。只要 Helm 和 ACP Crew 进程仍然存活：

- session summary 持久化到 `~/.tiller/sessions.json`
- 每个 session 的消息流持久化到 `~/.tiller/session-messages/<sessionId>.json`
- 每个 session 的 command output / diff snapshot 持久化到 `~/.tiller/session-artifacts/<sessionId>.json`
- Web 重新连接后请求 `session.list`，再读取消息与 artifacts
- Helm 对仍在内存中的 active mission 返回 `restoreMethod: "client-reconnect"`

这属于 Tiller Sync Protocol 职责，不需要 ACP `session/load`。

### B. Helm ↔ ACP Crew 恢复

只有 Helm/Crew 也重启或 runtime 丢失时，才进入 ACP 层恢复。Tiller 会保存 provider-aware runtime descriptor 到 `~/.tiller/session-runtimes.json`，包含 ACP 原生 `runtimeSessionId` 与能力快照：

- `sessionLoad`: agent 支持 ACP `session/load`，通常期望恢复并回放历史
- `sessionResume`: agent 支持 ACP `session/resume`，恢复上下文但不返回旧消息
- `sessionList`: agent 支持列出 agent 侧 sessions

恢复策略：

1. 如果 Mission 仍在当前 Helm 进程中：走 `client-reconnect`
2. 如果有 `runtimeSessionId` 且 agent 支持 `session/load`：优先调用 ACP `session/load`
3. 否则如果支持 `session/resume`：调用 ACP `session/resume`
4. 都不支持时：只恢复 Tiller UI history，不能假装 agent 上下文已恢复

当前**仍需真实联调**的边界：

- 不同 ACP 实现对 initialize capability 字段的差异
- `session/load` 历史回放事件与本地消息去重
- `session/resume` 恢复后首条 prompt 的上下文连续性
- 外部 Crew 进程存活但 Helm 重启时的重新附着策略

Helm 终端会输出低噪声调试日志：连接/断开、认证、`session.list/create`、runtime id、capability、`resume.check/start`、状态变更与错误；完整日志仍写入 `logs/daemon.log`。

## Crew Provider 策略

Tiller 提供的是标准 ACP 插槽：

- 用户带来 ACP-compatible agent command
- registry 管 provider schema / preset / config
- runtime 管 session 生命周期与协议
- UI 消费结构化 sync events，而不是直接依赖具体 Agent
