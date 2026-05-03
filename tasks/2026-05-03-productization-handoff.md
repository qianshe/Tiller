# 2026-05-03 Tiller 产品化暂停交接

## 当前决策

- 暂缓 npm 发布、GitHub tag、公开发布。
- 先把项目跑通，再处理正式 npm 版本与发布流程。
- 当前许可证策略保持保守：`UNLICENSED` / all rights reserved，暂不授予开源使用权。
- SQLite 默认保留，Node.js `node:sqlite` ExperimentalWarning 暂时接受。

## 今晚已完成

### 1. stash / Git 状态

- stash 合并问题已处理过。
- 后续仍需在继续前重新检查：

```bash
git status --short --branch
git stash list
```

### 2. 配置和 ACP 舰员不显示的根因

根因：

- 前端的“已连接”原本只代表 WebSocket open；
- 旧逻辑要求 trusted device token 后才会发 `project.list` / `agent.list`；
- 个人版内置 Deck 无 token 时没有初始同步，所以 UI 显示 0 项目 / 0 ACP 舰员。

已做的方向：

- Helm runtime options 增加 `authMode`。
- 默认 `authMode: none`，保留 `TILLER_AUTH=pairing` 作为后续恢复配对验证入口。
- 内置 Deck 无 token 时也会请求初始同步。
- embedded personal 模式下允许无 token 自动重连。

相关文件：

- `apps/helm/src/runtime-options.ts`
- `apps/helm/src/runtime-options.test.ts`
- `apps/helm/src/server.ts`
- `packages/agent-registry/src/registry.ts`
- `apps/deck/src/app/App.tsx`
- `apps/deck/src/app/helm-endpoint.ts`
- `apps/deck/src/app/helm-endpoint.test.ts`
- `apps/deck/src/connection/reconnect-policy.ts`
- `apps/deck/src/connection/reconnect-policy.test.ts`

已验证过：

- `pnpm --filter @qianshe/tiller test`：82 pass
- `pnpm --filter @qianshe/tiller typecheck`：pass
- `pnpm --filter @tiller/deck typecheck`：pass
- 浏览器 smoke 一次成功：总览显示 2 项目 / 1 工作区 / 3 ACP 舰员。

> 明天继续时建议重新跑一遍，因为今晚中途又发现了 duplicate Helm 问题。

### 3. duplicate Helm 问题开始处理

现象：

- 只有一个内置 Helm，但任务页左侧显示两个 `LOCAL HELM`。
- 一个是浏览器当前 endpoint：`127.0.0.1:47631`；
- 一个来自后端 `helm.list`：`0.0.0.0:47631`；
- 前端按 endpoint key 去重，所以把它们当成两个 Helm。

已开始的修复方向：

- `normalizeEmbeddedHelmSummaries()`：内置 Deck 模式下，把后端返回的 Helm endpoint 归一到当前浏览器 endpoint。
- `configuredHelms` 合并时用归一化后的 helms。

相关文件：

- `apps/deck/src/app/helm-endpoint.ts`
- `apps/deck/src/app/helm-endpoint.test.ts`
- `apps/deck/src/app/App.tsx`

已跑过局部测试：

```bash
pnpm --filter @tiller/deck exec tsx --test src/app/helm-endpoint.test.ts src/connection/reconnect-policy.test.ts
```

结果：10 pass。

明天还需要：

- 跑 `pnpm --filter @tiller/deck typecheck`。
- build/pack 后用真实浏览器验证任务页只剩一个 Local Helm。
- 确认项目文件面板挂在当前活动 Project / Workspace 下。

## 今晚新增的产品级文件

> 注意：当前 `.gitignore` 里有 `docs/`，明天要检查这些新 docs 是否被 ignore。若需要纳入仓库，要调整 `.gitignore`。

新增：

- `LICENSE`：all rights reserved，占位，暂不开放源码授权。
- `NOTICE`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/LICENSE_STRATEGY.md`
- `docs/PRODUCTIZATION.md`
- `tasks/2026-05-03-productization-handoff.md`

README 已更新发布状态：

- 暂缓 npm 发布和 GitHub tag。
- 指向 release checklist / productization / license strategy。
- 明确当前 `UNLICENSED`。

## 明天优先级建议

### P0：恢复清晰工作区

1. 查看状态：

```bash
git status --short --branch
git diff --stat
```

2. 注意 `.gitignore` 当前忽略 `docs/`，如果产品文档要提交，需要修正。

### P1：修 duplicate Helm + 文件面板路径

目标：

- 内置 Deck 中只显示一个 Local Helm。
- 项目树项目都挂在当前 Local Helm 下。
- 文件列表按当前 Project / Workspace 返回，而不是显示 0 文件或错工作区。

重点检查：

- `configuredHelms`
- `missionHelms`
- `effectiveMissionHelmId`
- `activeProfileId`
- `project.files` 请求的 `projectId/workspaceId`
- `filteredWorkspaces` 是否因为多个项目共享 `main` workspace id 而错配。

### P2：配置归一化副作用

发现：启动时可能打印：

```text
[tiller] project.id.normalize updated=2
```

并改写 `C:\Users\qjq\.tiller\config.json`。

风险：

- 可能重排项目 id。
- 多项目共享 `main` workspace 时，workspace path 可能被最后一次刷新覆盖。
- 会导致 Tiller 项目和 zhene-agent 项目都指向同一个 `main` workspace，进而文件面板/会话 cwd 错乱。

建议：

- 不要在启动时随意改用户配置。
- root workspace id 应考虑 project scope，或在读取层按 `project.path` 优先解析。
- 至少先确保 session/create 和 project.files 使用 project.path fallback，而不是只按全局 workspace id 找路径。

### P3：产品文件完善

- 决定 `docs/` 是否应该被提交；若是，改 `.gitignore`。
- 补 `.npmignore` 或确认 package `files` 足够。
- 补 `.env.example`（如果需要）。
- SECURITY.md 里最终要替换真实安全联系方式。

## 暂不做

- 不 publish npm。
- 不打 GitHub tag。
- 不切正式开源协议。
- 不继续扩大多 Helm 公版 Web 能力。

## 明天推荐第一条命令

```bash
git status --short --branch
```

然后优先处理 duplicate Helm 和 workspace/file path 两个体验问题。
