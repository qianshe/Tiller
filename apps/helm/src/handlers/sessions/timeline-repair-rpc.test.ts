import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentMessage,
  AgentToolCall,
  SessionTimelineEntry,
  SessionUpdateRecord,
} from "@tiller/shared";
import type { HelmHandlerContext } from "../context";
import { repairTimeline } from "./timeline-repair-rpc";
import { createSessionUpdateRecord } from "../../runtime/session-updates/reducer";

const SESSION_ID = "session-repair";

test("timeline repair preserves subagent position and both assistant occurrences without Built-in", () => {
  const records = createOccurrenceRecords();
  const currentEntries = [brokenAssistantEntry()];
  const capture = createRepairContext(currentEntries, records);

  const result = repairTimeline({ sessionId: SESSION_ID, apply: true }, capture.context);

  assert.equal(result.repairable, true);
  assert.equal(result.applied, true);
  assert.equal(result.updateCount, 4);
  assert.equal(capture.replacements.length, 1);
  const repaired = capture.replacements[0]!;
  assert.deepEqual(repaired.map((entry) => entry.kind), [
    "tool_call",
    "assistant_message",
    "assistant_message",
  ]);
  const toolEntry = repaired[0];
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.sequence : undefined, 1);
  assert.equal(toolEntry?.kind === "tool_call" ? toolEntry.toolCall.status : undefined, "completed");
  const assistantTexts = repaired
    .filter((entry) => entry.kind === "assistant_message")
    .flatMap((entry) => entry.chunks)
    .filter((chunk) => chunk.kind === "content")
    .map((chunk) => chunk.text);
  assert.deepEqual(assistantTexts, ["正文1", "正文2"]);
  assert.equal(new Set(repaired.map((entry) => entry.id)).size, repaired.length);
  assert.equal(capture.broadcasts.length, 1);
  assert.equal(capture.broadcasts[0]?.update?.kind, "timeline_batch");
  assert.equal(capture.broadcasts[0]?.update?.batch?.replace, true);
});

test("timeline repair dry-run performs no writes", () => {
  const capture = createRepairContext([brokenAssistantEntry()], createOccurrenceRecords());

  const result = repairTimeline({ sessionId: SESSION_ID }, capture.context);

  assert.equal(result.repairable, true);
  assert.equal(result.applied, false);
  assert.ok(result.changedEntryCount > 0);
  assert.equal(capture.replacements.length, 0);
  assert.equal(capture.broadcasts.length, 0);
});

test("timeline repair rejects active sessions and unavailable journals", () => {
  const active = createRepairContext([], createOccurrenceRecords(), true);
  assert.deepEqual(repairTimeline({ sessionId: SESSION_ID, apply: true }, active.context), {
    sessionId: SESSION_ID,
    repairable: false,
    applied: false,
    updateCount: 0,
    beforeEntryCount: 0,
    afterEntryCount: 0,
    changedEntryCount: 0,
    reason: "session_active",
  });
  assert.equal(active.replacements.length, 0);

  const missing = createRepairContext([], []);
  assert.equal(
    repairTimeline({ sessionId: SESSION_ID, apply: true }, missing.context).reason,
    "no_journal",
  );
  assert.equal(missing.replacements.length, 0);
});

test("timeline repair rejects canonical tails newer than the retained journal", () => {
  const records = createOccurrenceRecords();
  const newerMessage = assistantMessage("journal 之外的正文", 10);
  const capture = createRepairContext([{
    id: newerMessage.id,
    kind: "assistant_message",
    chunks: [{
      id: `${newerMessage.id}:content`,
      kind: "content",
      text: newerMessage.text,
      timestamp: newerMessage.timestamp,
      sequence: newerMessage.sequence,
    }],
    timestamp: newerMessage.timestamp,
    updatedAt: newerMessage.timestamp,
    sequence: newerMessage.sequence,
  }], records);

  const result = repairTimeline({ sessionId: SESSION_ID, apply: true }, capture.context);

  assert.equal(result.repairable, false);
  assert.equal(result.reason, "unsafe_gap");
  assert.equal(capture.replacements.length, 0);
});

test("timeline repair rejects unsequenced entries inside the journal-covered suffix", () => {
  const unsequenced: SessionTimelineEntry = {
    id: "assistant-unsequenced",
    kind: "assistant_message",
    chunks: [{
      id: "assistant-unsequenced:content",
      kind: "content",
      text: "无法证明是否被 journal 覆盖",
      timestamp: at(5),
    }],
    timestamp: at(5),
    updatedAt: at(5),
  };
  const capture = createRepairContext(
    [brokenAssistantEntry(), unsequenced],
    createOccurrenceRecords(),
  );

  const result = repairTimeline({ sessionId: SESSION_ID, apply: true }, capture.context);

  assert.equal(result.repairable, false);
  assert.equal(result.reason, "unsafe_gap");
  assert.equal(capture.replacements.length, 0);
});

