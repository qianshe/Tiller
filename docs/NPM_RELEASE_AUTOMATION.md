# npm Release Automation

Tiller uses GitHub Actions for two release gates:

- CI on pull requests and pushes to `main`.
- Manual npm release that bumps version, verifies, tags, publishes npm and creates a draft GitHub Release.

## npm publish permission

The default publishing path is npm Trusted Publishing through GitHub Actions OIDC. This avoids storing a long-lived npm token in GitHub.

Configure it in npm:

```text
@qianshe/tiller → Settings → Trusted Publisher
```

Use these values:

| Field | Value |
| --- | --- |
| Publisher | GitHub Actions |
| Organization / user | `qianshe` |
| Repository | `Tiller` |
| Workflow filename | `publish-npm.yml` |

The publish workflow must keep:

```yaml
permissions:
  contents: write
  id-token: write
```

`contents: write` is required to push the version commit/tag and create the draft GitHub Release. `id-token: write` is required by npm Trusted Publishing. The publish workflow runs on Node.js 24 so the bundled npm CLI supports Trusted Publishing.

Fallback: if Trusted Publishing is not configured, create a GitHub Actions secret named `NPM_TOKEN` with an npm granular access token that can publish `@qianshe/tiller`. If npm publish requires 2FA, create the token with publish 2FA bypass enabled, then add `NODE_AUTH_TOKEN` back to the publish step.

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
| `bump` | `prerelease-alpha` | One of `prerelease-alpha`, `prerelease-beta`, `prerelease-rc`, `patch`, `minor`, `major`. |
| `dist_tag` | `preview` | Must match the bump type. |
| `base_branch` | `main` | Branch to bump, verify, commit and tag. |

Accepted combinations:

| Bump type | Required npm dist-tag |
| --- | --- |
| `prerelease-alpha` | `preview` |
| `prerelease-beta` | `preview` |
| `prerelease-rc` | `preview` |
| `patch` | `latest` |
| `minor` | `latest` |
| `major` | `latest` |

The workflow:

1. checks out the base branch;
2. runs `npm --prefix apps/helm version ... --no-git-tag-version`;
3. runs typecheck, tests, Deck import lint and package smoke test;
4. commits `apps/helm/package.json`;
5. creates and pushes the matching `vX.Y.Z...` tag;
6. publishes `apps/helm/dist-package` to npm through Trusted Publishing;
7. creates a zip copy of `apps/helm/dist-package`;
8. creates release notes with package metadata, compare link, commit summary and GitHub-generated issue/PR notes;
9. publishes `apps/helm/dist-package` to npm through Trusted Publishing;
10. creates a draft GitHub Release and attaches both the generated npm tarball and zip package.

Prerelease versions are created as draft GitHub prereleases. Stable versions are created as draft GitHub Releases. Publish the draft only after npm installation is verified.

> If branch protection blocks workflow pushes to `main`, allow GitHub Actions to bypass that rule for this workflow or keep version bumping in a regular pull request before running the publish workflow.

## Release steps

1. Confirm local `main` is clean and pushed.
2. In GitHub Actions, run `Publish npm` manually:

```text
bump: prerelease-alpha
dist_tag: preview
base_branch: main
```

If `apps/helm/package.json` is currently `0.1.0-alpha.2`, this creates and publishes `v0.1.0-alpha.3`. The `prerelease-alpha`, `prerelease-beta` and `prerelease-rc` options control the prerelease suffix (`alpha`, `beta`, `rc`). `patch`, `minor` and `major` create stable tags without a prerelease suffix.

3. Verify npm:

```bash
npm view @qianshe/tiller@preview version --registry=https://registry.npmjs.org/
npm install -g @qianshe/tiller@preview --registry=https://registry.npmjs.org/
tiller --version
```

4. If npm verification succeeds, publish the draft GitHub Release from the GitHub Releases UI, or run:

```bash
gh release edit v0.1.0-alpha.3 --draft=false
```

For a stable release, run `Publish npm` with `patch`, `minor`, or `major`, and use:

```text
dist_tag: latest
```

Verify:

```bash
npm view @qianshe/tiller@latest version --registry=https://registry.npmjs.org/
```

After publishing a stable `latest`, verify explicit update behavior from an older global installation:

```bash
tiller update
```

The command should run `npm install -g @qianshe/tiller@latest`. Startup checks should only print `tiller update` guidance and must not install packages.

## Notes

- Do not release from a dirty or unverified branch.
- The publish workflow intentionally refuses prerelease bumps with `latest`, or stable bumps with `preview`.
- If npm publish fails after the version tag has been pushed, fix the npm permission or registry issue before creating another version.
- Draft GitHub Releases include `qianshe-tiller-<version>.tgz`, `qianshe-tiller-<version>.zip`, a compare link, commit summary and GitHub-generated issue/PR notes when available.
- Keep Tiller Pro and commercial release artifacts out of this Core workflow.
