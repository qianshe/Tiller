# Tiller Core / Pro Boundary

This document defines the current product split for Tiller so the public Core repo can stay simple while future commercial features have a clear home.

## Product intent

Tiller starts as a local-first command deck for one machine:

- one running Helm daemon;
- local or LAN browser access to that daemon;
- local projects and worktrees;
- ACP-compatible coding agents;
- local session history, artifacts and logs.

Future paid functionality should focus on multi-machine and team control-plane use cases. Those capabilities should not be added to the Core runtime by default.

## Repository split

| Area | Repository | License / terms | Purpose |
| --- | --- | --- | --- |
| Tiller Core | `qianshe/Tiller` | Source-available preview now; possible open-core license later | Single-machine local command deck |
| Tiller Pro / Control Plane | future private `tiller-pro` | Commercial | Multi-machine, team and enterprise control plane |

Do not move code to `tiller-pro` before there is a real Pro feature or user need. The first boundary is architectural and product-level, not a physical rewrite.

## Core scope

Core owns features required for a useful single-machine product:

- `apps/helm`: local daemon, CLI, HTTP/WebSocket transport, local config, local session store.
- `apps/deck`: embedded single-Helm Web UI.
- `packages/acp-runtime`: ACP process/session integration used by the local daemon.
- `packages/agent-registry`: local agent discovery and provider metadata.
- `packages/sync-protocol`: client/server protocol for the local Deck ↔ Helm connection.
- `packages/shared`: shared types and utilities with no Pro dependency.

Core may support multiple projects, worktrees and agents on the same Helm instance. It should not become a central SaaS or fleet manager.

## Pro scope

Pro should own capabilities that turn Tiller from a local deck into a control plane:

- multiple Helm nodes / machine registry;
- remote node enrollment and health checks;
- team accounts, organizations and seats;
- RBAC, SSO and identity provider integration;
- central audit log and retention policies;
- policy management for permissions, tools and agent access;
- hosted relay / secure remote access;
- centralized backup, sync and search across nodes;
- license activation, metering and billing;
- enterprise deployment tooling and support bundles.

## Boundary rules

1. Core must run without Pro.
2. Core must not import code from Pro.
3. Shared protocol changes must keep single-Helm use cases first.
4. Do not add account, billing, license-server, SSO, central audit or fleet-management code to Core.
5. If Core needs extension points, add narrow interfaces instead of speculative plugin frameworks.
6. Pro may depend on Core packages or published Core artifacts; Core must never depend on Pro.
7. Multi-machine orchestration belongs to Pro even if the UI concept starts in Core discussions.

## Suggested future private repo shape

```text
tiller-pro/
├── apps/
│   ├── control-plane/      # API and central orchestration
│   └── admin-console/      # team / fleet / billing UI
├── packages/
│   ├── fleet/              # Helm node registry and health
│   ├── rbac/               # roles, teams, permissions
│   ├── audit/              # central audit events and retention
│   ├── relay/              # secure remote access / tunnel / pairing bridge
│   ├── licensing/          # license activation and entitlement checks
│   └── billing/            # commercial packaging, if needed
└── docs/
    └── enterprise-deployment.md
```

Start this repository empty. Add code only after a concrete paid feature is designed.

## Migration triggers

Create or populate `tiller-pro` when at least one of these is true:

- a real user asks for multiple Helm machines in one dashboard;
- team identity, RBAC or audit logging becomes necessary;
- hosted relay or remote access is required;
- a commercial license check is needed;
- Core extension points are stable enough for Pro to depend on.

Until then, keep the public repo focused on making Tiller Core reliable and easy to install.
