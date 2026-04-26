# Tiller

> Tiller — a mobile control plane for any ACP-compatible coding agent.

Tiller 是一个面向任意 ACP 兼容 Coding Agent 的移动端控制台。

## 它解决什么问题

Tiller 关注的不是“跟 AI 聊天”，而是“远程控制 Coding Agent 工作流”：

- Agent 需要执行命令，但你不在电脑前
- Agent 改了一批文件，你想先看 diff
- Agent 卡在权限审批上，任务停住了
- 你想在手机端恢复、推进、取消或审查开发任务

所以 Tiller 是 **控制面（control plane）**，不是 Bot Hub。

## 为什么是 ACP-first

Tiller 不硬编码 Codex、Claude、Gemini、OpenCode 或任何特定 Agent。

```text
Mobile / Web Client
    ↓
Tiller Sync Protocol
    ↓
Tiller Daemon
    ↓
ACP Client Runtime
    ↓
ACP-compatible Agent Process
```

- **ACP**：Agent 协议层
- **Tiller Sync**：Web / 移动端 与 daemon 的同步协议层

## 当前 MVP 范围

当前仓库实现的是 **真实 ACP 本地闭环优先**：

```text
Web Client → localhost Daemon → ACP Agent Runtime
```

包含：

- pnpm monorepo skeleton
- `apps/web`：Vite + React，移动优先控制台
- `apps/daemon`：Node.js + ws
- `packages/shared`：共享类型
- `packages/sync-protocol`：Web ↔ daemon 协议
- `packages/agent-registry`：provider 配置与本地加载
- `packages/acp-runtime`：ACP session runtime 与事件归一化
- real session / permission request / command output / diff summary 的统一 UI 入口

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
- Daemon WebSocket: `ws://127.0.0.1:47631`
- 运行期 daemon 日志：`D:/myProject/tools/Tiller/logs/daemon.log`

### 第一次连接 / 配对

当前 daemon 启动后会在终端里打印：

- 6 位 pairing code
- 一段可扫码的本地 QR code

第一次打开 Web UI 时，先做这一步：

1. 在 daemon 终端里查看 6 位 pairing code
2. 在 Web 的 **设备配对** 区输入 pairing code
3. 配对成功后，浏览器会保存 daemon token
4. 之后同一浏览器会自动 `device.auth`

如果你清除了浏览器本地存储，或 daemon 重启后 pairing token 失效，就重新输入 pairing code 即可。

### 日志约定

- 仓库内统一使用 `D:/myProject/tools/Tiller/logs/` 存放本地调试日志
- daemon 启动、监听失败、未处理异常等会自动追加到 `logs/daemon.log`
- ACP connection test 与 real session 运行日志会自动写到 `logs/acp/`
- 手动重定向出来的调试日志也建议统一写到 `logs/` 下，避免散落在仓库根目录

当前默认约定示例：

- `logs/daemon.log`
- `logs/acp/connection-test-opencode.log`
- `logs/acp/session-session-1712345678901.log`

### 验证 happy path

1. 打开 Web 页面
2. 先完成 daemon 配对
3. 确认显示 `connected`
4. 点击 `Create session`
5. 等状态进入 `idle / running / waiting`
6. 输入 prompt 并发送
7. 观察真实流式输出
8. 如 agent 发出权限卡片，则点击 `Allow once` 或 `Deny`
9. 观察 command output、diff summary 和最终状态

> 注意：是否真的出现权限卡片，还取决于 ACP Agent 自己的权限策略。
> 以 OpenCode 为例，只有当对应工具权限被配置成 `ask` 时，才会弹审批；如果当前权限默认是 `allow`，那 Tiller UI 不出现权限卡片并不一定是前端故障。

### 手动验证 permission 卡片（不改仓库代码）

如果你想专门验证 Tiller 的权限卡片链路，建议按这个顺序手动测试：

1. 先确认 Web 已完成 daemon 配对，并且能正常 `Create session`
2. 先发一个普通 prompt，确认 `agent.message` 正常返回
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
    web/
    daemon/
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

Tiller 的接入方式不是硬编码某个 Agent，而是让 daemon 读取 provider 配置，然后按统一插槽启动一个 **ACP-compatible process**。

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

1. daemon 读取 `~/.tiller/config.json`
2. `agent-registry` 解析 provider
3. `acp-runtime` 用 `command + args + env + cwd` 启动进程
4. 通过 stdio 完成 ACP initialize / request / notification
5. 再把 ACP 原始事件规范化成 Tiller 的 sync events 给 Web UI

当前仓库已经具备真实 ACP provider slot；如果某个 provider 在插件态下存在 agent 语义兼容问题，可先用可工作的纯净命令（例如 `opencode acp --pure`）验证主链路。

如果后续需要快速验证一个外部 ACP adapter / wrapper，推荐把 **adapter 原型** 用 Python 编写；但 **Tiller 核心仓库本身仍保持 TypeScript + pnpm monorepo**，不改变当前架构边界。

## 安全提醒

MVP 默认保持保守：

- daemon 仅监听 `127.0.0.1`
- workspace 走 allowlist 思路
- 不默认静默批准危险操作
- 日志避免记录敏感代码细节

## Roadmap

- `v0.1` ACP 本地真实闭环 ✅
- `v0.2` 真实 ACP provider slot + config loading
- `v0.3` 更完整的 cancel / diff / git / error recovery
- `v0.4` 远程访问、认证、E2EE 设计
- `v0.5` preset / adapter / quirks layer

## Session persistence

当前已经补上最小闭环：

- session summary 会持久化到 `~/.tiller/sessions.json`
- 每个 session 的消息流会持久化到 `~/.tiller/session-messages/<sessionId>.json`
- 每个 session 的 command output / diff snapshot 会持久化到 `~/.tiller/session-artifacts/<sessionId>.json`
- provider-aware reconnect descriptor 会持久化到 `~/.tiller/session-runtimes.json`
- Web 会在连接后加载最近 session 列表，并在打开 session 时回放持久化消息历史
- Web 会在打开 session 时回放持久化 command output 与最新 diff snapshot
- Web 会为每个 session 显示 runtime resume 状态：`History only` / `Resume available` / `Resume unavailable`

当前**仍未实现**的边界：

- daemon 重启后的真实 ACP runtime resume
- provider-specific `session.resume.start` 真正握手（当前仅有 same-process skeleton）
- 断线后重新附着到仍在运行的外部 agent 进程
- command output / diff 历史的完整持久化
- 不同 ACP 实现下的 resume 兼容层

也就是说：

> 现在能恢复“记录/history”，还不能恢复“活的 runtime 执行现场”。

## Provider 策略

Tiller 提供的是标准 ACP 插槽：

- 用户带来 ACP-compatible agent command
- registry 管 provider schema / preset / config
- runtime 管 session 生命周期与协议
- UI 消费结构化 sync events，而不是直接依赖具体 Agent
