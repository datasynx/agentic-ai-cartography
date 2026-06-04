# Cartograph — Task List

- [x] 1.  Scaffolding: Create all config files, npm install, build verify
- [x] 2.  src/types.ts — Zod-Schemas, Types, Config, defaultConfig()
- [x] 3.  src/preflight.ts — Claude CLI Check, API Key Check
- [x] 4.  src/db.ts — SQLite Schema + CartographDB Class + Tests
- [x] 5.  src/tools.ts — Custom MCP Tools + stripSensitive() + Tests
- [x] 6.  src/safety.ts — PreToolUse Hook (Bash-Blocklist) + Tests
- [x] 7.  src/agent.ts — Orchestrator: runDiscovery
- [x] 8.  src/exporter.ts — Mermaid + YAML + JSON + HTML + Tests
- [x] 9.  src/cli.ts — Commander Setup (discover, export, show, sessions, chat, overview, seed, bookmarks, doctor, docs)
- [x] 10. src/index.ts — Public API
- [x] 11. Build + npm link + Smoke Tests

## v2.0 — MCP-first transformation

- [x] 12. src/db.ts — recursive-CTE graph traversal, search, summary (+ tests)
- [x] 13. src/allowlist.ts — strict read-only allowlist (POSIX + PowerShell), safetyHook + run() integration (+ tests)
- [x] 14. src/mcp/ — createMcpServer (Resources/Tools/Prompts), stdio + Streamable HTTP transports (+ in-memory tests)
- [x] 15. src/semantic/ — sqlite-vec vector store + pluggable embeddings + semantic SearchFn (+ tests)
- [x] 16. src/scanners/ + src/discovery/ — Scanner plugin registry + deterministic local discovery (+ tests)
- [x] 17. src/cli.ts mcp command + cartography-mcp binary + startMcp
- [x] 18. Packaging — dual ESM/CJS, exports map, v2.0.0, server.json, publint/attw clean
- [x] 19. Docs — README MCP-first + client configs, CHANGELOG, CLAUDE.md
