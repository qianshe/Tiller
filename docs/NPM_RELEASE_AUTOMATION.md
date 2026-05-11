# npm Release Automation

Tiller uses GitHub Actions for two release gates:

- CI on pull requests and pushes to `main`.
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

1. Update the package version in `apps/helm/package.json`.
2. Run verification locally:

```bash
pnpm typecheck
pnpm test
pnpm --filter @tiller/deck lint
pnpm --filter @tiller/helm pack:npm
```

3. Commit and push to `main` through PR or direct maintainer flow.
4. Create and push a matching tag:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

5. In GitHub Actions, run `Publish npm` manually:

```text
git_ref: v0.1.0-alpha.1
dist_tag: preview
```

6. Verify npm:

```bash
npm view @qianshe/tiller@preview version --registry=https://registry.npmjs.org/
npm install -g @qianshe/tiller@preview --registry=https://registry.npmjs.org/
tiller --version
```

For a stable release, use a stable version and tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Then dispatch:

```text
git_ref: v0.1.0
dist_tag: latest
```

Verify:

```bash
npm view @qianshe/tiller@latest version --registry=https://registry.npmjs.org/
```

## Notes

- Do not create a GitHub tag from a dirty working tree.
- The publish workflow intentionally refuses to publish if the requested ref version does not match the package version.
- The publish workflow intentionally refuses unsupported refs such as `v0.1`, `release-0.1.0`, or `v0.1.0-dev.1`.
- Keep Tiller Pro and commercial release artifacts out of this Core workflow.
