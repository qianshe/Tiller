# Phase 25 Real ACP Adapter Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, repeatable real-ACP adapter spike that validates Tiller's runtime boundary against an actual configured ACP provider without weakening the provider-free language-adapter seam.

**Architecture:** Keep the spike outside the product hot path by placing the executable harness under `apps/helm/scripts/` and reusable assertions in small script modules. The harness must talk through the same Helm HTTP/WebSocket JSON-RPC surface as Deck, so it validates the real adapter boundary without importing UI code or bypassing `rpc/`/`handlers/` layering.

**Tech Stack:** Node.js 22+, TypeScript/tsx test runner, pnpm workspace, Helm JSON-RPC over WebSocket, existing `@tiller/helm` smoke-runtime utilities, ACP provider configured in Tiller.

---

## File Structure

- Modify: `apps/helm/package.json`
  - Add a `spike:acp-adapter` script that runs the harness.
- Create: `apps/helm/scripts/acp-adapter-spike.mjs`
  - Starts Helm or connects to an existing Helm endpoint, discovers configured agents/projects, connects a real ACP provider, optionally sends one prompt, and prints a redacted JSON summary.
- Create: `apps/helm/scripts/acp-adapter-spike.test.mjs`
  - Unit-tests provider/project selection, env parsing, redaction, and result-shape assertions without starting a real provider.
- Modify: `docs/superpowers/plans/2026-05-28-phase-25-real-acp-adapter-spike.md`
  - Mark task checkboxes as implementation proceeds.
- Optional modify: `docs/bug/thinking-and-tool-call-disorder-and-duplication.md`
  - Only update status if the spike proves a bug path is fixed with a real provider.

## Guardrails

- Do not add a new runtime abstraction unless a test fails without it.
- Do not hard-code Codex/OpenCode-only behavior in Helm; provider-specific logic remains in `packages/acp-runtime/src/adapters/*`.
- Do not log prompt text, assistant text, image base64, command output, or full tool output.
- The spike must be safe to run on machines without a configured provider: it should exit with `ok:false` and `skipped:true`, not fail CI.
- Product tests must remain provider-free and deterministic.

---

### Task 1: Add provider/project selection pure helpers

**Files:**
- Create: `apps/helm/scripts/acp-adapter-spike.mjs`
- Create: `apps/helm/scripts/acp-adapter-spike.test.mjs`

- [x] **Step 1: Write failing tests for selection and redaction**

Add this test content to `apps/helm/scripts/acp-adapter-spike.test.mjs`:

```js
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
```

- [x] **Step 2: Run the failing tests**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test scripts/acp-adapter-spike.test.mjs
```

Expected: FAIL because `apps/helm/scripts/acp-adapter-spike.mjs` does not exist yet.

- [x] **Step 3: Implement minimal pure helpers**

Create `apps/helm/scripts/acp-adapter-spike.mjs` with this initial content:

```js
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

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const result = { ok: false, skipped: true, reason: "Harness runtime not implemented yet." };
  assertSpikeEnvelope(result);
  console.log(JSON.stringify(result));
}
```

- [x] **Step 4: Run tests to verify helpers pass**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test scripts/acp-adapter-spike.test.mjs
```

Expected: PASS for 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/scripts/acp-adapter-spike.mjs apps/helm/scripts/acp-adapter-spike.test.mjs
git commit -m "test：添加真实 ACP 适配 Spike 选择器"
```

---

### Task 2: Add Helm JSON-RPC client harness

**Files:**
- Modify: `apps/helm/scripts/acp-adapter-spike.mjs`
- Test: `apps/helm/scripts/acp-adapter-spike.test.mjs`

- [x] **Step 1: Add failing tests for RPC payload shape**

Append to `apps/helm/scripts/acp-adapter-spike.test.mjs`:

```js
import { buildRpcRequest, resolveSpikePrompt } from "./acp-adapter-spike.mjs";

test("buildRpcRequest produces JSON-RPC 2.0 requests", () => {
  assert.deepEqual(buildRpcRequest(7, "agent/list", {}), {
    jsonrpc: "2.0",
    id: 7,
    method: "agent/list",
    params: {},
  });
});

