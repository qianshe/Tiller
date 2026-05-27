# Phase 24 Timeline And History Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the documented timeline/history stability bugs so live ACP updates, loaded history, reimport, and image attachments produce a consistent Deck timeline without requiring manual reimport.

**Architecture:** Treat Helm as the source of durable event ordering and local-only attachment preservation. Keep ACP provider history import as an authoritative text/tool source, but never let it erase local user prompt identity or attachments. Keep Deck sorting deterministic by using one global timeline key strategy instead of mixing `timelineSequence` and timestamps inconsistently.

**Tech Stack:** Node.js 22+, TypeScript strict mode, pnpm workspace, Node test runner, SQLite-backed session stores, React/Zustand Deck timeline rendering.

---

## Source Bug Documents

- `docs/bug/history-load-disorder-and-attachment-loss.md`
- `docs/bug/thinking-and-tool-call-disorder-and-duplication.md`

## Non-Goals

- Do not start a real ACP provider migration in this phase.
- Do not change public JSON-RPC method names or response envelopes.
- Do not reintroduce the removed JSON session backend.
- Do not rewrite Deck Mission UI layout.
- Do not add a new event-sourcing database or external dependency.

## Success Criteria

1. User prompt messages persisted by Helm receive durable `timelineSequence` values.
2. New live event sequence allocation resumes above persisted messages/tool calls after Helm restart or session resume.
3. Provider history replace/repair preserves local user message attachments when provider messages represent the same prompt text.
4. Provider history paragraph splitting does not create equal-sequence assistant paragraphs that can be interleaved incorrectly with tools/thinking.
5. Deck conversation sorting uses a deterministic comparison when one item has sequence and another does not.
6. Live thinking/tool-call updates dedupe by stable id and do not create repeated identical Thinking cards.
7. Verification passes:
   - `pnpm --filter @tiller/helm test -- src/runtime/events.test.ts src/runtime/session-runtime-router.test.ts src/sessions/provider-history-sync.test.ts src/runtime/provider-history-service.test.ts`
   - `pnpm --filter @tiller/deck test -- src/features/mission/conversation src/features/server-events/session-events.test.ts src/features/logbook/message-history.test.ts`
   - `pnpm --filter @tiller/helm typecheck`
   - `pnpm --filter @tiller/deck typecheck`
   - `pnpm typecheck`

## File Responsibility Map

### Helm

- `apps/helm/src/runtime/events.ts`
  - Owns live runtime event ordering and sequence allocation.
  - Add exported helpers only when tests need to seed or inspect sequence state.
- `apps/helm/src/runtime/session-runtime-router.ts`
  - Creates local user prompt messages before runtime output.
  - Must assign a sequence through a dependency so user messages join the same ordering system.
- `apps/helm/src/sessions/provider-history-sync.ts`
  - Owns merging provider authoritative messages with local user prompts.
  - Must preserve local attachments and stable local user ids when matching provider prompts.
- `apps/helm/src/runtime/provider-history-service.ts`
  - Applies provider history sync decisions to stores.
  - Must rely on safe merge helpers and not strip local-only attachment payloads.

### Deck

- `apps/deck/src/features/mission/conversation/plain-messages.tsx`
  - Owns Mission conversation item ordering.
  - Must use one deterministic comparison for mixed sequence/no-sequence items.
- `apps/deck/src/features/server-events/session-events.ts`
  - Owns initial history replacement and live event application.
  - Must not filter out local user prompts solely because a paged history slice appears to represent them.
- `apps/deck/src/features/logbook/message-history.ts`
  - Owns history merging used by logbook/server-event paths.
  - Must dedupe repeated tool/thinking entries by stable id.

---

## Task 1: Add Durable Timeline Sequence Helpers In Helm

**Files:**

- Modify: `apps/helm/src/runtime/events.ts`
- Test: `apps/helm/src/runtime/events.test.ts`

- [ ] **Step 1: Add failing tests for sequence seeding**

Append tests that prove sequence allocation can start above persisted state:

