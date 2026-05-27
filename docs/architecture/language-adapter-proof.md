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

## Deferred Work

- Real ACP provider integration starts only after provider-free smoke passes.
- Prompt streaming starts only after provider-free smoke passes.
- Replacing the TypeScript Helm runtime starts only after provider-free smoke passes.

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
