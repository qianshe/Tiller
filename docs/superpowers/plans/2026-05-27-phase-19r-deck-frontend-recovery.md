# Phase 19R Deck Frontend Architecture Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover and finish the previously omitted Phase 19 frontend architecture work by first stabilizing the current dirty Deck diff, then continuing Mission boundary convergence without touching Helm/backend contracts.

**Architecture:** Treat this as a recovery-and-convergence phase. First preserve and validate the existing multi-chat / draft-window frontend diff so no work is lost; then split Mission by stable subdomains around chat workspace, composer, conversation, display, inspector, and navigation. Keep `apps/deck/src/app/*` as composition only, Zustand slices as state ownership, and `features/mission/*` as capability implementation.

**Tech Stack:** React 19, Vite 8, TypeScript strict mode, Zustand 5, Node test runner, existing Deck import-boundary lint.

---

## Current Recovery Context

Current dirty frontend/doc files at plan creation time:

```text
apps/deck/src/app/routing/mission-route.tsx
apps/deck/src/app/shell/root-mobile.test.ts
apps/deck/src/app/state/deck-data.ts
apps/deck/src/features/mission/actions/session-command-actions.ts
apps/deck/src/features/mission/orchestration/mission-selection-effects.test.ts
apps/deck/src/features/mission/ui/chat-pane-layout.test.ts
apps/deck/src/features/mission/ui/chat-pane.tsx
apps/deck/src/features/mission/ui/composer.tsx
apps/deck/src/features/mission/ui/plain-messages.test.tsx
apps/deck/src/features/mission/ui/plain-messages.tsx
apps/deck/src/features/mission/ui/sidebar-project-node.tsx
apps/deck/src/features/mission/ui/sidebar.tsx
apps/deck/src/features/mission/ui/workspace.tsx
apps/deck/src/shared/ui/icon.tsx
apps/deck/src/store/middleware.test.ts
apps/deck/src/store/middleware.ts
apps/deck/src/store/slices/sessions-slice.test.ts
apps/deck/src/store/slices/sessions-slice.ts
docs/tailwind-migration-inventory.md
```

The dirty diff appears to introduce multi-chat / draft chat-window state:

- `openChatSessionIds`
- `focusedChatWindowId`
- `draftChatWindow`

It also adjusts Mission chat pane rendering, composer behavior, sidebar affordances, store persistence, and several frontend tests.

## Non-Goals

- No Helm/backend code changes.
- No JSON-RPC or sync protocol changes.
- No visual redesign beyond preserving the current dirty diff behavior.
- No migration away from Zustand.
- No broad file moves until the dirty diff is validated and committed.
- No new dependencies.

## Success Criteria

1. Current frontend dirty diff is either committed as a verified recovery checkpoint or explicitly reverted by user decision.
2. Multi-chat / draft-window state is covered by store and layout tests.
3. Mission `workspace.tsx` stops growing and gains a clear next split path.
4. New Mission subdomain entrypoints exist without breaking existing imports.
5. App routing/state remains composition-only and does not own Mission business behavior.
6. Verification passes:
   - `pnpm --filter @tiller/deck test`
   - `pnpm --filter @tiller/deck lint`
   - `pnpm --filter @tiller/deck typecheck`
   - `pnpm --filter @tiller/deck build`
   - `pnpm typecheck`
7. Final task writes the next frontend phase plan based on what remains after this recovery phase.

---

## Task 0: Freeze And Audit The Dirty Frontend Diff

**Files:**

- Inspect only: all files listed in Current Recovery Context.
- Do not modify backend files.

- [ ] **Step 1: Capture current status**

```bash
git status --short
git diff --stat -- apps/deck docs/tailwind-migration-inventory.md
git diff --cached --stat -- apps/deck docs/tailwind-migration-inventory.md
```

Expected: output only contains `apps/deck/**` and `docs/tailwind-migration-inventory.md`.

- [ ] **Step 2: Inspect behavior ownership**

Review these ownership points:

```text
apps/deck/src/store/slices/sessions-slice.ts owns open chat / draft chat state.
apps/deck/src/store/middleware.ts owns persistence selection for that state.
apps/deck/src/app/state/deck-data.ts only exposes store state/actions to route composition.
apps/deck/src/app/routing/mission-route.tsx only wires props into MissionWorktree.
apps/deck/src/features/mission/ui/workspace.tsx composes Mission panes and should not own persistence.
apps/deck/src/features/mission/ui/chat-pane.tsx owns conversation window UI.
```

