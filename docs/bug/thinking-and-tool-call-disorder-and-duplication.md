# Bug：Thinking 与工具调用在 deck 时间线中重复与乱序

> 状态：部分修复（2026-05-28：已修复稳定 thinking id、Deck 同 id 工具快照去重与 timelineSequence 排序；仍待真实长会话 ACP provider 验证）
> 记录日期：2026-05-27
> 重现稳定性：高（在长会话中尤其稳定复现）

## 现象

在 deck 的 mission 时间线中，会话运行一段时间后出现两类相关问题：

1. **Thinking 卡片重复**：连续出现多张完全相同的 `Thinking` 卡片（screenshot 显示一次性出现 13+ 张相同卡片堆叠）。
2. **Thinking 与工具调用乱序**：`agent_thought_chunk`、`tool-call`、`command-output` 在时间线上的顺序与上游 ACP `session/update` 到达顺序不一致；同一个工具调用也可能重复出现。

## 临时绕过

对会话执行**重新导入**（reimport history）后，重复和乱序消失，时间线恢复正常。这表明问题只存在于**直播事件流**这一路径，而**JSONL 历史解析**这一路径是正确的。

但不能每次都手动重新导入。

## 受影响范围

- 所有 ACP provider（Claude / Codex / Opencode / Generic）共享同一段 helm 直播事件链路，因此理论上都受影响；目前已观察到的是 Claude ACP 上。
- 仅出现在直播/streaming 阶段，session restore（走 `loadClaudeCodeHistory()` / `parseClaudeCodeJsonlHistory()`）正常。

## 重现步骤（已知）

1. 启动一个 Claude ACP 会话。
2. 进行较长一段对话，确保产生多轮 `agent_thought_chunk` 与 `tool-call`、`command-output`。
3. 观察 mission 时间线，会看到重复的 `Thinking` 卡片和乱序的工具调用。
4. 触发 reimport history → 问题消失，验证是直播路径独有。

## 怀疑的代码位置

> 以下是初步嫌疑，未做深度定位。修复时需要先实测确认。

### 1) 直播 vs 历史解析的关键差异：去重键不同

**JSONL 历史解析（正确）** [packages/acp-runtime/src/adapters/claude/history.ts:62-108](../../packages/acp-runtime/src/adapters/claude/history.ts:62)：
- 工具调用以 `Map<string, AgentToolCall>` 收集，键为 `part.id`（tool_use_id）→ 同一工具调用天然去重。
- thinking 用 `${messageId}:thinking:${index}` 作为 id（`index` 是 part 在 content 数组中的位置）→ 在同一条 assistant message 内不会冲突。
- 最后统一 `sortByTimestamp(...)` 排序。

**直播事件路径（出问题）** [packages/acp-runtime/src/events.ts:245-276](../../packages/acp-runtime/src/events.ts:245)：
- `extractThinkingToolCall()` 返回的 id 是 `${messageId}:thinking`（**没有 index 后缀**）。
- 当 `update.messageId` 缺失时，[events.ts:497-505 `resolveMessageId()` / `hashStableMessageSeed()`](../../packages/acp-runtime/src/events.ts:497) 用 `sessionId + updateType + text` 的 FNV-like hash 作为兜底 id。
  - 同一思考内容的不同 chunk → 文本不同 → hash 不同 → 产出不同的 thinking 工具调用 id → **同一段思考被切成多张卡片**。
  - 同一段文本的重复送达 → hash 相同但已经被发布 → deck 端是否真正按 id 合并需要确认。

### 2) deck 端缺少强 id 去重

- [apps/deck/src/features/logbook/message-history.ts](../../apps/deck/src/features/logbook/message-history.ts) 的 `mergeMessageHistory` / `isEquivalentMessage` 主要处理消息合并，对工具调用流的处理路径在 `mergeSessionToolCalls`。
- 需要确认 `mergeSessionToolCalls`（在 helm-connection 或 server-events feature 内）是否按 `toolCall.id` 严格去重，或者仅按 timelineSequence append。

### 3) `timelineSequence` 单调但不能消除重复

- [apps/helm/src/runtime/events.ts:312-327](../../apps/helm/src/runtime/events.ts:312) 给每个 tool-call/thinking 分配 `timelineSequence = nextLiveEventSequence(sessionId)`。
- 这个 sequence 是单调递增的，能保证排序稳定，但**对同一逻辑工具调用的多次进入会发不同 sequence**，反而可能把"一段思考被拆成多张卡片"的问题放大成时间线上的多个独立条目。

### 4) `bumpAssistantStreamSegment` 与 `flushLiveAssistantMessage` 的边界

