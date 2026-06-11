---
date: 2026-06-11T21:12:57Z
researcher: majone
git_commit: 5ceaeb27162e37a741b88adc1b5704f36aa0b2df
branch: main
repository: agentic-ai-cartography
topic: "Verify-and-close triage of the security/correctness issues (#42, #43, #44, #45, #46, #52)"
tags: [research, codebase, security, go-live, triage, mcp-transport, sanitization]
status: complete
last_updated: 2026-06-11
last_updated_by: majone
---

# Research: Security & Correctness Verify-and-Close (#42, #43, #44, #45, #46, #52)

**Date**: 2026-06-11T21:12:57Z
**Researcher**: majone
**Git Commit**: 5ceaeb27162e37a741b88adc1b5704f36aa0b2df
**Branch**: main
**Repository**: datasynx/agentic-ai-cartography

## Research Question
The "go-live" issues #42–#46 and #52 were filed on 2026-06-09 by an audit; the codebase has since had multiple merges. Document the **current** state of each issue's acceptance criteria against `main` (5ceaeb2) to determine which are already satisfied and which have remaining work.

## Summary

Of the six issues, **five are fully satisfied in code today** and can be closed as already-implemented; **one (#46) has a single small remainder**.

| Issue | Status | Verdict |
|---|---|---|
| **#42** HTTP transport auth | All criteria met (token-required non-loopback bind, 401, timing-safe, loopback unchanged, tests) | **Close** |
| **#43** metadata credential redaction | All criteria met (recursive `redactValue` on metadata, `redactSecrets` on edge evidence, test covers `user:pass@host`) | **Close** |
| **#44** binary `--allowed-hosts` / `--url` | `--allowed-hosts` parsed + threaded; README ↔ binary USAGE match; `--url` is an `install`-subcommand flag, never a binary bind flag | **Close** (with note) |
| **#45** process.exit / default export | No `process.exit(` in `src/`; SIGINT re-raises via `process.kill`; smithery default export documented in CLAUDE.md | **Close** |
| **#46** unguarded JSON.parse / swallowed errors | All listed spots now guarded/logged **except** one unguarded `JSON.parse` | **One 3-line fix, then close** |
| **#52** postinstall script | `postinstall` removed from package.json; `scripts/postinstall.mjs` deleted; Claude CLI checked lazily in `preflight.ts` | **Close** |

The only remaining code change in this entire package is guarding `src/installer/format.ts:15`.

## Detailed Findings

### #42 — HTTP transport authentication (CLOSE)
- Non-loopback bind refuses to start without a token — `src/mcp/transports.ts:83-88` (throws "Refusing to bind a non-loopback host … without an auth token"). Test: `test/transports.test.ts:29-33`.
- 401 on missing/invalid token — `src/mcp/transports.ts:100-107` (`401` + `www-authenticate: Bearer`). Tests: `test/transports.test.ts:47-65` (missing token → 401; wrong token → 401).
- Timing-safe comparison — `src/mcp/transports.ts:36-42`; bearer extraction — `:44-49`.
- Loopback/stdio unchanged (token optional) — `src/mcp/transports.ts:62-79`; test `test/transports.test.ts:41-45`.
- Token threaded with env fallback `CARTOGRAPHY_HTTP_TOKEN` — `src/mcp/start.ts:78-84`.

### #43 — Credential redaction in metadata/evidence (CLOSE)
- `redactSecrets()` (DSN `user:pass@` → `***@`) — `src/tools.ts:112-114`; recursive `redactValue()` — `src/tools.ts:117-126`.
- Applied to node metadata before persistence — `src/tools.ts:171` (`metadata: redactValue(...)`); to edge evidence — `src/tools.ts:192` (`evidence: redactSecrets(...)`).
- DB-layer control-char sanitization — `src/db.ts:486` (`sanitizeValue` on metadata), `src/db.ts:547` (`sanitizeUntrusted` on evidence).
- Test covering `user:pass@host` DSNs (postgres/redis/mysql, nested + array) — `test/tools-hardening.test.ts:56-69`.

### #44 — Binary flags (CLOSE, with note)
- `--allowed-hosts` is parsed (comma-split, trimmed) — `src/mcp/start.ts:53` — and threaded to `runHttp` — `src/mcp/start.ts:79-84`.
- Binary USAGE matches the parser — `src/mcp-bin.ts:14-16` lists `--http --port --host --allowed-hosts --token --db --session --no-semantic`; README invocation matches — `README.md:158-164`.
- `--url` is **not** a binary flag and is **not** documented as one. It exists only on the `install` subcommand as client-config metadata (the URL to register into a host's config) — `src/cli.ts:1295` (`.option('--url <url>', 'HTTP endpoint (with --http)')`). The original issue's "binary ignores --url" premise does not apply to the current code: the standalone server binds a host/port, it is not given a URL.

### #45 — process.exit() / default export (CLOSE)
- No real `process.exit(` calls in `src/` — the only grep hit is a comment at `src/cli.ts:42`. The codebase uses `process.exitCode` throughout (e.g. `src/mcp-bin.ts:21`, many in `src/cli.ts`, `src/preflight.ts:33`).
- SIGINT/shutdown re-raises with default disposition via `process.kill(process.pid, signal)` (correct 130 exit status) instead of `process.exit()` — `src/cli.ts:35-48`.
- The single default export (`export default createServer;` — `src/smithery.ts:35`) is explicitly documented as a Smithery-runtime exception in CLAUDE.md (lines 16-17). No other `export default` in `src/`.

### #46 — Unguarded JSON.parse / swallowed errors (ONE REMAINDER)
Guarded/logged now (all the issue's listed spots):
- `src/db.ts:14-20` `safeJsonParse()` wraps metadata/tags reads (`db.ts:520-521`).
- Seed command JSON.parse wrapped with a friendly stderr error — `src/cli.ts:977-983`.
- `package.json` version parse falls back to `'0.0.0'` with a logged warning — `src/cli.ts:58-62`.
- `sendResourceUpdated().catch(...)` now logs to stderr — `src/mcp/server.ts:365-367`.
- HTTP request `catch` now logs to stderr before the 500 — `src/mcp/transports.ts:135-137`.
- `preflight.ts:11-16` credential parse returns `false` silently — acceptable (absent/!invalid creds is an expected, non-error state).

**Remaining gap (the only one in this package):**
- `src/installer/format.ts:15` — `case 'json': return JSON.parse(text) as Record<string, unknown>;` inside `parseConfig()` is **not** wrapped. A corrupt JSON client-config file would throw here.

### #52 — Postinstall script (CLOSE)
- No `"postinstall"` key in `package.json` scripts (`package.json:38-52`).
- `scripts/postinstall.mjs` no longer exists (`scripts/` holds only `build-llms.mjs`, `build-mcpb.mjs`, `gen-docs.ts`).
- Claude CLI + auth are verified lazily at command time — `src/preflight.ts:19-52` (`checkPrerequisites()` runs `claude --version`, then checks `ANTHROPIC_API_KEY`/OAuth with actionable messages), called from the `discover` handler at `src/cli.ts:85`.

## Code References
- `src/mcp/transports.ts:83-88` — non-loopback token guard (#42)
- `src/mcp/transports.ts:100-107` — 401 path (#42)
- `src/mcp/start.ts:53,78-84` — `--allowed-hosts` + token threading (#42/#44)
- `src/tools.ts:112-126,171,192` — redaction of metadata + evidence (#43)
- `test/tools-hardening.test.ts:56-69` — `user:pass@host` redaction test (#43)
- `src/cli.ts:1295` — `--url` is an `install`-subcommand flag (#44)
- `src/cli.ts:35-48` — SIGINT re-raise, no process.exit (#45)
- `src/smithery.ts:35` + CLAUDE.md:16-17 — documented default export (#45)
- `src/db.ts:14-20,520-521` — safeJsonParse guards (#46)
- `src/installer/format.ts:15` — **the one unguarded JSON.parse** (#46)
- `package.json:38-52` + `src/preflight.ts:19-52` + `src/cli.ts:85` — no postinstall, lazy CLI check (#52)

## Architecture Documentation
- **Sanitization is layered**: redaction (credentials) happens in the tool layer (`src/tools.ts`) before the DB call; control-character sanitization happens in the DB layer (`src/db.ts`); JSON columns are read back through `safeJsonParse`. The one place that bypasses the guarded-parse convention is the installer config reader (`src/installer/format.ts`), which sits outside the catalog read path.
- **Transport security boundary**: `runHttp` enforces two independent gates for non-loopback binds — an explicit `allowedHosts` allowlist (DNS-rebinding, CVE-2025-66414) and a bearer token — both required, both covered by `test/transports.test.ts`.
- **Exit discipline**: the process never calls `process.exit()`; it sets `process.exitCode` or re-raises signals, so buffered stdio/stderr drains.

## Historical Context (from thoughts/)
- `thoughts/shared/research/2026-06-11-open-issues-clustering.md` — defined Packages A–F and first flagged that #42/#43/#45 appeared already-implemented and #44/#46 had small remainders; this document is the fresh verification of that hypothesis.
- `thoughts/shared/plans/2026-06-11-package-E-mcp-enhancements.md` — Package E (now merged), which is unrelated but shares the same `src/db.ts` migration/`src/cli.ts` files touched here.

## Related Research
- `thoughts/shared/research/2026-06-11-open-issues-clustering.md`
- `thoughts/shared/research/2026-06-11-package-E-mcp-enhancements.md`

## Open Questions
- **#44** — should the issue be closed as "resolved" (allowed-hosts done) with a comment that `--url` was never a binary flag, or relabeled to drop the `--url` premise? (No code change either way.)
- **#46** — close after the single `src/installer/format.ts:15` guard lands, or close now and split the installer guard into its own follow-up? (Acceptance criteria mention an installer/seed corrupt-input test.)
