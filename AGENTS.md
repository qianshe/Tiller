# Tiller - AI Agent 开发指南

> 本文件为 AI 编码助手提供项目上下文和行为约束。

## 项目简介

Tiller 是一个 **local-first command deck**，把运行在本机/服务器上的 Coding Agent 整理成浏览器可查看、恢复、推进和审查的工作台。

核心特性：运行时在本地、Web 与运行时同源、默认支持局域网、面向 ACP 生态。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | Node.js 22+, TypeScript 6.x |
| 包管理 | pnpm 10.x (workspace) |
| 后端 (helm) | ACP SDK, tsup, ws |
| 前端 (deck) | React 19, Vite 8, Zustand 5, react-markdown |
| 存储 | SQLite (node:sqlite) / JSON fallback |
| 协议 | ACP (Agent Client Protocol) |

## 项目结构

```
tiller/
├── apps/
│   ├── helm/          # 后端运行时 - CLI + HTTP + WebSocket 服务
│   │   └── src/
│   │       ├── app/main.ts  # 运行时入口
│   │       ├── cli.ts       # CLI 入口
│   │       ├── server.ts    # HTTP/WS 服务（仅传输/组合）
│   │       ├── rpc/         # 协议传输层（router / notifications / websocket-stream，无领域知识）
│   │       ├── handlers/    # 业务方法实现，按 domain 分组
│   │       │   ├── config/        # 配置相关 RPC 与 project-files / project-git
│   │       │   ├── sessions/      # 会话相关 RPC、清理、分页
│   │       │   ├── context.ts     # handler 上下文装配
│   │       │   └── devices-rpc.ts # 设备/配对 RPC
│   │       ├── sessions/    # 会话持久化与生命周期
│   │       │   ├── sqlite/        # 仅余 boundary 测试；实现位于 packages/persistence/src/sqlite/
│   │       │   ├── project/       # 项目相关会话数据
│   │       │   ├── summary/       # 会话摘要
│   │       │   ├── store-factory.ts / runtime-store.ts / message-store.ts / artifact-store.ts / cleanup.ts ...
│   │       │   └── facade.ts      # 对外公共 API
│   │       ├── updates/     # 自更新（check / installer / npm-registry / versions）
│   │       ├── runtime/     # 运行时核心服务
│   │       ├── auth/        # 认证与配对
│   │       ├── providers/   # ACP provider 适配
│   │       ├── state/       # 全局状态
│   │       └── logging/     # 日志系统
│   ├── deck/          # 前端 Web UI - React SPA
│   │   └── src/
│   │       ├── app/         # 仅做组合 / 入口 / 全局样式
│   │       │   ├── composition/   # 顶层 bindings：feature 公共 API ↔ store ↔ shell
│   │       │   ├── routing/       # 路由表与路由组件（仅 wiring）
│   │       │   ├── shell/         # 应用外壳：root、main、错误边界、tokens.css、styles.css
│   │       │   └── state/         # app 级派生状态 (deck-data / runtime-state)
│   │       ├── features/    # 功能模块 (feature-sliced)
│   │       │   ├── agents/          # Agent 管理
│   │       │   ├── auth/            # 认证
│   │       │   ├── helm-connection/ # Helm 连接管理
│   │       │   ├── logbook/         # 活动日志
│   │       │   ├── mission/         # 会话/任务核心 UI（含 orchestration/、facade.ts）
│   │       │   ├── overview/        # 概览页
│   │       │   ├── pairing/         # 设备配对
│   │       │   ├── preferences/     # 偏好设置
│   │       │   ├── prompt-enhancer/ # Prompt 增强
│   │       │   ├── server-events/   # 服务端事件处理
│   │       │   ├── settings/        # 设置页
│   │       │   └── toast/           # Toast 通知
│   │       ├── shared/      # 共享 UI / utils / config / assets（仅在出现真实复用后入驻）
│   │       └── store/       # Zustand：slices/、facade.ts、middleware.ts、persist.ts
│   └── mobile/        # 移动端 (早期规划，避免反向耦合 Deck/Helm)
├── packages/
│   ├── shared/            # 跨包共享类型与工具（无内部依赖；若 types.ts 多域累积难以导航再按 domain 拆）
│   ├── core/              # 后端领域模型 / 端口 / 用例；CI 由 dependency-guard 强制不依赖 apps/SDK/SQLite
│   ├── domain-contracts/  # 跨 app 契约（agent/approval/project/runtime/session），纯类型
│   ├── persistence/       # SQLite/JSON 存储适配器（含 sqlite/、summary/、message-store 等）
│   ├── acp-runtime/       # ACP 运行时集成（adapters/{claude,codex,opencode,openclaw,generic} + connection/）
│   ├── agent-registry/    # Agent 注册与发现
│   └── sync-protocol/     # 同步协议消息定义
├── docs/                  # 设计 / 发布 / 前端文档
├── output/                # 构建产物
└── tsconfig.base.json     # 共享 TS 配置
```

