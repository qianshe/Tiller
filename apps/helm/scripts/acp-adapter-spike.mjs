#!/usr/bin/env node
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function shouldSendSpikePrompt({ sendPrompt }) {
  return sendPrompt === "1" || /^true$/iu.test(String(sendPrompt ?? ""));
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

export async function runSpike(options) {
  const client = await createRpcClient(options.wsUrl);
  try {
    const [agentList, projectList] = await Promise.all([
      client.call("agent/list", {}),
      client.call("project/list", {}),
    ]);
    const target = resolveSpikeTarget({
      providerId: options.providerId,
      projectId: options.projectId,
      agents: agentList.agents ?? [],
      projects: projectList.projects ?? [],
    });
    if (target.skipped) {
      return { ok: false, skipped: true, reason: target.reason };
    }

    const connected = await client.call("agent/connect", {
      providerId: target.provider.id,
      projectId: target.project.id,
      cwd: target.cwd,
    });

    let prompted = false;
    let sessionId;
    if (connected.ok && shouldSendSpikePrompt(options)) {
      const created = await client.call("session/new", {
        projectId: target.project.id,
        cwd: target.cwd,
        agentId: target.provider.id,
      });
      sessionId = created.session?.id;
      if (!sessionId) {
        throw new Error("session/new did not return a session id");
      }
      await client.call("session/prompt", {
        sessionId,
        text: resolveSpikePrompt(options),
      });
      prompted = true;
    }

    return {
      ok: Boolean(connected.ok),
      skipped: false,
      providerId: target.provider.id,
      projectId: target.project.id,
      cwd: target.cwd,
      connected: Boolean(connected.ok),
      prompted,
      runtimeConnectionId: connected.runtimeConnectionId,
      sessionId,
      message: connected.message,
    };
  } finally {
    client.close();
  }
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

function isMainModule() {
  return Boolean(
    process.argv[1] &&
      path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]),
  );
}

if (isMainModule()) {
  const wsUrl = process.env.TILLER_SPIKE_WS_URL;
  if (!wsUrl) {
    const result = {
      ok: false,
      skipped: true,
      reason: "Set TILLER_SPIKE_WS_URL to an existing Helm WebSocket URL.",
    };
    assertSpikeEnvelope(result);
    console.log(JSON.stringify(result));
  } else {
    const result = await runSpike({
      wsUrl,
      providerId: process.env.TILLER_SPIKE_PROVIDER_ID,
      projectId: process.env.TILLER_SPIKE_PROJECT_ID,
      prompt: process.env.TILLER_SPIKE_PROMPT,
      sendPrompt: process.env.TILLER_SPIKE_SEND_PROMPT,
    });
    assertSpikeEnvelope(result);
    console.log(JSON.stringify(result));
  }
}
