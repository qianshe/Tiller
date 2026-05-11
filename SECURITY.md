# Security Policy

## Supported status

Tiller is currently pre-release software. Do not deploy it as a public internet
service until the release checklist and security review are complete.

Current supported line:

| Version | Status |
| --- | --- |
| 0.1.x alpha | Internal / local testing only |

## Reporting a vulnerability

Until a public security contact is created, report security issues privately to
the project owner. Do not publish exploit details before a fix or mitigation is
available.

Please include:

- affected version or commit;
- operating system and Node.js version;
- whether the issue requires LAN, local machine, or filesystem access;
- reproduction steps;
- impact and any known workaround.

## Security assumptions

- The embedded Deck is intended to manage the current local Tiller process.
- LAN access must be treated as privileged access during alpha testing.
- `daemon.auth: "pairing"` in `.tiller/config.json` (or `TILLER_AUTH=pairing`)
  can be used to re-enable pairing while the product security model is being finalized.
- Session data, logs, and config are stored under the user's `.tiller` directory.

## Before public release

- Decide the default authentication model for LAN access.
- Review private-network and mixed-content browser constraints.
- Verify package contents with `pnpm pack` before publishing.
- Audit dependencies and generated artifacts.
- Document the supported threat model.
