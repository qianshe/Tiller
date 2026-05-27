# Phase 23 Language Adapter Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that a future non-TypeScript Helm can satisfy Tiller's public transport contract by building a provider-free adapter stub first.

**Architecture:** Start with an isolated adapter proof that implements only JSON-RPC transport and provider-free inventory methods. Do not migrate real ACP providers until the stub passes the same contract smoke expectations as the TypeScript Helm reference.

**Tech Stack:** JSON-RPC 2.0 over WebSocket, HTTP static root, `packages/sync-protocol` method contracts, provider-free smoke tests.

---

## Non-Goals

- No real ACP provider process integration.
- No session prompt streaming.
- No replacement of the TypeScript Helm runtime.
- No Deck UI changes.

## Task 1: Choose Proof Runtime Boundary

**Files:**

- Create: `docs/architecture/language-adapter-proof.md`

- [ ] **Step 1: Document the proof boundary**

Create the file with this content:

```markdown
# Language Adapter Proof

The first language-adapter proof implements only the provider-free contract.

## Required Methods

- `helm/list`
- `project/list`
- `agent/list`
- `session/list`

## Required Runtime Behavior

- Starts an HTTP server.
- Opens a JSON-RPC WebSocket endpoint.
- Validates request envelopes and unknown methods.
- Returns stable inventory result envelopes.
- Does not require ACP credentials or provider binaries.

## Exit Criteria

The proof is acceptable only when a smoke script can confirm HTTP readiness, WebSocket readiness, first RPC latency, and all four inventory method result shapes.
```

- [ ] **Step 2: Verify no provider migration is implied**

Run:

```bash
Select-String -Path docs/architecture/language-adapter-proof.md -Pattern 'real ACP|prompt streaming|replacement'
```

Expected: matches only appear under `Non-Goals` or wording that explicitly defers the work.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/language-adapter-proof.md
git commit -m "docs：定义语言适配验证边界"
```

## Task 2: Add Provider-Free Smoke Spec

**Files:**

- Modify: `docs/architecture/language-adapter-proof.md`

- [ ] **Step 1: Append smoke expectations**

Append this section:

```markdown
## Provider-Free Smoke Expectations

A compatible adapter smoke result must include:

```json
{
  "ok": true,
  "timings": {
    "httpReadyMs": 0,
    "webSocketOpenMs": 0,
    "firstRpcMs": 0
  },
  "rpc": {
    "helms": 0,
    "projects": 0,
    "agents": 0,
    "sessions": 0
  }
}
```

The numeric values may differ; the field names and success semantics must remain stable.
```

- [ ] **Step 2: Verify expected fields exist**

Run:

```bash
Select-String -Path docs/architecture/language-adapter-proof.md -Pattern 'httpReadyMs|webSocketOpenMs|firstRpcMs|sessions'
```

Expected: all four field names are present.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/language-adapter-proof.md
git commit -m "docs：补充适配器冒烟输出契约"
```

## Verification

Run after all tasks:

```bash
pnpm --filter @tiller/sync-protocol test
pnpm --filter @tiller/helm smoke:runtime
pnpm --filter @tiller/helm smoke:runtime:trace
pnpm typecheck
```
