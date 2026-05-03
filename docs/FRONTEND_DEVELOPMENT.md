# Frontend Development and Packaging Guide

This guide explains how Deck frontend changes flow into the local Helm runtime and
into the npm package candidate.

## Package names

| Scenario | Name |
| --- | --- |
| pnpm workspace development | `@tiller/helm` |
| npm package candidate | `@qianshe/tiller` |
| CLI command | `tiller` |

## Daily frontend development

For UI work with hot reload, run both Deck and Helm from the repository root:

```bash
pnpm dev
```

This starts:

- `@tiller/deck dev`: Vite dev server, usually `http://127.0.0.1:5173`.
- `@tiller/helm dev`: local Helm runtime, usually `http://127.0.0.1:47631`.

Open the Vite URL for frontend iteration. In this mode Deck is not embedded; it
connects to the Helm WebSocket at the configured Helm endpoint, defaulting to
`127.0.0.1:47631`.

If you only run:

```bash
pnpm --filter @tiller/helm dev
```

then Helm serves already-built Deck static assets from `apps/deck/dist` during
workspace development. Frontend source edits do not hot-reload through this
entrypoint; rebuild Deck or Helm and refresh the page.

## Embedded Deck verification

Use the Helm build when you need to verify the same shape that will be packaged:

```bash
pnpm --filter @tiller/helm build
pnpm --filter @tiller/helm dev
```

The build script:

1. builds `@tiller/deck` with `VITE_TILLER_EMBEDDED_HELM=true`;
2. bundles the Helm server;
3. copies Deck static assets into the Helm dist output;
4. creates `apps/helm/dist-package` with the public npm package manifest.

Then open:

```text
http://127.0.0.1:47631
```

Use this path to check same-origin WebSocket behavior, embedded single-Helm UI,
permission drawers, and packaged static assets.

## Verification for frontend changes

Run the smallest relevant checks first, then broaden before release candidates:

```bash
pnpm --filter @tiller/deck typecheck
pnpm --filter @tiller/helm test
pnpm --filter @tiller/helm typecheck
pnpm typecheck
```

For UI changes that affect packaged behavior, also run:

```bash
pnpm --filter @tiller/helm build
```

Recommended manual checks:

- Vite dev URL updates during frontend iteration.
- Helm embedded URL works after `@tiller/helm build`.
- WebSocket connects and initial sync completes.
- Permission approval UI appears in the expected location.
- Session status, logs, diffs, and file browser still render.

## npm package smoke test

Public release is currently paused. Do not run `npm publish` until
`docs/RELEASE_CHECKLIST.md` is complete and the repository is clean.

To build and pack the npm candidate without publishing:

```bash
pnpm --filter @tiller/helm pack:npm
```

This runs the Helm build and then `npm pack ./dist-package`. The generated
tarball should be named like:

```text
qianshe-tiller-<version>.tgz
```

Smoke test the tarball in a clean temporary directory:

```bash
mkdir %TEMP%\tiller-smoke
cd %TEMP%\tiller-smoke
npm install -g D:\myProject\tools\Tiller\qianshe-tiller-<version>.tgz
tiller start --host 127.0.0.1 --port 47631
```

On non-Windows shells, use an equivalent temporary directory and absolute
tarball path.

Check that:

- `tiller` starts without monorepo source access;
- Deck opens at `http://127.0.0.1:47631`;
- the packaged UI can connect to the same-origin WebSocket;
- `~/.tiller` contains runtime data, not the repository;
- the package contains only expected files.

Inspect package contents without installing:

```bash
npm pack ./apps/helm/dist-package --dry-run --json
```

## Actual npm publish gate

Only after release approval:

1. Confirm `git status --short` is clean.
2. Confirm version, dist-tag, license, README, changelog, and release checklist.
3. Build from the release commit.
4. Run package smoke tests from the tarball.
5. Publish the same commit that will be tagged.

Command shape:

```bash
pnpm --filter @tiller/helm publish:npm
```

Do not publish from a dirty worktree or from local-only unreviewed changes.
