import assert from "node:assert/strict";
import test from "node:test";
import type { SessionSummary } from "@tiller/shared";
import type { DeckStore } from "../../store";
import { projectSessionLiveStateSnapshot } from "./session-live-state-projection.js";

function session(title: string | undefined): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Tiller",
    helmId: "helm-1",
    cwd: "D:/myProject/tools/Tiller",
    agentId: "codex",
    agentName: "Codex",
    status: "idle",
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    messageCount: 1,
    title,
  };
}

function deckState(title: string | undefined): DeckStore {
  return {
    sessions: [session(title)],
    sessionLiveStates: {},
    sessionLiveStateSequences: {},
    sessionPlans: {},
    promptQueues: {},
    statuses: {},
    sessionConfigOptions: {},
    sessionAvailableCommands: {},
    agentAvailableCommands: {},
    diffs: {},
  } as unknown as DeckStore;
}

test("projectSessionLiveStateSnapshot does not overwrite lifecycle status", () => {
  const projection = projectSessionLiveStateSnapshot(
    {
      ...deckState("任务"),
      sessions: [{ ...session("任务"), status: "idle" }],
      statuses: { "session-1": "idle" },
    } as DeckStore,
    "session-1",
    {
      sequence: 2,
      status: {
        runtimeStatus: "running",
        effectiveStatus: "running",
        pendingApprovalCount: 0,
      },
    },
  );

  assert.equal(projection.patch?.statuses, undefined);
  assert.equal(projection.patch?.sessions, undefined);
});

test("projectSessionLiveStateSnapshot does not overwrite a saved session title", () => {
  const projection = projectSessionLiveStateSnapshot(
    deckState("发布计划"),
    "session-1",
    {
      sequence: 1,
      sessionInfo: { title: "请检查发布计划" },
    },
  );

  assert.equal(projection.patch?.sessions?.[0]?.title, "发布计划");
});

test("projectSessionLiveStateSnapshot fills an unnamed session title", () => {
  const projection = projectSessionLiveStateSnapshot(
    deckState(undefined),
    "session-1",
    {
      sequence: 1,
      sessionInfo: { title: "请检查发布计划" },
    },
  );

  assert.equal(projection.patch?.sessions?.[0]?.title, "请检查发布计划");
});
