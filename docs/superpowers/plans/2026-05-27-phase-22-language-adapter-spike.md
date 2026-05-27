# Phase 22 Language Adapter Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define and validate the smallest adapter contract a non-TypeScript Helm implementation must satisfy before any language migration begins.

**Architecture:** Keep Deck and `packages/sync-protocol` as the compatibility boundary. Treat the current TypeScript Helm as the reference adapter and describe the required transport, persistence, runtime-event, trace, and smoke behaviors without moving implementation details into shared packages.

**Tech Stack:** TypeScript strict mode, JSON-RPC over WebSocket, Node test runner, pnpm workspace, ACP runtime contracts, SQLite/JSON session persistence.

---

## Non-Goals

- Do not rewrite Helm in another language in this phase.
- Do not change public JSON-RPC method names or payload shapes.
- Do not introduce code generation or a new schema dependency.
- Do not touch Deck UI while frontend architecture work is active in parallel.

## Adapter Compatibility Boundary

A future Helm implementation in another language must provide these externally observable contracts:

1. **Transport:** HTTP static serving plus JSON-RPC 2.0 over WebSocket.
2. **Inventory RPC:** `helm/list`, `project/list`, `agent/list`, `session/list` must work without real ACP credentials.
3. **Session RPC:** session creation, prompt, draft, resume, configure, cleanup, and history APIs must preserve existing method names and result envelopes.
4. **Realtime:** server notifications must preserve `session/update`, `error/raised`, `approval/created`, and `approval/resolved` payload ownership.
5. **Persistence:** session summaries, messages, artifacts, and runtime descriptors must survive process restart or explicitly report a fallback mode.
6. **ACP Runtime Events:** provider streams must map into stable session messages, tool calls, command outputs, approvals, diffs, and completion statuses.
7. **Prompt Trace:** when prompt trace is enabled, every adapter must emit comparable lifecycle events for submit, route, runtime, event, and Deck-applied phases.
8. **Smoke:** provider-free runtime smoke must pass before any real ACP provider test is required.

## Task 1: Freeze Reference Contract Checklist

**Files:**

- Create: `docs/architecture/language-adapter-checklist.md`

- [ ] **Step 1: Write the checklist document**

Create the file with this content:

```markdown
# Language Adapter Checklist

A non-TypeScript Helm implementation is compatible only when it satisfies every required item below.

## Required Transport

- Serves Deck static assets from the same origin as the WebSocket endpoint.
- Accepts JSON-RPC 2.0 request envelopes with `id`, `method`, and `params`.
- Sends JSON-RPC 2.0 success or error responses with stable error codes.
- Supports server notifications without `id`.

## Required Provider-Free RPC

- `helm/list` returns `{ "helms": [] }` or populated Helm summaries.
- `project/list` returns `{ "projects": [] }` or populated project summaries.
- `agent/list` returns `{ "agents": [] }` or populated provider summaries.
- `session/list` returns `{ "sessions": [], "hasMore": false }` plus optional pagination fields.

## Required Session Runtime Mapping

- User prompts become persisted user messages before provider output is applied.
- Assistant streaming chunks append or merge into stable assistant messages.
- Tool calls preserve call id, title, kind, status, and input/output summaries.
- Command output is stored as artifacts and broadcast as session updates.
- Runtime completion moves the session out of a running state.

## Required Persistence

- Session summary store supports list, save/upsert, and delete.
- Message store supports append/merge, replace from authoritative history, pagination, and delete.
- Artifact store supports output/tool/diff append, replacement, pagination, and delete.
- Runtime descriptor store supports persist, lookup, reconnect metadata, and delete.

## Required Trace And Smoke

- Provider-free smoke validates HTTP root, WebSocket open, first RPC, and inventory RPC.
- Trace smoke validates that enabling trace does not break provider-free smoke.
- Real provider smoke is allowed to be manual but must use the same public methods.
```

- [ ] **Step 2: Verify the document has no placeholders**

Run:

```bash
Select-String -Path docs/architecture/language-adapter-checklist.md -Pattern 'PLACEHOLDER|UNSPECIFIED'
```

Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/language-adapter-checklist.md
git commit -m "docs：定义语言适配检查清单"
```

## Task 2: Add Contract Smoke Guidance

**Files:**

- Modify: `docs/architecture/language-adapter-checklist.md`

- [ ] **Step 1: Add smoke command mapping**

Append this section:

```markdown
## Reference Smoke Commands

Run these in the TypeScript reference implementation before comparing another adapter:

```bash
pnpm --filter @tiller/sync-protocol test
pnpm --filter @tiller/helm test
pnpm --filter @tiller/helm smoke:runtime
pnpm --filter @tiller/helm smoke:runtime:trace
pnpm typecheck
```

A new language adapter should expose equivalent checks even if the command names differ.
```

- [ ] **Step 2: Verify markdown renders as plain text**

Run:

```bash
Get-Content docs/architecture/language-adapter-checklist.md
```

Expected: file includes `Reference Smoke Commands` and all five commands.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture/language-adapter-checklist.md
git commit -m "docs：补充语言适配冒烟要求"
```

## Task 3: Decide Migration Spike Entry Point

**Files:**

- Create: `docs/superpowers/plans/2026-05-27-phase-23-language-adapter-proof.md`

- [ ] **Step 1: Create a proof plan that builds one provider-free adapter stub**

The proof plan must require a stub adapter to pass only provider-free `helm/list`, `project/list`, `agent/list`, and `session/list` contract smoke first.

- [ ] **Step 2: Explicitly defer real ACP provider migration**

The proof plan must state that real ACP provider integration starts only after provider-free smoke passes.

- [ ] **Step 3: Commit**

```bash
git add -f docs/superpowers/plans/2026-05-27-phase-23-language-adapter-proof.md
git commit -m "docs：规划语言适配验证入口"
```

## Verification

Run after all tasks:

```bash
pnpm --filter @tiller/sync-protocol test
pnpm --filter @tiller/helm test
pnpm --filter @tiller/helm smoke:runtime
pnpm --filter @tiller/helm smoke:runtime:trace
pnpm typecheck
```
