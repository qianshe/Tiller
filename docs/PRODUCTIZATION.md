# Tiller Productization Notes

## Current product line

Tiller v1 is a single npm-distributed local/服务器 runtime:

- command: `tiller`
- package candidate: `@qianshe/tiller`
- embedded Web: manages only the current Tiller process
- config/data root: user `.tiller` directory

## Current release status

Public release is paused until the runtime, embedded Deck, and workspace mapping
are stable.

Do not publish npm, create GitHub tags, or market this as a public release until
`docs/RELEASE_CHECKLIST.md` passes.

## Product boundaries

In scope for v1:

- local/服务器 Tiller runtime;
- embedded single-Helm Deck;
- ACP agent configuration from the local Tiller config;
- same-origin WebSocket between embedded Deck and Tiller;
- package smoke testing from a tarball.

Out of scope for v1:

- public SaaS connecting directly to a user's private LAN runtime;
- multi-Helm public console;
- license-code or paid entitlement flow;
- hosted account system.

## Packaging expectations

The packaged runtime must not depend on monorepo source paths. It should include:

- bundled Tiller server entry;
- first-party workspace code bundled into the CLI artifact;
- built Deck static assets;
- package metadata and expected npm bin mapping.

## Runtime expectations

- Works on Windows, macOS, and Linux with Node.js 22+.
- Writes config, logs, and session data under the user's `.tiller` directory.
- Prints reachable URLs at startup.
- Fails clearly when the port is already occupied.
- Can be constrained to loopback with `--host 127.0.0.1`.

## Open decisions

- Final LAN authentication default.
- Final open-source/commercial license strategy.
- Versioning and dist-tag policy.
- Whether the package name `@qianshe/tiller` with CLI command `tiller` is the final public convention.
