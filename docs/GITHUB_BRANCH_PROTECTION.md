# GitHub Branch Protection

This document describes the recommended repository settings for Tiller Core.

## Goal

`main` should stay releasable. Pull requests and direct maintainer changes must pass CI before release tags are created.

## Recommended ruleset

GitHub path:

```text
Repository → Settings → Rules → Rulesets → New branch ruleset
```

Target branch:

```text
main
```

Recommended settings:

- Require a pull request before merging.
- Require status checks to pass.
- Require branches to be up to date before merging.
- Block force pushes.
- Block deletions.
- Restrict bypass permissions to the owner only, or disable bypass entirely when collaborators join.

Required status checks:

```text
CI
```

This name comes from `.github/workflows/ci.yml`:

```yaml
jobs:
  verify:
    name: CI
```

## Release tags

Do not create release tags from a dirty or unverified worktree.

Recommended local flow:

```bash
git status --short --branch
pnpm typecheck
pnpm test
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/helm pack:npm
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

npm publication is manual through the `Publish npm` GitHub Actions workflow.

## Prepare release workflow

`Prepare release` can bump `apps/helm/package.json`, push a version commit, create a tag and create a GitHub Release. If branch protection blocks workflow pushes to `main`, either allow GitHub Actions to bypass that rule for this workflow or keep version bumps in regular pull requests and only use the manual publish workflow after the tag exists.

## Notes for current solo-maintainer phase

During solo development, direct pushes to `main` may still be practical. If direct pushes remain enabled, keep the CI workflow on `push: main` and wait for it to pass before creating release tags.

When outside contributors join, prefer PR-only changes to `main`.
