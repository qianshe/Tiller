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
│   │       ├── app/         # 入口 (main.ts)
│   │       ├── auth/        # 认证与配对
│   │       ├── handlers/    # 请求处理器
│   │       ├── logging/     # 日志系统
│   │       ├── providers/   # ACP provider 适配
│   │       ├── runtime/     # 运行时核心
│   │       ├── sessions/    # 会话管理
│   │       ├── state/       # 状态管理
│   │       ├── cli.ts       # CLI 入口
│   │       └── server.ts    # HTTP/WS 服务
│   ├── deck/          # 前端 Web UI - React SPA
│   │   └── src/
│   │       ├── app/         # 入口、路由、全局样式
│   │       ├── features/    # 功能模块 (feature-sliced)
│   │       │   ├── agents/          # Agent 管理
│   │       │   ├── auth/            # 认证
│   │       │   ├── helm-connection/ # Helm 连接管理
│   │       │   ├── logbook/         # 活动日志
│   │       │   ├── mission/         # 会话/任务核心 UI
│   │       │   ├── overview/        # 概览页
│   │       │   ├── pairing/         # 设备配对
│   │       │   ├── preferences/     # 偏好设置
│   │       │   ├── prompt-enhancer/ # Prompt 增强
│   │       │   ├── server-events/   # 服务端事件处理
│   │       │   ├── settings/        # 设置页
│   │       │   └── toast/           # Toast 通知
│   │       ├── shared/      # 共享 UI 组件与工具
│   │       └── store/       # Zustand 状态管理 (slices)
│   └── mobile/        # 移动端 (早期规划)
├── packages/
│   ├── shared/            # 跨包共享类型与工具
│   ├── acp-runtime/       # ACP 运行时集成
│   ├── agent-registry/    # Agent 注册与发现
│   └── sync-protocol/     # 同步协议消息定义
├── docs/                  # 设计文档
├── output/                # 构建产物
└── tsconfig.base.json     # 共享 TS 配置
```

## 依赖关系

```
deck → shared, sync-protocol
helm → acp-runtime, shared (运行时)
acp-runtime → agent-registry (可选)
agent-registry → (独立)
sync-protocol → (独立)
shared → (独立, 无内部依赖)
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
4. **保持小文件**: 单文件不超过 300 行，超过立即拆分

### 代码风格

- TypeScript strict mode，所有类型显式声明
- 文件名 kebab-case：`my-feature.ts`
- 类型/接口 PascalCase：`SessionMessage`
- 变量/函数 camelCase：`getSessionById`
- 常量 UPPER_SNAKE_CASE：`MAX_RETRY_COUNT`
- 使用 `import type` 导入纯类型

### Deck 前端规则

- Feature 模块通过 `index.ts` 导出公共 API
- 禁止跨 feature 深层导入（如 `../other-feature/internal`）
- 每个 feature 可包含：`ui/`、`hooks/`、`actions/`、`utils/`、`types.ts`
- Zustand store 按 slice 拆分，放在 `store/slices/`
- 组件优先使用组合模式，避免深层 prop drilling

### Helm 后端规则

- 入口文件：`src/app/main.ts`
- CLI 逻辑：`src/cli.ts`
- 服务启动：`src/server.ts`
- Handler 按职责分目录：`handlers/`
- 状态管理：`state/`
- 会话管理：`sessions/`

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

当文件接近 300 行时，按以下优先级拆分：

1. **提取纯函数** → `utils/`
2. **提取组件** → `ui/`
3. **提取 Hook** → `hooks/`
4. **提取常量/类型** → `types.ts`
5. **提取子流程** → 独立模块

拆分后确保：
- 原文件只保留导入和组装逻辑
- 新文件有清晰的单一职责
- 所有导入路径正确
- typecheck 通过

## 禁止事项

- 不要提交 `.env` 文件、`.tiller/` 目录、SQLite 数据库
- 不要修改 `LICENSE` 文件除非有明确指示
- 不要发布 npm 包或创建 Git tag
- 不要在没有运行 typecheck 的情况下完成任务
- 不要引入新的外部依赖而不说明理由