test("timeline repair continues a cumulative assistant message from the preserved prefix", () => {
  const prefixMessage = assistantMessage("前", 1);
  const prefix: SessionTimelineEntry = {
    id: prefixMessage.id,
    kind: "assistant_message",
    chunks: [{
      id: `${prefixMessage.id}:content`,
      kind: "content",
      text: prefixMessage.text,
      timestamp: prefixMessage.timestamp,
      sequence: prefixMessage.sequence,
    }],
    timestamp: prefixMessage.timestamp,
    updatedAt: prefixMessage.timestamp,
    sequence: prefixMessage.sequence,
  };
  const records = [updateRecord(3, {
    type: "message",
    message: {
      ...assistantMessage("前后", 3),
      id: prefixMessage.id,
    },
  })];
  const capture = createRepairContext([prefix], records);

  const result = repairTimeline({ sessionId: SESSION_ID, apply: true }, capture.context);

  assert.equal(result.repairable, true);
  const repaired = capture.replacements[0]!;
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0]?.id, prefix.id);
  assert.equal(
    repaired[0]?.kind === "assistant_message"
      ? repaired[0].chunks.find((chunk) => chunk.kind === "content")?.text
      : undefined,
    "前后",
  );
});

test("timeline repair preserves a pruned prefix and is idempotent", () => {
  const prefixMessage: AgentMessage = {
    id: "user-prefix",
    role: "user",
    text: "更早的正文",
    timestamp: at(0),
    sequence: 0,
  };
  const prefix: SessionTimelineEntry = {
    id: prefixMessage.id,
    kind: "user_message",
    message: prefixMessage,
    timestamp: prefixMessage.timestamp,
    updatedAt: prefixMessage.timestamp,
    sequence: prefixMessage.sequence,
  };
  const capture = createRepairContext([prefix, brokenAssistantEntry()], createOccurrenceRecords());

  const first = repairTimeline({ sessionId: SESSION_ID, apply: true }, capture.context);
  const second = repairTimeline({ sessionId: SESSION_ID, apply: true }, capture.context);

  assert.equal(first.applied, true);
  assert.equal(capture.replacements[0]?.[0]?.id, prefix.id);
  assert.equal(second.applied, true);
  assert.equal(second.changedEntryCount, 0);
});

function createOccurrenceRecords(): SessionUpdateRecord[] {
  const spawn = subagent("running", at(1));
  const terminal = { ...subagent("completed", at(3)), sequence: 1 };
  return [
    updateRecord(1, { type: "tool-call", toolCall: spawn }),
    updateRecord(2, { type: "message", message: assistantMessage("正文1", 2) }),
    updateRecord(3, { type: "tool-call", toolCall: terminal }),
    updateRecord(4, {
      type: "message",
      message: { ...assistantMessage("正文2", 2), timestamp: at(4) },
    }),
  ];
}

function updateRecord(
  sequence: number,
  event: Parameters<typeof createSessionUpdateRecord>[0]["event"],
) {
  return createSessionUpdateRecord({
    sessionId: SESSION_ID,
    runtimeSessionId: "runtime-1",
    providerId: "opencode",
    source: "acp_live",
    sequence,
    receivedAt: at(sequence),
    event,
  });
}

function subagent(status: AgentToolCall["status"], timestamp: string): AgentToolCall {
  return {
    id: "subagent-1",
    commandId: "child-1",
    kind: "subagent",
    title: "Run child task",
    status,
    timestamp,
    updatedAt: timestamp,
    sequence: status === "running" ? 1 : 3,
  };
}

function assistantMessage(text: string, sequence: number): AgentMessage {
  return {
    id: "assistant-shared",
    role: "assistant",
    contentKind: "content",
    text,
    timestamp: at(sequence),
    sequence,
  };
}

function brokenAssistantEntry(): SessionTimelineEntry {
  const message = assistantMessage("正文2", 4);
  return {
    id: message.id,
    kind: "assistant_message",
    chunks: [{
      id: `${message.id}:content`,
      kind: "content",
      text: message.text,
      timestamp: message.timestamp,
      sequence: message.sequence,
    }],
    timestamp: message.timestamp,
    updatedAt: message.timestamp,
    sequence: message.sequence,
  };
}

function createRepairContext(
  initialEntries: SessionTimelineEntry[],
  records: SessionUpdateRecord[],
  active = false,
) {
  let storedEntries = initialEntries;
  const replacements: SessionTimelineEntry[][] = [];
  const broadcasts: Array<{ sessionId: string; update: any }> = [];
  const context = {
    sessions: new Map(active ? [[SESSION_ID, {}]] : []),
    sessionTimelineStore: {
      list: () => storedEntries,
      replace: (_sessionId: string, entries: SessionTimelineEntry[]) => {
        storedEntries = entries;
        replacements.push(entries);
        return entries;
      },
    },
    sessionUpdateStore: {
      listPage: () => ({ updates: records, hasMore: false }),
    },
    broadcastSessionTopic: (
      sessionId: string,
      _method: string,
      params: { update: any },
    ) => broadcasts.push({ sessionId, update: params.update }),
    broadcastNotification: () => undefined,
  } as unknown as HelmHandlerContext;
  return { context, replacements, broadcasts };
}

function at(second: number) {
  return `2026-07-15T00:00:${String(second).padStart(2, "0")}.000Z`;
}
