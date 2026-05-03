# Changelog

All notable changes to Tiller should be recorded here.

The project is currently in pre-release productization. npm publishing and GitHub
tagging are paused until the release checklist is complete.

## [Unreleased]

### Added

- Productization documents for contribution, security, release readiness, and
  license strategy.
- Embedded single-Helm Deck packaging direction for `@qianshe/tiller`.

### Changed

- `tiller` remains the intended CLI command for the unified package.
- Release status is explicitly pre-release and not ready for public npm publish.

### Known gaps

- Embedded Deck / Helm configuration and workspace mapping still need hardening.
- LAN authentication and pairing defaults need a final product decision.
- Package contents and tag flow need another clean verification pass.
