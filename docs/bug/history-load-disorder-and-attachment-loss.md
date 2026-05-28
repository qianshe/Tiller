# Bug：加载旧会话时消息乱序、用户消息缺失、图片附件被重导入清空

> 状态：部分修复（2026-05-28：A1/A2/A3/A5、B1/B2 与 C1/C2 已修；A4 与 C3 仍依赖更深的历史/重导入策略验证）
> 记录日期：2026-05-27
> 重现稳定性：高（凡是加载有过工具调用 / 图片消息的旧会话都能复现）

## 现象

主人在 deck 加载历史会话时观察到三类相互独立但同源的异常：

1. **Thinking / 工具调用 / 文本内容顺序错乱**：同一轮对话里，思考卡、工具调用、assistant 文本段在时间线上的相对位置与原始发生顺序不符。
2. **用户消息有时整条不显示**：旧会话打开时会有"看不到自己说过的话"的情况。
3. **图片消息记录必然消失**：用户消息里通过粘贴/上传的图片附件在某些路径下会被清空。

主人反馈：**重新导入历史（reimport）后第 1、2 项会稍微正常一些；但是图片附件无论如何都救不回来**。

> 这与现有 [`thinking-and-tool-call-disorder-and-duplication.md`](./thinking-and-tool-call-disorder-and-duplication.md) 不同——那一篇关注的是**直播路径**的乱序/重复；本篇关注的是**历史加载 / provider 同步**这一路径独有的问题，重导入是该 bug 的"绕过手段"而非触发条件。

## 历史记录的两套实现（背景知识）

[`apps/helm/src/sessions/store-factory.ts`](../../apps/helm/src/sessions/store-factory.ts) 决定使用哪个 backend：

| Backend | 触发条件 | 关键文件 |
|---|---|---|
| **SQLite**（默认） | 不设环境变量 / SQLite 可用 | [`sqlite/store.ts`](../../apps/helm/src/sessions/sqlite/store.ts), [`sqlite/merge.ts`](../../apps/helm/src/sessions/sqlite/merge.ts) |
| **JSON**（fallback） | `TILLER_SESSION_STORE=json` 或 SQLite 初始化失败 | [`message-store.ts`](../../apps/helm/src/sessions/message-store.ts), [`artifact-store.ts`](../../apps/helm/src/sessions/artifact-store.ts) |

- 同一时间只用一套，但两套**各自维护了几乎重复的 `normalizeSessionMessages` / `mergeAgentMessageChunk` / `collapseRepeatedAssistantText`**。
- 本文档列出的根因在 **SQLite 和 JSON 两套实现中都存在**——任何修复都要双侧对齐，不能只改一边。

> **2026-05-27 更新**：已将 JSON backend 实现移除，运行时仅保留 SQLite 一套。[`message-store.ts`](../../apps/helm/src/sessions/message-store.ts) / [`artifact-store.ts`](../../apps/helm/src/sessions/artifact-store.ts) 现在只剩分页纯函数，[`runtime-store.ts`](../../apps/helm/src/sessions/runtime-store.ts) / [`summary/store.ts`](../../apps/helm/src/sessions/summary/store.ts) 只剩类型与验证器；归一化/合并集中到了 [`normalize.ts`](../../apps/helm/src/sessions/normalize.ts)；旧 JSON 文件的一次性迁移仍由 [`legacy-json-loader.ts`](../../apps/helm/src/sessions/legacy-json-loader.ts) + [`migrateJsonSessionDataToSqlite`](../../apps/helm/src/sessions/sqlite/store.ts) 兜底。**本文 A1–C3 根因尚未修复**，只是排查/修复时不再需要"双侧对齐"。

## 现象 1：Thinking / 工具调用 / 内容顺序错乱

### 根因 A1：`timelineSequence` 是 in-process ephemeral 计数器

