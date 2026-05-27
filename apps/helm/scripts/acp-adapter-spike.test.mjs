import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSpikeEnvelope,
  redactSpikeText,
  resolveSpikeTarget,
} from "./acp-adapter-spike.mjs";

test("resolveSpikeTarget picks explicit provider and project", () => {
  const target = resolveSpikeTarget({
    providerId: "codex",
    projectId: "p2",
    agents: [
      { id: "opencode", name: "OpenCode" },
      { id: "codex", name: "Codex" },
    ],
    projects: [
      { id: "p1", name: "One", worktrees: [{ path: "D:/one" }] },
      { id: "p2", name: "Two", worktrees: [{ path: "D:/two" }] },
    ],
  });

  assert.equal(target.provider?.id, "codex");
  assert.equal(target.project?.id, "p2");
  assert.equal(target.cwd, "D:/two");
});

test("resolveSpikeTarget returns skipped when no provider is configured", () => {
  const target = resolveSpikeTarget({ agents: [], projects: [] });

  assert.equal(target.skipped, true);
  assert.match(target.reason, /No ACP provider/i);
});

test("redactSpikeText keeps shape without leaking content", () => {
  assert.equal(redactSpikeText("hello world"), "[redacted chars=11]");
  assert.equal(redactSpikeText(""), "");
});

test("assertSpikeEnvelope accepts skipped and connected results", () => {
  assertSpikeEnvelope({ ok: false, skipped: true, reason: "No ACP provider" });
  assertSpikeEnvelope({
    ok: true,
    skipped: false,
    providerId: "codex",
    projectId: "p1",
    cwd: "D:/repo",
    connected: true,
    prompted: false,
  });
});
