import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionCompactionEntryFromProvider } from "./compaction-entry";
import {
  hydrateRuntimeCompactionEventSummary,
  hydrateSessionCompactionEntries,
} from "./compaction-summary";

test("Claude compaction hydration restores summaries for live and persisted entries", () => {
  const context = {
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
  } as any;
  const resolverCalls: unknown[] = [];
  const resolveSummary = (providerId: string | undefined, options: unknown) => {
    resolverCalls.push({ providerId, options });
    return {
      summaryText: "Recovered compacted summary",
      summaryMessageId: "summary-1",
    };
  };

  const liveEvent = hydrateRuntimeCompactionEventSummary(
    "session-claude-compaction",
    {
      type: "compaction",
      phase: "completed",
      source: "provider",
      timestamp: "2026-07-17T11:47:32.000Z",
    },
    context,
    resolveSummary,
  );
  const persistedEntries = hydrateSessionCompactionEntries(
    "session-claude-compaction",
    [
      buildSessionCompactionEntryFromProvider({
        sessionId: "session-claude-compaction",
        providerId: "claudecode",
        timestamp: "2026-07-17T11:46:35.000Z",
      }),
    ],
    context,
    resolveSummary,
  );

  assert.equal(liveEvent.summaryText, "Recovered compacted summary");
  assert.equal(liveEvent.messageId, "summary-1");
  assert.equal(persistedEntries[0]?.kind, "context_compaction");
  assert.equal(
    persistedEntries[0]?.kind === "context_compaction"
      ? persistedEntries[0].summaryText
      : undefined,
    "Recovered compacted summary",
  );
  assert.equal(
    persistedEntries[0]?.kind === "context_compaction"
      ? persistedEntries[0].detailsVisibility
      : undefined,
    "expandable",
  );
  assert.equal(
    persistedEntries[0]?.kind === "context_compaction"
      ? persistedEntries[0].summaryMessageId
      : undefined,
    "summary-1",
  );
  assert.deepEqual(resolverCalls, [
    {
      providerId: "claudecode",
      options: {
        cwd: "D:/repo",
        runtimeSessionId: "runtime-claude-1",
        completedAt: "2026-07-17T11:47:32.000Z",
      },
    },
    {
      providerId: "claudecode",
      options: {
        cwd: "D:/repo",
        runtimeSessionId: "runtime-claude-1",
        completedAt: "2026-07-17T11:46:35.000Z",
      },
    },
  ]);
});

test("Claude compaction hydration collapses a delayed replay summary into the provider row", () => {
  const context = {
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
  } as any;
  const entries = hydrateSessionCompactionEntries(
    "session-claude-compaction",
    [
      buildSessionCompactionEntryFromProvider({
        sessionId: "session-claude-compaction",
        providerId: "claudecode",
        timestamp: "2026-07-17T11:46:35.173Z",
        source: "provider",
      }),
      buildSessionCompactionEntryFromProvider({
        sessionId: "session-claude-compaction",
        providerId: "claudecode",
        timestamp: "2026-07-17T14:01:30.007Z",
        source: "heuristic",
        summaryText: "Wrapped replay summary",
        summaryMessageId: "summary-1",
      }),
    ],
    context,
    () => ({
      summaryText: "Recovered compacted summary",
      summaryMessageId: "summary-1",
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(
    entries[0]?.id,
    "compaction:session-claude-compaction:compaction:2026-07-17T11:46:35.173Z",
  );
  assert.equal(
    entries[0]?.kind === "context_compaction" ? entries[0].summaryText : undefined,
    "Recovered compacted summary",
  );
});

test("Claude compaction hydration preserves a later heuristic-only compaction", () => {
  const context = {
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
  } as any;
  const entries = hydrateSessionCompactionEntries(
    "session-claude-compaction",
    [
      buildSessionCompactionEntryFromProvider({
        sessionId: "session-claude-compaction",
        providerId: "claudecode",
        timestamp: "2026-07-17T11:46:35.173Z",
        source: "provider",
      }),
      buildSessionCompactionEntryFromProvider({
        sessionId: "session-claude-compaction",
        providerId: "claudecode",
        timestamp: "2026-07-17T14:01:30.007Z",
        source: "heuristic",
        summaryText: "Second compacted summary",
        summaryMessageId: "summary-2",
      }),
    ],
    context,
    () => ({
      summaryText: "First compacted summary",
      summaryMessageId: "summary-1",
    }),
  );

  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) =>
      entry.kind === "context_compaction" ? entry.summaryMessageId : undefined,
    ),
    ["summary-1", "summary-2"],
  );
});
