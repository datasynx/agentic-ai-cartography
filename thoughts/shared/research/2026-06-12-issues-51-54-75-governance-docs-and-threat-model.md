---
date: 2026-06-12T00:04:43+02:00
researcher: majone
git_commit: d6559f422ec50a23f6f418073e59292632cf630c
branch: main
repository: datasynx/agentic-ai-cartography
topic: "GitHub issues #51, #54, #75 — governance files, README/reference gaps, structured threat model"
tags: [research, codebase, governance, documentation, security, threat-model, release, smithery, semantic-search]
status: complete
last_updated: 2026-06-12
last_updated_by: majone
---

# Research: Issues #51 (governance files), #54 (README/reference gaps), #75 (threat model)

**Date**: 2026-06-12T00:04:43+02:00
**Researcher**: majone
**Git Commit**: d6559f422ec50a23f6f418073e59292632cf630c
**Branch**: main
**Repository**: datasynx/agentic-ai-cartography

## Research Question

Document the current state of the codebase relevant to three open `documentation`-labelled
issues, so each can be triaged and closed/scoped against what already exists:

- **#51** — Add governance files: `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  issue/PR templates, `CODEOWNERS`.
- **#54** — README/reference gaps: optional-dependency graceful degradation, two-mode release
  process, Smithery env/secrets, HTTP auth.
- **#75** — Add a structured threat-model document (`docs/explanation/threat-model.md`).

This is a documentarian's map of *what exists today*, not a recommendation. Where an issue's
acceptance criterion is already satisfied in the tree, that is recorded as a fact with the
file/line that satisfies it.

## Summary

