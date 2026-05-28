# Phase 26 Core / Adapter Seam Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Helm into a thin host shell and move session orchestration into core use cases and adapter ports so the runtime can later change language or provider implementations without rewriting business flow.

**Architecture:** Keep business rules in `packages/core`, contracts in `packages/domain-contracts` / `packages/shared`, and transport/runtime wiring in `apps/helm`. Preserve the current ACP runtime behavior while narrowing `apps/helm` to composition, provider lifecycle wiring, and persistence orchestration.

**Tech Stack:** TypeScript 6, Node.js 22, pnpm workspace, existing core ports/use-cases, Helm JSON-RPC handlers, ACP runtime adapter.

---

## File Structure

- Create: `packages/core/src/session/session-lifecycle.ts`
- Create: `packages/core/src/session/session-lifecycle.test.ts`
- Modify: `packages/core/src/ports/session-store-port.ts`
- Modify: `packages/core/src/ports/index.ts`
- Modify: `apps/helm/src/handlers/sessions/session-create-rpc.ts`
- Modify: `apps/helm/src/handlers/sessions/prompt-rpc.ts`
- Modify: `apps/helm/src/runtime/provider-history-service.ts`
- Modify: `apps/helm/src/runtime/session-service-factory.ts`
- Modify: `apps/helm/src/runtime/provider-lifecycle.ts`
- Modify: `packages/acp-runtime/src/events.ts`
- Modify: `apps/deck/src/features/logbook/timeline.ts`
- Modify: `apps/deck/src/features/server-events/session-events.ts`

## Guardrails

- Do not move UI code or Deck logic into core.
- Do not add speculative shared abstractions if only one call site exists.
- Do not introduce a second session store or a second runtime model.
- Keep provider-specific code inside `@tiller/acp-runtime` or Helm adapter files, not in core use cases.
- Preserve the current provider-free smoke and regression tests.

---

### Task 1: Define the core session lifecycle boundary

**Files:**
- Create: `packages/core/src/session/session-lifecycle.ts`
- Create: `packages/core/src/session/session-lifecycle.test.ts`

- [x] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createSessionLifecycle } from "./session-lifecycle.js";

test("createSessionLifecycle persists the created session through ports", async () => {
  const calls: string[] = [];
  const lifecycle = createSessionLifecycle({
    resolveProject: async (projectId) => {
      calls.push(`resolveProject:${projectId}`);
      return { id: projectId, name: "Project", helmId: "helm-1", worktrees: [{ path: "D:/repo", name: "main" }] };
    },
    resolveAgent: async (agentId) => {
      calls.push(`resolveAgent:${agentId}`);
      return { id: agentId, name: "Codex", command: "codex", transport: "stdio", protocol: "acp" };
    },
    createRuntime: async () => {
      calls.push("createRuntime");
      return { runtimeSessionId: "runtime-1", sessionConfigState: {}, sessionConfigOptions: [], sessionModelState: {}, sessionCapabilities: {} };
    },
    persistSession: async () => {
      calls.push("persistSession");
    },
  });

  const result = await lifecycle.createSession({ sessionId: "session-1", projectId: "project-1", agentId: "codex", cwd: "D:/repo" });
  assert.equal(result.session.id, "session-1");
  assert.deepEqual(calls, ["resolveProject:project-1", "resolveAgent:codex", "createRuntime", "persistSession"]);
});
```

- [x] **Step 2: Run it and confirm it fails**

Run:

```bash
pnpm --filter @tiller/core exec tsx --test src/session/session-lifecycle.test.ts
```

Expected: FAIL because `session-lifecycle.ts` does not exist yet.

- [x] **Step 3: Implement the minimal use case**

Create `packages/core/src/session/session-lifecycle.ts` with a small pure orchestration layer that depends only on ports:

```ts
export function createSessionLifecycle(deps) {
  return {
    async createSession(input) {
      const project = await deps.resolveProject(input.projectId);
      const agent = await deps.resolveAgent(input.agentId);
      const runtime = await deps.createRuntime({ sessionId: input.sessionId, project, agent, cwd: input.cwd });
      const session = { id: input.sessionId, projectId: project.id, agentId: agent.id, cwd: input.cwd, runtimeSessionId: runtime.runtimeSessionId };
      await deps.persistSession(session);
      return { session };
    },
  };
}
```

- [x] **Step 4: Run the test and confirm it passes**

Run:

```bash
pnpm --filter @tiller/core exec tsx --test src/session/session-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/session-lifecycle.ts packages/core/src/session/session-lifecycle.test.ts
git commit -m "feat：抽出会话生命周期核心用例"
```

---

### Task 2: Narrow Helm session handlers to transport only

**Files:**
- Modify: `apps/helm/src/handlers/sessions/session-create-rpc.ts`
- Modify: `apps/helm/src/handlers/sessions/prompt-rpc.ts`
- Modify: `apps/helm/src/runtime/session-service-factory.ts`
- Modify: `apps/helm/src/runtime/provider-history-service.ts`
- Test: `apps/helm/src/handlers/sessions/rpc.test.ts`

- [x] **Step 1: Add a delegation test**

Add a test that proves `createSession` and `promptSession` route through the new core lifecycle boundary and no longer own orchestration details.

- [x] **Step 2: Run it and confirm the current code fails or is incomplete**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test src/handlers/sessions/rpc.test.ts
```

