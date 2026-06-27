import assert from "node:assert/strict";
import test from "node:test";
import type { AgentProviderDescriptor, WorktreeSummary } from "@tiller/domain-contracts";
import { buildResumeInfo, resolveResumeUnavailableReason } from "./resume-policy";

const agent: AgentProviderDescriptor = {
  id: "codex",
  name: "Codex",
  command: "codex-acp",
  transport: "stdio",
  protocol: "acp",
};

const worktree: WorktreeSummary = {
  name: "main",
  path: "D:/repo",
};

test("resume policy rejects missing provider", () => {
  assert.equal(
    resolveResumeUnavailableReason({
      agent: undefined,
      worktree,
      runtimeSessionId: "rt-1",
      restoreMethod: "session/load",
      agentId: "missing",
      nowIso: "2026-05-24T00:00:00.000Z",
    }),
    "Agent provider missing is not configured.",
  );
});

test("resume policy rejects unsupported restore methods", () => {
  const info = buildResumeInfo({
    agent,
    worktree,
    runtimeSessionId: "rt-1",
    restoreMethod: "ui-history",
    agentId: "codex",
    nowIso: "2026-05-24T00:00:00.000Z",
  });

  assert.equal(info.state, "resume-unavailable");
  assert.equal(info.mode, "none");
  assert.equal(info.reason, "ACP restore method ui-history is unsupported.");
});

test("resume policy allows session/load and session/resume", () => {
  for (const restoreMethod of ["session/load", "session/resume"] as const) {
    const info = buildResumeInfo({
      agent,
      worktree,
      runtimeSessionId: "rt-1",
      restoreMethod,
      agentId: "codex",
      nowIso: "2026-05-24T00:00:00.000Z",
    });

    assert.equal(info.state, "resume-available");
    assert.equal(info.mode, "reconnect");
    assert.equal(info.restoreMethod, restoreMethod);
  }
});