Expected: no persistence logic inside Mission UI leaf components; no Mission business rules inside `app/*` beyond prop wiring.

- [ ] **Step 3: Run validation before editing**

```bash
pnpm --filter @tiller/deck test
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
```

Expected: PASS. If a test fails due to stale string assertions, update only the affected assertion to match the current source behavior and rerun the same command.

---

## Task 1: Commit The Current Multi-Chat Recovery Checkpoint

**Files:**

- Stage only: `apps/deck/**`, `docs/tailwind-migration-inventory.md`.
- Do not stage backend files.

- [ ] **Step 1: Stage the current frontend recovery diff**

```bash
git add apps/deck docs/tailwind-migration-inventory.md
git diff --cached --stat
```

Expected: staged paths are limited to Deck frontend and Tailwind inventory documentation.

- [ ] **Step 2: Run final checkpoint verification**

```bash
pnpm --filter @tiller/deck test
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit checkpoint**

```bash
git commit -m "feat：支持 Mission 多聊天窗口"
```

Expected: commit succeeds and `git status --short` has no remaining `apps/deck/**` changes.

---

## Task 2: Establish Mission Subdomain Entry Points Without Moving Implementations

**Files:**

- Create: `apps/deck/src/features/mission/workspace/index.ts`
- Create: `apps/deck/src/features/mission/composer/index.ts`
- Create: `apps/deck/src/features/mission/conversation/index.ts`
- Create: `apps/deck/src/features/mission/display/index.ts`
- Create: `apps/deck/src/features/mission/inspector/index.ts`
- Create: `apps/deck/src/features/mission/navigation/index.ts`
- Modify: `apps/deck/src/features/mission/index.ts`

- [ ] **Step 1: Add workspace public entrypoint**

```ts
export { MissionWorktree } from "../ui/workspace";
export { buildMissionWorktreeModel } from "../ui/workspace-model";
export { dedupeRuntimeOverviewItems } from "../ui/workspace-runtime-overview";
```

- [ ] **Step 2: Add composer public entrypoint**

```ts
export { MissionComposer } from "../ui/composer";
export { SlashCommandPopup } from "../ui/slash-command-popup";
```

- [ ] **Step 3: Add conversation public entrypoint**

```ts
export { MissionChatPane } from "../ui/chat-pane";
export { PermissionDrawer } from "../ui/permission-drawer";
export { QueuedPrompts } from "../ui/queued-prompts";
```

- [ ] **Step 4: Add display, inspector, and navigation entrypoints**

```ts
// display/index.ts
export { MissionDisplaySection } from "../ui/display-section";
export { MissionDiffPanel } from "../ui/diff-panel";

// inspector/index.ts
export { MissionInspector } from "../ui/inspector";

// navigation/index.ts
export { MissionSidebar } from "../ui/sidebar";
```

- [ ] **Step 5: Re-export subdomains from mission index**

```ts
export * from "./workspace";
export * from "./composer";
export * from "./conversation";
export * from "./display";
export * from "./inspector";
export * from "./navigation";
```

Keep existing exports in `mission/index.ts` until all call sites are migrated.

- [ ] **Step 6: Verify and commit**

```bash
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
git add apps/deck/src/features/mission
git commit -m "refactor：建立 Mission 前端子域出口"
```

---

## Task 3: Route Workspace Imports Through Subdomain Public APIs

**Files:**

- Modify: `apps/deck/src/features/mission/ui/workspace.tsx`
- Modify if needed: `apps/deck/src/features/mission/ui/chat-pane.tsx`

- [ ] **Step 1: Replace sibling implementation imports in workspace**

Target imports in `workspace.tsx` should read from subdomain entrypoints for pane-level components:

```ts
import { MissionChatPane } from "../conversation";
import { MissionComposer } from "../composer";
import { MissionDiffPanel, MissionDisplaySection } from "../display";
import { MissionInspector } from "../inspector";
import { MissionSidebar } from "../navigation";
```

Keep local helpers that still live in `ui/` as direct imports until Task 5 moves files.

- [ ] **Step 2: Verify no circular import was introduced**

```bash
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/deck/src/features/mission
git commit -m "refactor：通过子域出口组合 Mission 工作区"
```

---

## Task 4: Extract Chat Window State Selectors From Workspace

**Files:**

- Create: `apps/deck/src/features/mission/workspace/chat-window-model.ts`
- Create: `apps/deck/src/features/mission/workspace/chat-window-model.test.ts`
- Modify: `apps/deck/src/features/mission/ui/workspace.tsx`

- [ ] **Step 1: Write failing selector tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildChatWindowModel } from "./chat-window-model";

test("chat window model focuses draft when draft window is selected", () => {
  const model = buildChatWindowModel({
    activeSessionId: "session-1",
    openChatSessionIds: ["session-1"],
    focusedChatWindowId: "draft:draft-1",
    draftChatWindow: { id: "draft-1", title: "Draft", agentId: "codex", cwd: "D:/repo" },
  });

  assert.equal(model.focusedDraftWindow?.id, "draft-1");
  assert.equal(model.focusedRealSessionId, null);
});

test("chat window model falls back to active session", () => {
  const model = buildChatWindowModel({
    activeSessionId: "session-1",
    openChatSessionIds: [],
    focusedChatWindowId: null,
    draftChatWindow: null,
  });

  assert.equal(model.focusedRealSessionId, "session-1");
  assert.equal(model.selectedWindowId, "session-1");
});
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @tiller/deck test -- src/features/mission/workspace/chat-window-model.test.ts
```

Expected: FAIL because `chat-window-model.ts` does not exist.

- [ ] **Step 3: Implement pure model**

```ts
type DraftChatWindowLike = {
  id: string;
  title?: string;
  agentId?: string;
  cwd?: string;
};

export type BuildChatWindowModelInput = {
  activeSessionId: string | null;
  openChatSessionIds: string[];
  focusedChatWindowId: string | null;
  draftChatWindow: DraftChatWindowLike | null;
};

export function buildChatWindowModel(input: BuildChatWindowModelInput) {
  const draftWindowId = input.draftChatWindow ? `draft:${input.draftChatWindow.id}` : null;
  const focusedDraftWindow =
    input.focusedChatWindowId && input.focusedChatWindowId === draftWindowId ? input.draftChatWindow : null;
  const focusedRealSessionId = focusedDraftWindow
    ? null
    : input.focusedChatWindowId && input.openChatSessionIds.includes(input.focusedChatWindowId)
      ? input.focusedChatWindowId
      : input.activeSessionId;

  return {
    draftWindowId,
    focusedDraftWindow,
    focusedRealSessionId,
    selectedWindowId: focusedDraftWindow ? draftWindowId : focusedRealSessionId,
  };
}
```

- [ ] **Step 4: Use model from workspace**

Replace inline focused chat-window derivation in `workspace.tsx` with `buildChatWindowModel(...)`.

- [ ] **Step 5: Verify and commit**

```bash
pnpm --filter @tiller/deck test -- src/features/mission/workspace/chat-window-model.test.ts src/features/mission/ui/chat-pane-layout.test.ts
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
git add apps/deck/src/features/mission
git commit -m "refactor：抽出 Mission 聊天窗口模型"
```

---

## Task 5: Move Workspace Composition Files Into `mission/workspace`

**Files:**

- Move: `apps/deck/src/features/mission/ui/workspace.tsx` -> `apps/deck/src/features/mission/workspace/workspace.tsx`
- Move: `apps/deck/src/features/mission/ui/workspace-model.ts` -> `apps/deck/src/features/mission/workspace/workspace-model.ts`
- Move: `apps/deck/src/features/mission/ui/workspace-model.test.ts` -> `apps/deck/src/features/mission/workspace/workspace-model.test.ts`
- Move: `apps/deck/src/features/mission/ui/workspace-runtime-overview.ts` -> `apps/deck/src/features/mission/workspace/workspace-runtime-overview.ts`
- Move: `apps/deck/src/features/mission/ui/workspace-runtime-overview.test.ts` -> `apps/deck/src/features/mission/workspace/workspace-runtime-overview.test.ts`
- Move if present: `apps/deck/src/features/mission/ui/mobile-pager.tsx` -> `apps/deck/src/features/mission/workspace/mobile-pager.tsx`
- Move if present: `apps/deck/src/features/mission/ui/page.tsx` -> `apps/deck/src/features/mission/workspace/page.tsx`

- [ ] **Step 1: Move files with git mv**

```bash
git mv apps/deck/src/features/mission/ui/workspace.tsx apps/deck/src/features/mission/workspace/workspace.tsx
git mv apps/deck/src/features/mission/ui/workspace-model.ts apps/deck/src/features/mission/workspace/workspace-model.ts
git mv apps/deck/src/features/mission/ui/workspace-model.test.ts apps/deck/src/features/mission/workspace/workspace-model.test.ts
git mv apps/deck/src/features/mission/ui/workspace-runtime-overview.ts apps/deck/src/features/mission/workspace/workspace-runtime-overview.ts
git mv apps/deck/src/features/mission/ui/workspace-runtime-overview.test.ts apps/deck/src/features/mission/workspace/workspace-runtime-overview.test.ts
```

If `mobile-pager.tsx` and `page.tsx` exist, move them in the same task.

- [ ] **Step 2: Update `workspace/index.ts`**

```ts
export { MissionWorktree } from "./workspace";
export { buildMissionWorktreeModel } from "./workspace-model";
export { dedupeRuntimeOverviewItems } from "./workspace-runtime-overview";
export { buildChatWindowModel } from "./chat-window-model";
```

- [ ] **Step 3: Update imports**

Use exact project search for stale paths:

```bash
git grep "features/mission/ui/workspace\|./workspace-model\|./workspace-runtime-overview" -- apps/deck/src
```

Expected after edits: no stale imports from moved files.

- [ ] **Step 4: Verify and commit**

```bash
pnpm --filter @tiller/deck test -- src/features/mission/workspace
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
git add apps/deck/src/features/mission
git commit -m "refactor：收敛 Mission 工作区目录"
```

---

## Task 6: Narrow App Route And State To Composition-Only Wiring

**Files:**

- Modify: `apps/deck/src/app/routing/mission-route.tsx`
- Modify: `apps/deck/src/app/state/deck-data.ts`
- Inspect: `apps/deck/src/app/shell/root.tsx`

- [ ] **Step 1: Confirm app files only pass through state/actions**

The app route may pass `openChatSessionIds`, `setOpenChatSessionIds`, `focusedChatWindowId`, `setFocusedChatWindowId`, `draftChatWindow`, and `setDraftChatWindow`, but must not derive Mission behavior.

- [ ] **Step 2: Add or update static tests if app wiring drifts**

If there is a source-string test for mission route wiring, assert only wiring behavior, not implementation details.

- [ ] **Step 3: Verify and commit if changed**

```bash
pnpm --filter @tiller/deck test -- src/app
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
git add apps/deck/src/app
git commit -m "refactor：收窄 Deck Mission 路由装配"
```

If inspection shows no source change is needed, record the decision in the final phase note instead of making an empty commit.

---

## Task 7: Final Verification And Next Frontend Phase Plan

**Files:**

- Create: `docs/superpowers/plans/2026-05-27-phase-19b-deck-mission-ui-relocation.md`

- [ ] **Step 1: Run full frontend verification**

```bash
pnpm --filter @tiller/deck test
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck build
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Manual UI smoke if local app is available**

Check:

```text
1. Mission route opens.
2. Session sidebar still selects sessions.
3. Opening multiple chat windows keeps focus stable.
4. Draft chat window can be selected and submitted.
5. Composer can send prompt when Helm is connected.
6. Plain messages and tool groups render without raw text chevrons.
7. Mobile diff detail opens the display pane.
```

If local browser verification is unavailable, mark manual UI smoke as unverified and provide the checklist.

- [ ] **Step 3: Write next phase plan**

Create `docs/superpowers/plans/2026-05-27-phase-19b-deck-mission-ui-relocation.md` with the remaining UI file moves only after this recovery phase is green.

- [ ] **Step 4: Commit final plan**

```bash
git add -f docs/superpowers/plans/2026-05-27-phase-19b-deck-mission-ui-relocation.md
git commit -m "docs：规划 Mission UI 归位阶段"
```

---

## Architecture Review Checklist

- [ ] `apps/deck/src/app/*` is composition/wiring only.
- [ ] Mission open-chat state is owned by Zustand slice and persistence middleware.
- [ ] Mission UI components do not write directly to persistence.
- [ ] Workspace composition imports pane components through subdomain public entrypoints.
- [ ] No Deck code imports Helm internals.
- [ ] No new shared/common abstraction was created without two real consumers.
- [ ] `pnpm --filter @tiller/deck lint` passes after import-boundary changes.