- [x] **Step 3: Move orchestration out of handlers**

Keep the handlers responsible only for:

1. RPC input validation.
2. Resolving the target project/agent/worktree.
3. Calling the core lifecycle use case.
4. Broadcasting the result.

Provider selection, runtime creation, and history sync should remain in adapter/wiring files.

- [ ] **Step 4: Run Helm targeted tests**

Run:

```bash
pnpm --filter @tiller/helm test -- src/handlers/sessions/rpc.test.ts src/runtime/session-service-factory.test.ts src/runtime/provider-history-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/src/handlers/sessions/session-create-rpc.ts apps/helm/src/handlers/sessions/prompt-rpc.ts apps/helm/src/runtime/session-service-factory.ts apps/helm/src/runtime/provider-history-service.ts apps/helm/src/handlers/sessions/rpc.test.ts
git commit -m "refactor：收窄 Helm 会话编排边界"
```

---

### Task 3: Tighten the ACP adapter boundary

**Files:**
- Modify: `apps/helm/src/runtime/provider-lifecycle.ts`
- Modify: `packages/acp-runtime/src/events.ts`
- Modify: `packages/acp-runtime/src/events.test.ts`
- Modify: `apps/helm/src/runtime/events.test.ts`

- [ ] **Step 1: Add a regression test for stable thought ids**

Ensure repeated ACP thought chunks for the same logical assistant segment keep one stable id/commandId instead of being hashed from changing text.

- [ ] **Step 2: Run the ACP runtime event tests**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test ../../packages/acp-runtime/src/events.test.ts
```

- [ ] **Step 3: Keep provider-specific resolution in ACP runtime only**

If a provider needs a stable fallback or title rule, fix it inside `packages/acp-runtime`; Helm should not duplicate those heuristics.

- [ ] **Step 4: Run adapter tests and runtime smoke**

Run:

```bash
pnpm --filter @tiller/helm exec tsx --test ../../packages/acp-runtime/src/events.test.ts
pnpm --filter @tiller/helm test -- src/runtime/events.test.ts
pnpm --filter @tiller/helm smoke:runtime
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/helm/src/runtime/provider-lifecycle.ts packages/acp-runtime/src/events.ts packages/acp-runtime/src/events.test.ts apps/helm/src/runtime/events.test.ts
git commit -m "fix：收紧 ACP 适配边界"
```

---

### Task 4: Lock the seam with boundary tests and docs

**Files:**
- Modify: `apps/deck/src/features/logbook/timeline.test.ts`
- Modify: `apps/deck/src/features/server-events/server-events.test.ts`
- Modify: `docs/superpowers/plans/2026-05-28-phase-26-core-adapter-seam-hardening.md`

- [ ] **Step 1: Add a boundary regression test**

Prove Deck still consumes only the public timeline/session-event surfaces and does not reach into app internals.

- [ ] **Step 2: Run boundary checks**

Run:

```bash
pnpm --filter @tiller/deck lint
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Update the plan with the verified seam**

Mark completed tasks and note any leftovers for the next phase.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-28-phase-26-core-adapter-seam-hardening.md
git commit -m "docs：规划 Core 与 Adapter 收敛"
```

---

## Self-Review

- **Spec coverage:** The plan covers core session lifecycle extraction, Helm handler narrowing, ACP adapter tightening, and boundary verification.
- **Placeholder scan:** No TBD/TODO placeholders.
- **Type consistency:** Names align with the existing `packages/core/src/session/send-prompt-use-case.ts` and current `packages/core/src/ports/*` layout.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-28-phase-26-core-adapter-seam-hardening.md`.

Recommended execution: **Inline Execution** in this session, because the changes are boundary extraction and test-first refactors with frequent verification checkpoints.

### Progress Update - 2026-05-28

- Task 1 implemented `packages/core/src/session/session-lifecycle.ts` and test coverage.
- Task 2 started: `apps/helm/src/handlers/sessions/session-create-rpc.ts` now routes runtime-backed final session creation through `createSessionLifecycle` while preserving the existing starting-session broadcast.
- Added `session/new` characterization coverage in `apps/helm/src/handlers/sessions/rpc.test.ts`.
- Verified:
  - `pnpm --filter @tiller/core test`
  - `pnpm --filter @tiller/helm test -- src/handlers/sessions/rpc.test.ts`
  - `pnpm typecheck`