The three issues were all filed against an earlier state of the repository (#51 and #54 on
2026-06-09, #75 on 2026-06-11). As of commit `d6559f4`, the codebase has moved substantially
ahead of issues #51 and #54:

- **#51 — effectively already implemented.** Every requested governance file exists in the tree:
  `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.github/PULL_REQUEST_TEMPLATE.md`,
  `.github/ISSUE_TEMPLATE/` (bug + feature + config), and `.github/CODEOWNERS`. The "Community
  Standards" checklist set (incl. LICENSE) is present.
- **#54 — largely already documented.** The README has a `## Releasing` section covering the
  two release modes, a "Smithery scope / `env: {}`" note, an HTTP-auth section, and a
  semantic-search graceful-degradation note. The one sub-item that is *partially* covered is the
  runtime degradation **message** in `src/semantic/` (there is a `semantic search: ready` log on
  success but no explicit log when it falls back to lexical).
- **#75 — genuinely absent.** There is no `docs/explanation/threat-model.md`. `docs/explanation/`
  contains only `index.md`. `SECURITY.md` has a prose "Security model" guarantee list (lines
  30–53) but not a structured attacker-model / assets / trust-boundaries → mitigations document.
  The *mechanisms* a threat model would map are all implemented (allowlist, sanitization, HTTP
  auth, credential redaction) and are inventoried in detail below.

A secondary incidental finding: `CLAUDE.md` references `@docs/SPEC.md`, but `docs/SPEC.md` does
not exist in the tree.

## Detailed Findings

### Issue #51 — Governance / community-health files

All requested files are present in the working tree.

| File | Status | Path |
|---|---|---|
| SECURITY.md | **Present** (54 lines) | `SECURITY.md` |
| CONTRIBUTING.md | **Present** (63 lines) | `CONTRIBUTING.md` |
| CODE_OF_CONDUCT.md | **Present** (48 lines) | `CODE_OF_CONDUCT.md` |
| PULL_REQUEST_TEMPLATE.md | **Present** (22 lines) | `.github/PULL_REQUEST_TEMPLATE.md` |
| ISSUE_TEMPLATE/ | **Present** (3 files) | `.github/ISSUE_TEMPLATE/{bug_report.yml,feature_request.yml,config.yml}` |
| CODEOWNERS | **Present** (9 lines) | `.github/CODEOWNERS` |
| LICENSE | **Present** (MIT, 22 lines) | `LICENSE` |
| CHANGELOG.md | **Present** | `CHANGELOG.md` |

- `SECURITY.md` headers: `# Security Policy` → `## Reporting a vulnerability` (GitHub private
  advisory preferred; email `majone.software@gmail.com`, subject `SECURITY: agentic-ai-cartography`;
  72-hour SLA) → `## Supported versions` (2.x ✅, <2.0 ❌) → `## Security model` (the guarantee
  list, lines 30–53).
- `CONTRIBUTING.md` documents the dev flow (`npm install` / `npm run build` / `npm test`, Node ≥ 20),
  the local gate (`npm run lint`, `npm test`, `npm run build`), **Conventional Commits (required)**
  with the feat/fix/breaking → release mapping, the coding rules (mirrors CLAUDE.md), and a
  security note pointing reporters at `SECURITY.md`.
- `CODE_OF_CONDUCT.md` is Contributor Covenant v2.1, enforcement contact `majone.software@gmail.com`.
- `.github/CODEOWNERS` sets `@datasynx` as default owner with extra scrutiny routed for the
  allowlist, tools, MCP, and `.github/` paths.
- `.github/ISSUE_TEMPLATE/config.yml` disables blank issues and links security reports to the
  private advisory flow; `bug_report.yml` and `feature_request.yml` are structured forms.

Supporting convention infrastructure (relevant to #51's acceptance criteria about Conventional
Commits + lint/test/build):

- `.releaserc.json` (30 lines) — semantic-release config: `branches: ["main"]`; plugins
  commit-analyzer, release-notes-generator, changelog, npm, github (assets `dist/cartography.mcpb`,
  `sbom-cyclonedx.json`), git.
- `.github/workflows/pr-title.yml` (35 lines) — `amannn/action-semantic-pull-request@v5`, allowed
  types `feat, fix, perf, refactor, docs, test, build, ci, chore, revert`. No local commitlint
  config exists; enforcement is at PR-title level only.
- `package.json` scripts: `build` (tsup), `dev` (tsx), `test` (vitest run), `test:coverage`,
  `lint`/`typecheck` (`tsc --noEmit`), `release` (semantic-release), `prepublishOnly`
  (lint + test + build).

Full `.github/` inventory:

| File | Purpose |
|---|---|
| `CODEOWNERS` | Review routing (`@datasynx` default; allowlist/tools/MCP/.github scrutiny) |
| `PULL_REQUEST_TEMPLATE.md` | PR checklist (Conventional title, lint/test/build, tests, docs) |
| `ISSUE_TEMPLATE/bug_report.yml` | Structured bug form |
| `ISSUE_TEMPLATE/feature_request.yml` | Structured feature form |
| `ISSUE_TEMPLATE/config.yml` | Disables blank issues; links security advisory |
| `dependabot.yml` | Weekly npm + Actions updates, dev-deps grouped |
| `workflows/ci.yml` | lint/typecheck → test matrix (Node 20/22) → audit/licenses → build/validate/SBOM |
| `workflows/release.yml` | Two-mode release (semantic-release vs idempotent publish) |
| `workflows/pr-title.yml` | Conventional-Commits PR-title check |
| `workflows/codeql.yml` | Weekly CodeQL scan (JS/TS) |
| `workflows/mcp-publish.yml` | Publishes `server.json` to MCP Registry (GitHub OIDC) |
| `workflows/pages.yml` | Deploys `docs/` to GitHub Pages |

### Issue #54 — README / reference gaps

The README addresses all four sub-items raised by #54.

**1. Optional-dependency graceful degradation (semantic search).**
- `README.md:271-274` documents it: *"semantic search auto-upgrades when `sqlite-vec` and a local
  embedder (`@huggingface/transformers`) are present; otherwise it falls back to lexical search.
  These ship as `optionalDependencies` and are lazy-loaded…"*
- `package.json:98-103` `optionalDependencies`: `@anthropic-ai/claude-agent-sdk ^0.2.59`,
  `@anthropic-ai/sdk ^0.78.0`, `@huggingface/transformers ^4.2.0`, `sqlite-vec ^0.1.9`.
- Mechanism (the part the issue asked to "improve the runtime message" for):
  - `src/semantic/embeddings.ts` `createLocalEmbedder()` (lines 24–53) dynamically imports
    `@huggingface/transformers`; on any failure it returns `undefined` (lines 50–52, silent `catch`).
  - `src/semantic/store.ts` `VectorStore.init()` (lines 34–66) dynamically imports `sqlite-vec`;
    returns `false` on failure (silent `catch`, lines 63–65).
  - `src/semantic/search.ts` `createSemanticSearch()` (lines 25–50): if no embedder → `lexicalSearch()`;
    if vector store `init()` is false → `lexicalSearch()`; otherwise hybrid (vector, then lexical
    fallback on zero hits).
  - `src/mcp/start.ts` logs `semantic search: ready` on success (≈ lines 67–70). **There is no
    explicit log emitted when it degrades to lexical** — degradation is silent. This is the single
    place where #54's text ("improve the runtime message in `src/semantic/embeddings.ts`") is not
    yet satisfied.
  - `--no-semantic` flag disables semantic search entirely (`src/mcp/start.ts`, `src/mcp-bin.ts`;
    documented at `docs/reference/cli.md:33`).
- `docs/reference/mcp.md:31` notes "semantic search when available, lexical otherwise."

**2. Two-mode release process.**
- `README.md:439-459` `## Releasing` documents both modes and the rationale.
- `.github/workflows/release.yml`: `env.HAS_RELEASE_TOKEN` / `env.HAS_NPM_TOKEN` gate the two paths.
  - Mode A (`HAS_NPM_TOKEN && HAS_RELEASE_TOKEN`): `npx semantic-release` with
    `GITHUB_TOKEN: secrets.RELEASE_TOKEN`, `NODE_AUTH_TOKEN: secrets.NPM_TOKEN`.
  - Mode B (`HAS_NPM_TOKEN && !HAS_RELEASE_TOKEN`): idempotent publish — skips if
    `npm view "$NAME@$VERSION"` already resolves; else `npm publish` (provenance) + best-effort
    `gh release create`.
  - Rationale (workflow header lines 13–17): Actions `GITHUB_TOKEN` cannot hold the `workflow`
    scope, so it cannot push refs touching workflow files; semantic-release pushes a tag and
    therefore needs a workflow-scoped `RELEASE_TOKEN`.
  - One-time baseline bootstrap anchors `v1.1.1` at `df16cbf` if no version tags exist.
- README "Repository secrets" table (≈ lines 451–459): `NPM_TOKEN` (required), `RELEASE_TOKEN`
  (optional, upgrades to full semantic-release), `CODECOV_TOKEN` (optional).
- `.github/workflows/mcp-publish.yml` publishes `server.json` to the MCP Registry on
  `release: published` via `mcp-publisher login github-oidc` (no PAT).

**3. Smithery env / secrets.**
- `smithery.yaml`: `runtime: typescript`, `env: {}` with the comment *"No secrets required —
  read-only discovery over an in-memory catalog by default."*
- `src/smithery.ts`: the one sanctioned default export. `createServer({ config })` builds the MCP
  server with `dbPath: config?.db ?? ':memory:'` and optional `session`. `configSchema` (Zod)
  exposes `db` and `session` to Smithery's config UI.
- `README.md:105-113` documents the Smithery scope: hosted runtime needs no secrets; the cloud
  scanners (`scan_aws_resources`, `scan_gcp_resources`, `scan_azure_resources`, `scan_k8s_resources`)
  need the respective CLI + credentials on the host, so they are local/self-hosted only.
- Cloud-credential env vars (read via `safeEnv()` in `src/platform.ts:60-67`): AWS
  (`AWS_DEFAULT_REGION`, `AWS_PROFILE`, `AWS_CONFIG_FILE`), GCP (`GOOGLE_APPLICATION_CREDENTIALS`),
  Azure (`AZURE_CONFIG_DIR`), Kubernetes (`KUBECONFIG`).
- `server.json`: MCP Registry descriptor, `name: io.github.datasynx/cartography`, version `2.0.0`,
  npm package `@datasynx/agentic-ai-cartography`, stdio transport, `--db` / `--session` args.

**4. HTTP auth.**
- `README.md:156-169` documents the HTTP transport's DNS-rebind protection and bearer-token
  requirement.
- Implemented in `src/mcp/transports.ts` (see #75 findings below): non-loopback bind throws
  without `allowedHosts` and without a token; token compared with a constant-time check.
- `SECURITY.md:49-51` states the HTTP guarantee.

### Issue #75 — Structured threat-model document

**Absent artifact.** `find docs -iname '*threat*'` returns nothing. `docs/explanation/` contains
only `index.md` ("Why MCP-first?"). The requested `docs/explanation/threat-model.md` does not exist.

What exists today is the prose guarantee list in `SECURITY.md:30-53`:

> - **No destructive commands.** Anything not provably read-only is rejected.
> - **Scan parameters are validated** before being placed in a shell command (`src/tools.ts`,
>   `assertSafeScanArg`)…
> - **Credentials are redacted** from node ids and metadata before they are persisted
>   (`stripSensitive`, `redactValue`).
> - **Untrusted text is sanitized** before it enters the catalog or an LLM context
>   (`sanitizeUntrusted`)… Each scan tool's output is also size-capped (`maxToolResponseBytes`)…
> - **The HTTP transport requires authentication** when bound to a non-loopback host…

The issue asks for a *structured* model — attacker model, assets, trust boundaries, mitigations
mapped to each. The mechanisms that such a document would catalogue are all implemented:

**Trust boundaries (where untrusted data enters):**
1. **Agent/MCP-client supplied scan parameters** (namespace, region, project, subscription, RG).
2. **Untrusted scan content** — browser bookmarks (`scan_bookmarks`), browser history
   (`scan_browser_history`), installed-app lists, and the stdout of CLI scanners.
3. **HTTP transport** — Streamable HTTP when bound to a non-loopback host.
4. **The catalog / SQLite DB** — persisted nodes/edges later re-read into LLM context.

**Assets:**
- Local command execution surface (Bash / PowerShell via `run()`).
- Cloud + cluster credentials (AWS/GCP/Azure/K8s config files referenced by env).
- Browser bookmarks/history, installed apps, DB connection strings, host/process/network info.

**Mitigations and exact locations:**

| Boundary / threat | Mitigation | Location |
|---|---|---|
| Arbitrary command execution | Positive read-only **allowlist** (binaries + per-tool verb rules), not a denylist | `src/allowlist.ts:14-29, 44-65, 197-222` |
| Command injection via substitution | `$()` and backticks rejected | `src/allowlist.ts:211` |
| File-system writes | Write-redirect detection (allows only `/dev/null`, `2>&1`) | `src/allowlist.ts:181-189` |
| Windows mutation | PowerShell dangerous-cmdlet regex | `src/allowlist.ts:41-43, 73-82` |
| Defense-in-depth at execution | `run()` re-checks `checkReadOnly()` before `execSync`, regardless of origin | `src/platform.ts:77-95` |
| Secret env leakage to children | `safeEnv()` allowlist of env keys | `src/platform.ts:60-75` |
| Agent-driven Bash in Claude loop | `safetyHook` PreToolUse deny | `src/safety.ts:1-42` |
| Shell-arg injection in scan params | `assertSafeScanArg` regex per arg kind | `src/tools.ts:83-114` |
| Credentials in node ids/metadata | `stripSensitive`, `redactSecrets`, `redactValue` | `src/tools.ts:67-81, 111-126` |
| Hidden prompt-injection in untrusted text | `sanitizeUntrusted` strips invisible/bidi/control Unicode (NFC) | `src/sanitize.ts:18-45`; applied at `src/db.ts:475-492, 539-550` |
| Context-window exhaustion | `clampText` size cap (`maxToolResponseBytes`, default 100 000) | `src/tools.ts:48-65`; `src/types.ts:194,213` |
| HTTP DNS-rebinding (CVE-2025-66414) | non-loopback bind requires explicit `allowedHosts` | `src/mcp/transports.ts:71-78` |
| Unauthenticated HTTP | non-loopback bind requires bearer token; constant-time compare | `src/mcp/transports.ts:83-88, 36-42, 100-107` |

**Security test coverage** (evidence the mitigations are exercised): `test/safety.test.ts`,
`test/tools-hardening.test.ts`, `test/sanitize.test.ts`, `test/transports.test.ts`.

## Code References

- `SECURITY.md:30-53` — prose "Security model" guarantee list (#75 source material).
- `CONTRIBUTING.md:31-40` — Conventional Commits requirement (#51).
- `.github/CODEOWNERS:1-9` — review routing (#51).
- `.github/ISSUE_TEMPLATE/config.yml` — security advisory link, blank-issue disable (#51).
- `.releaserc.json:1-30` — semantic-release config (#51/#54).
- `.github/workflows/release.yml` — two-mode release conditional logic (#54).
- `README.md:271-274` — semantic-search graceful-degradation note (#54).
- `README.md:439-459` — `## Releasing` two-mode docs + secrets table (#54).
- `README.md:105-113` — Smithery scope / `env: {}` note (#54).
- `README.md:156-169` — HTTP DNS-rebind + bearer-token docs (#54).
- `smithery.yaml` — `env: {}` (#54).
- `src/smithery.ts` — default export, `createServer`, `:memory:` default (#54).
- `src/semantic/embeddings.ts:24-53` — `createLocalEmbedder()` silent `undefined` fallback (#54).
- `src/semantic/store.ts:34-66` — `VectorStore.init()` silent `false` fallback (#54).
- `src/semantic/search.ts:25-50` — semantic→lexical selection (#54).
- `src/mcp/start.ts:67-70` — `semantic search: ready` log; no degradation log (#54).
- `src/allowlist.ts:14-29,44-65,181-222` — read-only allowlist (#75).
- `src/platform.ts:60-95` — `safeEnv()` + `run()` chokepoint (#75).
- `src/safety.ts:1-42` — PreToolUse hook (#75).
- `src/sanitize.ts:18-45` — untrusted-text sanitization (#75).
- `src/tools.ts:48-126` — clampText, SCAN_ARG_PATTERNS, redaction, stripSensitive (#75).
- `src/mcp/transports.ts:36-107` — HTTP auth + DNS-rebind protection (#75).

## Architecture Documentation

**Documentation lives in two places** that new docs must fit into:

1. **README.md** — installation, MCP client copy-paste configs (13 hosts), Smithery, HTTP auth,
   `## Safety` (lines 403–419), `## Releasing` (lines 439–459).
2. **`docs/` — Diátaxis structure**, deployed to GitHub Pages via `.github/workflows/pages.yml`:
   - `docs/tutorials/index.md` — zero-to-agent walkthrough.
   - `docs/how-to/` — `index.md`, `install.md`, `drift-and-ci.md`.
   - `docs/reference/` — `index.md`, `mcp.md`, `cli.md`, `clients.md`.
   - `docs/explanation/` — **only `index.md`** ("Why MCP-first?"). This is where #75's
     `threat-model.md` would slot in.
   - `docs/adapters.md` — non-MCP framework bridges.
   - Non-Diátaxis enterprise docs: `EVALUATION-REPORT.md`, `TASK-SPECIFICATION.md`,
     `VISION-STRATEGY.md`, `LICENSE-COMPLIANCE.md`, `LEGAL-SIGNOFF-LGPL.md`, `SPIKE-VITEST-4.md`,
     `tasks.md`.
   - Generated: `llms.txt`, `llms-full.txt`, `index.html` (via `scripts/build-llms.mjs`,
     `scripts/gen-docs.ts`).

**CHANGELOG.md** follows Keep a Changelog 1.1.0 + SemVer; the header says it is maintained
automatically by semantic-release, and an `[Unreleased]` section is currently populated.

**Conventions** (from `CLAUDE.md` / `CONTRIBUTING.md`): named exports (sole exception
`src/smithery.ts`), 2-space, no `any`, ISO 8601 UTC, ids `"{type}:{id}"`, `.js` import extensions,
logs to stderr, `process.exitCode` not `process.exit()`.

## Historical Context (from thoughts/)

No prior research documents exist under `thoughts/` for these topics — `thoughts/shared/research/`
was empty before this document. Relevant recent git history (already in the tree):

- `7cb4534` — "feat: untrusted-text sanitization, tool-output limit, cleanups" (introduced
  `src/sanitize.ts` + `maxToolResponseBytes`, central to #75's mitigations and #54's degradation note).
- `5ceaeb2` — "feat: Package E — MCP/agent capability enhancements (#71–#74)".
- The auto-memory index (`MEMORY.md`) records a preferred workflow: research → plan → issues →
  implement, phased, only acting after approval — consistent with this research-only pass.

## Related Research

None. This is the first document under `thoughts/shared/research/`.

## Open Questions

1. **Issue #51 triage.** Every requested file exists at `d6559f4`. Is the remaining work only the
   GitHub "Community Standards" checklist verification, or is the issue simply closeable?
2. **Issue #54 — semantic degradation message.** README documents the fallback, but the runtime
   path is silent when it degrades to lexical (`src/mcp/start.ts` logs only the success case). The
   issue text specifically asked to "improve the runtime message in `src/semantic/embeddings.ts`."
   Is an explicit "semantic search unavailable → lexical" log still wanted?
3. **Issue #75.** The only genuinely missing artifact. The mitigations table above is the raw
   material; the deliverable is the structured `docs/explanation/threat-model.md` (attacker model,
   assets, trust boundaries, mitigations-per-boundary) plus an `explanation/index.md` cross-link.
4. **Incidental.** `CLAUDE.md` references `@docs/SPEC.md`, but `docs/SPEC.md` does not exist. Out
   of scope for #51/#54/#75 but surfaced during the docs-tree sweep.
