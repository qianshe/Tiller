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

当前仓库实现的是 `v0.1` 的本地闭环：

```text
Web Client → localhost Daemon → Mock Agent Runtime
```

包含：

- pnpm monorepo skeleton
- `apps/web`：Vite + React，移动优先控制台
- `apps/daemon`：Node.js + ws
- `packages/shared`：共享类型
- `packages/sync-protocol`：Web ↔ daemon 协议
- `packages/agent-registry`：mock provider 与未来配置入口
- `packages/acp-runtime`：mock session runtime 与未来 ACP TODO hooks
- mock streaming / permission request / command output / diff summary

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

### 验证 happy path

1. 打开 Web 页面
2. 确认显示 `connected`
3. 点击 `Create mock session`
4. 输入 prompt 并发送
5. 观察流式输出
6. 在权限卡片出现后点击 `Allow once` 或 `Deny`
7. 观察 command output、diff summary 和最终 idle 状态

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

当前仓库只做了 **config stub + runtime seams**，没有提前接入真实 ACP，避免在 v0.1 被具体 Agent 适配拖住。

如果后续需要快速验证一个外部 ACP adapter / wrapper，推荐把 **adapter 原型** 用 Python 编写；但 **Tiller 核心仓库本身仍保持 TypeScript + pnpm monorepo**，不改变当前架构边界。

## 安全提醒

MVP 默认保持保守：

- daemon 仅监听 `127.0.0.1`
- workspace 走 allowlist 思路
- 不默认静默批准危险操作
- 日志避免记录敏感代码细节

## Roadmap

- `v0.1` 本地 mock 闭环 ✅
- `v0.2` 真实 ACP provider slot + config loading
- `v0.3` 更完整的 cancel / diff / git / error recovery
- `v0.4` 远程访问、认证、E2EE 设计
- `v0.5` preset / adapter / quirks layer

## Session persistence TODO

当前 `session` 生命周期只保存在 daemon 进程内存里，便于先把 mock flow 跑通。

后续在 `v0.3` 再补：

- daemon 重启后的 session 恢复策略
- 最近 session 列表持久化
- 断线重连后的 active session 恢复
- mock runtime 与真实 ACP runtime 的 resume 边界

现在故意不提前实现，避免超出 `v0.1` 范围。

## Provider 策略

Tiller 提供的是标准 ACP 插槽：

- 用户带来 ACP-compatible agent command
- registry 管 provider schema / preset / config
- runtime 管 session 生命周期与协议
- UI 消费结构化 sync events，而不是直接依赖具体 Agent
