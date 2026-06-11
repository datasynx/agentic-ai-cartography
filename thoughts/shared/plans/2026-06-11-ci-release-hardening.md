# CI/Release Hardening Implementation Plan (#53)

## Overview

Harden the GitHub Actions supply chain: pin every action to an immutable commit SHA, keep them maintained via Dependabot, and strengthen the in-CI `server.json` validation from parity+syntax to real (best-effort) JSON-schema validation. This completes the open items of **#53**. **#48 is already fully implemented** (verified) and is closed separately without code.

## Current State Analysis

- **#48 — DONE (no work):** `ci.yml:111` builds the `.mcpb` on every PR; `release.yml:64-82` builds it + SBOM; **both** release modes attach them to the GitHub Release — Mode A via `.releaserc.json:13-21` (`@semantic-release/github` `assets`), Mode B via `release.yml:123-125` (`gh release create … dist/cartography.mcpb sbom-cyclonedx.json`).
- **#53.2 — DONE (no work):** `.github/workflows/codeql.yml` runs CodeQL for `javascript-typescript` on push/PR + weekly cron.
- **#53.1 — OPEN:** Every `uses:` across the 6 workflows floats on a major tag (`@v3/@v4/@v5`); none is SHA-pinned. `.github/dependabot.yml` covers only the `npm` ecosystem (no `github-actions`).
- **#53.3 — PARTIAL:** `ci.yml:112-121` validates `server.json` version-parity with `package.json` + JSON syntax, but does **not** validate against the declared `$schema` (`server.json:2`). `ajv` is already resolvable in the tree.

### Key Discoveries
- The 11 distinct action refs to pin (from `grep -rn 'uses:' .github/workflows/`):
  `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`, `codecov/codecov-action@v4`, `github/codeql-action/init@v3`, `github/codeql-action/autobuild@v3`, `github/codeql-action/analyze@v3`, `amannn/action-semantic-pull-request@v5`.
- `.releaserc.json` already exists with the full plugin chain + asset config — do not touch it.
- `server.json:2` `$schema` = `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`; `version: 2.0.0` matches `package.json`.

## Desired End State
- Every `uses:` in `.github/workflows/*` is pinned to a 40-char commit SHA with a trailing `# vX` comment; CI stays green (proof the SHAs resolve and behavior is unchanged).
- `.github/dependabot.yml` has a `github-actions` ecosystem entry so the pinned SHAs are auto-bumped.
- `scripts/validate-server-json.mjs` enforces version-parity + required-field structure (hard) and best-effort remote `$schema` validation (hard on real violations, warn-and-skip on network/$ref errors); `ci.yml` calls it instead of the inline bash.
- `npm run lint/build/test` green; `node scripts/validate-server-json.mjs` exits 0.

