import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider, SessionSummary } from "@tiller/shared";
import { createRuntimeDescriptorService } from "./runtime-descriptor-service.js";

function sessionSummary(overrides: Partial<SessionSummary>): SessionSummary {
  return {
    id: "session-1",
    title: "Session",
    status: "idle",
    projectId: "project-1",
    projectName: "Project",
    helmId: "helm-1",
    agentId: "codex",
    agentName: "Codex",
    cwd: "D:/repo",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    messageCount: 0,
    ...overrides,
  };
}

const agent: AcpAgentProvider = {
  id: "codex",
  name: "Codex",
  command: "codex",
  transport: "stdio",
  protocol: "acp",
};

test("runtime descriptor persistence is a no-op when nothing is restorable", () => {
  const upserts: unknown[] = [];
  const service = createRuntimeDescriptorService({
    sessionRuntimeStore: {
      get: () => undefined,
      upsert: (descriptor) => upserts.push(descriptor),
    },
    getAgents: () => [agent],
  });

  service.persistRuntimeDescriptor(sessionSummary({ runtimeSessionId: undefined }), agent);
  assert.equal(upserts.length, 0);
});

test("runtime descriptor persistence preserves provider history and marks error state stale", () => {
  const upserts: unknown[] = [];
  const service = createRuntimeDescriptorService({
    sessionRuntimeStore: {
      get: () => ({
        sessionId: "session-1",
        providerId: "codex",
        lastSeenAt: "2026-05-28T00:00:00.000Z",
        state: "resumeable",
        providerHistory: { syncedAt: "2026-05-28T00:00:00.000Z" },
      }),
      upsert: (descriptor) => upserts.push(descriptor),
    },
    getAgents: () => [agent],
  });

  service.persistRuntimeDescriptor(
    sessionSummary({ runtimeSessionId: "runtime-1", status: "error" }),
    agent,
    { sessionLoad: true },
  );

  assert.equal(upserts.length, 1);
  const descriptor = upserts[0] as { providerHistory?: unknown; state?: string };
  assert.equal(descriptor.state, "stale");
  assert.deepEqual(descriptor.providerHistory, { syncedAt: "2026-05-28T00:00:00.000Z" });
});
