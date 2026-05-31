# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-05-31

### Changed

- **Provider-agnostic positioning** -- README, CLI banner, and package metadata no longer reference a specific LLM vendor; architecture designed for Claude, OpenAI, Ollama, or any compatible provider
- **Remove unused dependencies** -- `ora` and `picocolors` removed (17 transitive packages eliminated)
- **Dynamic CLI version** -- reads from package.json at runtime instead of hardcoded string
- **Deduplicated color helpers** -- consolidated banner formatting functions in cli.ts
- **Build target aligned** -- tsup target updated from node18 to node20 (matches engines field)
- **npm keywords expanded** -- added `cmdb`, `platform-engineering`, `agentic-ai`, `mcp`, `shadow-it`

### Added

- **DB pagination** -- `getNodes()`/`getEdges()` accept optional `{ limit, offset }` for paginated queries
- **`getNodeCount()`** -- efficient COUNT query without loading all rows
- **Composite index** -- `idx_connections_lookup` on `(session_id, source_asset_id, target_asset_id)` for O(1) upsert lookups
- **DB migration v3** -- automatically adds composite index to existing v2 databases
- **Circuit breaker logging** -- `logDebug()` calls when breaker trips (observability)
- **Error message sanitization** -- URLs in error messages stripped of credentials before logging
- **Public API exports** -- `createScanRunner`, `safeEnv`, `extractHost`, `walkChrome` exported for plugin authors
- **303 tests** across 14 test files (+59 new tests)
  - Circuit breaker: trip threshold, reset, timeout passthrough (6 tests)
  - safeEnv: secret filtering, AWS key exclusion (5 tests)
  - Platform: scanListeningPorts, scanProcesses, Windows stubs (4 tests)
  - Exporter: JGF, HTML, discoveryApp, exportAll integration (19 tests)
  - Bookmarks: extractHost, walkChrome direct tests (15 tests)
  - DB: pagination, getNodeCount, composite index (4 tests)
  - stripSensitive: edge cases (4 tests)
- **Vision & Strategy 2026-2027** -- comprehensive product strategy document with market analysis, competitive landscape, open-source revenue model, and 4-phase roadmap

### Security

- **stripSensitive hardened** -- trim whitespace, never return empty string for valid input
- **Error log sanitization** -- URLs in discovery failure messages sanitized before output
- **safeEnv secret filtering** -- verified: AWS_SECRET_ACCESS_KEY and arbitrary env vars excluded from child processes

### Performance

- **Hex layout optimization** -- pre-parse occupied coordinates in `findFreeOrigin()` instead of re-splitting strings per iteration
- **Connection upsert** -- composite index reduces lookup from O(n) table scan to O(1)

## [1.1.1] - 2026-03-06

### Security

- **npm audit CI gate** -- `npm audit --audit-level=high` as mandatory CI step; build breaks on high/critical vulnerabilities
- **License compliance CI gate** -- `license-checker --failOn GPL/AGPL` blocks strong copyleft introductions
- **Dependabot** -- weekly npm dependency updates with dev-dependency grouping (`.github/dependabot.yml`)
- **.npmrc security defaults** -- `audit=true`, `engine-strict=true`, `fund=false`
- **LGPL-3.0 legal sign-off** -- formal compliance review, `THIRD-PARTY-LICENSES` file, CI enforcement

### Changed

- **vitest 3.x → 4.x** -- major version upgrade, 244/244 tests pass with zero config changes
- **postinstall ESM** -- extracted inline CJS postinstall to `scripts/postinstall.mjs`
- **Dependency updates** -- `claude-agent-sdk` 0.2.59→0.2.70, `@types/node` patch update

### Added

- **SBOM generation** -- CycloneDX SBOM (`sbom.cdx.json`) generated and uploaded as CI artifact
- **Enterprise evaluation docs** -- evaluation report, task specification, legal sign-off, spike results

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
