import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@tiller/shared";
import {
  pageSessionMessages,
  type SessionMessagePageOptions,
} from "./message-store.js";
import { mergeSessionMessage, normalizeSessionMessages } from "./normalize.js";

type InMemoryMessageStore = {
  append: (sessionId: string, message: AgentMessage) => AgentMessage[];
  replace: (sessionId: string, messages: AgentMessage[]) => AgentMessage[];
  list: (sessionId: string) => AgentMessage[];
  listPage: (
    sessionId: string,
    options?: SessionMessagePageOptions,
  ) => { messages: AgentMessage[]; nextCursor?: string; hasMore: boolean };
  remove: (sessionId: string) => void;
};

function createInMemoryMessageStore(): InMemoryMessageStore {
  const sessions = new Map<string, AgentMessage[]>();
  return {
    append(sessionId, message) {
      const next = mergeSessionMessage(sessions.get(sessionId) ?? [], message);
      sessions.set(sessionId, next);
      return next;
    },
    replace(sessionId, messages) {
      const next = normalizeSessionMessages(messages);
      sessions.set(sessionId, next);
      return next;
    },
    list(sessionId) {
      return sessions.get(sessionId) ?? [];
    },
    listPage(sessionId, options) {
      return pageSessionMessages(sessions.get(sessionId) ?? [], options);
    },
    remove(sessionId) {
      sessions.delete(sessionId);
    },
  };
}

test("session message normalize preserves append order instead of sorting by timestamp", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "msg-late",
    role: "assistant",
    text: "late",
    timestamp: "2026-04-27T08:00:02.000Z",
  });
  store.append("session-1", {
    id: "msg-early",
    role: "user",
    text: "early",
    timestamp: "2026-04-27T08:00:01.000Z",
  });

  assert.deepEqual(
    store.list("session-1").map((message) => message.id),
    ["msg-late", "msg-early"],
  );
});

test("session message normalize merges chunks with the same message id", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "msg-1",
    role: "assistant",
    text: "你好",
    timestamp: "2026-04-27T08:00:00.000Z",
  });
  store.append("session-1", {
    id: "msg-1",
    role: "assistant",
    text: "，主人喵~",
    timestamp: "2026-04-27T08:00:01.000Z",
  });

  assert.deepEqual(store.list("session-1"), [
    {
      id: "msg-1",
      role: "assistant",
      text: "你好，主人喵~",
      timestamp: "2026-04-27T08:00:00.000Z",
    },
  ]);
});

test("session message normalize merges consecutive assistant stream chunks without a shared id", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "session-1-msg-1000",
    role: "assistant",
    text: "执行 pnpm ",
    timestamp: "2026-04-27T08:00:00.000Z",
  });
  store.append("session-1", {
    id: "session-1-msg-1001",
    role: "assistant",
    text: "typecheck 验证喵~",
    timestamp: "2026-04-27T08:00:01.000Z",
  });

  assert.deepEqual(store.list("session-1"), [
    {
      id: "session-1-msg-1000",
      role: "assistant",
      text: "执行 pnpm typecheck 验证喵~",
      timestamp: "2026-04-27T08:00:00.000Z",
    },
  ]);
});

test("session message normalize merges stable alphanumeric assistant stream chunks", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "019dfc94-a921-7112-8980-8d57cd537787-msg-11jmeuu",
    role: "assistant",
    text: "具体",
    timestamp: "2026-05-06T12:06:32.267Z",
  });
  store.append("session-1", {
    id: "019dfc94-a921-7112-8980-8d57cd537787-msg-13ipn7f",
    role: "assistant",
    text: "消息内容",
    timestamp: "2026-05-06T12:06:32.275Z",
  });

  assert.deepEqual(store.list("session-1"), [
    {
      id: "019dfc94-a921-7112-8980-8d57cd537787-msg-11jmeuu",
      role: "assistant",
      text: "具体消息内容",
      timestamp: "2026-05-06T12:06:32.267Z",
    },
  ]);
});

test("session message normalize keeps the latest cumulative assistant stream snapshot", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "session-1-msg-1000",
    role: "assistant",
    text: "主人，已完成",
    timestamp: "2026-04-27T08:00:00.000Z",
  });
  store.append("session-1", {
    id: "session-1-msg-1001",
    role: "assistant",
    text: "主人，已完成本轮验证喵~",
    timestamp: "2026-04-27T08:00:01.000Z",
  });

  assert.deepEqual(store.list("session-1"), [
    {
      id: "session-1-msg-1000",
      role: "assistant",
      text: "主人，已完成本轮验证喵~",
      timestamp: "2026-04-27T08:00:00.000Z",
    },
  ]);
});