## 依赖关系

```
deck → shared, sync-protocol, domain-contracts
helm → core, persistence, acp-runtime, shared, domain-contracts, sync-protocol
core → shared, domain-contracts
persistence → shared
domain-contracts → shared
acp-runtime → agent-registry (可选)
agent-registry / sync-protocol / shared → 独立
# core 禁止 import apps/*、acp-runtime、persistence、sync-protocol、ACP SDK、WS、React、SQLite、Node fs；由 *-guard.test.ts 在 CI 强制
```

## 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式 (同时启动 helm + deck)
pnpm dev

# 仅启动后端
pnpm --filter @tiller/helm dev

# 仅启动前端
pnpm --filter @tiller/deck dev

# 类型检查
pnpm typecheck                    # 全量
pnpm --filter @tiller/helm typecheck
pnpm --filter @tiller/deck typecheck

# 测试
pnpm test                         # 全量
pnpm --filter @tiller/helm test
pnpm --filter @tiller/core test   # 含 dependency-guard / workspace-boundary-guard 架构边界测试
pnpm --filter @tiller/persistence test

# 构建
pnpm --filter @tiller/helm build
pnpm --filter @tiller/deck build

# 前端 lint
pnpm --filter @tiller/deck lint

# 打包验证
pnpm --filter @tiller/helm pack:npm
```

## 开发规则

### 基本原则

1. **最小变更**: 只改必须改的，不做无关重构
2. **先读后写**: 修改文件前先理解现有代码
3. **验证优先**: 改完后运行 typecheck 和相关测试
4. **单一职责优先**: 每个文件/模块只承担一个清晰职责。**SRP 是首要原则，行数仅作辅助提示**——单一职责的长文件（schema、专注的状态机等）不强制拆分；多职责的短文件无论行数都需先抽离再追加。

### 代码风格

- TypeScript strict mode，所有类型显式声明
- 文件名 kebab-case：`my-feature.ts`
- 文件名不得重复直接父目录语义：`connection/file-client.ts`、`workspace/controller.tsx`；不要写成 `connection/connection-file-client.ts`、`workspace/workspace.tsx`。`index.ts`、`types.ts`、`schema.ts`、`constants.ts` 这类职责名由父目录提供语义，允许使用。
- 类型/接口 PascalCase：`SessionMessage`
- 变量/函数 camelCase：`getSessionById`
- 常量 UPPER_SNAKE_CASE：`MAX_RETRY_COUNT`
- 使用 `import type` 导入纯类型

### Deck 前端规则

- `app/` 仅做组合：`composition/` 装配 bindings，`routing/` 仅 wiring，`shell/` 是外壳，`state/` 仅放 app 级派生数据；任何业务/视图模型逻辑都应放回 feature。
- Feature 模块通过 `index.ts` 导出公共 API；需要给其他 feature 暴露窄接口时使用 `facade.ts` 作为受认可的公共子入口。
- 禁止跨 feature 深层导入（如 `../other-feature/internal`）；新增跨 feature 依赖必须走 `index.ts` 或 `facade.ts`。
- 每个 feature 可包含：`ui/`、`hooks/`、`actions/`、`utils/`、`orchestration/`、`types.ts`、`index.ts`、可选 `facade.ts`。
- Zustand store 按 slice 拆分，放在 `store/slices/`；slice 不得反向导入 `app/*` 或 feature UI。
- 组件优先使用组合模式，避免深层 prop drilling。
- 改动 Deck 跨层导入后运行 `pnpm --filter @tiller/deck lint`。

### Helm 后端规则

- 入口与组合层：`src/app/main.ts`（运行时入口）、`src/cli.ts`（CLI）、`src/server.ts`（HTTP/WS 装配，仅传输/组合）。
- **`rpc/` vs `handlers/` 边界**：
  - `src/rpc/` 只做协议传输——JSON-RPC 路由、WebSocket 流、通知分发，**不持有领域知识**。
  - `src/handlers/<domain>/` 才是业务方法实现，按 `config/`、`sessions/` 等 domain 分组。
  - 新增 RPC 方法 = 在对应 `handlers/<domain>/` 下扩展，不要往 `rpc/` 里加业务，也不要继续把不相关方法堆进同一个 `handlers/<domain>/rpc.ts`。
  - 当 `handlers/<domain>/rpc.ts` 开始混合校验/路由/业务时，先按职责（validate / route-within-domain / implement）拆分再追加。
- 会话持久化：SQLite/JSON 实现位于 `packages/persistence/`，Helm 通过 `@tiller/persistence` 公开导出 + `sessions/store-factory.ts` 消费；不要把存储实现搬回 `apps/helm/src/sessions/sqlite/`，也不要在 handler 中直接触碰存储内部。
- 自更新：`apps/helm/src/updates/*` 独立成簇；网络调用只能停留在 `updates/npm-registry.ts`，不要泄漏到 `handlers/` 或 `server.ts`。
- 配对/可信设备：`auth/` + `state/`。
- ACP provider/进程集成：放 `packages/acp-runtime` 或 Helm `providers/`，不要落到 CLI、HTTP handler 或 Deck。
- 默认日志不得包含 assistant 消息正文与命令输出正文，遵守 `README.md` 隐私边界。

### 测试规则

- 测试文件与源文件同目录，后缀 `.test.ts`
- 使用 Node.js 内置 test runner
- 新增/修改功能必须附带测试
- 运行：`pnpm --filter @tiller/helm test` 或 `pnpm --filter @tiller/deck test`

### 提交规范

- 中文提交信息
- 格式：`type：描述`
- 类型：`feat`/`fix`/`refactor`/`docs`/`test`/`chore`
- 示例：`feat：添加 Agent 配置面板`

## 单文件膨胀预防

**主标准：单一职责（SRP）**。行数只是辅助信号，不是硬门槛。

### 真正的拆分触发条件

只要文件出现下列任意一项，就**必须先抽离再追加**，与行数无关：

- 混入了不相关的职责（UI + 数据获取 + 业务校验 + 协议传输 等）
- 同一文件里耦合了多个可独立变化的模块
- 新增功能时找不到清晰的插入点
- dispatcher 类文件里同时包含传输、校验、业务实现

反过来：单一职责的长文件（schema、纯查表、专注的状态机/解析器）**不应**因为长就强行拆。

### 行数仅作复核提示

| 行数区间 | 含义 |
|---|---|
| ≤ 250 | 通常没问题 |
| 250–500 | 复核 SRP；若确为单一职责的组合/dispatcher/schema，可保留 |
| > 500 | 强复核 SRP；追加前先确认是否需要按职责拆 |

行数本身**不会**让 PR 失败；触发拆分的永远是职责，不是数字。

### 拆分优先级

1. **提取纯函数** → `utils/`
2. **提取组件** → `ui/`
3. **提取 Hook** → `hooks/`
4. **提取常量/类型** → `types.ts`（若 types 自己开始多域，则继续按 domain 拆）
5. **提取子流程** → 独立模块或 `orchestration/`

拆分后确保：

- 原文件只保留导入与组装逻辑
- 新文件有清晰的单一职责
- 所有导入路径正确
- typecheck 通过

## 禁止事项

- 不要提交 `.env` 文件、`.tiller/` 目录、SQLite 数据库
- 不要修改 `LICENSE` 文件除非有明确指示
- 不要发布 npm 包或创建 Git tag
- 不要在没有运行 typecheck 的情况下完成任务
- 不要引入新的外部依赖而不说明理由
