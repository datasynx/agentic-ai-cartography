---
date: 2026-06-12T00:00:00Z
researcher: majone
git_commit: 8d8468c8509bed74e5d1c972f2efd5dc41219761
branch: main
repository: agentic-ai-cartography
topic: "Decision: dev-tree npm audit highs (tmp via @anthropic-ai/mcpb) — issue #50"
tags: [research, security, dependencies, npm-audit, go-live, decision]
status: complete
last_updated: 2026-06-12
last_updated_by: majone
---

# Decision: dev-tree `npm audit` highs (#50)

**Date**: 2026-06-12
**Researcher**: majone
**Git Commit**: 8d8468c8509bed74e5d1c972f2efd5dc41219761
**Branch**: main
**Repository**: datasynx/agentic-ai-cartography

## Question

`npm audit` (full tree) reported 8 vulns including 2 highs from `tmp <=0.2.5`
(path traversal / symlink write). `npm audit --omit=dev` is clean (0), so
published consumers are unaffected, but dev/CI machines run the full tree.
Issue #50 asks for a recorded decision (overrides pin / upstream-wait / isolate
mcpb tooling) and for the residual full-tree high count to be tracked.

## Findings

The vulnerable `tmp` reaches the tree only through dev tooling:

```
tmp <=0.2.5
└─ external-editor → @inquirer/editor → @inquirer/prompts → @anthropic-ai/mcpb (devDependency)
```

`@anthropic-ai/mcpb` is used only by `npm run build:mcpb` (Claude Desktop bundle).

Two corrections to the original issue triage, established empirically:

1. **"No fix available" was stale.** The advisory range is `tmp <=0.2.5`, but
   `tmp@0.2.6`/`0.2.7` now exist and are patched (`latest = 0.2.7`). An
   `overrides` pin therefore *does* resolve it.
2. **The 0.0.33 → 0.2.7 jump is safe here.** `external-editor`'s only call into
   `tmp` is `tmp.tmpNameSync()` (`node_modules/external-editor/main/index.js:131`),
   a stable API present across all `tmp` versions. No behavioural risk from the
   bump.

### Empirical test

Applied `overrides: { tmp: "^0.2.7" }`, reinstalled, re-audited, reverted:

- `tmp` resolved to `0.2.7` down the mcpb chain.
- Full-tree audit: **8 vulns (2H/2M/4L) → 3 vulns (1H/2M)**. Both `tmp` highs gone.
- `npm run build:mcpb` still validated + packed `dist/cartography.mcpb`.
- `npm audit --omit=dev` stayed clean (0).

### Residual findings are npm's own bundled tree

The remaining `picomatch` (high), `ip-address` (moderate) and `brace-expansion`
(low) all live under `node_modules/npm/node_modules/*` — npm's vendored
dependencies on the runner, **not** declared anywhere in this repo. `overrides`
cannot reach them; they clear whenever the runner's npm version bumps. CI already
treats the full-tree audit as advisory/non-blocking (`npm audit ... || true`).

## Decision

**Pin via `overrides` — Option A.** Chosen over isolating mcpb tooling
(Option B: drop `@anthropic-ai/mcpb` from devDeps + `npx -y` it in the build
step) because Option B trades a reproducible, cached, offline-capable bundle
build for a per-run network fetch and marginal subtree hygiene. The override is
locked in `package-lock.json`, proven non-breaking, and one line.

### Changes

- `package.json`: add `"overrides": { "tmp": "^0.2.7" }`.
- `package-lock.json`: regenerated to lock `tmp@0.2.7`.
- `.github/workflows/ci.yml`: comment on the advisory-only audit step recording
  that the **expected residual is 1 high (npm-bundled picomatch)** — a new high
  in our own tree should be investigated, not absorbed (satisfies #50 AC #2).

## Acceptance criteria (#50)

- [x] Decision recorded: `overrides` pin (this note).
- [x] Full-tree `npm audit` high count tracked: expected residual = 1 high,
      npm-bundled only; documented at the CI audit step and here.

## Out of scope

Broader dependency drift (Anthropic SDK / core-dep majors, wider Dependabot
grouping, fully isolating mcpb tooling) belongs to #49 and is untouched here.
