# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-06

### Added

- **Session pruning** -- `prune` CLI command with `--older-than` (ISO 8601) and `--dry-run` flags; `deleteSession()` and `pruneSessions()` methods on CartographyDB
- **Temp file cleanup** -- `cleanupTempFiles()` removes orphaned `/tmp/cartograph_*.sqlite` files at CLI startup to prevent accumulation after crashes
- **Test coverage reporting** -- `npm run test:coverage` via `@vitest/coverage-v8`; reports in text, lcov, and json-summary formats
- **244 tests** across 14 test files (+5 new tests for pruning and temp cleanup)

## [1.0.1] - 2026-03-05

### Changed

- **Zod DB validation** -- all 7 row mappers (session, node, edge, event, task, workflow, connection) now validate raw SQLite rows through Zod schemas, catching corrupted data at read time
- **Circuit breaker** -- cloud scan tools (k8s, AWS, GCP, Azure) skip remaining commands after 3 consecutive failures, preventing long hangs when CLIs are unconfigured

### Added

- **Test coverage** -- 239 tests across 14 test files (+29 new tests)
  - `bookmarks.ts` -- 17 tests covering Chrome parsing, multi-profile, deduplication, Firefox discovery, URL edge cases
  - `agent.ts` -- 12 tests covering event emission, error propagation, turn counting, hint passing, mixed content blocks

## [1.0.0] - 2026-03-05

### Added

- **Discovery agent** -- Claude-powered autonomous infrastructure scanning via Agent SDK
- **Browser bookmarks** -- Chrome, Chromium, Firefox, Brave, Edge, Vivaldi, Opera (all platforms including Snap/Flatpak)
- **Browser history scanning** -- anonymized hostname extraction with user consent
- **Installed app detection** -- platform-native scanning (dpkg/snap/flatpak/rpm, Homebrew/Spotlight, Registry/winget/choco/scoop)
- **Local database discovery** -- PostgreSQL, MySQL, MongoDB, Redis, SQLite file scanning
- **Cloud resource scanning** -- AWS (EC2/RDS/EKS/S3), GCP (Compute/GKE/Cloud Run), Azure (AKS/WebApps)
- **Kubernetes scanning** -- Nodes, Services, Pods, Deployments, Ingresses
- **Human-in-the-loop** -- `ask_user()` tool for mid-discovery clarification
- **Export formats** -- JSON, JGF, Mermaid (topology + dependencies), Backstage YAML, interactive HTML map
- **Hex grid visualization** -- axial coordinate system with domain clustering
- **Safety hook** -- `PreToolUse` blocklist for destructive commands (Unix + PowerShell)
- **Cross-platform support** -- Linux, macOS, Windows (native PowerShell, no WSL required)
- **Structured logging** -- JSON to stderr for ELK/Datadog/Splunk/CloudWatch
- **Graceful shutdown** -- SIGTERM/SIGINT handlers with DB cleanup
- **Input validation** -- `--depth` (1-50), `--max-turns` (1-500)
- **Discovery timeout** -- 30-minute wall-clock guard
- **Environment safety** -- whitelisted env vars for child processes (`safeEnv()`)
- **CLI commands** -- `discover`, `export`, `show`, `sessions`, `overview`, `chat`, `bookmarks`, `seed`, `doctor`, `docs`
- **CI/CD** -- GitHub Actions workflow (lint, test, build on Node 20/22)
- **210 tests** across 12 test files (vitest)

### Security

- Bash safety hook blocks destructive commands on all platforms
- `stripSensitive()` removes credentials from URLs before storage
- Child processes receive only whitelisted environment variables
- Read-only discovery -- agent never writes, deletes, or modifies system state
