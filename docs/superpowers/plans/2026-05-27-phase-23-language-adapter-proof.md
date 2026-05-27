# Phase 23 Language Adapter Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the language migration seam with the smallest provider-free adapter stub before any real ACP provider migration starts.

**Architecture:** Keep Deck and `packages/sync-protocol` as the compatibility boundary. Build a provider-free Helm-compatible adapter stub that speaks the same HTTP + JSON-RPC over WebSocket contract for inventory methods only. The current TypeScript Helm remains the reference implementation.

**Tech Stack:** Existing TypeScript contract tests, JSON-RPC 2.0 over WebSocket, provider-free test fixtures. The proof may choose another language later, but this plan first freezes observable behavior and smoke expectations.

---

## Non-Goals

- Do not migrate real Helm runtime logic yet.
- Do not integrate real ACP providers in this phase.
- Do not replace SQLite/JSON persistence yet.
- Do not change public method names or response envelopes.
- Do not introduce a production control plane or remote SaaS dependency.

## Success Criteria

1. A provider-free adapter stub can serve an HTTP health/static root.
2. The stub can accept JSON-RPC 2.0 over WebSocket.
3. The stub returns compatible envelopes for:
   - `helm/list`
   - `project/list`
   - `agent/list`
   - `session/list`
4. The proof has an automated smoke command that does not require ACP credentials.
5. Real ACP provider integration is explicitly deferred until provider-free smoke passes.

## Task 1: Choose The Proof Location

**Files:**

- Inspect: `docs/architecture/language-adapter-checklist.md`
- Create only after decision: `experiments/language-adapter-proof/` or another explicitly approved location.

- [ ] Decide whether the proof lives under `experiments/` or an external repository.
- [ ] Keep it isolated from `apps/helm` so the reference implementation is not polluted.
- [ ] Document how to run it.

## Task 2: Define Provider-Free Fixtures

**Files:**

- Create: proof-local fixture file or test helper.

- [ ] Define empty-compatible responses for inventory methods.
- [ ] Define populated fixture responses with one Helm, one project, one agent, and one idle session.
- [ ] Ensure fixtures use only public contract shapes from `@tiller/sync-protocol` and `@tiller/domain-contracts` where applicable.

## Task 3: Implement Minimal Adapter Stub

**Files:**

- Create proof-local server entrypoint.

- [ ] Serve HTTP root with a simple HTML shell or health response.
- [ ] Accept WebSocket JSON-RPC envelopes.
- [ ] Route only the four provider-free inventory methods.
- [ ] Return MethodNotFound for unsupported methods using stable JSON-RPC error shape.

## Task 4: Add Provider-Free Smoke

**Files:**

- Create proof-local smoke script or test.

- [ ] Validate HTTP readiness.
- [ ] Validate WebSocket connection.
- [ ] Validate first RPC timing.
- [ ] Validate the four inventory result envelopes.
- [ ] Do not require real ACP credentials, local agent binaries, or production config.

## Task 5: Gate Real ACP Migration

**Files:**

- Modify: proof README or checklist.

- [ ] State that real ACP provider migration starts only after provider-free smoke passes.
- [ ] List the next real-provider checks: draft/session creation, prompt streaming, tool calls, command output, approvals, resume, cancel, and trace ordering.

## Verification

Run the reference implementation checks first:

```bash
pnpm --filter @tiller/sync-protocol test
pnpm --filter @tiller/helm smoke:runtime
pnpm typecheck
```

Then run the proof-local provider-free smoke command once implemented.
