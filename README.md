<div align="center">

# 🗺️ Datasynx Cartography

**AI-powered Infrastructure Cartography & SOP Generation**

[![npm version](https://img.shields.io/npm/v/@datasynx/agentic-ai-cartography?style=flat-square&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography)
[![npm downloads](https://img.shields.io/npm/dm/@datasynx/agentic-ai-cartography?style=flat-square&color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node.js ≥18](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Built with Claude](https://img.shields.io/badge/Built_with-Claude_Agent_SDK-D4A017?style=flat-square&logo=anthropic&logoColor=white)](https://github.com/anthropics/claude-code)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Datasynx_AI-0077B5?style=flat-square&logo=linkedin&logoColor=white)](https://www.linkedin.com/company/datasynx-ai/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-blue?style=flat-square)](https://github.com/datasynx/agentic-ai-cartography)

<br/>

*Claude IS the agent — it decides which read-only commands to run, analyses the output, and stores results via custom MCP tools into SQLite. No hand-written parsers, diff logic, or decision trees.*

<br/>

**[📦 npm](https://www.npmjs.com/package/@datasynx/agentic-ai-cartography) · [💼 LinkedIn](https://www.linkedin.com/company/datasynx-ai/) · [🐛 Issues](https://github.com/datasynx/agentic-ai-cartography/issues)**

</div>

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
| **Safety hook** | Blocks `rm`, `mv`, `kill`, etc. | Blocks `rm`, `mv`, `kill`, etc. | Blocks `Remove-Item`, `Stop-Process`, etc. |

---

## Features

| Feature | Details |
|---------|---------|
| **Installed App Scan** | Linux: dpkg/snap/flatpak/rpm, macOS: /Applications + Homebrew + Spotlight, Windows: Registry + winget + choco + scoop. 70+ known tools checked via cross-platform command lookup |
| **Browser Bookmarks** | Chrome, Chromium, Firefox, Brave, Edge, Vivaldi, Opera — all platforms including Snap/Flatpak on Linux |
| **Database Discovery** | PostgreSQL, MySQL, MongoDB, Redis, SQLite file scan. Windows: `Get-Service` for DB engine detection |
| **Cloud Scanning** | AWS (EC2/RDS/EKS/S3), GCP (Compute/GKE/Cloud Run), Azure (AKS/WebApps), Kubernetes |
| **Human-in-the-Loop** | Chat with the agent mid-discovery: type `"hubspot windsurf"` to search for specific tools |
| **SOP Generation** | Automatically generates Standard Operating Procedures from observed workflows |
| **SOP Dashboard** | HTML dashboard with all SOPs, step details, frequency stats |
| **Export Formats** | Mermaid topology, D3.js interactive graph, Backstage YAML, JSON, SOP Markdown |
| **Safety First** | `PreToolUse` hook blocks all destructive commands — Unix AND PowerShell. 100% read-only |

---

## Requirements

- **Node.js >= 18** (Linux, macOS, or Windows)
- **Claude CLI** — the Agent SDK starts it as a subprocess

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

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

# Discover your full infrastructure (one-shot, Claude Sonnet)
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
  --model <m>           Claude model         (default: claude-sonnet-4-5-...)
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
  --format <fmt...>    mermaid, json, yaml, html, sops  (default: all)
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
├── discovery.html             Enterprise discovery frontend (Map + Topology)
├── sop-dashboard.html         HTML dashboard with all SOPs + frequency stats
├── sops/
│   ├── deploy-check.md
│   └── db-migration.md
└── workflows/
    └── workflow-001.mermaid
```

---

## Cost Estimate

| Mode | Model | Interval | per Hour | per 8h Day |
|------|-------|----------|----------|------------|
| Discover | Sonnet | one-shot | $0.15–0.50 | one-shot |
| SOP generation | Sonnet | one-shot | $0.01–0.03 | one-shot |

---

## Architecture

```
CLI (Commander.js)
  └── Preflight: Claude CLI + API key check
      └── Platform Detection (src/platform.ts)
          ├── Shell: /bin/sh (Unix) | PowerShell (Windows)
          ├── Commands: which (Unix) | Get-Command (Windows)
          └── Agent Orchestrator (src/agent.ts)
              └── runDiscovery()     Claude Sonnet + Bash + MCP Tools
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

**Claude only reads — never writes, never deletes.**

---

## Public API

```typescript
import {
  CartographyDB,
  runDiscovery,
  exportAll,
  exportSOPDashboard,
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