```ts
import { seedLiveEventSequenceForSession, nextLiveEventSequenceForTest } from "./events.js";

test("live event sequence resumes above persisted timeline sequences", () => {
  seedLiveEventSequenceForSession("session-seed", [3, 12, undefined, 7]);
  assert.equal(nextLiveEventSequenceForTest("session-seed"), 13);
  assert.equal(nextLiveEventSequenceForTest("session-seed"), 14);
});

test("live event sequence ignores invalid persisted values", () => {
  seedLiveEventSequenceForSession("session-invalid", [undefined, Number.NaN, -1, 0, 2]);
  assert.equal(nextLiveEventSequenceForTest("session-invalid"), 3);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm --filter @tiller/helm test -- src/runtime/events.test.ts
```

Expected: fails because `seedLiveEventSequenceForSession` and `nextLiveEventSequenceForTest` are not exported.

- [ ] **Step 3: Implement minimal helpers**

In `apps/helm/src/runtime/events.ts`, keep `nextLiveEventSequence` as the internal allocator and add:

```ts
export function seedLiveEventSequenceForSession(
  sessionId: string,
  sequences: ReadonlyArray<number | undefined>,
) {
  const maxSequence = sequences.reduce((max, value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
      return max;
    }
    return Math.max(max, value);
  }, 0);
  liveEventSequenceBySession.set(
    sessionId,
    Math.max(liveEventSequenceBySession.get(sessionId) ?? 0, maxSequence),
  );
}

export function nextLiveEventSequenceForTest(sessionId: string) {
  return nextLiveEventSequence(sessionId);
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

```bash
pnpm --filter @tiller/helm test -- src/runtime/events.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/src/runtime/events.ts apps/helm/src/runtime/events.test.ts
git commit -m "fix：恢复会话时间线序列种子"
```

## Task 2: Assign Timeline Sequence To User Prompt Messages

**Files:**

- Modify: `apps/helm/src/runtime/session-runtime-router.ts`
- Test: `apps/helm/src/runtime/session-runtime-router.test.ts`

- [ ] **Step 1: Add failing test for user message sequence**

Add a test in `session-runtime-router.test.ts` that sends a prompt and asserts the persisted user message has a numeric sequence:

```ts
test("sendPromptToSession assigns timeline sequence to persisted user prompts", async () => {
  const persisted: AgentMessage[] = [];
  const context = createPromptRouterTestContext({ persisted });
  await sendPromptToSession({ sessionId: "session-sequence", text: "hello" }, context);
  await flushPromises();

  assert.equal(persisted[0]?.role, "user");
  assert.equal(typeof persisted[0]?.timelineSequence, "number");
});
```

If the existing test helper has a different name than `createPromptRouterTestContext`, add the assertion to the nearest existing prompt test instead of introducing a second context factory.

- [ ] **Step 2: Run focused test and confirm RED**

```bash
pnpm --filter @tiller/helm test -- src/runtime/session-runtime-router.test.ts
```

Expected: fails because user prompt messages currently omit `timelineSequence`.

- [ ] **Step 3: Thread the allocator into user message creation**

In `session-runtime-router.ts`, import the allocator from `events.ts`:

```ts
import { allocateLiveEventSequence } from "./events";
```

Then update `createUserPromptMessage` so the returned user message includes:

```ts
timelineSequence: allocateLiveEventSequence(item.sessionId),
```

If `allocateLiveEventSequence` does not exist yet, rename the existing internal helper from Task 1 to this public name and keep `nextLiveEventSequenceForTest` as the test-only wrapper.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --filter @tiller/helm test -- src/runtime/events.test.ts src/runtime/session-runtime-router.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/src/runtime/events.ts apps/helm/src/runtime/session-runtime-router.ts apps/helm/src/runtime/session-runtime-router.test.ts
git commit -m "fix：为用户 Prompt 分配时间线序列"
```

## Task 3: Preserve Local User Attachments During Provider History Merge

**Files:**

- Modify: `apps/helm/src/sessions/provider-history-sync.ts`
- Test: `apps/helm/src/sessions/provider-history-sync.test.ts`

- [ ] **Step 1: Add failing attachment preservation test**

Add this test:

```ts
test("mergeAuthoritativeMessagesWithLocalUserPrompts preserves local user attachments", () => {
  const localMessages: AgentMessage[] = [
    {
      id: "local-user-1",
      role: "user",
      text: "describe this image",
      timestamp: "2026-05-28T00:00:00.000Z",
      timelineSequence: 1,
      attachments: [
        { type: "image", mimeType: "image/png", name: "image.png", data: "data:image/png;base64,AAA" },
      ],
    },
  ];
  const authoritativeMessages: AgentMessage[] = [
    {
      id: "provider-user-1",
      role: "user",
      text: "describe this image",
      timestamp: "2026-05-28T00:00:01.000Z",
      timelineSequence: 2,
    },
  ];

  const merged = mergeAuthoritativeMessagesWithLocalUserPrompts(localMessages, authoritativeMessages);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.id, "local-user-1");
  assert.deepEqual(merged[0]?.attachments, localMessages[0]?.attachments);
  assert.equal(merged[0]?.timelineSequence, 1);
});
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
pnpm --filter @tiller/helm test -- src/sessions/provider-history-sync.test.ts
```

Expected: fails because provider user message replaces the local attachment-bearing message.

- [ ] **Step 3: Implement local user preservation helper**

In `provider-history-sync.ts`, add a helper used by `mergeAuthoritativeMessagesWithLocalUserPrompts`:

```ts
function mergeRepresentedUserMessage(local: AgentMessage, provider: AgentMessage): AgentMessage {
  return {
    ...provider,
    id: local.id,
    timestamp: local.timestamp,
    timelineSequence: local.timelineSequence ?? provider.timelineSequence,
    ...(local.attachments?.length ? { attachments: local.attachments } : {}),
  };
}
```

When an authoritative user message is represented by a local user prompt, replace the provider item with `mergeRepresentedUserMessage(local, provider)` instead of dropping the local item entirely.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --filter @tiller/helm test -- src/sessions/provider-history-sync.test.ts src/runtime/provider-history-service.test.ts
```

Expected: pass. If `provider-history-service.test.ts` does not exist, run the closest existing provider history tests shown by `find_file`.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/src/sessions/provider-history-sync.ts apps/helm/src/sessions/provider-history-sync.test.ts
git commit -m "fix：保留 Provider 历史合并中的本地附件"
```

## Task 4: Make Paragraph Timeline Sequences Strictly Ordered

**Files:**

- Modify: `apps/helm/src/sessions/provider-history-sync.ts`
- Test: `apps/helm/src/sessions/provider-history-sync.test.ts`

- [ ] **Step 1: Add failing paragraph sequence test**

Add:

```ts
test("toParagraphMessages assigns strictly increasing paragraph sequences", () => {
  const paragraphs = toParagraphMessages([
    {
      id: "assistant-1",
      role: "assistant",
      text: "first paragraph\n\nsecond paragraph",
      timestamp: "2026-05-28T00:00:00.000Z",
      timelineSequence: 10,
    },
  ]);

  assert.equal(paragraphs.length, 2);
  assert.deepEqual(
    paragraphs.map((message) => message.timelineSequence),
    [10, 11],
  );
});
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
pnpm --filter @tiller/helm test -- src/sessions/provider-history-sync.test.ts
```

Expected: fails because paragraphs currently share the same `timelineSequence`.

- [ ] **Step 3: Offset paragraph sequences**

Inside `toParagraphMessages`, when splitting one assistant message into multiple paragraphs, set:

```ts
timelineSequence:
  typeof message.timelineSequence === "number" ? message.timelineSequence + index : undefined,
```

