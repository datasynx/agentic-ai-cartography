<div align="center">

# 🗺️ Datasynx Cartography

**AI-powered Infrastructure Discovery & Agentic AI Cartography**

[![npm version](https://img.shields.io/npm/v/@datasynx/agentic-ai-cartography?style=flat-square&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography)
[![npm downloads](https://img.shields.io/npm/dm/@datasynx/agentic-ai-cartography?style=flat-square&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![CI](https://github.com/datasynx/agentic-ai-cartography/actions/workflows/ci.yml/badge.svg)](https://github.com/datasynx/agentic-ai-cartography/actions/workflows/ci.yml)
[![Release](https://github.com/datasynx/agentic-ai-cartography/actions/workflows/release.yml/badge.svg)](https://github.com/datasynx/agentic-ai-cartography/actions/workflows/release.yml)
[![semantic-release](https://img.shields.io/badge/%20%20%F0%9F%93%A6%F0%9F%9A%80-semantic--release-e10079.svg?style=flat-square)](https://github.com/semantic-release/semantic-release)
[![MCP](https://img.shields.io/badge/MCP-server-6E56CF?style=flat-square)](https://modelcontextprotocol.io)
[![Provenance](https://img.shields.io/badge/npm-provenance_signed-3B7DBD?style=flat-square&logo=npm&logoColor=white)](https://docs.npmjs.com/generating-provenance-statements)
[![Agentic AI](https://img.shields.io/badge/Agentic_AI-Provider_Agnostic-D4A017?style=flat-square)](https://github.com/datasynx/agentic-ai-cartography)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Datasynx_AI-0077B5?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/company/datasynx-ai/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue?style=flat-square)](https://github.com/datasynx/agentic-ai-cartography)

<br/>

*A **Model Context Protocol server** that gives any AI agent read-only awareness of your complete system landscape — local services, databases, SaaS tools, installed apps and their dependencies — with progressive disclosure, recursive dependency traversal and semantic search. Discovery runs deterministically (no LLM required) or via an optional Claude-driven loop. Provider-agnostic: works with Claude, OpenAI, Ollama, or any MCP-compatible host.*

<br/>

**[📦 npm](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography) · [💼 LinkedIn](https://www.linkedin.com/company/datasynx-ai/) · [🐛 Issues](https://github.com/datasynx/agentic-ai-cartography/issues)**

</div>

---

## Contents

[MCP-first quick start](#-mcp-first--install-once-every-agent-knows-your-landscape) ·
[Connect your client](#connect-your-client-copy-paste) ·
[Embed in your app](#embed-in-your-own-app) ·
[What it does](#what-it-does) ·
[Cross-platform](#cross-platform-support) ·
[Features](#features) ·
[CLI commands](#commands) ·
[Architecture](#architecture) ·
[Safety](#safety) ·
[Public API](#public-api) ·
[Releasing](#releasing)

---

## 🤖 MCP-first — install once, every agent knows your landscape

> **v2.0** inverts the architecture: the package's primary interface is now a
> production **Model Context Protocol (MCP) server**. Any MCP host — Claude Code,
> Cursor, Cline, Windsurf, VS Code Copilot, the Vercel AI SDK, LangGraph — connects
> to it and gains read-only awareness of your complete system landscape. The bundled
> Claude-driven discovery loop is now one optional turnkey adapter; the server needs
> **no LLM dependency of its own**.

The topology is exposed with **progressive disclosure** so agents never blow their
context window:

- **Resources** (read-only context): `cartography://graph/summary` (low-token index — read first), `cartography://nodes/{id}`, `cartography://services`, `cartography://databases`, `cartography://dependencies/{id}`.
- **Tools** (parameterized queries): `query_infrastructure`, `search_topology` (semantic), `get_dependencies` (recursive graph traversal), `list_services`, `get_node`, `get_summary`, `run_discovery`.
- **Prompts**: `audit-attack-surface`, `map-service-dependencies`, `onboard-to-system`.

### Quick start

```bash
# 1. Discover your system (read-only, deterministic — no LLM required)
npx -p @datasynx/agentic-ai-cartography cartography-mcp --help
datasynx-cartography discover          # or the richer Claude-driven loop

# 2. Run the MCP server (stdio by default)
npx -p @datasynx/agentic-ai-cartography cartography-mcp
```

### Auto-install into your client

Let the harness write the correct config for your host — it parses the existing
file and merges in the server entry **without clobbering** your other servers:

```bash
datasynx-cartography list-clients                          # supported hosts
datasynx-cartography install --client claude-code          # global/user config
datasynx-cartography install --client claude-code --project # project-local (.mcp.json)
datasynx-cartography install --client claude-code --dry-run # preview the merge diff
```

Flags: `--global` (default) / `--project` scope, `--dry-run` (no write), `--name <server>`,
`--http`/`--url <url>` (register the HTTP endpoint), `--db <path>`, `--session <id>`.

> More hosts (Cursor, VS Code, Codex, Windsurf, Cline, Roo, Zed, JetBrains, Goose,
> Gemini CLI, OpenHands, Claude Desktop) are being added to `list-clients`. Until then,
> use the copy-paste blocks below.

### Connect your client (copy-paste)

**Claude Code**
```bash
claude mcp add cartography -- npx -p @datasynx/agentic-ai-cartography cartography-mcp
```

**Cursor / Windsurf / Cline** — `mcp.json` (or `~/.codeium/windsurf/mcp_config.json`):
```json
{
  "mcpServers": {
    "cartography": {
      "command": "npx",
      "args": ["-p", "@datasynx/agentic-ai-cartography", "cartography-mcp"]
    }
  }
}
```

**VS Code (Copilot)** — `.vscode/mcp.json` (note: `servers`, not `mcpServers`):
```json
{
  "servers": {
    "cartography": { "command": "npx", "args": ["-p", "@datasynx/agentic-ai-cartography", "cartography-mcp"] }
  }
}
```

**Remote / team use** — Streamable HTTP (localhost-bound, DNS-rebind protected):
```bash
cartography-mcp --http --port 3737      # → http://127.0.0.1:3737/mcp

# Exposing beyond loopback requires an explicit Host allowlist (CVE-2025-66414):
cartography-mcp --http --host 0.0.0.0 --port 3737 --allowed-hosts cartography.internal:3737
```
> Binding a non-loopback `--host` **without** `--allowed-hosts` is refused on purpose — it would
> leave the server open to DNS-rebinding attacks. Put it behind TLS/a reverse proxy for real deployments.

**Vercel AI SDK** (provider-agnostic):
```ts
import { experimental_createMCPClient } from 'ai';
const mcp = await experimental_createMCPClient({
  transport: { type: 'sse', url: 'http://127.0.0.1:3737/mcp' },
});
const tools = await mcp.tools(); // MCP tools → AI SDK tools, any model
```

### Embed in your own app

```ts
import { createMcpServer, runStdio, createSemanticSearch, localDiscoveryFn, CartographyDB } from '@datasynx/agentic-ai-cartography';

const db = new CartographyDB('/path/to/cartography.db');
const server = createMcpServer({
  db,
  search: await createSemanticSearch(db),   // semantic (sqlite-vec) + lexical fallback
  discovery: localDiscoveryFn(),            // deterministic, LLM-free scanners
});
await runStdio(server);
```

---

## What it does

```
$ datasynx-cartography discover

  CARTOGRAPHY  localhost
  ─────────────────────────────────────────────
  🔖  Browser bookmarks scanned…
  🖥  All installed apps scanned…
  +  Node  saas_tool:vscode           [saas_tool]   90%
  +  Node  saas_tool:cursor           [saas_tool]   90%
  +  Node  saas_tool:docker-desktop   [saas_tool]   90%
  +  Node  saas_tool:github.com       [saas_tool]   70%  🔖
  +  Node  web_service:localhost:5432 [database]    90%
  +  Node  web_service:localhost:6379 [cache]       90%
  ~  Edge  web_service:app → web_service:localhost:5432  uses
  ─────────────────────────────────────────────
  DONE  9 nodes, 3 edges  in 38.4s

  SEARCH MORE  — Refine discovery interactively
  → Search for (Enter = finish): hubspot windsurf
  ⟳  Searching for: hubspot windsurf
  +  Node  saas_tool:hubspot.com      [saas_tool]   70%  🔖
  +  Node  saas_tool:windsurf         [saas_tool]   90%
```

---

## Cross-Platform Support

Cartography runs natively on **Linux**, **macOS**, and **Windows** — no WSL required on Windows.

| Capability | Linux | macOS | Windows |
|---|---|---|---|
| **Network scanning** | `ss -tlnp` | `lsof -iTCP -sTCP:LISTEN` | `Get-NetTCPConnection` |
| **Process listing** | `ps aux` | `ps aux` | `Get-Process` |
| **Installed apps** | dpkg, rpm, snap, flatpak, `.desktop` | `/Applications`, Homebrew, Spotlight | Registry, winget, choco, scoop |
| **Command lookup** | `which` | `which` | `Get-Command` (PowerShell) |
| **File search** | `find` | `find` | `Get-ChildItem -Recurse` |
| **Shell** | `/bin/sh` | `/bin/sh` | PowerShell (pwsh / powershell.exe) |
| **DB service detection** | CLI probes (psql, mysql, etc.) | CLI probes | `Get-Service` + CLI probes |
| **Browser bookmarks** | `~/.config/google-chrome` + Snap/Flatpak | `~/Library/Application Support/...` | `%LOCALAPPDATA%\Google\Chrome\User Data` |
| **Firefox profiles** | `~/.mozilla/firefox` + Snap/Flatpak | `~/Library/.../Firefox/Profiles` | `%APPDATA%\Mozilla\Firefox\Profiles` |
| **Safety policy** | Read-only **allowlist** (POSIX parser) | Read-only **allowlist** (POSIX parser) | Read-only allowlist (PowerShell mutating-cmdlet denylist) |

---

## Features

| Feature | Details |
|---------|---------|
| **Installed App Scan** | Linux: dpkg/snap/flatpak/rpm, macOS: /Applications + Homebrew + Spotlight, Windows: Registry + winget + choco + scoop. 70+ known tools checked via cross-platform command lookup |
| **Browser Bookmarks** | Chrome, Chromium, Firefox, Brave, Edge, Vivaldi, Opera — all platforms including Snap/Flatpak on Linux |
| **Database Discovery** | PostgreSQL, MySQL, MongoDB, Redis, SQLite file scan. Windows: `Get-Service` for DB engine detection |
| **Cloud Scanning** | AWS (EC2/RDS/EKS/S3), GCP (Compute/GKE/Cloud Run), Azure (AKS/WebApps), Kubernetes |
| **Human-in-the-Loop** | Chat with the agent mid-discovery: type `"hubspot windsurf"` to search for specific tools |
| **Export Formats** | Mermaid topology, D3.js interactive graph, Backstage YAML, JSON |
| **Safety First** | Strict read-only **allowlist** (not a denylist): only known-safe commands run — shell-aware for POSIX *and* PowerShell, enforced at the command runner as defense-in-depth. 100% read-only |

---

## Requirements

- **Node.js >= 20** (Linux, macOS, or Windows) — that's it for the MCP server and the
  deterministic, read-only discovery. **No LLM and no API key required.**
- **Optional — Claude CLI**, only for the richer Claude-driven discovery loop
  (`datasynx-cartography discover`): `npm install -g @anthropic-ai/claude-code && claude login`.
- **Optional — semantic search** auto-upgrades when `sqlite-vec` and a local embedder
  (`@huggingface/transformers`) are present; otherwise it falls back to lexical search.
  These ship as `optionalDependencies` and are lazy-loaded, so installs that skip them
  pay no cost.

---

## Install

```bash
npm install -g @datasynx/agentic-ai-cartography
```

[![npm](https://img.shields.io/badge/npm-@datasynx%2Fagentic--ai--cartography-CB3837?style=for-the-badge&logo=npm&logoColor=white)](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography)

---

## Quick Start

```bash
# Check all requirements (platform-aware)
datasynx-cartography doctor

# Discover your full infrastructure (autonomous agent scan)
# → scans bookmarks, installed apps, local services, cloud, config files
# → then interactive follow-up: type tool names to search further
datasynx-cartography discover

# Seed infrastructure manually (JSON file or interactive)
datasynx-cartography seed --file infra.json
datasynx-cartography seed

# View all browser bookmarks
datasynx-cartography bookmarks

# Full feature reference (shows platform-specific commands)
datasynx-cartography docs
```

---

## Commands

### Cartography (Discovery)

```
datasynx-cartography discover [options]

  --entry <hosts...>    Start hosts          (default: localhost)
  --depth <n>           Max crawl depth      (default: 8)
  --max-turns <n>       Max agent turns      (default: 50)
  --model <m>           LLM model            (default: claude-sonnet-4-5-...)
  --org <name>          Org name for Backstage YAML
  -o, --output <dir>    Output directory     (default: ./datasynx-output)
  -v, --verbose         Show agent reasoning
```

Discovery pipeline (automatic, in order):
1. **Browser bookmarks** — every domain classified as saas_tool or web_service
2. **Installed apps** — all IDEs, business tools, dev tools, browsers (platform-native detection)
3. **Local services** — `ss` (Linux), `lsof` (macOS), `Get-NetTCPConnection` (Windows)
4. **Database discovery** — PostgreSQL, MySQL, MongoDB, Redis, SQLite files
5. **Cloud & Kubernetes** — AWS/GCP/Azure/k8s (skipped gracefully if not configured)
6. **Config files** — `.env`, `docker-compose.yml`, etc.
7. **Human-in-the-loop** — interactive follow-up after initial scan

### Analysis & Export

```
datasynx-cartography export [session-id] [options]
  --format <fmt...>    mermaid, json, yaml, html, map  (default: all)
  -o, --output <dir>   Output directory
datasynx-cartography show [session-id]             Session details + node list
datasynx-cartography sessions                      List all sessions
datasynx-cartography bookmarks                     View all browser bookmarks
datasynx-cartography seed [--file <path>]          Manually add infrastructure nodes
datasynx-cartography doctor                        Check all requirements + cloud CLIs
datasynx-cartography docs                          Full feature reference
```

---

## Output Files

```
datasynx-output/
├── catalog.json               Full machine-readable dump
├── catalog-info.yaml          Backstage service catalog
├── topology.mermaid           Infrastructure topology (graph TB)
├── dependencies.mermaid       Service dependencies (graph LR)
└── discovery.html             Enterprise discovery frontend (Map + Topology)
```

---

## Cost Estimate

| Mode | Model | Interval | per Hour | per 8h Day |
|------|-------|----------|----------|------------|
| Discover | Sonnet | one-shot | $0.15–0.50 | one-shot |

---

## Architecture

The **MCP server is the headline interface** — LLM-agnostic and the same SQLite graph
underneath every entry point. Discovery (deterministic scanners or the optional Claude
loop) writes the graph; any MCP host reads it.

```
                         ┌──────────────────────────────────────────┐
   MCP hosts ───────────►│  MCP server (src/mcp) — primary interface │
   (Claude Code,         │    Resources · Tools · Prompts            │
    Cursor, Cline,       │    stdio + Streamable HTTP transports     │
    Windsurf, VS Code,   └───────────────────┬──────────────────────┘
    Vercel AI SDK, …)                        │
                                             ▼
                              CartographyDB (SQLite WAL, src/db)
                         recursive-CTE traversal · search · summary
                                             ▲
                ┌────────────────────────────┴────────────────────────────┐
                │                                                          │
   Deterministic discovery (src/discovery, src/scanners)     Optional Claude loop (src/agent)
     bookmarks · installed-apps · local ports · DBs            runDiscovery() — human-in-the-loop
     LLM-free, registry-driven                                 LLM + Bash + custom MCP tools
                │                                                          │
                └──────────────────────────┬───────────────────────────────┘
                                           ▼
                    Platform layer (src/platform) + read-only allowlist (src/allowlist)
                    Shell/commands resolved per-OS · every command vetted before it runs
```

### Safety

v2.0 replaces the old "block bad commands" denylist with a **strict read-only allowlist**
(`src/allowlist.ts`): a command runs only if it is explicitly known to be safe. The check
is shell-aware and enforced in two places — the command runner itself (defense-in-depth)
and the Claude loop's `PreToolUse` hook.

- **POSIX:** parses the command line, resolves `sudo`/`env`/command-runners and brace
  groups, and allows only read-only tools (`ss`, `lsof`, `ps`, `which`, `find`, DB
  probes, cloud `describe/list/get`, `kubectl get/describe`, …). Redirections, pipes to
  writers, and anything unrecognized are rejected.
- **Windows/PowerShell:** allows read-only cmdlets and rejects mutating ones
  (`Remove-Item`, `Move-Item`, `Stop-Process`, `Stop-Service`, `Restart-Computer`,
  `Format-Volume`, `Out-File`, `Set-Content`, …).

**Cartography only reads — never writes, never deletes.**

---

## Public API

```typescript
import {
  CartographyDB,
  runDiscovery,
  exportAll,
  safetyHook,
  defaultConfig,
} from '@datasynx/agentic-ai-cartography';

// Run a discovery pass with optional user hint
await runDiscovery(config, db, sessionId, onEvent, onAskUser, 'hubspot windsurf');
```

---

## Releasing

[`release.yml`](.github/workflows/release.yml) publishes to npm automatically on every push
to `main`, in one of **two modes** — auto-selected by which secrets are present:

- **`RELEASE_TOKEN` present → full [semantic-release](https://github.com/semantic-release/semantic-release).**
  Version, `CHANGELOG.md`, git tag `v<version>`, GitHub Release and the provenance-signed npm
  publish are all derived from [Conventional Commits](https://www.conventionalcommits.org/)
  since the last tag (`fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE:` → major;
  `docs/chore/refactor/test/ci` → no release). No manual version bumps. PR titles are linted
  by [`pr-title.yml`](.github/workflows/pr-title.yml) so the squash-merge commit stays analyzable.
- **`RELEASE_TOKEN` absent → idempotent npm publish.** The `package.json` version is published
  (provenance-signed) only when it isn't already on npm — so doc/refactor merges are no-ops.
  Bump the version + merge to release.

> **Why two modes:** every commit here carries `.github/workflows/` files, and the Actions
> `GITHUB_TOKEN` may not push a git ref that touches workflow files (it can't hold the
> `workflow` scope). semantic-release pushes a tag, so it needs a workflow-scoped
> `RELEASE_TOKEN`. Until one exists, the idempotent publish keeps releases flowing with only
> `NPM_TOKEN`; adding `RELEASE_TOKEN` later upgrades to the full flow with no other changes.

Quality is gated independently by [`ci.yml`](.github/workflows/ci.yml) on every PR and push:
**lint/typecheck → test matrix (Node 20/22) + coverage → audit + license check → build &
validate (publint, [are-the-types-wrong](https://github.com/arethetypeswrong/arethetypeswrong.github.io),
ESM/CJS consumer smoke tests)**.

**Repository secrets** (*Settings → Secrets and variables → Actions*):

| Secret | Required | Purpose |
|---|---|---|
| `NPM_TOKEN` | **yes** | npm *Automation*/granular token with publish rights for the `@datasynx` scope. Provenance signing itself needs no secret (OIDC). |
| `RELEASE_TOKEN` | optional | PAT (classic: `repo` + `workflow`) or deploy key. Unlocks full semantic-release (auto-versioning, changelog, tags, GitHub Releases). Without it, the idempotent npm publish is used. |
| `CODECOV_TOKEN` | optional | Upload coverage to Codecov (non-blocking if absent). |

---

## Built by

<div align="center">

[![Datasynx AI on LinkedIn](https://img.shields.io/badge/Datasynx_AI-Follow_on_LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/company/datasynx-ai/)

</div>

---

## License

MIT — © [Datasynx AI](https://www.linkedin.com/company/datasynx-ai/)

---

## Related Projects

- [**agentic-ai-shadowing**](https://github.com/datasynx/agentic-ai-shadowing) — AI-powered agent session shadowing & replay
