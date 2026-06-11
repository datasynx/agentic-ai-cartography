---
date: 2026-06-11T18:43:39Z
researcher: majone
git_commit: 3e15d5457b5e6893aa947fb5dbb48f913b15cf86
branch: main
repository: agentic-ai-cartography
topic: "Cluster all open GitHub issues into packages and pick one for the next research cycle"
tags: [research, triage, github-issues, clustering, go-live, mcp]
status: complete
last_updated: 2026-06-11
last_updated_by: majone
---

# Research: Open-Issue Clustering & Next-Package Decision

**Date**: 2026-06-11T18:43:39Z
**Researcher**: majone
**Git Commit**: 3e15d5457b5e6893aa947fb5dbb48f913b15cf86
**Branch**: main
**Repository**: datasynx/agentic-ai-cartography

## Research Question
Fetch all open GitHub issues, cluster them into packages where possible, and decide one package for the next research cycle.

## Summary

There are **19 open issues** (18 substantive + 1 umbrella epic). They fall into **6 cohesive packages**.

The single most important finding: **the codebase has moved well past the audit that produced most of these issues.** The audit issues (#42–#54) were filed on **2026-06-09**; since then commits #68/#69/#70 landed (untrusted-text sanitization, tool-output limits, deterministic session naming). Verifying the issues against `HEAD` (3e15d54) shows that **most of the "go-live blocker" and robustness work is already implemented in code but the issues remain open**. The genuinely-fresh, not-yet-built work is the **Tier-2 feature package (#71–#75)**, filed today (2026-06-11).

**Recommendation for the next research cycle: Package E — MCP / Agent Capability Enhancements (#71, #72, #73, #74).** It is the only package that is both cohesive *and* unimplemented, it is the natural continuation of the prior "Research Tier-2" cycle, and the security/robustness packages mostly need a *verify-and-close* triage pass rather than research.

## Issue → Package Map

| # | Title (short) | Labels | Package | Code status at HEAD |
|---|---|---|---|---|
| #42 | HTTP transport has no auth | security, enhancement | A — Security/Transport | **Implemented** — bearer token, 401, non-loopback enforcement |
| #43 | stripSensitive only covers node id | security, bug | A — Security/Transport | **Implemented** — `redactValue`/`sanitizeValue` over metadata |
| #44 | binary ignores `--allowed-hosts`/`--url` | bug, docs | A — Security/Transport | **Partially** — `--allowed-hosts` parsed; `--url` only on `cli mcp`, not the `cartography-mcp` binary |
| #52 | Reconsider postinstall script | enhancement, security | A — Security/Transport | Open (not yet verified) |
| #45 | process.exit() + default export | bug | B — Code Correctness | **Resolved** — no `process.exit(` in src; smithery default export now documented as exception in CLAUDE.md |
| #46 | Unguarded JSON.parse / swallowed errors | bug | B — Code Correctness | **Mostly resolved** — `safeJsonParse` added; one unguarded parse remains (`installer/format.ts:15`) |
| #47 | Primary interface under-tested | testing, enhancement | C — Testing & CI | Open |
| #48 | build:mcpb not wired into CI/release | bug, ci | C — Testing & CI | Open |
| #53 | Harden workflows (SHA-pin, CodeQL, server.json) | security, ci | C — Testing & CI | Open |
| #51 | Governance files (SECURITY.md…) | documentation | D — Docs & Governance | Partly (SECURITY.md referenced by #75) |
| #54 | README/reference gaps | documentation | D — Docs & Governance | Open |
| #75 | Structured threat-model doc | documentation | D — Docs & Governance | Open (filed today) |
| #71 | readOnly annotations on agent-SDK tools | enhancement | **E — MCP Capability** | Open — confirmed: `src/tools.ts` tools carry no annotations |
| #72 | PostToolUse audit-logging hook | enhancement | **E — MCP Capability** | Open (filed today) |
| #73 | 'fast' model role for helper tasks | enhancement | **E — MCP Capability** | Open (filed today) |
| #74 | Expand MCP prompts (SPOF, runbook) | enhancement | **E — MCP Capability** | Open (filed today) |
| #49 | Anthropic SDK major bumps | dependencies | F — Dependencies | Open |
| #50 | npm audit dev-tree highs (tmp) | dependencies, security | F — Dependencies | Open (tracking-only) |
| #55 | Go-live readiness (epic) | epic, go-live | — (umbrella tracker) | Tracks #42–#54 |

## Detailed Findings

### Package A — Security & Transport Hardening (#42, #43, #44, #52)
The remote/HTTP deployment surface. **Largely already implemented**:
- **#42 (auth)** — `src/mcp/transports.ts:21-49` defines `token`, `timingSafeEqual()`, `bearerToken()`. Lines `82-88` make a token **mandatory** for non-loopback bind; lines `100-107` enforce `Authorization: Bearer` with a `401`/`www-authenticate` response; `src/mcp/start.ts:75-85` threads the token (env fallback `CARTOGRAPHY_HTTP_TOKEN`). Covered by `test/transports.test.ts:47-65`.
- **#43 (metadata sanitization)** — `src/tools.ts:112-126` `redactSecrets`/`redactValue` recursively redact DSN credentials; applied to node `metadata` (`tools.ts:159`) and edge `evidence` (`tools.ts:180`). `src/db.ts:472` also applies `sanitizeValue` before persistence; reads go through `safeJsonParse` (`db.ts:14-20,506-507`).
- **#44 (flags)** — `--allowed-hosts` **is** now parsed (`src/mcp/start.ts:53`). `--url` is **not** parsed by the `cartography-mcp` binary, but it **does** exist on the `cli mcp` subcommand (`src/cli.ts:1285`) and is documented (`README.md:96`). The narrow remaining gap: `--url` on the standalone binary.
- **#52 (postinstall)** — not re-verified in this pass.

### Package B — Code Correctness / Robustness (#45, #46)
- **#45** — `grep 'process.exit('` over `src/` returns only a *comment* (`src/cli.ts:42`) explaining why they avoid it; `src/mcp-bin.ts` uses `process.exitCode`. The smithery default export (`src/smithery.ts:35`) is now an explicitly documented CLAUDE.md exception. **Effectively resolved.**
- **#46** — `safeJsonParse` (`src/db.ts:14-20`) now guards metadata/tags reads; most other parses are wrapped (preflight, bookmarks, cli, transports). **One unguarded parse remains**: `src/installer/format.ts:15` (`case 'json': return JSON.parse(text)`).

### Package C — Testing & CI/CD Pipeline (#47, #48, #53)
Coherent "ship-the-pipeline" cluster, **not yet addressed**: raise coverage on `src/mcp/**` + `src/tools.ts` and add a real client→server e2e (#47); build/attach the `.mcpb` Desktop bundle in CI/release (#48); SHA-pin third-party actions, add CodeQL, validate `server.json` parity in CI (#53).

### Package D — Documentation & Governance (#51, #54, #75)
Governance/health files (#51); README graceful-degradation / release-process / Smithery-env gaps (#54); a structured `docs/explanation/threat-model.md` (#75). #75 is fresh (today).

### Package E — MCP / Agent Capability Enhancements (#71, #72, #73, #74)  ← recommended
The freshest cluster (all filed 2026-06-11, all tagged "Research Tier-2"), all **unimplemented**, all extend the MCP/agent surface and reuse existing tools:
- **#71** — add `readOnly`/non-destructive annotations to the agent-SDK `tool()` discovery tools in `src/tools.ts`. Confirmed open: server-side query tools carry `readOnlyHint` (`src/mcp/server.ts:189-291`) but the in-process SDK tools do not.
- **#72** — PostToolUse hook persisting `{tool, command, bytes, timestamp}` to `activity_events` for an audit trail.
- **#73** — optional `models: { lead, fast }` shape routing helper LLM calls to a cheaper model (keep `agentModel` as lead).
- **#74** — two new parametrized prompts (`find-single-points-of-failure`, `generate-runbook`) reusing `get_summary`/`get_dependencies`.

### Package F — Dependencies (#49, #50)
Anthropic SDK major-bump evaluation (#49) and tracking the dev-tree `tmp` highs via `@anthropic-ai/mcpb` (#50, no production impact). Maintenance-class, partly tracking-only.

## Recommendation: research Package E next

**Why E over the others:**
1. **It's the only package that is both cohesive and unbuilt.** Packages A and B are ~90% already implemented at HEAD — their issues mostly need a *verify-and-close* triage pass, not research.
2. **It's the natural next cycle.** #71–#74 are explicitly the "Research Tier-2" follow-up backlog; researching them continues an existing thread (research → plan → issues → implement).
3. **Cohesive & low-risk.** All four extend the MCP/agent capability surface, reuse existing tools, and touch `src/tools.ts` / `src/agent.ts` / `src/mcp/server.ts` — a single coherent research scope.
4. **No external blockers.** Unlike Package C (CI secrets, release infra) or F (upstream SDK behavior), E is fully in-repo.

**Prerequisite triage (cheap, do alongside):** verify-and-close #42, #43, #45 (implemented), and narrow #44/#46 to their tiny remainders (`--url` on the binary; `installer/format.ts:15`). This shrinks the open count and makes the epic #55 board reflect reality.

## Code References
- `src/mcp/transports.ts:82-107` — bearer-token auth enforcement (#42)
- `src/tools.ts:112-126,159,180` — recursive DSN redaction over metadata/evidence (#43)
- `src/mcp/start.ts:44-60` — arg parser; `--allowed-hosts` parsed, `--url` absent (#44)
- `src/cli.ts:1285` — `--url` option on the `cli mcp` subcommand (#44)
- `src/db.ts:14-20,506-507` — `safeJsonParse` guard (#46)
- `src/installer/format.ts:15` — remaining unguarded `JSON.parse` (#46)
- `src/smithery.ts:35` — documented default-export exception (#45)
- `src/mcp/server.ts:189-291` — `readOnlyHint` on query tools (contrast for #71)
- `src/tools.ts` save_node/save_edge handlers — no annotations (target for #71)

## Open Questions
- Should #42/#43/#45 be closed as already-implemented, or are they intentionally held open pending tests/docs (#47/#54)?
- Is the `--url` gap (#44) limited to the standalone `cartography-mcp` binary by design, or should it accept `--url` too?
- Confirm Package E is the desired next research target vs. a verify-and-close triage sprint on Packages A/B.
