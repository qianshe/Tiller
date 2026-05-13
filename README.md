<p align="center">
  <img src="docs/assets/readme-hero.svg" alt="Tiller - Your local-first command deck for ACP coding agents" width="760" />
</p>

<p align="center">
  <strong>Chat with your local AI coding agents from any device on your trusted network.</strong>
  <br />
  No cloud control plane. No public bot hub. Just one private command deck.
</p>

<p align="center">
  <a href="LICENSE"><img alt="license Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-f59e0b" /></a>
  <a href="https://www.npmjs.com/package/@qianshe/tiller"><img alt="npm preview" src="https://img.shields.io/npm/v/%40qianshe%2Ftiller?tag=preview&label=npm%20preview&color=f59e0b" /></a>
  <img alt="node >=22" src="https://img.shields.io/badge/node-%3E%3D22-64748b" />
  <img alt="platform Web Desktop LAN" src="https://img.shields.io/badge/platform-Web%20%7C%20Desktop%20%7C%20LAN-64748b" />
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#highlights">Features</a> ·
  <a href="#supported-agents">Agents</a> ·
  <a href="#updating-tiller">Update</a> ·
  <a href="#privacy-and-logs">Privacy</a> ·
  <a href="#development">Development</a>
</p>

---

Tiller 把运行在你电脑、工作站或服务器上的 Coding Agent 整理成一个浏览器工作台：你可以在同一个 Web UI 里查看项目、连接 Agent、恢复会话、发送 Prompt、跟踪消息、查看任务日志与文件变更。

它不是公网 Bot Hub，也不会默认把你的本地运行时暴露给云端。Tiller 的目标是成为你的 **私有 AI Agent 控制台**：运行时在本地，Web UI 与运行时同源，数据默认保存在你自己的机器上。

## Highlights

- **Local-first runtime**：Helm 后端、Agent 进程、工作区、日志与会话数据默认运行在本机/服务器。
- **One command, built-in Web UI**：全局安装后执行 `tiller start`，浏览器直接打开内置 Deck UI。
- **ACP ecosystem ready**：通过 Agent Client Protocol 接入 ACP-compatible coding agents。
- **Session-oriented workflow**：围绕项目、工作区、Agent 与 session 组织任务，适合恢复和继续推进。
- **LAN-friendly**：可监听局域网地址，适合在办公室机器、家用服务器或开发主机上运行。
- **Pairing by default for remote access**：局域网访问时可通过 pairing code 配对受信任设备。
- **Private by design**：默认数据目录为 `~/.tiller`，日志避免记录 assistant 正文和命令输出正文。

## What can you use it for?

- 在浏览器里管理本机正在跑的 Codex / Claude / OpenCode 等 ACP Agent。
- 从另一台局域网设备查看同一台开发机上的 Agent 会话状态。
- 为每个项目和 worktree 保留会话、消息、任务日志和 diff 摘要。
- 在不搭建公网 SaaS 的前提下，把多 Agent 工作流放进一个本地控制台。

## Product split

The public repository is treated as **Tiller Core**: a local-first command deck for one operator. Core can manage local projects, worktrees, ACP agents, and manually configured Helm endpoints without requiring a Tiller account or license server.

Future managed fleet and team features belong in a separate commercial **Tiller Pro / Control Plane** line. Examples include automatic Helm node enrollment, shared team workspace, RBAC, SSO, central audit logs, hosted relay, billing and license activation.

## Install

Tiller is published as an npm preview package.

```bash
npm install -g @qianshe/tiller@preview
```

Requirements:

- Node.js `>= 22`
- At least one ACP-compatible agent installed and authenticated locally

Check the CLI:

```bash
tiller --version
tiller --help
```

## Quick start

Start Tiller:

```bash
tiller start
```

By default Tiller listens on:

```text
http://127.0.0.1:47631
```

The terminal will print:

- Web UI address
- WebSocket origin
- pairing code when pairing is enabled
- config path
- log path

Open the printed URL in your browser, add/select a project, choose an Agent, then start a session from the Deck UI.

## Host and port

Local-only:

```bash
tiller start --host 127.0.0.1 --port 47631
```