## What We're NOT Doing
- No change to `.releaserc.json`, `release.yml`, or `mcp-publish.yml` (release/publish already correct).
- No major-version bumps of any action (codecov stays v4, etc.) — pinning the **current** SHA of the in-use major only.
- No new CodeQL/scanning config (#53.2 done).
- No change to `#48` artifacts (done).
- Not removing the existing `mcp-publisher` publish-time schema validation.

## Implementation Approach
Two independent phases. Phase 1 (pinning + Dependabot) is purely YAML/config. Phase 2 (server.json validator) is a small Node script + one `ci.yml` step swap. CI on the PR is the authoritative end-to-end proof.

---

## Phase 1: SHA-pin all actions + Dependabot github-actions

### Overview
Replace each `@vX` ref with the resolved commit SHA + `# vX` comment, and teach Dependabot to maintain them.

### Changes Required

#### 1. Resolve each action's SHA (implement-time)
For each distinct `OWNER/REPO@TAG` above, resolve the commit the tag points to:
```bash
gh api repos/<owner>/<repo>/commits/<tag> --jq .sha
# e.g. gh api repos/actions/checkout/commits/v4 --jq .sha
# github/codeql-action/{init,autobuild,analyze} share one repo (github/codeql-action) → one SHA for v3
```
Then rewrite every occurrence, e.g.:
```yaml
- uses: actions/checkout@<sha>          # v4
- uses: codecov/codecov-action@<sha>    # v4
- uses: amannn/action-semantic-pull-request@<sha>  # v5
- uses: github/codeql-action/init@<sha>     # v3
```
**Files:** `.github/workflows/ci.yml` (8 refs incl. `codecov/codecov-action@v4:50`), `.github/workflows/codeql.yml` (4 refs), `.github/workflows/release.yml` (4 refs), `.github/workflows/mcp-publish.yml` (1), `.github/workflows/pages.yml` (4), `.github/workflows/pr-title.yml` (1 — `amannn/...@v5:20`). Every `uses:` line gets a SHA + `# vX` comment.

#### 2. Dependabot — maintain the pinned SHAs
**File:** `.github/dependabot.yml`
```yaml
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
      - "ci"
    groups:
      actions:
        patterns:
          - "*"
```
(Appended to the existing `updates:` list; the `npm` block is unchanged.)

### Success Criteria

#### Automated Verification:
- [ ] Every `uses:` is SHA-pinned: `! grep -rEn 'uses: .*@v[0-9]+$' .github/workflows/` returns nothing
- [ ] All workflow YAML still parses: `for f in .github/workflows/*.yml; do node -e "require('yaml').parse(require('fs').readFileSync('$f','utf8'))"; done`
- [ ] `actionlint` clean if available (optional): `command -v actionlint && actionlint || echo "actionlint not installed"`
- [ ] `npm run lint && npm run build && npm run test` green (unaffected, sanity)

#### Manual Verification:
- [ ] All CI checks pass on the PR (proves each pinned SHA resolves and the actions behave identically — checkout/setup-node/codecov/codeql/pr-title).
- [ ] Dependabot opens/queues a `github-actions` group PR (visible under Insights → Dependency graph → Dependabot after merge).

---

## Phase 2: server.json schema validation in CI (#53.3)

### Overview
Move the inline parity/syntax check into a tested script that also performs real schema validation.

### Changes Required

#### 1. New validation script
**File:** `scripts/validate-server-json.mjs` (new)
```js
#!/usr/bin/env node
// Validate server.json: (1) version parity with package.json [hard],
// (2) required-field structure [hard], (3) best-effort JSON-schema validation
// against the declared $schema [hard on real violations, warn-and-skip on
// network/$ref errors so CI never flakes]. Authoritative schema validation also
// runs at publish time via mcp-publisher (.github/workflows/mcp-publish.yml).
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const server = JSON.parse(readFileSync(resolve(root, 'server.json'), 'utf8'));

const fail = (m) => { console.error(`::error::${m}`); process.exitCode = 1; };

// (1) version parity
if (server.version !== pkg.version) fail(`server.json version (${server.version}) != package.json version (${pkg.version})`);

// (2) required structure
for (const key of ['$schema', 'name', 'version', 'packages']) {
  if (server[key] === undefined) fail(`server.json missing required field: ${key}`);
}
if (Array.isArray(server.packages)) {
  server.packages.forEach((p, i) => {
    for (const k of ['identifier', 'version', 'transport']) {
      if (p[k] === undefined) fail(`server.json packages[${i}] missing: ${k}`);
    }
  });
}

// (3) best-effort schema validation
try {
  const { default: Ajv } = await import('ajv');
  const res = await fetch(server.$schema, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`schema fetch ${res.status}`);
  const schema = await res.json();
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false });
  const validate = ajv.compile(schema);
  if (!validate(server)) {
    for (const e of validate.errors ?? []) fail(`schema: ${e.instancePath || '/'} ${e.message}`);
  }
} catch (err) {
  console.warn(`::warning::Skipped remote schema validation (${err instanceof Error ? err.message : String(err)}); parity + structure checks still enforced.`);
}

if (!process.exitCode) console.log(`server.json OK — version parity + structure (${pkg.version})`);
```

#### 2. Add ajv as an explicit devDependency
**File:** `package.json` — add `"ajv": "^8.17.1"` to `devDependencies` (currently only transitively present).

#### 3. Wire into CI
**File:** `.github/workflows/ci.yml` — replace the inline `Validate server.json` step (`:112-121`) with:
```yaml
      - name: Validate server.json (parity + schema)
        run: node scripts/validate-server-json.mjs
```

#### 4. Test for the validator
**File:** `test/server-json.test.ts` (new) — assert the committed `server.json` passes parity + structure (import-free: spawn the script, or replicate the parity+structure assertions on the parsed files). Minimal:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
describe('server.json', () => {
  it('matches package.json version and has required fields', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const s = JSON.parse(readFileSync('server.json', 'utf8'));
    expect(s.version).toBe(pkg.version);
    for (const k of ['$schema', 'name', 'version', 'packages']) expect(s[k]).toBeDefined();
    expect(Array.isArray(s.packages)).toBe(true);
  });
});
```

### Success Criteria

#### Automated Verification:
- [ ] `node scripts/validate-server-json.mjs` exits 0 on the committed `server.json`
- [ ] Script hard-fails on a deliberately mismatched version (manual spot check during dev)
- [ ] `npm run test` green incl. the new `test/server-json.test.ts`
- [ ] `npm run lint && npm run build` green

#### Manual Verification:
- [ ] CI "Build & Validate Package" job runs the new step and passes.
- [ ] When the network/schema is reachable, schema violations would fail CI (verified by temporarily breaking a field locally).

---

## Testing Strategy

### Unit Tests
- `test/server-json.test.ts` — parity + required-field structure on the committed file.

### Integration Tests
- The PR's CI run is the integration test for Phase 1 (all actions still resolve + behave) and the new validate step for Phase 2.

### Manual Testing Steps
1. After Phase 1, push the branch and confirm all 8 CI checks pass (checkout, setup-node, codecov upload, CodeQL, pr-title, build-validate).
2. Locally break `server.json` (bump `version`) → `node scripts/validate-server-json.mjs` exits non-zero with a clear `::error::`.
3. Restore; confirm exit 0.

## Performance Considerations
- SHA pins have zero runtime cost. The validator adds one ~10s-bounded network fetch in the build job (already a multi-minute job); failure is non-blocking.

## Migration Notes
- None — config/CI-only. Rollback = revert the workflow/dependabot/script changes. Pinned SHAs are functionally identical to the major tags they replace.

## References
- Research: `thoughts/shared/research/2026-06-11-ci-release-hardening.md`
- Issues: #53 (this plan), #48 (verified done — close separately), epic #55
- Existing patterns: `.github/workflows/codeql.yml` (CodeQL, #53.2 done), `.releaserc.json:13-21` (#48 assets), `ci.yml:112-121` (current inline server.json check), `scripts/build-mcpb.mjs` (script style)
