# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Continuous Cartography — topology diffing / drift detection.** Compare two
  discovery snapshots to surface added/removed/changed nodes and added/removed
  edges. Read-only, deterministic, no schema migration.
  - Engine: `diffTopology(base, current)` (pure) + `CartographyDB.diffSessions(baseId, currentId)`.
    Nodes keyed by `id`, edges by `(source, target, relationship)`. Drift is detected on a
    stable field projection (`DRIFT_FIELDS`); `confidence` changes are reported as
    `confidenceDelta` but never on their own mark a node as changed.
  - MCP tool **`diff_topology`** (read-only; defaults to the two most recent sessions) and
    prompt **`compare-environments`**.
  - CLI **`datasynx-cartography diff [base] [current]`** with `--format text|json|mermaid`
    and `-o, --output <file>`.
  - Exporter **`generateDiffMermaid`** — added=green, removed=red, changed=amber.
- **Headless discovery output** — `discover --output-format text|json|stream-json`.
  `stream-json` emits one JSON event per line (NDJSON) on stdout plus a final
  `{kind:"result",…}` line; `json` emits the final catalog object; `text` is the
  unchanged interactive default. Non-text modes keep stdout machine-clean (progress
  stays on stderr) and skip interactive review/follow-up — making discovery
  pipeline/CI-friendly.
- **Configurable tool-output limit** — `CartographyConfig.maxToolResponseBytes`
  (default 100 000) caps each scan tool's response; oversized output is truncated
  with an explicit notice instead of silently flooding the agent's context window.
  Exposed as the pure `clampText(raw, max)` helper.
- **Session names** — discovery sessions now get a deterministic, human-friendly
  label (e.g. `"infra+data · 42 nodes · 2026-06-11"`) instead of a bare UUID,
  derived from the topology with no LLM call (`deriveSessionName`). Override with
  `discover --name <name>`. Shown in `sessions`, `show`, `overview` and the
  `cartography://sessions` MCP resource. Backed by a new `name` column
  (**schema migration v5**, additive — existing catalogs upgrade in place).

### Security

- **Untrusted-text sanitization** — new `sanitizeUntrusted` / `sanitizeValue` strip
  invisible Unicode (zero-width spaces, bidi/format controls, soft hyphen, BOM) and
  C0/C1 control characters (preserving tab/newline/CR) and NFC-normalize. Applied at
  the catalog write chokepoint (`upsertNode`/`insertEdge` — node name/domain/tags/
  metadata and edge evidence) and to scan-tool output, so hidden prompt-injection
  payloads cannot reach the catalog or an LLM context.

### Fixed

- **MCP tool prefix typo** — the discovery agent's `allowedTools` and the CLI progress
  renderer used `mcp__cartograph__*` (missing the `y`) while the in-process MCP server is
  registered as `cartography`. Corrected to `mcp__cartography__*`, so the tool allowlist
  now actually matches and the discovery progress display renders tool names correctly.
- **`doctor` Node.js check** now requires `>=20`, matching `engines.node` (was `>=18`).
- **`config.maxDepth`** is now applied — surfaced to the discovery agent as a crawl-depth
  bound in the system prompt (it was previously defined but unused).

- **Claude Code plugin** (`plugin/`) — Cartography is now installable in one step
  from the shared Datasynx marketplace (`/plugin marketplace add datasynx/claude-plugins`
  then `/plugin install cartography@datasynx`), mirroring the Shadowing plugin.
  The marketplace references this repo's `plugin/` directory via a `git-subdir`
  source. README and docs now lead the Claude Code install with the plugin flow,
  keeping `claude mcp add` as the manual alternative.

## [2.0.0] - 2026-06-04

Major release — **the package is now MCP-first**. The Model Context Protocol server
is the primary interface; the Claude-driven discovery loop becomes an optional adapter.
Backward compatible: the existing CLI commands and library API are unchanged.

### Added

- **Production MCP server** (`createMcpServer`, `@modelcontextprotocol/sdk`) exposing the
  topology as **Resources** (progressive disclosure: `cartography://graph/summary`,
  `nodes/{id}`, `services`, `databases`, `dependencies/{id}`), query **Tools**
  (`query_infrastructure`, `search_topology`, `get_dependencies`, `list_services`,
  `get_node`, `get_summary`, `run_discovery`) and **Prompts** (`audit-attack-surface`,
  `map-service-dependencies`, `onboard-to-system`).
- **Two transports**: stdio (local-first default) and Streamable HTTP (localhost-bound,
  DNS-rebinding protection). New `cartography-mcp` binary and `datasynx-cartography mcp` command.
- **Recursive-CTE graph traversal** (`getDependencies`, downstream/upstream/both, cycle guard),
  plus `getGraphSummary`, `searchNodes`, `getNode`, `getNodesByType`.
- **Semantic search** via `sqlite-vec` with pluggable embeddings (local transformer +
  offline hash fallback) and graceful lexical degradation.
- **Scanner plugin architecture** (`Scanner`/`ScannerRegistry`) with built-in bookmarks,
  installed-apps and local-ports scanners, and **deterministic LLM-free discovery**
  (`runLocalDiscovery`).
- Official **MCP Registry** metadata (`server.json`, `mcpName`).

### Changed

- **Safety: denylist → strict read-only allowlist** (`src/allowlist.ts`), shell-aware
  (POSIX allowlist + PowerShell mutating-cmdlet denylist), enforced inside command execution
  as defense-in-depth and shared by the Claude `safetyHook`.
- **Dual ESM/CJS** build with types-first `exports`; clean `publint`/`attw`.
- `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`, `@huggingface/transformers` and
  `sqlite-vec` moved to `optionalDependencies` (lazy-loaded, graceful absence).

### Removed

- Default export of `CartographyDB` (use the named `createMcpServer` / `CartographyDB` exports).

## [1.2.1] - 2026-05-31

### Changed

- **Remove `any` type** -- `McpServer = any` replaced with typed `McpServerConfig` import (kein `any` compliance)
- **Deduplicate browser DB reading** -- `queryBrowserDb<T>()` helper consolidates 3 copy-open-query-close patterns; `db.close()` now in `finally` for guaranteed cleanup
- **Export bookmarks internals** -- `readChromeLike`, `chromeLikePaths`, `chromeLikeHistoryPaths` exported for direct testing

### Security

- **npm audit fix** -- patched vite path traversal + WebSocket vulnerabilities (nanoid, picomatch updates); 0 vulnerabilities

### Added

- **327 tests** across 14 test files (+24 new tests, +7 files at 100% coverage)
  - DB migration: v1→v3 and v2→v3 migration path tests (2 tests)
  - Hex: hexRound q/r branch coverage → 100% (2 tests)
  - Exporter: nodeLayer branches (messaging/infra/config/other), metadata extras (6 tests)
  - Bookmarks: readChromeLike direct tests, chromeLikePaths/chromeLikeHistoryPaths (14 tests)
  - Platform: dbScanDirs, findFiles improvements (3 tests)
- **7 files at 100% coverage** -- hex.ts, exporter.ts, mapper.ts, db.ts (lines), logger.ts, safety.ts, preflight.ts

### Performance

- **70% overall statement coverage** -- up from 62% baseline

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