LAN/server access:

```bash
tiller start --host 0.0.0.0 --port 47631
```

Environment variables are also supported:

```bash
TILLER_HOST=0.0.0.0 TILLER_PORT=47631 tiller start
```

Or configure `~/.tiller/config.json`:

```json
{
  "daemon": {
    "host": "0.0.0.0",
    "port": 47631,
    "auth": "pairing"
  }
}
```

If the port is already used by another Tiller or old development process, Tiller will stop startup and ask you to change the port or close the existing process.

## Supported agents

Tiller is built around [Agent Client Protocol](https://agentclientprotocol.com/). Any agent that exposes an ACP-compatible runtime can be integrated.

The current product focus is on common CLI coding agents such as:

- **Codex CLI** via ACP adapter
- **Claude Agent / Claude Code** via ACP adapter
- **OpenCode**

The ACP documentation lists many agents that can be used with an ACP client, including AgentPool, Augment Code, AutoDev, Blackbox AI, Claude Agent, Cline, Codex CLI, Cursor, Docker cagent, fast-agent, Factory Droid, Gemini CLI, GitHub Copilot public preview, Goose, Junie, Kimi CLI, Kiro CLI, OpenCode, OpenHands, Qoder CLI, Qwen Code, Stakpak, stdio Bus, VT Code and more.

See the official ACP agent list: <https://agentclientprotocol.com/get-started/agents>

> Note: ACP compatibility and authentication are provided by each agent or adapter. If an agent requires its own login, API key, subscription or local CLI setup, complete that setup before connecting it from Tiller.

## Runtime data

Tiller stores runtime data under your user directory by default:

```text
~/.tiller/
  config.json
  sessions.sqlite
  trusted-devices.json
  logs/tiller.log
```

Default storage is SQLite through Node.js `node:sqlite`. Node.js 22 may print an ExperimentalWarning for the built-in SQLite API; this does not prevent Tiller from running.

If you need to fall back to JSON storage:

```bash
TILLER_SESSION_STORE=json tiller start
```

## Privacy and logs

Tiller is designed for local-first operation:

- Source workspaces stay on the machine where Tiller and the agent run.
- Session data is stored in `~/.tiller` unless you explicitly change runtime configuration.
- Helm logs keep stream/event metadata and avoid printing assistant message bodies or command output bodies.
- When troubleshooting message content, inspect `sessions.sqlite` directly instead of relying on logs.

If you expose Tiller on a LAN or server, prefer pairing mode and trusted networks. Do not expose an unauthenticated Tiller process directly to the public internet.

## Development

```bash
pnpm install
pnpm dev
```

Common checks:

```bash
pnpm typecheck
pnpm test
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/helm pack:npm
```

Build only the packaged Helm runtime and embedded Deck UI:

```bash
pnpm --filter @tiller/helm build
```

## Release channel

Current npm channel:

```bash
npm install -g @qianshe/tiller@preview
```

`preview` is intended for early testing. Expect breaking changes before a stable `latest` release.

## Updating Tiller

Tiller checks npm `latest` on startup and prints an update notice when a newer stable version is available. Startup checks never install packages automatically.

To update Tiller explicitly:

```bash
tiller update
```

This runs:

```bash
npm install -g @qianshe/tiller@latest
```

Preview releases are opt-in only. When a newer preview exists, Tiller may print:

```bash
npm install -g @qianshe/tiller@preview
```

Disable startup update checks:

```bash
TILLER_UPDATE_CHECK=0 tiller start
```

## Feedback and issues

Tiller is in public preview. Bug reports, feature requests and ACP agent compatibility notes are welcome through GitHub Issues:

<https://github.com/qianshe/Tiller/issues>

Especially useful feedback includes:

- operating system, Node.js version and Tiller version;
- which ACP agent you tried to connect;
- whether the issue happens on local-only or LAN access;
- relevant logs without secrets, tokens or private command output.

## License

Tiller Core is licensed under the [Apache License 2.0](LICENSE).

Tiller Pro, hosted services, commercial support and enterprise control-plane features may be distributed separately under commercial terms.
