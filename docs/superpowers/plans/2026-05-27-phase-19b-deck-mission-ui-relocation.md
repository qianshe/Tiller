# Phase 19B Deck Mission UI Relocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue after Phase 19R by moving remaining Mission UI implementations from the legacy `ui/` bucket into capability subdomains without changing behavior.

**Architecture:** Keep `features/mission/workspace` as the composition shell created in Phase 19R. Move leaf UI files by capability into `composer/`, `conversation/`, `display/`, `inspector/`, and `navigation/`; each subdomain owns its own tests and `index.ts` public surface. Do not move shared hooks, orchestration, actions, config, or utils unless a file's responsibility clearly belongs to the subdomain.

**Tech Stack:** React 19, Vite 8, TypeScript strict mode, Zustand 5, Node test runner, existing import-boundary lint.

---

## Non-Goals

- No behavior redesign.
- No Helm/backend changes.
- No JSON-RPC contract changes.
- No store schema changes.
- No new dependencies.
- No mechanical move of files that are already shared utilities or cross-subdomain helpers.

## Success Criteria

1. Legacy `apps/deck/src/features/mission/ui/` no longer owns capability implementations that clearly belong to a Mission subdomain.
2. Composer files live under `mission/composer/`.
3. Conversation files live under `mission/conversation/`.
4. Display files live under `mission/display/`.
5. Inspector files live under `mission/inspector/`.
6. Navigation files live under `mission/navigation/`.
7. Public imports go through subdomain `index.ts` files where crossing subdomain boundaries.
8. Verification passes:
   - `pnpm --filter @tiller/deck test`
   - `pnpm --filter @tiller/deck lint`
   - `pnpm --filter @tiller/deck build`
   - `pnpm typecheck`

---

## Task 1: Move Composer UI Files

**Files:**

- Move `apps/deck/src/features/mission/ui/composer.tsx` -> `apps/deck/src/features/mission/composer/composer.tsx`
- Move `apps/deck/src/features/mission/ui/composer.test.tsx` -> `apps/deck/src/features/mission/composer/composer.test.tsx`
- Move `apps/deck/src/features/mission/ui/composer-attachments.tsx` -> `apps/deck/src/features/mission/composer/composer-attachments.tsx`
- Move `apps/deck/src/features/mission/ui/composer-config-controls.tsx` -> `apps/deck/src/features/mission/composer/composer-config-controls.tsx`
- Move `apps/deck/src/features/mission/ui/composer-draft-selectors.tsx` -> `apps/deck/src/features/mission/composer/composer-draft-selectors.tsx`
- Move `apps/deck/src/features/mission/ui/slash-command-popup.tsx` -> `apps/deck/src/features/mission/composer/slash-command-popup.tsx`
- Move `apps/deck/src/features/mission/ui/slash-command-popup.test.tsx` -> `apps/deck/src/features/mission/composer/slash-command-popup.test.tsx`
- Modify `apps/deck/src/features/mission/composer/index.ts`

- [ ] Move files with `git mv`.
- [ ] Update relative imports inside moved files.
- [ ] Update `composer/index.ts` to export from local files.
- [ ] Update tests that read old paths.
- [ ] Run:

```bash
pnpm --filter @tiller/deck test -- src/features/mission/composer
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
```

- [ ] Commit:

```bash
git add apps/deck/src/features/mission apps/deck/src/app
git commit -m "refactor：归位 Mission Composer UI"
```

## Task 2: Move Conversation UI Files

**Files:**

Move these from `mission/ui/` into `mission/conversation/`:

```text
chat-pane.tsx
message-timeline.tsx
plain-messages.tsx
plain-messages.test.ts
plain-messages.test.tsx
permission-drawer.tsx
permission-drawer.test.tsx
queued-prompts.tsx
queued-prompts.test.tsx
session-approval-list.test.tsx
tool-loading.tsx
tool-loading.test.tsx
```

- [ ] Move files with `git mv`.
- [ ] Keep `conversation/index.ts` as the public surface.
- [ ] Update workspace/composer imports through `../conversation` only when crossing subdomain boundaries.
- [ ] Update source-reading tests to new paths.
- [ ] Run:

```bash
pnpm --filter @tiller/deck test -- src/features/mission/conversation src/features/mission/ui/chat-pane-layout.test.ts
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
```

- [ ] Commit:

```bash
git add apps/deck/src/features/mission apps/deck/src/app
git commit -m "refactor：归位 Mission Conversation UI"
```

## Task 3: Move Display UI Files

**Files:**

Move these from `mission/ui/` into `mission/display/`:

```text
display-section.tsx
display-panel.tsx
display-panel.test.tsx
diff-panel.tsx
diff-tree.tsx
diff-tree.test.tsx
logbook-panel.tsx
panel-header.tsx
panels.tsx
```

- [ ] Move files with `git mv`.
- [ ] Update `display/index.ts` to export local display files.
- [ ] Update imports and path-based tests.
- [ ] Run:

```bash
pnpm --filter @tiller/deck test -- src/features/mission/display src/features/mission/ui/chat-pane-layout.test.ts
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
```

- [ ] Commit:

```bash
git add apps/deck/src/features/mission apps/deck/src/app
git commit -m "refactor：归位 Mission Display UI"
```

## Task 4: Move Inspector And Navigation UI Files

**Files:**

Move into `mission/inspector/`:

```text
inspector.tsx
project-file-list.tsx
```

Move into `mission/navigation/`:

```text
agent-icon.tsx
mission-status-bar.tsx
mission-status-bar.test.tsx
session-row.tsx
sidebar.tsx
sidebar-project-node.tsx
session-overview-card.tsx
session-overview-card.test.tsx
```

- [ ] Move files with `git mv`.
- [ ] Update `inspector/index.ts` and `navigation/index.ts`.
- [ ] Update source-reading tests and imports.
- [ ] Run:

```bash
pnpm --filter @tiller/deck test -- src/features/mission/inspector src/features/mission/navigation src/features/mission/ui/chat-pane-layout.test.ts
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck typecheck
```

- [ ] Commit:

```bash
git add apps/deck/src/features/mission apps/deck/src/app
git commit -m "refactor：归位 Mission 导航与检视 UI"
```

## Task 5: Retire Or Minimize Legacy Mission UI Bucket

**Files:**

- Inspect remaining files under `apps/deck/src/features/mission/ui/`.
- Modify `apps/deck/src/features/mission/mission-subdomains.test.ts`.
- Modify `apps/deck/scripts/lint-import-boundaries.mjs` only if a stricter rule is justified.

- [ ] Classify every remaining `ui/` file as either intentionally shared UI glue or candidate for one of the subdomains.
- [ ] Add/adjust a static test documenting the allowed remaining `ui/` files.
- [ ] Do not create a generic `shared` folder for one-off files.
- [ ] Run:

```bash
pnpm --filter @tiller/deck test
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/deck build
pnpm typecheck
```

- [ ] Commit:

```bash
git add apps/deck/src/features/mission apps/deck/scripts apps/deck/src/app
git commit -m "test：约束 Mission UI 子域边界"
```