test("session message normalize collapses repeated assistant snapshots inside one merged payload", () => {
  const store = createInMemoryMessageStore();
  const finalAnswer =
    "主人，已完成本轮最小改动喵~\n\n| 项目 | 内容 |\n|---|---|\n| **产物** | `apps/deck/src/app/App.tsx` |";
  const bridge =
    "我会按 `superpowers` 流程做最小定位与修改，并优先用 MCP 搜索/编辑，确保 typecheck 验证喵~";
  store.append("session-1", {
    id: "session-1-msg-1000",
    role: "assistant",
    text: finalAnswer,
    timestamp: "2026-04-27T08:00:00.000Z",
  });
  store.append("session-1", {
    id: "session-1-msg-1001",
    role: "assistant",
    text: `${finalAnswer}${bridge}${finalAnswer}`,
    timestamp: "2026-04-27T08:00:01.000Z",
  });

  assert.equal(store.list("session-1")[0]?.text, finalAnswer);
});

test("session message normalize collapses repeated replayed assistant text without line breaks", () => {
  const store = createInMemoryMessageStore();
  const replayedText =
    "我会使用 `superpowers:systematic-debugging` 来先定位根因，再做最小修复喵~[🌳木] 目标：定位并修复 mission 页左侧项目展开/收起失效的根因；验收是能通过代码/类型检查，并给出可复核的交互点。先读取项目上下文与相关代码喵~";
  const replayHead = replayedText.slice(0, 55);
  const replayTail = replayedText.slice(55);
  store.append("session-1", {
    id: "session-1-msg-1000",
    role: "assistant",
    text: replayHead,
    timestamp: "2026-04-27T08:00:00.000Z",
  });
  store.append("session-1", {
    id: "session-1-msg-1001",
    role: "assistant",
    text: replayTail,
    timestamp: "2026-04-27T08:00:01.000Z",
  });
  store.append("session-1", {
    id: "session-1-msg-1002",
    role: "assistant",
    text: replayHead,
    timestamp: "2026-04-27T08:00:02.000Z",
  });
  store.append("session-1", {
    id: "session-1-msg-1003",
    role: "assistant",
    text: replayTail,
    timestamp: "2026-04-27T08:00:03.000Z",
  });

  assert.equal(store.list("session-1")[0]?.text, replayedText);
});

test("session message normalize keeps normalized assistant stream segments separate", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "session-1-msg-s0",
    role: "assistant",
    text: "工具前说明",
    timestamp: "2026-04-27T08:00:00.000Z",
  });
  store.append("session-1", {
    id: "session-1-msg-s1",
    role: "assistant",
    text: "工具后继续",
    timestamp: "2026-04-27T08:00:02.000Z",
  });

  assert.deepEqual(
    store.list("session-1").map((message) => [message.id, message.text]),
    [
      ["session-1-msg-s0", "工具前说明"],
      ["session-1-msg-s1", "工具后继续"],
    ],
  );
});

test("session message normalize refreshes duplicate replay timestamps without duplicating text", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "msg-1",
    role: "user",
    text: "还有谁？",
    timestamp: "2026-04-30T13:17:41.000Z",
  });
  store.append("session-1", {
    id: "msg-1",
    role: "user",
    text: "还有谁？",
    timestamp: "2026-04-30T13:22:46.686Z",
  });

  assert.deepEqual(store.list("session-1"), [
    {
      id: "msg-1",
      role: "user",
      text: "还有谁？",
      timestamp: "2026-04-30T13:22:46.686Z",
    },
  ]);
});

test("session message normalize replaces a session with authoritative history order", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "stale",
    role: "user",
    text: "old",
    timestamp: "2026-04-30T13:22:46.000Z",
  });
  store.replace("session-1", [
    { id: "msg-2", role: "assistant", text: "new", timestamp: "2026-04-30T09:59:11.000Z" },
    { id: "msg-1", role: "user", text: "hello", timestamp: "2026-04-30T09:58:57.000Z" },
  ]);

  assert.deepEqual(
    store.list("session-1").map((message) => message.id),
    ["msg-2", "msg-1"],
  );
});

