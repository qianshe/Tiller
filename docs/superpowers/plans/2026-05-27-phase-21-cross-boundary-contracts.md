# Phase 21 Cross-Boundary Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Deck/Helm/package contracts explicit and testable so future language migration or new runtime capabilities can replace one side without breaking the other.

**Architecture:** Treat `packages/sync-protocol` as the transport contract, `packages/domain-contracts` as domain DTO ownership, `packages/core` as pure policies/use-cases, and Helm/Deck as adapters. Add compatibility tests around public JSON-RPC methods and realtime session updates without moving implementation-specific runtime code into shared packages.

**Tech Stack:** TypeScript strict mode, pnpm workspace, Node test runner, JSON-RPC over WebSocket, existing package boundaries.

---

## Precondition

Phase 19 frontend architecture and Phase 20 backend architecture should be complete or at least stable enough that new contract tests do not chase moving file paths.

## Non-Goals

- No backend language migration yet.
- No protocol shape changes unless an existing shape is undocumented or ambiguous.
- No new external schema/codegen dependency in this phase.
- No shared/common abstractions without a concrete Deck + Helm or future-runtime consumer.

## Success Criteria

1. Public JSON-RPC method ownership is documented and covered by contract tests.
2. Session realtime update payloads are owned by a package-level contract, not hidden in Helm-only modules.
3. Contract tests can run without real ACP credentials.
4. Backward-compatible aliases such as existing session config methods remain covered.
5. A future runtime in another language can implement the same contract by following the tests and package types.
6. Verification passes:
   - `pnpm --filter @tiller/sync-protocol test`
   - `pnpm --filter @tiller/domain-contracts typecheck`
   - `pnpm --filter @tiller/core test`
   - `pnpm --filter @tiller/helm smoke:runtime`
   - `pnpm typecheck`

---

## Task 1: Inventory Public RPC And Realtime Contracts

**Files:**

- Create: `packages/sync-protocol/src/contracts/rpc-method-inventory.ts`
- Test: `packages/sync-protocol/src/contracts/rpc-method-inventory.test.ts`

- [ ] List method families: `helm/*`, `project/*`, `agent/*`, `session/*`, `approval/*`, `device/*`.
- [ ] Mark each method owner: Deck caller, Helm handler domain, response package type.
- [ ] Add a test that fails if duplicate method names are introduced.

## Task 2: Promote Session Realtime Update DTO Ownership

**Files:**

- Inspect: `apps/helm/src/runtime/session-update-contracts.ts`
- Modify or create package-level contract in `packages/domain-contracts`
- Update imports in Helm and Deck only through package public exports.

- [ ] Move stable DTO types only.
- [ ] Keep publisher, stores, and runtime event logic in Helm.
- [ ] Add type-level smoke usage from Deck and Helm.

## Task 3: Add Provider-Free RPC Contract Tests

**Files:**

- Create: `apps/helm/src/rpc/contract-smoke.test.ts`

- [ ] Create an in-memory or mocked handler context.
- [ ] Verify representative methods return documented envelope shapes.
- [ ] Cover safe no-provider paths: `helm/list`, `project/list`, `agent/list`, `session/list`.

## Task 4: Define Language Migration Adapter Checklist

**Files:**

- Create: `docs/superpowers/plans/2026-05-27-phase-22-language-adapter-spike.md`

- [ ] Specify what a non-TypeScript Helm implementation must provide.
- [ ] Include transport, config, session persistence, runtime event mapping, trace, and smoke requirements.
- [ ] Keep this as a spike plan, not implementation.

## Verification

```bash
pnpm --filter @tiller/sync-protocol test
pnpm --filter @tiller/domain-contracts typecheck
pnpm --filter @tiller/core test
pnpm --filter @tiller/helm smoke:runtime
pnpm typecheck
```