test("resolveSpikePrompt defaults to a harmless short prompt", () => {
  assert.equal(resolveSpikePrompt({}), "Reply with exactly: Tiller ACP spike ok");
  assert.equal(resolveSpikePrompt({ prompt: "ping" }), "ping");
});
```

- [x] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test scripts/acp-adapter-spike.test.mjs
```

Expected: FAIL because `buildRpcRequest` and `resolveSpikePrompt` are not exported yet.

- [x] **Step 3: Implement RPC helpers and runtime skeleton**

Add these exports to `apps/helm/scripts/acp-adapter-spike.mjs`:

```js
export function buildRpcRequest(id, method, params) {
  return { jsonrpc: "2.0", id, method, params };
}

export function resolveSpikePrompt({ prompt }) {
  return prompt || "Reply with exactly: Tiller ACP spike ok";
}
```

Then add an internal `createRpcClient` using Node's built-in WebSocket:

```js
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
```

- [x] **Step 4: Run tests**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test scripts/acp-adapter-spike.test.mjs
```

Expected: PASS for helper tests.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/scripts/acp-adapter-spike.mjs apps/helm/scripts/acp-adapter-spike.test.mjs
git commit -m "feat：添加 ACP Spike RPC 客户端骨架"
```

---

### Task 3: Implement real provider connect smoke

**Files:**
- Modify: `apps/helm/scripts/acp-adapter-spike.mjs`
- Modify: `apps/helm/package.json`

- [x] **Step 1: Add package script**

Modify `apps/helm/package.json` scripts to include:

```json
"spike:acp-adapter": "node scripts/acp-adapter-spike.mjs"
```

- [x] **Step 2: Implement `runSpike` using public JSON-RPC methods**

Add this function to `apps/helm/scripts/acp-adapter-spike.mjs`:

```js
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

    return {
      ok: Boolean(connected.ok),
      skipped: false,
      providerId: target.provider.id,
      projectId: target.project.id,
      cwd: target.cwd,
      connected: Boolean(connected.ok),
      prompted: false,
      runtimeConnectionId: connected.runtimeConnectionId,
      message: connected.message,
    };
  } finally {
    client.close();
  }
}
```

Update the CLI block to read env:

```js
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const wsUrl = process.env.TILLER_SPIKE_WS_URL;
  if (!wsUrl) {
    const result = { ok: false, skipped: true, reason: "Set TILLER_SPIKE_WS_URL to an existing Helm WebSocket URL." };
    assertSpikeEnvelope(result);
    console.log(JSON.stringify(result));
  } else {
    const result = await runSpike({
      wsUrl,
      providerId: process.env.TILLER_SPIKE_PROVIDER_ID,
      projectId: process.env.TILLER_SPIKE_PROJECT_ID,
      prompt: process.env.TILLER_SPIKE_PROMPT,
    });
    assertSpikeEnvelope(result);
    console.log(JSON.stringify(result));
  }
}
```

- [x] **Step 3: Run provider-free no-env smoke**

Run:

```bash
pnpm --filter @tiller/helm spike:acp-adapter
```

Expected: exits 0 and prints JSON with `skipped:true` and reason mentioning `TILLER_SPIKE_WS_URL`.

- [x] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test scripts/acp-adapter-spike.test.mjs
pnpm --filter @tiller/helm typecheck
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/package.json apps/helm/scripts/acp-adapter-spike.mjs apps/helm/scripts/acp-adapter-spike.test.mjs
git commit -m "feat：添加真实 ACP 连接 Spike"
```

---

### Task 4: Add optional prompt round-trip gate

**Files:**
- Modify: `apps/helm/scripts/acp-adapter-spike.mjs`
- Test: `apps/helm/scripts/acp-adapter-spike.test.mjs`

- [x] **Step 1: Add failing test for prompt opt-in**

Append to `apps/helm/scripts/acp-adapter-spike.test.mjs`:

```js
import { shouldSendSpikePrompt } from "./acp-adapter-spike.mjs";

test("shouldSendSpikePrompt requires explicit opt-in", () => {
  assert.equal(shouldSendSpikePrompt({}), false);
  assert.equal(shouldSendSpikePrompt({ sendPrompt: "1" }), true);
  assert.equal(shouldSendSpikePrompt({ sendPrompt: "true" }), true);
});
```

- [x] **Step 2: Run failing tests**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test scripts/acp-adapter-spike.test.mjs
```