- [`apps/helm/src/runtime/events.ts:21`](../../apps/helm/src/runtime/events.ts) 定义了 `liveEventSequenceBySession = new Map<string, number>()`，是**模块级内存 Map**。
- [`events.ts:41-45`](../../apps/helm/src/runtime/events.ts) `nextLiveEventSequence(sessionId)` 在该 Map 上递增，给 assistant message / tool-call / thinking / command-output / diff 分配 `timelineSequence`。
- **Helm 进程重启后 Map 会归零**；但每条事件的 `timelineSequence` 已被序列化进 SQLite/JSON 的 `payload_json`。
- 重启后继续对话，新事件分配的 sequence（从 1 开始）与历史中保留的 sequence 重叠，导致**全局 sequence 不再单调**。

### 根因 A2：用户消息从不分配 `timelineSequence`

- 用户消息在 [`session-runtime-router.ts:122-128`](../../apps/helm/src/runtime/session-runtime-router.ts) / [`session-runtime-router.ts:159-169`](../../apps/helm/src/runtime/session-runtime-router.ts) 创建，**没有调用 `nextLiveEventSequence`**。
- 持久化后，本地用户消息的 `timelineSequence === undefined`。

### 根因 A3：前端排序比较器在"一边有 sequence、一边没有"时静默退化

- [`plain-messages.tsx:890-902`](../../apps/deck/src/features/mission/conversation/plain-messages.tsx)：

  ```ts
  if (left.timelineSequence !== undefined && right.timelineSequence !== undefined) {
    return left.timelineSequence - right.timelineSequence;
  }
  return Date.parse(left.timestamp) - Date.parse(right.timestamp);
  ```
- 当用户消息（无 sequence）与 assistant / tool（有 sequence）比较时，比较器**退化为 timestamp**；但与 assistant 内部 / tool 内部排序时又用 sequence——同一时间线上**两套排序键并用**，结果不一致。

### 根因 A4：SQL 加载顺序与前端排序键不一致

- SQLite 查询消息时：`ORDER BY position ASC, id ASC`（[`sqlite/store.ts:258`](../../apps/helm/src/sessions/sqlite/store.ts)），`position` 是**写入数组的索引**。
- SQLite 查询工具调用时：`ORDER BY updated_at ASC, id ASC`（[`sqlite/store.ts:384`](../../apps/helm/src/sessions/sqlite/store.ts)）。
- 前端再把两个列表合一起，按 `timelineSequence`（或退化的 timestamp）二次排序。
- SQL 层的"两类各自有序"与前端"全局排序"**不在同一基线**，工具调用插入消息序列的位置会偏。
- JSON 实现同样问题：`pageSessionArtifacts` 在 [`artifact-store.ts:190-192`](../../apps/helm/src/sessions/artifact-store.ts) 按 `compareTimestampIdPosition` 排序，仍不依据 timelineSequence。

### 根因 A5：assistant 段落拆分共享同一 sequence

- [`provider-history-sync.ts:141-157`](../../apps/helm/src/sessions/provider-history-sync.ts) 的 `toParagraphMessages` 把一条 assistant 拆成 `${id}#p0/#p1/…`，**`...message` 展开时继承了同一个 `timelineSequence`**。
- 这些段落彼此并列（sequence 相等）；如果同一轮里有 think / tool-call，且它们的 sequence 落在该范围里，**渲染时会被插到拆分段落的中间**或干脆按 `plainConversationKindRank` 把工具排到所有消息段前面。
- 若旧 provider 历史里的消息没带 sequence、新工具调用带新 sequence，则工具会被排到**所有旧 assistant 段之前**。

### 综合表现
- 加载旧会话时由于上述任意一项即可错位，多数情况下叠加发生，**形成"思考/工具/文本三段顺序乱"**的现象。
- 重导入历史能缓解，是因为 reimport 会**整体替换**消息与工具调用（用 provider 视角的稳定顺序），新写入的 sequence 在写入时点上是单调的；但只要 Helm 在重导入后再重启或者继续对话，问题会再次出现。

## 现象 2：用户消息有时缺失

### 根因 B1：`mergeAuthoritativeMessagesWithLocalUserPrompts` 用整段文本做匹配

- [`provider-history-sync.ts:83-100`](../../apps/helm/src/sessions/provider-history-sync.ts)：
  ```ts
  const missingLocalUsers = localMessages.filter(
    (message) => message.role === "user" && !hasRepresentedUserPrompt(authoritativeMessages, message),
  );
  ```
