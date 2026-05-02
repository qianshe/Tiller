# ACP TypeScript SDK Runtime Decision

## Goal

Adopt `@agentclientprotocol/sdk` as Tiller's primary ACP session runtime connection path after validating it against fake SDK agents and real Codex/OpenCode Deck ↔ Helm smoke flows.

## Scope

- Added SDK only to `packages/acp-runtime`.
- Added shared SDK mapping helpers in `packages/acp-runtime/src/sdk-helpers.ts`.
- Switched `packages/acp-runtime/src/runtime.ts#createAcpRuntime()` to the SDK-backed connection path.
- Switched `packages/acp-runtime/src/runtime.ts#testAcpConnection()` to SDK-backed `initialize`.
- Switched `packages/acp-runtime/src/runtime.ts#listAcpAgentSessions()` to the SDK-backed `ClientSideConnection.listSessions()` path.
- Removed stale manual JSON-RPC request-builder tests from `packages/acp-runtime/src/runtime.test.ts`.
- Did not change Deck protocol message shapes.

## Coverage Findings

### Covered by SDK

- `ClientSideConnection` can drive a stdio ACP agent created with `AgentSideConnection`.
- `ndJsonStream` covers newline-delimited JSON transport over child-process stdio.
- `initialize` supports Tiller's current client capabilities shape:
  - Probe/list paths keep `fs.readTextFile = false`, `fs.writeTextFile = false`, `terminal = false`.
  - Live runtimes advertise `fs.readTextFile = true`, `fs.writeTextFile = true`, `terminal = true`.
- `session/new`, `session/load`, and `session/resume` can carry explicit `mcpServers`.
- `session/prompt` can receive `session/update` notifications and reuse Tiller's existing `mapSessionUpdateNotification()` mapping.
- `session/request_permission` can be mapped into Tiller's permission request structure.
- `session/cancel` can cancel an in-flight prompt turn.
- `fs/read_text_file` and `fs/write_text_file` are implemented for workspace-contained paths.
- `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, and `terminal/release` are implemented by Helm and surfaced through existing Deck permission + command-output UI.

### Important SDK Semantics

- The npm package is `@agentclientprotocol/sdk`.
- `ClientSideConnection` exposes the generic agent lifecycle Tiller needs: `initialize`, `newSession`, `loadSession`, `listSessions`, `resumeSession`, `closeSession`, `prompt`, `cancel`, and extension hooks.
- `ClientSideConnection` also accepts client-side callbacks for permission, filesystem, terminal, elicitation, and extension requests.
- Tiller uses a capability split:
  - Connection-test and session-list probes advertise filesystem and terminal as disabled.
  - Live session runtimes advertise filesystem and terminal as enabled and implement those callbacks in Helm.
- The SDK has a peer dependency on `zod`; pnpm resolved it in the lockfile.
- SDK stdio MCP server shape uses `env: Array<{ name, value }>` rather than Tiller's `Record<string, string>`.
- Current SDK `ListSessionsRequest` does not include `mcpServers`; only `cwd`, `cursor`, and `additionalDirectories` are accepted.
  - Tiller now follows the SDK shape for `session/list`.
  - Provider MCP servers are still forwarded for `session/new`, `session/load`, and `session/resume`, where the SDK request types support them.

### Remaining Gaps

- Provider-native history export such as OpenCode export remains outside the generic SDK runtime.
- Provider-native cleanup such as OpenCode session delete remains in Helm provider cleanup code.
- Full raw protocol-line logging parity is not available through the SDK; Tiller still logs launch metadata, SDK request names, stderr, and mapped session updates.
- Filesystem callbacks are deliberately constrained to the active workspace root.
- Terminal execution requires the existing Deck permission flow before Helm spawns a process.

## Decision

**Use the SDK for the ACP agent communication path.**

Use the SDK for:

1. ACP protocol type reference.
2. Test fixtures and fake ACP agents.
3. Primary session runtime creation, prompts, session updates, permission requests, cancellation, workspace filesystem callbacks, and terminal callbacks.
4. Agent connection testing and session listing.

Remaining compatibility boundary:

1. Preserve or replace raw protocol-line logging where needed for diagnosis.
2. Keep provider adapters for launch config, native history export, and native cleanup only.

## Files Added or Changed

- `packages/acp-runtime/package.json`
  - Adds `@agentclientprotocol/sdk`.
- `pnpm-lock.yaml`
  - Records SDK and resolved peer dependency versions.
- `packages/acp-runtime/src/sdk-helpers.ts`
  - Shared SDK capability, MCP, prompt, and permission mapping helpers.
- `packages/acp-runtime/src/sdk-runtime.test.ts`
  - Fake `AgentSideConnection` fixture and mainline coverage for SDK-backed production runtime behavior, including prompt, permission, cancel, workspace fs, and terminal callbacks.
- `packages/acp-runtime/src/runtime.ts`
  - Uses `ClientSideConnection` for `createAcpRuntime()`, connection testing, and generic `session/list` while preserving Tiller launch adapters, status events, timeouts, permission responses, configure, close, cancel, and cleanup outcomes.
- `apps/deck/src/app/App.tsx`
  - Sends `session.prompt`, `permission.respond`, and `session.cancel` from the UI.
- `tasks/acp-sdk-runtime-decision.md`
  - This runtime adoption decision note.

## Verification

Verified commands:

```powershell
pnpm --filter @qianshe/tiller exec tsx --test ../../packages/acp-runtime/src/sdk-runtime.test.ts
pnpm --filter @tiller/acp-runtime typecheck
pnpm --filter @qianshe/tiller test
pnpm typecheck
git diff --check
```

Observed results:

- SDK/runtime tests: 7/7 passed.
- ACP runtime typecheck: passed.
- Helm tests: 67/67 passed.
- Workspace typecheck: passed for all 7 checked workspace projects, including `apps/deck`.
- `git diff --check`: passed; only CRLF normalization warnings were printed.
- Deck/Helm smoke: Deck returned HTTP 200 at `http://127.0.0.1:5173`; Helm WebSocket opened at `ws://127.0.0.1:47631`.
- Real prompt-level smoke through the Deck-trusted client credentials and the running Helm:
  - Codex created `session-1777643630422`, runtime `019de3d1-3148-7422-a464-2f57b5b90658`, returned `TILLER-SDK-SMOKE-OK`, reached `idle`, and cleanup closed the remote session.
  - OpenCode created `session-1777643645590`, runtime `ses_21c2e81c3ffeDXLGKCmpdjMEin`, returned `TILLER-SDK-SMOKE-OK`, reached `idle`, and cleanup removed local Tiller state while terminating the local runtime process.
- Chrome DevTools snapshot confirmed Deck remained connected after smoke: `连接 · 已连接`, `ACP 舰员 · 2`, `任务 · 2`.
- `node:sqlite` still emits the expected experimental warning during Helm tests.