Expected: FAIL because `shouldSendSpikePrompt` is missing.

- [x] **Step 3: Implement opt-in prompt send**

Add helper:

```js
export function shouldSendSpikePrompt({ sendPrompt }) {
  return sendPrompt === "1" || /^true$/iu.test(String(sendPrompt ?? ""));
}
```

In `runSpike`, after connect succeeds, only when `shouldSendSpikePrompt(options)` is true:

```js
let prompted = false;
if (connected.ok && shouldSendSpikePrompt(options)) {
  await client.call("session/new", {
    providerId: target.provider.id,
    projectId: target.project.id,
    cwd: target.cwd,
  });
  prompted = true;
}
```

If current RPC requires a different session creation shape, inspect `apps/helm/src/handlers/sessions/rpc.ts` and adjust the params to the existing public method; do not add a new RPC method for the spike.

- [x] **Step 4: Run no-prompt and helper tests**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test scripts/acp-adapter-spike.test.mjs
pnpm --filter @tiller/helm spike:acp-adapter
```

Expected: tests pass; no-env script still prints `skipped:true`.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/scripts/acp-adapter-spike.mjs apps/helm/scripts/acp-adapter-spike.test.mjs
git commit -m "feat：为 ACP Spike 添加 Prompt 选项"
```

---

### Task 5: Final verification and docs status

**Files:**
- Modify: `docs/superpowers/plans/2026-05-28-phase-25-real-acp-adapter-spike.md`
- Optional modify: `docs/bug/thinking-and-tool-call-disorder-and-duplication.md`

- [x] **Step 1: Run automated verification**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test scripts/acp-adapter-spike.test.mjs
pnpm --filter @tiller/helm test -- scripts/acp-adapter-spike.test.mjs
pnpm --filter @tiller/helm smoke:runtime
pnpm typecheck
```

Expected: all pass. If `pnpm --filter @tiller/helm test -- scripts/acp-adapter-spike.test.mjs` runs the full Helm test suite due package script behavior, accept that as stronger verification.

- [ ] **Step 2: Run optional real provider spike manually if an endpoint is available**  
  _Not run in this session: no explicit existing Helm WebSocket endpoint/provider opt-in was provided._

Start Helm in another terminal or use an existing endpoint, then run:

```bash
$env:TILLER_SPIKE_WS_URL="ws://127.0.0.1:<port>/"
$env:TILLER_SPIKE_PROVIDER_ID="<configured-provider-id>"
pnpm --filter @tiller/helm spike:acp-adapter
```

Expected redacted JSON shape:

```json
{
  "ok": true,
  "skipped": false,
  "providerId": "<configured-provider-id>",
  "projectId": "<project-id>",
  "cwd": "<worktree-path>",
  "connected": true,
  "prompted": false
}
```

If no provider or endpoint is available, record `not run: no local ACP provider endpoint` in final notes; do not fail the phase.

- [ ] **Step 3: Commit plan checkbox updates and optional doc status**

```bash
git add docs/superpowers/plans/2026-05-28-phase-25-real-acp-adapter-spike.md docs/bug/thinking-and-tool-call-disorder-and-duplication.md
git commit -m "docs：记录真实 ACP Spike 验证状态"
```

Only include `docs/bug/thinking-and-tool-call-disorder-and-duplication.md` if it was actually changed.

---

## Self-Review

- **Spec coverage:** The plan validates real ACP connection through public Helm RPC, keeps provider-free tests deterministic, and adds optional prompt only behind explicit opt-in.
- **Placeholder scan:** No TBD/TODO placeholders; optional real-provider step has concrete skip behavior.
- **Type consistency:** Helper names are defined before use: `resolveSpikeTarget`, `redactSpikeText`, `assertSpikeEnvelope`, `buildRpcRequest`, `resolveSpikePrompt`, `shouldSendSpikePrompt`, `runSpike`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-phase-25-real-acp-adapter-spike.md`.

Recommended execution: **Inline Execution** in this session, because tasks are small and touch one harness boundary. Use `superpowers:executing-plans`, commit after each task, and keep product runtime untouched unless tests require it.
