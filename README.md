# @datasynx-ai/agentic-ai-catograph

**AI-powered Infrastructure Cartography & SOP Generation**

Cartograph uses the **Claude Agent SDK** to automatically discover your infrastructure, map dependencies, and generate Standard Operating Procedures from observed workflows — all from your terminal.

```
$ cartograph discover
🔍 Scanning localhost...
   ├── postgres:5432 (3 databases, 47 tables)
   ├── redis:6379 (standalone, 12 keys)
   ├── nginx:80 → upstream:3000 (express)
   │   └── GET /api/users, POST /api/auth, ...
   ├── rabbitmq:5672 (3 queues)
   └── grafana:3000 → prometheus:9090
✓ 8 nodes, 11 edges discovered
✓ Exported: catalog.json, topology.mermaid, catalog-info.yaml

$ cartograph shadow start
👁 Shadow daemon started (PID 48291)
   Observing network + processes every 30s...

$ cartograph shadow stop
✓ Shadow stopped. 142 events, 3 tasks, 2 workflows detected.
✓ Generated: sops/deploy-check.md, sops/db-migration.md
```

Claude **is** the agent — it decides which read-only commands to run, analyses the output, and stores results via custom MCP tools into SQLite. No hand-written parsers, diff logic, or decision trees.

---

## Requirements

- **Node.js ≥ 18**
- **Claude CLI** (runtime dependency — the Agent SDK starts it as a child process)

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

---

## Install

```bash
npm install -g @datasynx-ai/agentic-ai-catograph
```

---

## Quick Start

```bash
# Discover your infrastructure (one-shot, Claude Sonnet)
cartograph discover

# Start background observer (Claude Haiku, every 30s)
cartograph shadow start

# Attach to see live events
cartograph shadow attach

# After observing: generate SOPs from workflows
cartograph sops

# Stop daemon
cartograph shadow stop

# Full feature overview
cartograph docs
```

---

## Commands

### Discovery

```
cartograph discover [options]

  --entry <hosts...>    Start hosts          (default: localhost)
  --depth <n>           Max crawl depth      (default: 8)
  --max-turns <n>       Max agent turns      (default: 50)
  --model <m>           Claude model         (default: claude-sonnet-4-5-...)
  --org <name>          Org name for Backstage YAML
  -o, --output <dir>    Output directory     (default: ./cartograph-output)
  -v, --verbose         Show agent reasoning
```

### Shadow Daemon

```
cartograph shadow start [options]

  --interval <ms>       Poll interval        (default: 30000, min: 15000)
  --inactivity <ms>     Task boundary gap    (default: 300000)
  --model <m>           Claude model         (default: claude-haiku-4-5-...)
  --track-windows       Track window focus (requires xdotool)
  --auto-save           Save nodes without prompting
  --foreground          Run in foreground (no fork)

cartograph shadow stop
cartograph shadow status
cartograph shadow attach    # hotkeys: [T] new task  [S] status  [D] detach  [Q] stop
```

### Analysis & Export

```
cartograph sops [session-id]              Generate SOPs from observed workflows
cartograph export [session-id] [options]  Export all formats
  --format <fmt...>    mermaid, json, yaml, html, sops  (default: all)
  -o, --output <dir>   Output directory
cartograph show [session-id]              Session details + node list
cartograph sessions                       List all sessions
cartograph docs                           Full feature reference
```

---

## Output Files

```
cartograph-output/
├── catalog.json               Full machine-readable dump
├── catalog-info.yaml          Backstage service catalog
├── topology.mermaid           Infrastructure topology (graph TB)
├── dependencies.mermaid       Service dependencies (graph LR)
├── topology.html              Interactive D3.js force graph
├── sops/
│   ├── deploy-check.md
│   └── db-migration.md
└── workflows/
    └── workflow-001.mermaid
```

---

## Costs

| Mode | Model | Interval | per Hour | per 8h Day |
|------|-------|----------|----------|------------|
| Discovery | Sonnet | one-shot | $0.15–0.50 | one-shot |
| Shadow | Haiku | 30s | $0.12–0.36 | $0.96–2.88 |
| Shadow | Haiku | 60s | $0.06–0.18 | $0.48–1.44 |
| Shadow (quiet)* | Haiku | 30s | ~$0.02 | ~$0.16 |
| SOP generation | Sonnet | one-shot | $0.01–0.03 | one-shot |

\* *quiet = diff-check skips ~90% of cycles when the system is idle*

---

## Architecture

```
CLI (Commander)
  └── Preflight: Claude CLI check + API key + interval validation
      └── Agent Orchestrator
          ├── runDiscovery()     Claude Sonnet + Bash + MCP Tools
          ├── runShadowCycle()   Claude Haiku + MCP Tools only (no Bash!)
          └── generateSOPs()     Anthropic Messages API (no agent loop)
              └── Custom MCP Tools: save_node, save_edge, save_event,
                                    get_catalog, manage_task, save_sop
                  └── CartographDB (SQLite WAL, ~/.cartograph/cartograph.db)

Shadow Daemon
  ├── takeSnapshot()  →  ss + ps  (no Claude!)
  ├── Diff-check      →  only calls Claude when something changed
  ├── IPC Server      →  Unix socket ~/.cartograph/daemon.sock
  └── Notifications   →  desktop alerts when no client attached
```

### Safety

Every Bash call is guarded by a `PreToolUse` hook that blocks any destructive command:
`rm`, `mv`, `dd`, `chmod`, `kill`, `docker rm/run/exec`, `kubectl delete/apply/exec`, redirects (`>`), and more.
Claude only reads — never writes, never deletes.

---

## Public API

```typescript
import {
  CartographDB,
  runDiscovery,
  runShadowCycle,
  generateSOPs,
  exportAll,
  safetyHook,
  defaultConfig,
} from '@datasynx-ai/agentic-ai-catograph';
```

---

## License

MIT — © Datasynx AI