- [`hasRepresentedUserPrompt`](../../apps/helm/src/sessions/provider-history-sync.ts) 只比较 `text.trim()` 或 id。
- Provider 历史里的 user 消息可能被 ACP wrapper 包了（如 `[search-mode]\n…\n---\n原文`），或者 trim 规则不同 → 同一条本地 user 既不被识别为"已表示"，也无法稳定地与 provider 那一条对齐。
- `replace` 分支调用此函数后只产出 `[...authoritative, ...missingLocalUsers]` 再按 timestamp 排序，本地 user 是否进入最终序列、插在哪个位置，**完全取决于文本是否 trim 后一致**——边界条件多到不可控。

### 根因 B2：`replaceInitialMessageHistory` 在分页场景下被误用

- 前端 [`session-events.ts:412-419`](../../apps/deck/src/features/server-events/session-events.ts)：`session/list_messages` 在 `payload.before` 为空时调用 `replaceInitialMessageHistory(current, loaded)`。
- [`replaceInitialMessageHistory`](../../apps/deck/src/features/server-events/session-events.ts) 用 `loadedMessages` 的 id 集合过滤本地：
  ```ts
  if (loadedIds.has(message.id)) return false;
  if (message.role === "user" && !hasRepresentedUserPrompt(loadedMessages, message)) return true;
  ...
  ```
- 加载的是**最近一页**，旧的本地 user 消息若 id 不在该页（被旧的某次 `applyAuthoritativeProviderHistory` 替换过 id），又因文本能被 `hasRepresentedUserPrompt` 命中而被滤掉 → **整条用户消息从 UI 上消失，但 SQL 里其实还在**（或反过来：SQL 已经被 replace 清掉了原本的本地版本）。

### 根因 B3：`shouldImportAuthoritativeProviderHistory` 与 `applyAuthoritativeProviderHistory` 的状态机歧义

- [`provider-history-sync.ts:20-25`](../../apps/helm/src/sessions/provider-history-sync.ts)：
  ```ts
  return Boolean(currentState) || localMessages.length === 0;
  ```
  返回 true 才会 import。
- 一旦 `currentState` 存在（之前 import 过一次），后续 30s 自动刷新 / resume 都会再次进入 `applyAuthoritativeProviderHistory`，并按 `planProviderHistorySync` 决定 skip/append/replace。
- replace 分支会调用 `mergeAuthoritativeMessagesWithLocalUserPrompts(localMessages, syncDecision.messages)`，把整张表重写。在 B1 描述的匹配不稳定下，**重写后的最终消息列表与之前的不再保证一致**，可能少一条本地 user，可能加一条 provider 的 wrapper 版本。

### 综合表现
- 现象 2 实质是"**本地与 provider 双视角合并时缺乏稳定的 user 消息身份键**"，并且写回 SQL/JSON 时是**整体 replace**，错误一旦发生就被持久化。
- 重导入有时能恢复，是因为 provider 这一侧本身记录了该 user 消息；不能恢复的情况就是 provider 那侧也没回报（部分 ACP agent 不导出 user prompt）。

## 现象 3：图片附件在重导入 / 自动同步后必然消失

### 根因 C1：附件只存本地

- 用户消息在 [`session-runtime-router.ts:122-128`](../../apps/helm/src/runtime/session-runtime-router.ts) 创建时把 `attachments` 一起写入本地存储；attachments 是 base64 `data` + `mimeType` + `name`，**仅存在于本地 SQLite/JSON**。
- ACP provider 在 prompt 时收到的是图片内容本身，**provider 的历史导出里不会把 base64 图片再回报**（也不应该回报；那是用户上下文）。
- 因此 provider 历史里的 user 消息**永远没有 attachments**。

### 根因 C2：`replace` 路径用 provider 版本顶掉本地版本

- [`provider-history-service.ts:166-169`](../../apps/helm/src/runtime/provider-history-service.ts) 的 replace 分支：
  ```ts
  options.sessionMessageStore.replace(
    sessionId,
    mergeAuthoritativeMessagesWithLocalUserPrompts(localMessages, syncDecision.messages),
  );
  ```
