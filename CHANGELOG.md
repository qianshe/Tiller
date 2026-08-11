# Changelog

All notable changes to Tiller should be recorded here.

The project is currently in pre-release productization. npm publishing and GitHub
tagging are paused until the release checklist is complete.

## [Unreleased]

### Added

- Productization documents for contribution, security, release readiness, and
  license strategy.
- Embedded single-Helm Deck packaging direction: workspace `@tiller/helm`, npm `@qianshe/tiller`.

### Changed

- `tiller` remains the intended CLI command for the unified package.
- Release status is explicitly pre-release and not ready for public npm publish.

### Known gaps

- Embedded Deck / Helm configuration and workspace mapping still need hardening.
- LAN authentication and pairing defaults need a final product decision.
- Package contents and tag flow need another clean verification pass.

## [0.1.10] - 2026-08-12

### Added

- Dashboard overview with multi-Helm session and activity aggregation.
- Preparation records, quick session creation, and embedded task, Agent,
  settings, and session views.

### Changed

- Renamed the Dashboard navigation label to `概览` in Chinese and `Dashboard`
  in English while retaining the `/dashboard` route.
- Improved Dashboard responsive layout and information density.

### Fixed

- Corrected ACP thinking, tool-call, and sub-agent stream result handling.
