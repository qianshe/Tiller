# Contributing

Tiller is not accepting public contributions yet. This document defines the
internal contribution workflow so the repository stays release-ready.

## Development setup

```bash
pnpm install
pnpm dev
```

## Verification before completion

Run the smallest relevant checks for your change, then run broader checks before
release candidates.

Common checks:

```bash
pnpm --filter @qianshe/tiller test
pnpm --filter @qianshe/tiller typecheck
pnpm --filter @tiller/deck typecheck
pnpm typecheck
```

Package smoke check:

```bash
pnpm --filter @qianshe/tiller pack
```

## Change rules

- Keep changes small and traceable to a task.
- Do not publish npm packages or create Git tags from a dirty working tree.
- Do not change license metadata without updating `LICENSE`, `README.md`, and
  release notes together.
- Do not commit local `.tiller` runtime data, logs, SQLite files, or browser
  cache artifacts.
- For product behavior changes, update tests and documentation in the same
  change set.

## Commit style

Use concise Chinese commit messages with a conventional prefix when practical,
for example:

```text
fix：修复内置 Deck 初始同步
```

## Release gate

Public release is paused until the project passes the release checklist in
`docs/RELEASE_CHECKLIST.md`.
