# npm Release Automation

Tiller uses GitHub Actions for three release gates:

- CI on pull requests and pushes to `main`.
- Manual release preparation that bumps version, tags and creates a draft GitHub Release.
- Manual npm publish from an explicit version tag.

## Required GitHub secret

Create a repository secret:

```text
NPM_TOKEN
```

Use an npm granular access token that can publish `@qianshe/tiller`. If npm publish requires 2FA, create the token with publish 2FA bypass enabled.

GitHub path:

```text
Repository → Settings → Secrets and variables → Actions → New repository secret
```

## CI workflow

Workflow:

```text
.github/workflows/ci.yml
```

Runs on:

- pull requests;
- pushes to `main`.

Checks:

```bash
pnpm typecheck
pnpm test
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/helm pack:npm
```

## Prepare release workflow

Workflow:

```text
.github/workflows/prepare-release.yml
```

Runs only by manual dispatch from GitHub Actions. Inputs:

| Input | Example | Notes |
| --- | --- | --- |
| `bump` | `prerelease-alpha` | One of `prerelease-alpha`, `prerelease-beta`, `prerelease-rc`, `patch`, `minor`, `major`. |
| `base_branch` | `main` | Branch to bump, verify, commit and tag. |

The workflow:

1. checks out the base branch;
2. runs `npm version ... --no-git-tag-version --workspace apps/helm`;
3. runs typecheck, tests, Deck import lint and package smoke test;
4. commits `apps/helm/package.json`;
5. creates and pushes the matching `vX.Y.Z...` tag;
6. creates a draft GitHub Release;
7. attaches the generated npm tarball to the draft GitHub Release.

Prerelease versions are created as draft GitHub prereleases. Stable versions are created as draft GitHub Releases. Publish the draft only after npm publish succeeds and installation is verified.

> If branch protection blocks workflow pushes to `main`, either allow GitHub Actions to bypass that rule for this workflow or keep version bumping in a regular pull request and use the publish workflow only.

## Publish workflow

Workflow:

```text
.github/workflows/publish-npm.yml
```

Runs only by manual dispatch from GitHub Actions. Inputs:

| Input | Example | Notes |
| --- | --- | --- |
| `git_ref` | `v0.1.0-alpha.1` | Must be an existing tag/ref. |
| `dist_tag` | `preview` | Must match the ref shape. |

Accepted release refs:

| Git ref pattern | Required npm dist-tag |
| --- | --- |
| `vX.Y.Z-alpha.N` | `preview` |
| `vX.Y.Z-beta.N` | `preview` |
| `vX.Y.Z-rc.N` | `preview` |
| `vX.Y.Z` | `latest` |

Unsupported ref shapes fail before publishing. A prerelease ref with `latest`, or a stable ref with `preview`, also fails before publishing.

The workflow checks out the requested ref, builds `apps/helm/dist-package`, verifies that the ref version matches `apps/helm/dist-package/package.json`, then publishes with the selected npm dist-tag.

## Release steps

1. Confirm local `main` is clean and pushed.
2. In GitHub Actions, run `Prepare release` manually:

```text
bump: prerelease-alpha
base_branch: main
```

3. Wait for `Prepare release` to create a version commit, tag and draft GitHub Release.
4. In GitHub Actions, run `Publish npm` manually:

```text
git_ref: v0.1.0-alpha.2
dist_tag: preview
```

Use the exact tag created by the prepare workflow.

5. Verify npm:

```bash
npm view @qianshe/tiller@preview version --registry=https://registry.npmjs.org/
npm install -g @qianshe/tiller@preview --registry=https://registry.npmjs.org/
tiller --version
```

6. If npm verification succeeds, publish the draft GitHub Release from the GitHub Releases UI, or run:

```bash
gh release edit v0.1.0-alpha.2 --draft=false
```

For a stable release, run `Prepare release` with `patch`, `minor`, or `major`, then dispatch `Publish npm` with:

```text
git_ref: vX.Y.Z
dist_tag: latest
```

Verify:

```bash
npm view @qianshe/tiller@latest version --registry=https://registry.npmjs.org/
```

## Notes

- Do not create a release from a dirty or unverified worktree.
- The publish workflow intentionally refuses to publish if the requested ref version does not match the package version.
- The publish workflow intentionally refuses unsupported refs such as `v0.1`, `release-0.1.0`, or `v0.1.0-dev.1`.
- Keep Tiller Pro and commercial release artifacts out of this Core workflow.
