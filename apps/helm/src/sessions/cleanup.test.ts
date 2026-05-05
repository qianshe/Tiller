import test from "node:test";
import assert from "node:assert/strict";
import type { AcpAgentProvider, SessionSummary } from "@tiller/shared";
import { resolveSessionCleanupOutcome } from "./cleanup";

const provider: AcpAgentProvider = {
  id: "opencode",
  name: "OpenCode",
  kind: "custom",
  command: "opencode",
  args: ["acp", "--pure"],
  transport: "stdio",
  protocol: "acp",
};

function createSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: "session-1",
    projectId: "project-1",
    projectName: "Project One",
    helmId: "helm-1",
    workspaceId: "workspace-1",
    workspaceName: "Workspace One",
    agentId: "opencode",
    agentName: "OpenCode",
    status: "idle",
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z",
    messageCount: 1,
    ...overrides,
  };
}

test("resolveSessionCleanupOutcome treats sessions without runtimeSessionId as local-only cleanup", () => {
  const result = resolveSessionCleanupOutcome(createSummary(), provider);

  assert.deepEqual(result, {
    remoteDeleted: false,
    remoteDeletionAttempted: false,
    providerId: provider.id,
    message:
      "Legacy session had no tracked ACP runtimeSessionId; deleted local Tiller history only.",
  });
});

test("resolveSessionCleanupOutcome reports unresolved providers without attempting remote cleanup", () => {
  const result = resolveSessionCleanupOutcome(
    createSummary({ runtimeSessionId: "runtime-1" }),
    undefined,
  );

  assert.deepEqual(result, {
    remoteDeleted: false,
    remoteDeletionAttempted: false,
    providerId: "opencode",
    message:
      "Session data deleted locally, but the original ACP provider could not be resolved for remote cleanup.",
  });
});

test("resolveSessionCleanupOutcome normalizes provider cleanup success", () => {
  const result = resolveSessionCleanupOutcome(
    createSummary({ runtimeSessionId: "runtime-1" }),
    provider,
    () => ({
      kind: "remote-deleted",
      providerId: provider.id,
      message: "deleted",
    }),
  );

  assert.deepEqual(result, {
    remoteDeleted: true,
    remoteDeletionAttempted: true,
    providerId: provider.id,
    message: "deleted",
  });
});

test("resolveSessionCleanupOutcome normalizes provider cleanup failure", () => {
  const result = resolveSessionCleanupOutcome(
    createSummary({ runtimeSessionId: "runtime-1" }),
    provider,
    () => ({
      kind: "remote-delete-failed",
      providerId: provider.id,
      message: "boom",
    }),
  );

  assert.deepEqual(result, {
    remoteDeleted: false,
    remoteDeletionAttempted: true,
    providerId: provider.id,
    message: "boom",
  });
});
