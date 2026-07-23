import assert from "node:assert/strict";
import test from "node:test";
import { hydrateRuntimeCompactionEventSummary } from "./compaction-summary";

test("runtime provider compaction completion stores its resolved transcript summary", () => {
  const resolverCalls: unknown[] = [];
  const event = hydrateRuntimeCompactionEventSummary(
    "session-claude-compaction",
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      timestamp: "2026-07-20T08:00:00.000Z",
    },
    {
      sessions: new Map(),
      sessionStore: {
        get: () => ({
          id: "session-claude-compaction",
          agentId: "claudecode",
          cwd: "D:/repo",
          runtimeSessionId: "runtime-claude-1",
        }),
      },
      sessionRuntimeStore: { get: () => undefined },
    } as any,
    (providerId, context) => {
      resolverCalls.push({ providerId, context });
      return {
        summaryText: "Automatically compacted context.",
        summaryMessageId: "summary-auto",
      };
    },
  );

  assert.equal(event.summaryText, "Automatically compacted context.");
  assert.equal(event.messageId, "summary-auto");
  assert.deepEqual(resolverCalls, [{
    providerId: "claudecode",
    context: {
      cwd: "D:/repo",
      runtimeSessionId: "runtime-claude-1",
      completedAt: "2026-07-20T08:00:00.000Z",
    },
  }]);
});