- 当 `hasRepresentedUserPrompt` 通过 trim 文本判定为"已表示"时，**本地那条带 attachments 的 user message 被整条丢弃**，留下的是 provider 的那条（无 attachments）。
- 即便 trim 不命中、本地 user 被加回，`mergeAuthoritativeMessagesWithLocalUserPrompts` 也**不会把本地 attachments 回灌到 provider 那条上**；二者作为两条独立消息共存，但若按 id 后续再有任何 dedupe / merge，本地这条仍可能被吞掉。

### 根因 C3：reimport 主动走 replace 路径

- [`session-service-factory.ts:228-237`](../../apps/helm/src/runtime/session-service-factory.ts) 的 `reimportSessionHistory` 显式调用 `importAuthoritativeProviderHistory`，必然进入 `applyAuthoritativeProviderHistory` → replace。
- 即 reimport 的设计本身**就是"用 provider 视角覆盖本地"**，对附件而言这是数据丢失操作。

### 综合表现
- 只要走过任何一次 provider 同步（resume / 30s 刷新 / 显式 reimport），**带图片的旧 user 消息要么 attachments 字段被清空，要么整条被 provider 版本顶替**。
- 重导入正是触发条件，所以"重导入后图片消息肯定消失"。


## 2026-05-28 修复进展

已完成的修复与验证：

- `apps/helm/src/runtime/events.ts`：实时 `timelineSequence` 可从持久化历史种子恢复，Helm 重启后不再从 1 重新覆盖历史序列。
- `apps/helm/src/runtime/session-runtime-router.ts`：用户 Prompt 现在也分配 `timelineSequence`。
- `apps/helm/src/sessions/provider-history-sync.ts`：assistant 段落拆分后 `timelineSequence` 严格递增；provider 历史合并时保留本地附件用户消息。
- `apps/deck/src/features/logbook/timeline.ts` 与 `apps/deck/src/features/mission/conversation/plain-messages.tsx`：混合 legacy 消息与带序列消息时排序稳定。
- `apps/deck/src/features/server-events/session-events.ts`：初始历史加载会保留本地附件用户消息。

自动化验证：

- `pnpm --filter @tiller/helm test -- src/runtime/events.test.ts src/runtime/session-runtime-router.test.ts src/sessions/provider-history-sync.test.ts` ✅ 257/257
- `pnpm --filter @tiller/deck test -- src/features/mission/conversation/plain-messages.test.ts src/features/server-events/server-events.test.ts src/features/logbook/timeline.test.ts` ✅ 57/57
- `pnpm --filter @tiller/helm smoke:runtime` ✅
- `pnpm typecheck` ✅

仍待进一步核实：

- **A4：SQL 加载顺序与前端排序键不一致** —— 当前已靠前端稳定排序与序列恢复显著缓解，但尚未对 SQLite 查询层做结构性重排。
- **C3：reimport 必然走 replace** —— 现在附件保留和序列稳定已降低损失面，但如果未来要保证“重导入不丢任何本地上下文”，仍需要更强的重导入策略或显式附件回灌方案。

结论：本文档中的“必然乱序 / 必然丢附件”已经从高频故障降为“结构性风险 + 需要真实长会话验证”的状态，不再是当前最紧急的阻塞项。
## 各根因 vs 现象对照表

| 根因 | 现象 1 顺序乱 | 现象 2 user 丢失 | 现象 3 图片丢失 |
|---|---|---|---|
| A1 timelineSequence 是 ephemeral 计数器 | ✅ | — | — |
| A2 user 消息无 sequence | ✅ | 间接（排序偏移让"看起来缺"） | — |
| A3 比较器静默退化 | ✅ | — | — |
| A4 SQL 排序键与前端不一致 | ✅ | — | — |
| A5 paragraph 拆分共享 sequence | ✅ | — | — |
| B1 user 身份键基于 trim 文本 | — | ✅ | ✅（命中后丢本地附件） |
| B2 replaceInitialMessageHistory 分页误用 | — | ✅ | — |
| B3 provider sync 状态机不稳定 | — | ✅ | ✅（每次 sync 都可能重写） |
| C1 附件只存本地 | — | — | ✅（根本约束） |
| C2 replace 用 provider 顶替本地 | — | — | ✅ |
| C3 reimport 必然走 replace | — | — | ✅ |

