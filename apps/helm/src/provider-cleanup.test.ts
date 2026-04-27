import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider } from "@tiller/shared";

test("resolveProviderCleanupPlan returns an OpenCode remote delete command when runtimeSessionId is tracked", async () => {
  const mod = await import("./provider-cleanup.js");
  const provider: AcpAgentProvider = {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: ["acp", "--pure"],
    transport: "stdio",
    protocol: "acp",
  };

  const plan = mod.resolveProviderCleanupPlan(provider, "ses_123");

  assert.equal(plan.kind, "remote-delete");
  if (plan.kind !== "remote-delete") {
    throw new Error("Expected remote-delete plan");
  }
  assert.equal(plan.command, "opencode");
  assert.deepEqual(plan.args, ["session", "delete", "ses_123", "--pure"]);
});

test("resolveProviderCleanupPlan returns unsupported for Codex ACP", async () => {
  const mod = await import("./provider-cleanup.js");
  const provider: AcpAgentProvider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    args: ["-c", "model=gpt-5.4"],
    transport: "stdio",
    protocol: "acp",
  };

  const plan = mod.resolveProviderCleanupPlan(provider, "runtime-123");

  assert.equal(plan.kind, "unsupported");
  if (plan.kind !== "unsupported") {
    throw new Error("Expected unsupported plan");
  }
  assert.match(plan.message, /Codex/i);
});

test("executeProviderCleanup runs OpenCode remote delete and reports success", async () => {
  const mod = await import("./provider-cleanup.js");
  const provider: AcpAgentProvider = {
    id: "opencode",
    name: "OpenCode",
    command: "opencode",
    args: ["acp", "--pure"],
    transport: "stdio",
    protocol: "acp",
  };

  const result = mod.executeProviderCleanup(provider, "ses_456", {
    exec: (command: string, args: string[]) => {
      assert.equal(command, "opencode");
      assert.deepEqual(args, ["session", "delete", "ses_456", "--pure"]);
      return "deleted";
    },
  });

  assert.equal(result.kind, "remote-deleted");
  if (result.kind !== "remote-deleted") {
    throw new Error("Expected remote-deleted result");
  }
  assert.match(result.message, /OpenCode/i);
});

test("executeProviderCleanup keeps Codex ACP as unsupported without invoking exec", async () => {
  const mod = await import("./provider-cleanup.js");
  const provider: AcpAgentProvider = {
    id: "codex",
    name: "Codex",
    command: "codex-acp",
    args: ["-c", "model=gpt-5.4"],
    transport: "stdio",
    protocol: "acp",
  };

  let invoked = false;
  const result = mod.executeProviderCleanup(provider, "runtime-456", {
    exec: () => {
      invoked = true;
      return "should not run";
    },
  });

  assert.equal(invoked, false);
  assert.equal(result.kind, "unsupported");
});

test("quoteWindowsCommandLine quotes OpenCode cleanup args for cmd fallback", async () => {
  const mod = await import("./provider-cleanup.js");

  assert.equal(
    mod.quoteWindowsCommandLine("opencode", ["session", "delete", "ses 789", "--pure"]),
    '"opencode" "session" "delete" "ses 789" "--pure"',
  );
});
