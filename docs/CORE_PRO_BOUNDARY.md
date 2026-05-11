# Tiller Core / Pro Boundary

This document defines the product split for Tiller after the first public preview.

The boundary is **not** "one Helm is free, multiple Helm endpoints are paid". Core may include a useful local/manual multi-Helm deck. Pro is reserved for managed fleet, team, identity, policy, audit and hosted control-plane value.

## Product intent

Tiller Core is a local-first command deck for an individual operator:

- run Helm daemons on machines the user controls;
- open local or LAN browser access to those Helm endpoints;
- manually add or switch between Helm endpoints;
- manage local projects, worktrees and ACP-compatible coding agents;
- keep local session history, artifacts and logs.

Tiller Pro should focus on capabilities that become valuable when multiple people, machines or compliance requirements are involved.

## Repository split

| Area | Repository | License / terms | Purpose |
| --- | --- | --- | --- |
| Tiller Core | `qianshe/Tiller` | Source-available preview now; possible open-core license later | Local/manual command deck for one operator |
| Tiller Pro / Control Plane | private `qianshe/tiller-pro` | Commercial | Managed fleet, team and enterprise control plane |

Do not move code to `tiller-pro` only because Core can show more than one Helm endpoint. Move or create code there when the feature needs managed fleet state, team identity, centralized policy, hosted services or commercial entitlements.

## Core scope

Core should stay genuinely useful without a login or license server:

- `apps/helm`: local daemon, CLI, HTTP/WebSocket transport, local config, local session store.
- `apps/deck`: embedded Web UI for the current operator.
- `packages/acp-runtime`: ACP process/session integration used by the local daemon.
- `packages/agent-registry`: local agent discovery and provider metadata.
- `packages/sync-protocol`: client/server protocol for Deck ↔ Helm connections.
- `packages/shared`: shared types and utilities with no Pro dependency.

Core may include:

- multiple manually configured Helm endpoints;
- local browser profiles that remember endpoints;
- local/LAN pairing for trusted devices;
- multiple projects, worktrees and agents;
- local status, logs, sessions and artifacts.

Core should not require account login for basic local use.

## Pro scope

Pro owns capabilities that turn Tiller from a local/manual deck into a managed control plane:

- Helm node enrollment and fleet registry;
- node identity, trust material and health monitoring;
- shared team workspace and organization management;
- RBAC, SSO and identity provider integration;
- central audit log and retention policies;
- central policy management for permissions, tools and agent access;
- hosted relay / secure remote access;
- centralized backup, sync and search across nodes;
- license activation, metering, billing and entitlements;
- enterprise deployment tooling and support bundles.

## Boundary rules

1. Core must run without Pro.
2. Core must not import code from Pro.
3. Core may support manual multi-Helm convenience for one operator.
4. Pro owns managed fleet state, team identity, central policy, audit and hosted relay.
5. Do not add billing, SSO, central audit, license-server or Pro entitlement checks to Core's local happy path.
6. If Core needs extension points, add narrow interfaces instead of speculative plugin frameworks.
7. Pro may depend on Core packages or published Core artifacts; Core must never depend on Pro.
8. License checks should protect Pro-owned features, not local Core session creation or local ACP chat.

## Monetization posture

Early Core should prioritize adoption and feedback:

- keep local use friction low;
- allow manual endpoint management if it improves the product;
- add donation / sponsor / early-access links before adding hard paywalls;
- collect Pro waitlist signals for fleet, team and enterprise needs.

Revenue should come from managed capabilities that are hard to replicate by simply editing local code: hosted relay, trusted fleet registry, team identity, audit, support, updates and enterprise confidence.

## Suggested private repo shape

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
    └── commercial-boundary.md
```

## Migration triggers

Create or populate Pro runtime code when at least one of these is true:

- users need shared team state rather than local browser state;
- users need automatic node enrollment or health monitoring;
- RBAC, SSO or audit logging becomes necessary;
- hosted relay or remote access is required;
- commercial entitlements need enforcement;
- Core extension points are stable enough for Pro to depend on.

Until then, keep Core focused on making Tiller reliable, easy to install and pleasant for individual operators.