## 触发场景速查

| 用户动作 | 经过的代码路径 | 受影响现象 |
|---|---|---|
| 打开旧会话（首次） | `session/list_messages` + `session/get_artifacts` | 1（必然，只要会话有过工具调用） |
| 进入 idle 后 30s 内做任何操作 | `refreshAuthoritativeSessionHistory` → `applyAuthoritativeProviderHistory` | 2、3（视 provider 输出而定） |
| 点击 resume / Helm 重启后自动 resume | `startSessionResume` → `applyAuthoritativeProviderHistory` | 2、3 |
| 点击"重新导入历史" | `reimportSessionHistory` → `applyAuthoritativeProviderHistory`（必走 replace） | 2 缓解但不保证，3 必然丢失 |
| Helm 进程重启后继续对话 | 新事件分配从 1 开始的 sequence；旧的还在 | 1（变严重） |

## 关键文件清单

### Helm（双 backend 都涉及）
- [`apps/helm/src/runtime/events.ts`](../../apps/helm/src/runtime/events.ts) — `nextLiveEventSequence`、`liveEventSequenceBySession`、`bumpAssistantStreamSegment`
- [`apps/helm/src/runtime/session-runtime-router.ts`](../../apps/helm/src/runtime/session-runtime-router.ts) — `sendPromptImmediately` / `appendUserPromptMessage` 创建 user 消息但不分 sequence
- [`apps/helm/src/runtime/provider-history-service.ts`](../../apps/helm/src/runtime/provider-history-service.ts) — `applyAuthoritativeProviderHistory` / `refreshAuthoritativeSessionHistory`
- [`apps/helm/src/runtime/session-service-factory.ts`](../../apps/helm/src/runtime/session-service-factory.ts) — `reimportSessionHistory`
- [`apps/helm/src/sessions/provider-history-sync.ts`](../../apps/helm/src/sessions/provider-history-sync.ts) — `mergeAuthoritativeMessagesWithLocalUserPrompts` / `hasRepresentedUserPrompt` / `toParagraphMessages`

### SQLite backend
- [`apps/helm/src/sessions/sqlite/store.ts`](../../apps/helm/src/sessions/sqlite/store.ts) — `ORDER BY position`（消息）、`ORDER BY updated_at`（工具）
- [`apps/helm/src/sessions/sqlite/merge.ts`](../../apps/helm/src/sessions/sqlite/merge.ts) — `normalizeSessionMessages`、`mergeAgentMessageChunk`

### JSON backend
- [`apps/helm/src/sessions/message-store.ts`](../../apps/helm/src/sessions/message-store.ts) — JSON 版 `normalizeSessionMessages` / `pageSessionMessages`
- [`apps/helm/src/sessions/artifact-store.ts`](../../apps/helm/src/sessions/artifact-store.ts) — JSON 版 `pageSessionArtifacts`、`sortToolCalls`

### Deck
- [`apps/deck/src/features/server-events/session-events.ts`](../../apps/deck/src/features/server-events/session-events.ts) — `replaceInitialMessageHistory`、`hasRepresentedUserPrompt`
- [`apps/deck/src/features/logbook/message-history.ts`](../../apps/deck/src/features/logbook/message-history.ts) — `coalesceDisplayMessages`、`mergeAgentMessages`、`mergeMessageHistory`
- [`apps/deck/src/features/logbook/timeline.ts`](../../apps/deck/src/features/logbook/timeline.ts) — `sortAgentMessagesByTimeline`（只按 timestamp）、`compareTimelineItems`
- [`apps/deck/src/features/mission/conversation/plain-messages.tsx`](../../apps/deck/src/features/mission/conversation/plain-messages.tsx) — `comparePlainConversationItems`、`buildPlainConversationItems`、`sortDisplayMessages`

## 关联文档

- [`thinking-and-tool-call-disorder-and-duplication.md`](./thinking-and-tool-call-disorder-and-duplication.md) — 直播路径的 thinking/tool 乱序与重复（独立 bug，但共用部分排序基础设施）