- [apps/helm/src/runtime/events.ts:320-322](../../apps/helm/src/runtime/events.ts:320) 在非 thinking 工具调用时做 `flush + close + bump`，但 thinking 分支（events.ts:312-318）**没有 flush/bump**。
- 如果一轮 assistant 流中混着 thinking 与 tool-call，bump 时机可能导致后续 tool-call 与之前 thinking 的相对顺序紊乱。

## 排查建议

1. 在 `extractThinkingToolCall` 处加日志，确认上游 `update.messageId` 是否稳定；不稳定时观察 hash 兜底产生了多少不同 id。
2. 把 thinking 的 id 改成 `${stableMessageId}:thinking`（不依赖 chunk text 哈希）→ 同一段思考必然合并。可考虑：以 `(sessionId, currentAssistantSegment)` 作为 stable key。
3. 检查 deck 端 `mergeSessionToolCalls` 是否按 id 去重；若没有，加上"同 id 后到覆盖前到"的合并策略。
4. 对比 reimport 路径与直播路径产出的 `AgentToolCall[]` 序列（同一 jsonl 同一时间段），定位 id / timestamp / order 的差异。


## 2026-05-28 修复进展

Phase 24 已覆盖本文档中可自动化验证的直播链路基础问题：

- `packages/acp-runtime/src/events.ts`：`agent_thought_chunk` 在缺少上游 `messageId` 时不再使用 chunk 文本哈希生成 thinking id，改为稳定 session 级 fallback，避免同一思考流因文本变化拆成多张 thinking 卡片。
- `apps/deck/src/features/logbook/timeline.ts`：`mergeToolCallHistory` 对同 id 的完成态工具快照执行后到覆盖，避免完成态 replay/snapshot 被拼接成重复输出。
- `apps/helm/src/runtime/events.ts`：实时事件 sequence 可由持久化历史种子恢复，降低 Helm 重启后 timelineSequence 重叠导致的乱序风险。
- `apps/deck/src/features/mission/conversation/plain-messages.tsx` 与 `apps/deck/src/features/logbook/timeline.ts`：混合 legacy 消息与带 `timelineSequence` 的 thinking/tool 时保持稳定顺序。

已验证：

- `pnpm --filter @tiller/helm exec tsx --test ../../packages/acp-runtime/src/events.test.ts`：35/35 通过。
- `pnpm --filter @tiller/deck test -- src/features/mission/conversation/plain-messages.test.ts src/features/server-events/server-events.test.ts src/features/logbook/timeline.test.ts`：57/57 通过。
- `pnpm --filter @tiller/helm test -- src/runtime/events.test.ts src/runtime/session-runtime-router.test.ts src/sessions/provider-history-sync.test.ts`：257/257 通过。

未关闭项：尚未用真实 Claude/Codex/OpenCode ACP 长会话（≥ 20 个工具调用 + 多轮 thinking）做端到端对照，因此本文档保持“部分修复”。下一步应使用 `pnpm --filter @tiller/helm spike:acp-adapter` 或手工长会话验证直播结果是否无需 reimport 即与历史一致。
## 验收标准

- 长会话（≥ 20 个工具调用 + 多轮 thinking）直播下时间线**无任何重复**条目。
- thinking 卡片数量与上游 `.jsonl` 中 thinking part 数量一致。
- 直播完成后**不需要 reimport** 也能与 reimport 结果一致。
- helm 与 deck 双侧都加单元测试覆盖：(a) 同 id 重复事件去重；(b) 乱序到达的事件按 timelineSequence 排序。

## 关联文件

- [packages/acp-runtime/src/events.ts](../../packages/acp-runtime/src/events.ts) — `extractThinkingToolCall` / `resolveMessageId` / `hashStableMessageSeed`
- [packages/acp-runtime/src/tool-events.ts](../../packages/acp-runtime/src/tool-events.ts) — `extractToolCall`
- [apps/helm/src/runtime/events.ts](../../apps/helm/src/runtime/events.ts) — `handleRuntimeEvent` 中 `tool-call` / `message` 分支、`timelineSequence`、`flushLiveAssistantMessage`
- [apps/helm/src/runtime/live-message-buffer.ts](../../apps/helm/src/runtime/live-message-buffer.ts) — 直播缓冲
- [apps/deck/src/features/logbook/message-history.ts](../../apps/deck/src/features/logbook/message-history.ts) — deck 端消息合并
- 对照路径（正确实现）：[packages/acp-runtime/src/adapters/claude/history.ts](../../packages/acp-runtime/src/adapters/claude/history.ts) — `parseClaudeCodeJsonlHistory`