Keep IDs as `${message.id}#p${index}`.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --filter @tiller/helm test -- src/sessions/provider-history-sync.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/src/sessions/provider-history-sync.ts apps/helm/src/sessions/provider-history-sync.test.ts
git commit -m "fix：稳定 Provider 段落时间线序列"
```

## Task 5: Stabilize Deck Mixed Timeline Sorting

**Files:**

- Modify: `apps/deck/src/features/mission/conversation/plain-messages.tsx`
- Test: `apps/deck/src/features/mission/conversation/plain-messages.test.ts`

- [ ] **Step 1: Add failing mixed-sequence sort test**

Add a test that builds two messages and one tool/thinking item where only some items have sequence. Assert the user message remains before assistant/tool when timestamps are close:

```ts
test("plain conversation sorting keeps mixed sequence items deterministic", () => {
  const sorted = sortPlainConversationItemsForTest([
    { kind: "agent", id: "assistant", timestamp: "2026-05-28T00:00:00.010Z", timelineSequence: 2 },
    { kind: "user", id: "user", timestamp: "2026-05-28T00:00:00.000Z" },
    { kind: "tool", id: "tool", timestamp: "2026-05-28T00:00:00.020Z", timelineSequence: 3 },
  ]);

  assert.deepEqual(sorted.map((item) => item.id), ["user", "assistant", "tool"]);
});
```

If the existing test helper uses different item shapes, add the same assertion through that helper and export only a narrow `sortPlainConversationItemsForTest` wrapper.

- [ ] **Step 2: Run focused Deck test and confirm RED**

```bash
pnpm --filter @tiller/deck test -- src/features/mission/conversation/plain-messages.test.ts
```

Expected: fails or lacks the helper until sorting is exported for test.

- [ ] **Step 3: Implement deterministic comparison**

Update `comparePlainConversationItems` so it always compares a tuple:

```ts
const leftSequence = left.timelineSequence ?? Number.MAX_SAFE_INTEGER;
const rightSequence = right.timelineSequence ?? Number.MAX_SAFE_INTEGER;
if (leftSequence !== rightSequence) {
  return leftSequence - rightSequence;
}
const timestampDelta = Date.parse(left.timestamp) - Date.parse(right.timestamp);
if (timestampDelta !== 0) {
  return timestampDelta;
}
return plainConversationKindRank(left.kind) - plainConversationKindRank(right.kind);
```

This keeps sequenced runtime items ordered by sequence and gives no-sequence legacy items a deterministic timestamp fallback after sequenced items. If this pushes legacy users too late in an existing fixture, adjust the fallback to synthesize sequence from insertion index in the builder instead of changing the comparator twice.

- [ ] **Step 4: Run conversation tests**

```bash
pnpm --filter @tiller/deck test -- src/features/mission/conversation
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/features/mission/conversation/plain-messages.tsx apps/deck/src/features/mission/conversation/plain-messages.test.ts
git commit -m "fix：稳定 Mission 时间线混合排序"
```

## Task 6: Prevent Initial Page Replacement From Hiding Local Users

**Files:**

- Modify: `apps/deck/src/features/server-events/session-events.ts`
- Test: `apps/deck/src/features/server-events/session-events.test.ts`

- [ ] **Step 1: Add failing page replacement test**

Create or extend a test where local state contains a user message with an attachment, loaded first page contains a provider user with same text but no attachment, and `replaceInitialMessageHistory` preserves the local attachment-bearing user.

```ts
test("replaceInitialMessageHistory preserves local user attachments represented by loaded provider history", () => {
  const current = [
    {
      id: "local-user",
      role: "user" as const,
      text: "image prompt",
      timestamp: "2026-05-28T00:00:00.000Z",
      attachments: [{ type: "image" as const, mimeType: "image/png", data: "data:image/png;base64,AAA" }],
    },
  ];
  const loaded = [
    {
      id: "provider-user",
      role: "user" as const,
      text: "image prompt",
      timestamp: "2026-05-28T00:00:01.000Z",
    },
  ];

  const next = replaceInitialMessageHistoryForTest(current, loaded);

  assert.equal(next[0]?.id, "local-user");
  assert.deepEqual(next[0]?.attachments, current[0]?.attachments);
});
```

- [ ] **Step 2: Run focused Deck test and confirm RED**

```bash
pnpm --filter @tiller/deck test -- src/features/server-events/session-events.test.ts
```

Expected: fails until the replace helper preserves local attachment-bearing users.

- [ ] **Step 3: Preserve local attachment-bearing users**

In `replaceInitialMessageHistory`, before filtering represented local users, build a map of represented local user prompts that contain attachments. Replace loaded provider user messages with the local copy when text/id representation matches and the local copy has attachments.

- [ ] **Step 4: Run focused Deck tests**

```bash
pnpm --filter @tiller/deck test -- src/features/server-events/session-events.test.ts src/features/logbook/message-history.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/deck/src/features/server-events/session-events.ts apps/deck/src/features/server-events/session-events.test.ts
git commit -m "fix：保留初始历史加载中的本地用户附件"
```

## Task 7: Dedupe Live Thinking And Tool Call Updates

**Files:**

- Modify: `packages/acp-runtime/src/events.ts`
- Modify: `apps/deck/src/features/logbook/message-history.ts`
- Test: `packages/acp-runtime/src/events.test.ts`
- Test: `apps/deck/src/features/logbook/message-history.test.ts`

- [ ] **Step 1: Add ACP runtime thinking id stability test**

Add a test for two thinking chunks in the same assistant message and assert they share one stable thinking id or use stable indexed ids matching history parse behavior.

```ts
test("live thinking tool calls use stable ids for repeated chunks", () => {
  const first = mapAcpRuntimeUpdateToEventForTest({
    sessionId: "session-thinking",
    update: { sessionUpdate: "agent_thought_chunk", messageId: "assistant-1", content: "thinking" },
  });
  const second = mapAcpRuntimeUpdateToEventForTest({
    sessionId: "session-thinking",
    update: { sessionUpdate: "agent_thought_chunk", messageId: "assistant-1", content: "thinking again" },
  });

  assert.equal(first.toolCall.id, second.toolCall.id);
});
```

Use the existing exported test helper names in `packages/acp-runtime/src/events.test.ts`; if none exist, expose a narrow helper around the existing mapping function.

- [ ] **Step 2: Add Deck dedupe test**

In `message-history.test.ts`, add two tool calls with the same id and assert the merged output contains one item with the later status/output.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
pnpm --filter @tiller/acp-runtime test -- src/events.test.ts
pnpm --filter @tiller/deck test -- src/features/logbook/message-history.test.ts
```

