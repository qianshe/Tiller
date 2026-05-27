# Language Adapter Proof

This experiment proves the smallest provider-free compatibility seam for a future non-TypeScript Helm implementation.

## Boundary

The proof is intentionally isolated under `experiments/language-adapter-proof/` and does not modify `apps/helm` runtime code. It implements only:

- HTTP root serving on the same origin as WebSocket.
- JSON-RPC 2.0 requests over WebSocket.
- Provider-free inventory methods:
  - `helm/list`
  - `project/list`
  - `agent/list`
  - `session/list`
- Stable `MethodNotFound` errors for unsupported methods.

It does not start ACP providers, stream prompts, persist real sessions, or replace the TypeScript Helm runtime.

## Run

```bash
node experiments/language-adapter-proof/smoke.mjs
```

The smoke script starts the local proof server on a free port, validates HTTP readiness, opens a WebSocket, checks first RPC timing, verifies the four inventory result envelopes, and confirms unsupported methods return JSON-RPC `MethodNotFound`.

## Fixtures

`fixtures.mjs` contains both empty and populated provider-free inventory responses. The default proof uses the populated fixture so smoke output can verify non-empty envelope counts.

## Gate For Real ACP Migration

Real ACP provider migration must not start until provider-free smoke passes. After this proof is green, the next real-provider checks are:

1. Draft creation.
2. Session creation.
3. Prompt streaming.
4. Tool calls.
5. Command output.
6. Approval request/response.
7. Resume and cancel.
8. Prompt trace ordering.
