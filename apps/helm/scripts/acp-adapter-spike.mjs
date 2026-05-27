#!/usr/bin/env node
import assert from "node:assert/strict";

export function redactSpikeText(value) {
  if (!value) return "";
  return `[redacted chars=${String(value).length}]`;
}

export function resolveSpikeTarget({ providerId, projectId, agents, projects }) {
  const provider = providerId
    ? agents.find((agent) => agent.id === providerId)
    : agents[0];
  if (!provider) {
    return { skipped: true, reason: "No ACP provider configured." };
  }

  const project = projectId
    ? projects.find((item) => item.id === projectId)
    : projects.find((item) => item.worktrees?.length) ?? projects[0];
  if (!project) {
    return { skipped: true, reason: "No project configured." };
  }

  const cwd = project.worktrees?.[0]?.path ?? project.path ?? project.cwd;
  if (!cwd) {
    return { skipped: true, reason: "Selected project has no worktree path." };
  }

  return { skipped: false, provider, project, cwd };
}

export function buildRpcRequest(id, method, params) {
  return { jsonrpc: "2.0", id, method, params };
}

export function resolveSpikePrompt({ prompt }) {
  return prompt || "Reply with exactly: Tiller ACP spike ok";
}

export function assertSpikeEnvelope(result) {
  assert.equal(typeof result.ok, "boolean", "spike result must include ok boolean");
  assert.equal(typeof result.skipped, "boolean", "spike result must include skipped boolean");
  if (result.skipped) {
    assert.equal(typeof result.reason, "string", "skipped spike must include reason");
    return;
  }
  assert.equal(typeof result.providerId, "string", "connected spike must include providerId");
  assert.equal(typeof result.projectId, "string", "connected spike must include projectId");
  assert.equal(typeof result.cwd, "string", "connected spike must include cwd");
  assert.equal(typeof result.connected, "boolean", "connected spike must include connected");
  assert.equal(typeof result.prompted, "boolean", "connected spike must include prompted");
}

async function createRpcClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data));
    if (!payload.id || !pending.has(payload.id)) return;
    const { resolve, reject } = pending.get(payload.id);
    pending.delete(payload.id);
    if (payload.error) reject(new Error(payload.error.message || "RPC error"));
    else resolve(payload.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  return {
    call(method, params = {}) {
      const id = nextId++;
      socket.send(JSON.stringify(buildRpcRequest(id, method, params)));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() {
      socket.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const result = { ok: false, skipped: true, reason: "Harness runtime not implemented yet." };
  assertSpikeEnvelope(result);
  console.log(JSON.stringify(result));
}
