# Tiller

Tiller 是一个 **local-first command deck**：把运行在你电脑或服务器上的 Coding Agent，整理成一个可以在浏览器里查看、恢复、推进和审查的工作台。

它不试图做一个公网 Bot Hub，也不默认把你的内网运行时暴露给云端。Tiller 的核心思路是：

- **运行时在你这里**：Agent、工作区、日志和会话数据默认保存在本机/服务器的 `~/.tiller`。
- **Web 与运行时同源**：启动 Tiller 后直接访问它内置的 Web UI，不需要单独部署前端。
- **默认支持局域网**：适合放在个人电脑、家用服务器、办公室机器或私有服务器上运行。
- **先配对再控制**：局域网可访问不等于裸奔控制，首次设备需要 pairing code。
- **面向 ACP 生态**：Tiller 通过 ACP-compatible agent 工作，不把产品绑定到某一个模型或某一个 Agent。

## 适合什么场景

- 你在一台机器上跑 Coding Agent，希望从浏览器查看任务状态。
- 你希望在局域网里从另一台设备访问同一个 Agent 工作台。
- 你希望保留 session、消息、命令输出、diff 摘要和运行记录。
- 你希望后续把多个 Tiller 节点纳入一个更大的私有化控制台。

## 安装

当前建议先使用 tarball 试用：

```bash
npm install -g ./tiller-helm-0.1.0.tgz
```

如果后续发布到 npm，安装方式会是：

```bash
npm install -g @tiller/helm
# 或
npx @tiller/helm start
```

要求：

- Node.js 22+

## 启动

```bash
tiller start
```

默认监听：

- Host: `0.0.0.0`
- Port: `47631`

打开：

```text
http://127.0.0.1:47631
```

如果在局域网其他设备访问，使用启动日志里打印的 LAN 地址，例如：

```text
http://192.168.1.9:47631
```

## 端口和监听地址

锁定本机：

```bash
tiller start --host 127.0.0.1 --port 47631
```

指定局域网/服务器监听：

```bash
tiller start --host 0.0.0.0 --port 47631
```

也可以使用环境变量：

```bash
TILLER_HOST=0.0.0.0 TILLER_PORT=47631 tiller start
```

如果端口已被另一个 Tiller 或旧开发进程占用，Tiller 会阻止启动并提示换端口或停止旧进程。

## 第一次连接

启动后终端会打印：

- Web 访问地址
- pairing code
- 配置路径
- 日志路径

第一次打开 Web UI 时输入 pairing code 完成设备配对。之后同一浏览器会保存受信任设备信息；过期或撤销后需要重新配对。

## 数据位置

Tiller 默认把运行期数据写入用户目录：

```text
~/.tiller/
  config.json
  sessions.sqlite
  trusted-devices.json
  logs/tiller.log
```

这让它可以脱离源码仓库运行，更适合 npm 分发和服务器部署。

默认使用 SQLite 存储。Node.js 22 可能会打印 `node:sqlite` 的 ExperimentalWarning；这是 Node 对内置 SQLite API 的提示，不影响 Tiller 正常运行。若需要回退到 JSON 存储，可显式设置：

```bash
TILLER_SESSION_STORE=json tiller start
```

## 当前产品边界

当前内置 Web 只管理 **当前这个 Tiller 进程**。

后续可以扩展为两条产品线：

1. **Tiller 本地/服务器运行时**：通过 npm 分发，用户自己运行。
2. **私有化 Web 控制台**：部署在用户自己的网络中，可管理多个 Tiller 节点。

默认不建议让公网 SaaS 页面直接连接用户内网运行时；浏览器安全策略和私网访问限制会让这条路线复杂且不稳定。

## 开发

```bash
pnpm install
pnpm dev
```

常用验证：

```bash
pnpm --filter @tiller/helm test
pnpm typecheck
pnpm --filter @tiller/helm build
```

## 发布状态

当前仍是早期产品化阶段，**暂缓 npm 发布和 GitHub tag**。正式发布前必须先通过：

- [Release Checklist](docs/RELEASE_CHECKLIST.md)
- [Productization Notes](docs/PRODUCTIZATION.md)
- [License Strategy](docs/LICENSE_STRATEGY.md)

发布前至少确认：

- 包名、版本号和 dist-tag
- README 与 package metadata
- 许可证文本与 package `license` 字段一致
- GitHub release 与 npm publish 指向同一个 commit
- 打包产物脱离 monorepo 后可独立运行

## License

暂未开放开源授权。当前仓库使用 all-rights-reserved `LICENSE`，npm 包元数据继续使用 `UNLICENSED`，避免在产品策略未定前意外授予开源使用权。
