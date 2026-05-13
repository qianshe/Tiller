import assert from "node:assert/strict";
import test from "node:test";
import { markSessionResumeUnavailable } from "./resume-info";

test("markSessionResumeUnavailable converts reconnect metadata into a terminal failure", () => {
  const resume = markSessionResumeUnavailable(
    {
      mode: "reconnect",
      state: "resume-available",
      reason: "ACP agent advertises session/load; Helm can try agent-side restore and history replay.",
      checkedAt: "2026-05-13T00:00:00.000Z",
      providerId: "codex",
      runtimeSessionId: "runtime-1",
      restoreMethod: "session/load",
      lastSeenAt: "2026-05-13T00:00:00.000Z",
    },
    "Workspace workspace-1 is not configured.",
  );

  assert.equal(resume.state, "resume-unavailable");
  assert.equal(resume.reason, "Workspace workspace-1 is not configured.");
  assert.equal(resume.restoreMethod, "session/load");
});
