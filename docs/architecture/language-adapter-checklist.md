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
