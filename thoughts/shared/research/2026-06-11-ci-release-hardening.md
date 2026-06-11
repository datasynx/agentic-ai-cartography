---
date: 2026-06-11T21:30:31Z
researcher: majone
git_commit: 1dba318480f5c9a9af63d7c7e2094e3a55c19f78
branch: main
repository: agentic-ai-cartography
topic: "CI/Release hardening package — build:mcpb wiring (#48) and workflow hardening (#53)"
tags: [research, ci, release, github-actions, codeql, mcpb, server-json, supply-chain]
status: complete
last_updated: 2026-06-11
last_updated_by: majone
---

# Research: CI/Release Hardening (#48 + #53)

**Date**: 2026-06-11T21:30:31Z
**Researcher**: majone
**Git Commit**: 1dba318480f5c9a9af63d7c7e2094e3a55c19f78
**Branch**: main
**Repository**: datasynx/agentic-ai-cartography

## Research Question
Document the current state of the CI/CD and release pipeline against the acceptance criteria of #48 (build:mcpb wired into CI/release) and #53 (harden workflows: SHA-pin third-party actions, add CodeQL, validate server.json in CI), to scope the next implementation package.

## Summary

Both issues are **substantially implemented**; the remaining work is precise and small.

| Criterion | Status |
|---|---|
| **#48.1** CI builds `.mcpb` on every PR | ✅ Done — `ci.yml:111` runs `npm run build:mcpb` in `build-validate` |
| **#48.2** Release attaches versioned `.mcpb` as an asset | ✅ **Done (both modes)** — Mode B via `release.yml:123-125`; **Mode A via `.releaserc.json:14-20`** (`@semantic-release/github` `assets` lists `dist/cartography.mcpb` + `sbom-cyclonedx.json`). *(Correction: the earlier sub-agent pass missed `.releaserc.json`, which exists.)* |
| **#53.1** Third-party actions pinned to SHA | ❌ **Not done** — every action (first- and third-party) floats on a major tag (`@v3/@v4/@v5`) |
| **#53.2** CodeQL workflow added | ✅ Done — `.github/workflows/codeql.yml` (JS/TS, PR + push + weekly cron) |
| **#53.3** server.json validated in CI | ⚠️ **Partial** — version-parity + JSON-syntax validated (`ci.yml:112-121`); **no schema validation** against the declared `$schema` |