test("session message normalize keeps provider paragraph messages separate", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "provider-message-1#p0",
    role: "assistant",
    text: "第一段",
    timestamp: "2026-05-07T08:00:00.000Z",
  });
  store.append("session-1", {
    id: "provider-message-1#p1",
    role: "assistant",
    text: "第二段",
    timestamp: "2026-05-07T08:00:00.000Z",
  });

  assert.deepEqual(
    store.list("session-1").map((message) => [message.id, message.text]),
    [
      ["provider-message-1#p0", "第一段"],
      ["provider-message-1#p1", "第二段"],
    ],
  );
});

test("session message normalize removes only the targeted session history", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "msg-1",
    role: "user",
    text: "keep? no",
    timestamp: "2026-04-27T08:00:00.000Z",
  });
  store.append("session-2", {
    id: "msg-2",
    role: "assistant",
    text: "keep me",
    timestamp: "2026-04-27T08:00:01.000Z",
  });

  store.remove("session-1");

  assert.deepEqual(store.list("session-1"), []);
  assert.equal(store.list("session-2").length, 1);
  assert.equal(store.list("session-2")[0]?.id, "msg-2");
});

test("pageSessionMessages pages latest messages and exposes an older cursor", () => {
  const store = createInMemoryMessageStore();
  for (let index = 1; index <= 5; index += 1) {
    store.append("session-1", {
      id: `msg-${index}`,
      role: index % 2 ? "user" : "assistant",
      text: `message ${index}`,
      timestamp: `2026-04-27T08:00:0${index}.000Z`,
    });
  }

  const latest = store.listPage("session-1", { limit: 2 });
  assert.deepEqual(
    latest.messages.map((message) => message.id),
    ["msg-4", "msg-5"],
  );
  assert.equal(latest.hasMore, true);
  assert.ok(latest.nextCursor);

  const older = store.listPage("session-1", { limit: 2, before: latest.nextCursor });
  assert.deepEqual(
    older.messages.map((message) => message.id),
    ["msg-2", "msg-3"],
  );
  assert.equal(older.hasMore, true);
});

test("pageSessionMessages defaults to the latest twenty messages", () => {
  const store = createInMemoryMessageStore();
  for (let index = 1; index <= 25; index += 1) {
    store.append("session-1", {
      id: `msg-${index}`,
      role: index % 2 ? "user" : "assistant",
      text: `message ${index}`,
      timestamp: `2026-04-27T08:00:${String(index).padStart(2, "0")}.000Z`,
    });
  }

  const latest = store.listPage("session-1");
  assert.equal(latest.messages.length, 20);
  assert.deepEqual(latest.messages.map((message) => message.id).slice(0, 3), [
    "msg-6",
    "msg-7",
    "msg-8",
  ]);
  assert.deepEqual(latest.messages.map((message) => message.id).slice(-3), [
    "msg-23",
    "msg-24",
    "msg-25",
  ]);
  assert.equal(latest.hasMore, true);
});

test("pageSessionMessages defaults to latest twenty paragraph messages", () => {
  const store = createInMemoryMessageStore();
  for (let index = 0; index < 25; index += 1) {
    store.append("session-1", {
      id: `provider-message-${index}#p0`,
      role: "assistant",
      text: `paragraph ${index}`,
      timestamp: `2026-05-07T08:00:${String(index).padStart(2, "0")}.000Z`,
    });
  }

  const latest = store.listPage("session-1");
  assert.equal(latest.messages.length, 20);
  assert.equal(latest.messages[0]?.id, "provider-message-5#p0");
  assert.equal(latest.messages.at(-1)?.id, "provider-message-24#p0");
});

test("pageSessionMessages does not split one provider paragraph message across pages", () => {
  const store = createInMemoryMessageStore();
  store.append("session-1", {
    id: "msg-user-1",
    role: "user",
    text: "review this plan",
    timestamp: "2026-05-07T08:00:00.000Z",
  });
  for (let index = 0; index < 25; index += 1) {
    store.append("session-1", {
      id: `provider-message-1#p${index}`,
      role: "assistant",
      text: `paragraph ${index}`,
      timestamp: `2026-05-07T08:00:${String(index + 1).padStart(2, "0")}.000Z`,
    });
  }

  const latest = store.listPage("session-1");
  assert.equal(latest.messages.length, 25);
  assert.equal(latest.messages[0]?.id, "provider-message-1#p0");
  assert.equal(latest.messages.at(-1)?.id, "provider-message-1#p24");
  assert.equal(latest.hasMore, true);
});