Expected: at least one test fails under current duplicate behavior.

- [ ] **Step 4: Implement minimal id and merge fixes**

In `packages/acp-runtime/src/events.ts`, make live thinking id derive from the stable runtime message id and thinking channel, not from chunk text hash:

```ts
id: `${stableMessageId}:thinking`,
```

In Deck merge logic, collapse same-id tool calls with later data overriding earlier data:

```ts
const byId = new Map<string, AgentToolCall>();
for (const toolCall of toolCalls) {
  byId.set(toolCall.id, { ...byId.get(toolCall.id), ...toolCall });
}
```

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @tiller/acp-runtime test -- src/events.test.ts
pnpm --filter @tiller/deck test -- src/features/logbook/message-history.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add packages/acp-runtime/src/events.ts packages/acp-runtime/src/events.test.ts apps/deck/src/features/logbook/message-history.ts apps/deck/src/features/logbook/message-history.test.ts
git commit -m "fix：去重直播 Thinking 与工具调用"
```

## Task 8: Final Regression Verification

**Files:**

- No source edits unless a preceding verification exposes a regression.

- [ ] **Step 1: Run Helm focused regression**

```bash
pnpm --filter @tiller/helm test -- src/runtime/events.test.ts src/runtime/session-runtime-router.test.ts src/sessions/provider-history-sync.test.ts
```

Expected: pass.

- [ ] **Step 2: Run Deck focused regression**

```bash
pnpm --filter @tiller/deck test -- src/features/mission/conversation src/features/server-events/session-events.test.ts src/features/logbook/message-history.test.ts
```

Expected: pass.

- [ ] **Step 3: Run package focused regression**

```bash
pnpm --filter @tiller/acp-runtime test
```

Expected: pass.

- [ ] **Step 4: Run full typecheck**

```bash
pnpm typecheck
```

Expected: pass.

- [ ] **Step 5: Run runtime smoke**

```bash
pnpm --filter @tiller/helm smoke:runtime
```

Expected: pass.

- [ ] **Step 6: Manual ACP checklist**

If a safe local ACP provider is available, run one long streaming session with thinking and tool calls and verify no duplicate Thinking cards appear before reimport. If no safe provider is available, record this as manual ACP regression not verified.

- [ ] **Step 7: Commit completion note if needed**

If no source changes remain and manual ACP is not verified, do not create an empty commit. Report the unverified manual checklist in the final phase summary.
