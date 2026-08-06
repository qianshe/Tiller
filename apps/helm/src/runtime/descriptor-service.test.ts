import assert from "node:assert/strict";
import test from "node:test";
import type { AcpAgentProvider, SessionSummary } from "@tiller/shared";
import { createRuntimeDescriptorService } from "./descriptor-service.js";

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

test("runtime descriptor persistence drops legacy provider history and marks error state stale", () => {
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
  assert.equal(descriptor.providerHistory, undefined);
});

test("runtime descriptor persistence preserves and explicitly clears pending config", () => {
  let current = {
    sessionId: "session-1",
    providerId: "codex",
    runtimeSessionId: "runtime-1",
    capabilities: { sessionLoad: true },
    pendingConfig: {
      model: "opus",
      configOptions: [{ configId: "web-search", value: false }],
    },
    lastSeenAt: "2026-05-28T00:00:00.000Z",
    state: "resumeable" as const,
  };
  const service = createRuntimeDescriptorService({
    sessionRuntimeStore: {
      get: () => current,
      upsert: (descriptor) => {
        current = descriptor as typeof current;
      },
    },
    getAgents: () => [agent],
  });
  const summary = sessionSummary({ runtimeSessionId: "runtime-1" });

  service.persistRuntimeDescriptor(summary, agent, { sessionLoad: true });
  assert.deepEqual(current.pendingConfig, {
    model: "opus",
    configOptions: [{ configId: "web-search", value: false }],
  });

  service.persistRuntimeDescriptor(summary, agent, { sessionLoad: true }, {
    reasoningEffort: "high",
    configOptions: [
      { configId: "web-search", value: true },
      { configId: "notifications", value: false },
    ],
  });
  assert.deepEqual(current.pendingConfig, {
    model: "opus",
    reasoningEffort: "high",
    configOptions: [
      { configId: "web-search", value: true },
      { configId: "notifications", value: false },
    ],
  });

  service.persistRuntimeDescriptor(summary, agent, { sessionLoad: true }, null);
  assert.equal(current.pendingConfig, undefined);
});
