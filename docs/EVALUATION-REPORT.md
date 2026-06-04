# Enterprise npm Evaluation Report

**Package:** `@datasynx/agentic-ai-cartography@1.1.0`
**Date:** 2026-03-06
**Evaluator:** Automated Enterprise Assessment
**Status:** Conditional Approval

---

## Executive Summary

The package `@datasynx/agentic-ai-cartography` is an AI-powered infrastructure discovery tool based on the Claude Agent SDK. The evaluation identifies **no critical security vulnerabilities** (`npm audit`: 0 vulnerabilities), but several Conditions for Approval in the areas of dependency management, CI/CD hardening, and license compliance.

---

## Dimension Ratings

| Dimension | Rating | Details |
|-----------|--------|---------|
| Security (npm audit) | ✅ | 0 known vulnerabilities |
| Dependency Freshness | ⚠️ | 4 outdated packages, 2 major versions behind |
| CI/CD Security Gates | ❌ | No `npm audit` step in CI, no dependency bot |
| License Compliance | ⚠️ | 2x LGPL-3.0-or-later (transitive via sharp-libvips) |
| Build & Tests | ✅ | 244/244 tests pass, build OK, type check OK |
| Lockfile Hygiene | ✅ | package-lock.json present and up to date |
| Registry Security | ⚠️ | No `.npmrc` with security configuration |
| SBOM / Supply Chain | ❌ | No SBOM generation, no provenance |
| Dependency Tree Size | ✅ | 7 direct, ~90 transitive (acceptable) |
| Documentation | ✅ | README, CHANGELOG, CLAUDE.md present |

---

## Critical Issues

No critical vulnerabilities found.

---

## Conditions for Approval

### C1: Integrate npm audit as a CI gate
The CI pipeline (`ci.yml`) does **not** run `npm audit`. Vulnerabilities could reach production unnoticed.

### C2: Establish a dependency update policy
4 packages are outdated:
- `@anthropic-ai/claude-agent-sdk`: 0.2.59 → 0.2.70 (semver-compatible, can be updated immediately)
- `@types/node`: 22.19.13 → 25.3.5 (major version jump, @types/node@22 still receiving patches)
- `vitest`: 3.2.4 → 4.0.18 (major version jump)
- `@vitest/coverage-v8`: 3.2.4 → 4.0.18 (major version jump)

### C3: Assess LGPL license risk
2 transitive dependencies (`@img/sharp-libvips-linux-x64@1.2.4`, `@img/sharp-libvips-linuxmusl-x64@1.2.4`) are licensed under LGPL-3.0-or-later. These come in via `claude-agent-sdk → sharp`. LGPL may require specific compliance measures in enterprise environments.

### C4: Configure automated dependency updates
Neither Dependabot nor Renovate is configured. Dependency updates are performed manually only.

---

## Next Steps

### NS1: Create `.npmrc` with security defaults
No `.npmrc` present. Best practices: `audit=true`, `fund=false`, `engine-strict=true`.

### NS2: SBOM generation for supply-chain transparency
No Software Bill of Materials (SBOM) is generated. Recommended for enterprise compliance (CycloneDX or SPDX).

### NS3: Update semver-compatible dependencies
`@anthropic-ai/claude-agent-sdk` and `@types/node` (patch) can be updated without breaking changes.

### NS4: Evaluate major version upgrades (vitest 3→4)
vitest 4.x is a major upgrade. Review the migration guide and identify breaking changes.

### NS5: Modernize the postinstall script
The `postinstall` script uses `require()` in an ESM package. It works, but it is inconsistent.

---

## Test & Build Verification

```
Tests:   244/244 passed (14 files, 2.41s)
Lint:    tsc --noEmit — OK
Build:   tsup — OK (cli.js + index.js + index.d.ts)
Audit:   0 vulnerabilities
```

---

## Dependency Tree (Production)

```
@datasynx/agentic-ai-cartography@1.1.0
├── @anthropic-ai/claude-agent-sdk@0.2.59 (→ 0.2.70 available)
├── @anthropic-ai/sdk@0.78.0
├── better-sqlite3@12.6.2
├── commander@14.0.3
├── ora@9.3.0
├── picocolors@1.1.1
└── zod@4.3.6
```

Transitive dependencies: ~90 packages
Licenses: MIT (169), ISC (17), Apache-2.0 (8), BSD-3-Clause (7), LGPL-3.0-or-later (2)