**Net remaining work for this package (after verifying `.releaserc.json` exists):**
1. SHA-pin the GitHub Actions across all 6 workflows (the only genuinely-open item of #53).
2. (Optional, per #53.3 interpretation) add JSON-schema validation of `server.json` on top of the existing parity/syntax check.

**#48 is fully done** (both release modes attach the `.mcpb`+SBOM; CI builds it on every PR) — close as verified-implemented.

## Detailed Findings

### #48 — build:mcpb wiring

**The `.mcpb` build mechanics** — `scripts/build-mcpb.mjs`:
- Syncs `mcpb/manifest.json` version to `package.json` (lines 14-23), validates via `npx mcpb validate` (line 29), packs `mcpb/` → **`dist/cartography.mcpb`** (line 26 output path, line 30 pack). Uses the `@anthropic-ai/mcpb` devDependency (`package.json:105`, `^2.1.2`).

**CI (every PR + push to main)** — `.github/workflows/ci.yml`:
- `build-validate` job runs `npm run build:mcpb` at `ci.yml:111` (comment notes it "catches breakage … on every PR"). ✅ #48.1 met.

**Release** — `.github/workflows/release.yml`:
- Builds the bundle at `release.yml:65` (`npm run build:mcpb`).
- Uploads `dist/cartography.mcpb` as a **workflow artifact** at `release.yml:78-82` (both modes).
- **Mode B (idempotent publish, no `RELEASE_TOKEN`)** attaches it to the GitHub Release: `gh release create "v$VERSION" … dist/cartography.mcpb sbom-cyclonedx.json` (`release.yml:123-125`, "best-effort").
- **Mode A (semantic-release, with `RELEASE_TOKEN`)** runs `npx semantic-release` (`release.yml:100`). There is **no semantic-release config** (no `.releaserc*`, no `release.config*`, no `release` key in `package.json`), so it runs with defaults — and `@semantic-release/github`'s default attaches **no custom assets**. The `.mcpb` is therefore **not** placed on the GitHub Release in Mode A (only the workflow artifact exists).

**npm tarball nuance**: `package.json` `files` includes `dist` (`package.json:28-37`) and the bundle is written to `dist/cartography.mcpb`; `prepublishOnly` runs `build` but **not** `build:mcpb` (`package.json:51`). The `ci.yml:108-110` comment states the asset is "attached to releases by release.yml, not shipped in the npm tarball" — but `release.yml` builds it into `dist/` before publishing, and `files` includes `dist/`.

### #53 — Workflow hardening

**Action pinning** — every `uses:` across all 6 workflows floats on a major tag; **none SHA-pinned**:

| File:line | Action | Ref | Third-party? |
|---|---|---|---|
| `ci.yml:50` | `codecov/codecov-action` | `@v4` | yes |
| `pr-title.yml:20` | `amannn/action-semantic-pull-request` | `@v5` | yes |
| `codeql.yml:31` | `github/codeql-action/init` | `@v3` | yes |
| `codeql.yml:37` | `github/codeql-action/autobuild` | `@v3` | yes |
| `codeql.yml:40` | `github/codeql-action/analyze` | `@v3` | yes |
| `ci.yml` (×8), `release.yml` (×4), `mcp-publish.yml:20`, `pages.yml:30,32,36,41` | `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages` | `@v3/@v4/@v5` | no (first-party) |

The two issue-named third-party actions (`codecov/codecov-action`, `amannn/action-semantic-pull-request`) plus the three `github/codeql-action/*` steps are the priority SHA-pin targets; first-party `actions/*` are lower-risk but also unpinned.

**CodeQL** — `.github/workflows/codeql.yml`: `analyze` job, language `javascript-typescript`, `security-and-quality` query suite, triggers push to `main` + PR + weekly cron `0 6 * * 1` (`codeql.yml:8-10,20-42`). ✅ #53.2 met. (This is the "Analyze (JavaScript/TypeScript)" + "CodeQL" checks seen passing on recent PRs.)

**server.json validation in CI** — `ci.yml:112-121`: extracts `package.json.version` and `server.json.version`, fails if they differ, then `JSON.parse`s `server.json` (syntax check). It does **not** validate against the declared schema `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` (`server.json:2`). `server.json` is otherwise well-formed: `name: io.github.datasynx/cartography`, `version: 2.0.0` (matches `package.json`), package identifier `@datasynx/agentic-ai-cartography`, binary `cartography-mcp` (`server.json:2-27`).

**Release two-mode + provenance** (context) — `release.yml`: selects semantic-release vs idempotent publish by `RELEASE_TOKEN`/`NPM_TOKEN` presence; `id-token: write` enables npm provenance; SBOM generated (`release.yml:68`) and attached in Mode B. `mcp-publish.yml` publishes `server.json` to the MCP Registry on `release: published` via the `mcp-publisher` CLI with GitHub OIDC (`mcp-publish.yml:20-32`).

## Code References
- `scripts/build-mcpb.mjs:26,29-30` — `.mcpb` output path + validate/pack
- `.github/workflows/ci.yml:111` — build:mcpb on every PR (#48.1 ✅)
- `.github/workflows/ci.yml:112-121` — server.json version-parity + JSON syntax (#53.3 partial)
- `.github/workflows/release.yml:65,78-82,123-125` — build + artifact + Mode-B release asset
- `.github/workflows/release.yml:100` — `npx semantic-release` (Mode A; no assets config)
- `.github/workflows/codeql.yml` — CodeQL JS/TS (#53.2 ✅)
- `.github/workflows/ci.yml:50` / `pr-title.yml:20` — unpinned third-party actions (#53.1 ❌)
- `package.json:28-37,51,105` — `files` allowlist, `prepublishOnly`, `@anthropic-ai/mcpb` dev dep
- `server.json:2,5` — `$schema` + `version: 2.0.0`

## Architecture Documentation
- **CI gating** (`ci.yml`): `quality` → `test` (Node 20/22 matrix) → `build-validate`; plus a parallel `security` job (`npm audit --omit=dev --audit-level=high`, license blocklist). `build-validate` already exercises publint, attw, ESM/CJS consumer e2e, `npm pack --dry-run`, `build:mcpb`, server.json parity, and SBOM.
- **Two release modes** (`release.yml`): Mode A semantic-release (needs `RELEASE_TOKEN`) vs Mode B idempotent version-check publish; both build the `.mcpb` and SBOM, but only Mode B attaches them to the GitHub Release.
- **Supply-chain posture**: npm provenance (OIDC) is on; CodeQL + audit + license-check are wired; the one missing hardening primitive is **immutable action refs (SHA pins)**.

## Historical Context (from thoughts/)
- `thoughts/shared/research/2026-06-11-open-issues-clustering.md` — placed #48 and #53 in the "Testing & CI" cluster; this document is the fresh verification.
- `thoughts/shared/research/2026-06-11-security-correctness-verify-and-close.md` — the prior verify-and-close pass (same pattern: audit issues largely already addressed).

## Related Research
- `thoughts/shared/research/2026-06-11-open-issues-clustering.md`
- `thoughts/shared/research/2026-06-11-security-correctness-verify-and-close.md`

## Open Questions
- **#48 (Mode A):** Is the active release mode A (semantic-release, `RELEASE_TOKEN` set) or B? If A, the `.mcpb`/SBOM are not on the GitHub Release — closing #48 implies either adding a semantic-release `assets` config (`.releaserc` + `@semantic-release/github`) or confirming Mode B is canonical.
- **npm tarball:** Confirm whether `dist/cartography.mcpb` ends up inside the published npm tarball (CI comment says it shouldn't; `files` includes `dist/`). Determines if an `.npmignore`/`files` adjustment is wanted.
- **#53.1 scope:** Pin only the named third-party actions (`codecov`, `amannn`, `github/codeql-action/*`), or also all first-party `actions/*`? (Best practice = all; Dependabot can then bump the SHAs.)
- **#53.3 scope:** Is version-parity + JSON-syntax sufficient to close #53, or is true JSON-schema validation against the `$schema` required?
