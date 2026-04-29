# Tiller File Layout

> Purpose: keep each workspace module easy for humans and agents to identify by path before opening file contents.

## Workspace boundaries

- `apps/deck`: React/Vite Command Deck UI.
- `apps/helm`: Node.js Helm host process and local WebSocket server.
- `apps/mobile`: mobile placeholder.
- `packages/shared`: shared domain types.
- `packages/sync-protocol`: Deck ↔ Helm message protocol.
- `packages/agent-registry`: ACP provider registry/config loading.
- `packages/acp-runtime`: ACP process/session runtime.

## `apps/deck/src`

- `app/`: application shell and global styling.
  - `App.tsx`: Deck state, socket lifecycle, and high-level view orchestration.
  - `preferences.ts`: Deck preferences defaults, storage parsing, and validation.
  - `daemon-profiles.ts`: saved Helm profile storage and display helpers.
  - `styles.css`: current global Deck stylesheet. This is intentionally only moved in this pass; it remains a future split target.
- `auth/`: browser-side Beacon/trusted-device cache.
  - `beacon-cache.ts`: local storage cache for device id and Helm beacon token.
- `connection/`: browser-side connection policies.
  - `reconnect-policy.ts`: silent reconnect and live-connection decision rules.
- `components/`: reusable Deck UI primitives.
  - `primitives.tsx`: presentational primitives used by `App.tsx`.
  - `markdown.tsx`: Markdown rendering and code-block highlighting.
- `features/`: feature-specific client logic.
  - `features/logbook/timeline.ts`: command/tool timeline normalization.
  - `features/prompt-enhancer/enhancer.ts`: prompt enhancement and model endpoint helpers.
  - `features/mission/diff-tree.tsx`: mission diff tree rendering helpers.
  - `features/mission/panels.tsx`: mission display panel primitives.
- `state/`: client-side state derivation and persistence.
  - `snapshot-cache.ts`: cached Deck snapshot persistence.
  - `sessions.ts`: session list/status/draft selection derivation.

## `apps/helm/src`

- `index.ts`: side-effect entry that starts Helm by importing `server.ts`.
- `server.ts`: Helm WebSocket bootstrap, auth flow, handler dispatch, and context assembly.
- `runtime-events.ts`: normalized ACP runtime events to persisted state and broadcasts.
- `handlers/`: typed message handler modules.
  - `context.ts`: shared handler dependencies.
  - `config.ts`: helm/project/workspace/provider messages.
  - `devices.ts`: trusted Beacon device messages.
  - `sessions.ts`: session lifecycle, prompt, artifacts, permission, and cleanup messages.
- `auth/`: device authentication and socket membership.
  - `beacon-store.ts`: persisted Helm-side Beacon/trusted-device registry.
  - `socket-registry.ts`: authenticated WebSocket registry by device.
- `providers/`: provider-specific lifecycle helpers.
  - `cleanup.ts`: provider-aware remote session cleanup.
- `sessions/`: Tiller session persistence and summary updates.
  - `summary-store.ts`: session summaries.
  - `message-store.ts`: session message history.
  - `artifact-store.ts`: command output and diff artifacts.
  - `runtime-store.ts`: provider-aware runtime reconnect descriptors.
  - `cleanup.ts`: local/remote session cleanup outcome orchestration.
  - `summary-updates.ts`: summary mutation helpers from user/agent messages.
  - `git-diff.ts`: workspace git diff hydration helpers.

## `packages/*/src`

- `index.ts`: package public barrel only; keep this stable for workspace imports like `@tiller/shared`.
- `packages/shared/src/types.ts`: shared domain types and shared helpers.
- `packages/sync-protocol/src/messages.ts`: Deck ↔ Helm protocol message types.
- `packages/agent-registry/src/registry.ts`: ACP provider registry/config loading.
- `packages/acp-runtime/src/runtime.ts`: ACP process/session runtime orchestration.
- `packages/acp-runtime/src/requests.ts`: ACP JSON-RPC request builders and session id normalization.
- `packages/acp-runtime/src/events.ts`: ACP session/update normalization and provider cleanup result normalization.
- `packages/acp-runtime/src/config-adapters.ts`: provider-specific launch args/env config adapters.
- `packages/acp-runtime/src/process.ts`: process launch command resolution and termination helpers.

## Naming rules for future files

1. Prefer domain names over implementation names: `beacon-store` instead of `trusted-device-store` when the product language is Beacon.
2. Prefer behavior names for policy files: `reconnect-policy` instead of `hybrid-connection`.
3. Keep tests colocated with the source file using the same basename: `foo.ts` + `foo.test.ts`.
4. Keep package public APIs stable unless a package-level refactor explicitly updates exports and consumers.
5. When a file grows beyond one clear responsibility, split by feature/domain first, not by generic technical layers.

## Future split targets

- `apps/deck/src/app/App.tsx`: split into route/view components and feature panels.
- `apps/deck/src/app/styles.css`: split by app shell, components, and features after component extraction.
- `apps/helm/src/server.ts`: split server bootstrap, message handlers, session runtime orchestration, and project/workspace discovery.
- `packages/acp-runtime/src/runtime.ts`: split ACP transport, session lifecycle, event normalization, config adapters, and probes.