# Tiller Release Checklist

Release is currently **paused**. Do not publish npm packages, create GitHub tags,
or announce a public release until every required gate is complete.

## 1. Product behavior gates

- [ ] Embedded Deck shows exactly one Helm for the current process.
- [ ] Project tree groups projects under the active Helm only.
- [ ] Workspace/file browser uses the selected Project / Workspace path.
- [ ] ACP agents are loaded from `~/.tiller/config.json` in packaged runtime.
- [ ] New session creation works with Codex ACP from the packaged CLI.
- [ ] New session creation works with OpenCode ACP from the packaged CLI.
- [ ] LAN access behavior is documented and intentionally secured.

## 2. Package gates

- [ ] `pnpm --filter @tiller/deck build`
- [ ] `pnpm --filter @tiller/helm test`
- [ ] `pnpm --filter @tiller/helm typecheck`
- [ ] `pnpm --filter @tiller/deck typecheck`
- [ ] `pnpm --filter @tiller/helm build`
- [ ] `pnpm --filter @tiller/helm pack:npm`
- [ ] Install tarball in a clean temp directory.
- [ ] Run `tiller` from the tarball without monorepo source access.
- [ ] Confirm package contains only expected files.

## 3. Repository gates

- [ ] `README.md` matches actual product behavior.
- [ ] `CHANGELOG.md` has release notes for the target version.
- [ ] `LICENSE` and package `license` metadata match.
- [ ] `SECURITY.md` has a real reporting contact before public release.
- [ ] No local runtime files, logs, SQLite databases, or secrets are tracked.
- [ ] Git status is clean before tag or publish.

## 4. Release gates

- [ ] Decide release version and npm dist-tag.
- [ ] Build from `main` after all fixes are merged.
- [ ] Create Git tag only after package smoke checks pass.
- [ ] Publish npm package from the same commit as the GitHub tag.
- [ ] Attach tarball/checksum to release notes if needed.

## Current decision

As of 2026-05-03, release is paused. The package should remain `UNLICENSED` and
unpublished until product behavior is stable.
