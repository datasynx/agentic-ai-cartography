<div align="center">

# 🗺️ Datasynx Cartography

**AI-powered Infrastructure Discovery & Agentic AI Cartography**

[![npm version](https://img.shields.io/npm/v/@datasynx/agentic-ai-cartography?style=flat-square&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography)
[![npm downloads](https://img.shields.io/npm/dm/@datasynx/agentic-ai-cartography?style=flat-square&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![CI](https://github.com/datasynx/agentic-ai-cartography/actions/workflows/ci.yml/badge.svg)](https://github.com/datasynx/agentic-ai-cartography/actions/workflows/ci.yml)
[![Agentic AI](https://img.shields.io/badge/Agentic_AI-Provider_Agnostic-D4A017?style=flat-square)](https://github.com/datasynx/agentic-ai-cartography)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Datasynx_AI-0077B5?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/company/datasynx-ai/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue?style=flat-square)](https://github.com/datasynx/agentic-ai-cartography)

<br/>

*A **Model Context Protocol server** that gives any AI agent read-only awareness of your complete system landscape — local services, databases, SaaS tools, installed apps and their dependencies — with progressive disclosure, recursive dependency traversal and semantic search. Discovery runs deterministically (no LLM required) or via an optional Claude-driven loop. Provider-agnostic: works with Claude, OpenAI, Ollama, or any MCP-compatible host.*

<br/>

**[📦 npm](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography) · [💼 LinkedIn](https://www.linkedin.com/company/datasynx-ai/) · [🐛 Issues](https://github.com/datasynx/agentic-ai-cartography/issues)**

</div>

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
```

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
| **Safety First** | `PreToolUse` hook blocks all destructive commands — Unix AND PowerShell. 100% read-only |

---

## Requirements

- **Node.js >= 20** (Linux, macOS, or Windows)
- **LLM Provider** (one of the following):
  - **Claude CLI** (default): `npm install -g @anthropic-ai/claude-code && claude login`
  - OpenAI, Ollama, or any OpenAI-compatible endpoint (coming in v2.x)

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

```
CLI (Commander.js)
  └── Preflight: LLM provider check
      └── Platform Detection (src/platform.ts)
          ├── Shell: /bin/sh (Unix) | PowerShell (Windows)
          ├── Commands: which (Unix) | Get-Command (Windows)
          └── Agent Orchestrator (src/agent.ts)
              └── runDiscovery()     LLM Agent + Bash + MCP Tools
                  ├── scan_bookmarks()          browser bookmark extraction (all platforms)
                  ├── scan_browser_history()     anonymized hostname extraction
                  ├── scan_installed_apps()      platform-native app detection
                  ├── scan_local_databases()     DB service + file scanning
                  ├── scan_k8s_resources()       kubectl (readonly)
                  ├── scan_aws/gcp/azure()       cloud CLI scans (readonly)
                  ├── ask_user()                 human-in-the-loop questions
                  └── Custom MCP Tools → CartographyDB (SQLite WAL)
```

### Safety

Every Bash call is guarded by a `PreToolUse` hook that blocks destructive commands:

**Unix:** `rm`, `mv`, `dd`, `chmod`, `kill`, `docker rm/run/exec`, `kubectl delete/apply/exec`, redirects (`>`), and more.

**Windows/PowerShell:** `Remove-Item`, `Move-Item`, `Stop-Process`, `Stop-Service`, `Restart-Computer`, `Format-Volume`, `Out-File`, `Set-Content`, and more.

**The agent only reads — never writes, never deletes.**

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
