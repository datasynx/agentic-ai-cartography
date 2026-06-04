# Task Specification — Enterprise npm Evaluation Report

**Derived from:** [EVALUATION-REPORT.md](./EVALUATION-REPORT.md)
**Created:** 2026-03-06
**Product Owner:** Enterprise Platform Team
**Sprint-Ready:** Yes — all tasks are independently implementable

---

## TASK-01: Add npm audit as a mandatory gate in the CI pipeline

| Field | Content |
|------|--------|
| **Type** | Blocker |
| **Priority** | P0 – Critical |
| **Component** | CI/CD, Security |
| **Effort** | S |
| **Dependencies** | None |

### User Story

As a **Security Engineer**, I want the CI pipeline to fail automatically on known npm vulnerabilities (High/Critical), so that no vulnerable dependencies reach production.

### Background

Report section: **C1 — Add npm audit as a CI gate** + **CI/CD Security Gates dimension (❌)**. The current `ci.yml` runs `npm ci`, `lint`, `test`, and `build`, but does not contain an `npm audit` step. Vulnerabilities are currently not detected automatically.

### Acceptance Criteria

- [ ] `.github/workflows/ci.yml` contains a step `npm audit --audit-level=high` that runs **before** the build step
- [ ] The CI job aborts (exit code ≠ 0) when vulnerabilities with severity `high` or `critical` are found
- [ ] Vulnerabilities with severity `low` or `moderate` do **not** abort the build
- [ ] The step is integrated into the Node.js matrix (20, 22) and runs on all matrix variants

### Technical Notes

In `.github/workflows/ci.yml`, insert after the `Install dependencies` step:

```yaml
- name: Security audit
  run: npm audit --audit-level=high
```

`npm audit` uses the local `package-lock.json` and requires no network access beyond npm. `--audit-level=high` ignores Low/Moderate and aborts only on High/Critical.

### Definition of Done

- [ ] Code reviewed & merged
- [ ] CI pipeline runs green (since there are currently 0 vulnerabilities)
- [ ] Verification: Manually simulate a vulnerable dependency → build aborts

---

## TASK-02: Configure Dependabot for automatic dependency updates

| Field | Content |
|------|--------|
| **Type** | Required |
| **Priority** | P0 – Critical |
| **Component** | CI/CD, Security |
| **Effort** | S |
| **Dependencies** | None |

### User Story

As a **DevOps Engineer**, I want dependency updates to be proposed automatically as pull requests, so that security patches are applied promptly and no manual monitoring is required.

### Background

Report section: **C4 — Configure automated dependency updates**. Neither Dependabot nor Renovate is configured. There are currently 4 outdated packages, and updates are done purely manually.

### Acceptance Criteria

- [ ] File `.github/dependabot.yml` exists in the repository
- [ ] Ecosystem `npm` is configured with `directory: "/"`
- [ ] Update frequency is set to `weekly`
- [ ] PR limit is configured to a maximum of 5 open PRs
- [ ] Security updates are enabled (default in Dependabot)
- [ ] Target branch is `main`

### Technical Notes

Create file `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
    reviewers: []
    labels:
      - "dependencies"
```

Optional: Use `groups` to bundle dev dependencies (vitest, tsup, tsx, typescript) into a single PR.

### Definition of Done

- [ ] Code reviewed & merged
- [ ] Dependabot creates the first PRs for outdated dependencies within a week
- [ ] Configuration validated (YAML syntax correct, GitHub recognizes the file)

---

## TASK-03: Update semver-compatible dependencies

| Field | Content |
|------|--------|
| **Type** | Chore |
| **Priority** | P1 – High |
| **Component** | Security, Dependencies |
| **Effort** | S |
| **Dependencies** | None |

### User Story

As a **developer**, I want all semver-compatible dependency updates to be applied, so that known bug fixes and improvements are used and technical debt does not grow.

### Background

Report section: **NS3 — Update semver-compatible dependencies** + **C2 — Dependency Update Policy**. Two packages have semver-compatible updates:
- `@anthropic-ai/claude-agent-sdk`: 0.2.59 → 0.2.70 (Minor/Patch within `^0.2.59`)
- `@types/node`: 22.19.13 → 22.19.15 (Patch within `^22.10.0`)

### Acceptance Criteria

- [ ] `npm outdated` no longer shows semver-compatible updates for `@anthropic-ai/claude-agent-sdk` and `@types/node`
- [ ] `package-lock.json` is updated and committed
- [ ] All 244 tests pass after the update (`npm test`)
- [ ] Build is successful (`npm run build`)
- [ ] Type check is successful (`npm run lint`)

### Technical Notes

```bash
npm update @anthropic-ai/claude-agent-sdk @types/node
npm test
npm run lint
npm run build
```

`npm update` updates only within the semver range from `package.json`. No manual editing of `package.json` is required.

### Definition of Done

- [ ] Code reviewed & merged
- [ ] CI pipeline green
- [ ] `package-lock.json` diff reviewed (only expected version changes)

---

## TASK-04: Create .npmrc with security defaults

| Field | Content |
|------|--------|
| **Type** | Chore |
| **Priority** | P1 – High |
| **Component** | Security, Registry |
| **Effort** | S |
| **Dependencies** | None |

### User Story

As a **Security Engineer**, I want npm security defaults to be enforced project-wide, so that `npm install` automatically performs audits and engine constraints are respected.

### Background

Report section: **NS1 — Create .npmrc with security defaults** + **Registry Security dimension (⚠️)**. No `.npmrc` is present. Best practices are missing: audit-on-install, engine-strict mode, fund-disable.

### Acceptance Criteria

- [ ] File `.npmrc` exists in the repository root
- [ ] `audit=true` is set (automatic audit on `npm install`)
- [ ] `engine-strict=true` is set (installation aborts when the Node version does not satisfy `>=20.0.0`)
- [ ] `fund=false` is set (suppresses funding messages in CI)
- [ ] `.npmrc` is committed to Git (not in `.gitignore`)

### Technical Notes

Create file `.npmrc` in the repository root:

```ini
audit=true
engine-strict=true
fund=false
save-exact=false
```

`engine-strict=true` uses the `engines` field from `package.json` (`>=20.0.0`). On Node < 20, `npm install` aborts.

### Definition of Done

- [ ] Code reviewed & merged
- [ ] `npm install` on Node 18 aborts (engine-strict verification)
- [ ] `npm install` on Node 20/22 continues to work

---

## TASK-05: Assess LGPL license compliance for transitive dependencies

| Field | Content |
|------|--------|
| **Type** | Spike |
| **Priority** | P1 – High |
| **Component** | Compliance, Legal |
| **Effort** | M |
| **Dependencies** | None |

### User Story

As a **Compliance Officer**, I want a documented assessment of the LGPL-3.0-licensed transitive dependencies, so that the company can make informed decisions about using the package.

### Background

Report section: **C3 — Assess LGPL license risk** + **License Compliance dimension (⚠️)**. Two transitive dependencies (`@img/sharp-libvips-linux-x64@1.2.4`, `@img/sharp-libvips-linuxmusl-x64@1.2.4`) are licensed under LGPL-3.0-or-later. Dependency chain: `claude-agent-sdk → sharp → sharp-libvips`. LGPL may require specific compliance measures (e.g., dynamic linking, re-linking capability).

### Acceptance Criteria

- [ ] Documentation created that clarifies: How is `sharp-libvips` linked (static vs. dynamic)?
- [ ] Risk assessment: Does the LGPL obligation apply to our distribution model (SaaS / CLI tool / library)?
- [ ] Decision documented: Accept / Mitigate / Seek alternative
- [ ] If mitigation is required: follow-up task created
- [ ] Document placed in the `docs/` directory

### Technical Notes

- `sharp-libvips` is a prebuilt binary (native addon). LGPL-3.0 permits dynamic linking without copyleft effects on the rest of the application.
- Since `sharp` is loaded as an optional dependency of `claude-agent-sdk` and the prebuilt binaries are installed as separate npm packages, the risk is typically low.
- Coordinate the review with the Legal/Compliance team.
- Relevant resource: LGPL-3.0 FAQ, sharp-libvips licensing on GitHub.

### Definition of Done

- [ ] Compliance assessment reviewed and approved (Legal + Engineering)
- [ ] Decision documented in `docs/LICENSE-COMPLIANCE.md`
- [ ] Follow-up tasks created if needed

---

## TASK-06: Integrate SBOM generation into the CI pipeline

| Field | Content |
|------|--------|
| **Type** | Feature |
| **Priority** | P2 – Medium |
| **Component** | CI/CD, Compliance |
| **Effort** | M |
| **Dependencies** | TASK-01 |

### User Story

As a **Security Engineer**, I want a Software Bill of Materials (SBOM) to be generated automatically on every CI build, so that supply chain transparency is ensured and enterprise compliance requirements are met.

### Background

Report section: **NS2 — SBOM generation for supply chain transparency** + **SBOM / Supply Chain dimension (❌)**. No SBOM is currently generated. It is increasingly required for enterprise deployments (EO 14028, EU CRA).

### Acceptance Criteria

- [ ] CI pipeline generates an SBOM in CycloneDX format (JSON) on every build
- [ ] The SBOM file is uploaded as a CI artifact and is downloadable
- [ ] The SBOM contains all production dependencies with versions and licenses
- [ ] SBOM generation does **not** abort the build (informative, non-blocking)

### Technical Notes

Option A — `@cyclonedx/cyclonedx-npm`:
```bash
npx @cyclonedx/cyclonedx-npm --output-file sbom.json --spec-version 1.5
```

Option B — GitHub Actions SBOM Action:
```yaml
- name: Generate SBOM
  uses: anchore/sbom-action@v0
  with:
    artifact-name: sbom.cyclonedx.json
    format: cyclonedx-json
```

CycloneDX is the enterprise standard for npm SBOMs. SPDX is an alternative.

### Definition of Done

- [ ] Code reviewed & merged
- [ ] CI pipeline generates an SBOM artifact on every build
- [ ] SBOM file validated (e.g., via `cyclonedx-cli validate`)
- [ ] Documentation in README under "CI/CD" updated

---

## TASK-07: Evaluate the vitest 3.x → 4.x major upgrade

| Field | Content |
|------|--------|
| **Type** | Spike |
| **Priority** | P2 – Medium |
| **Component** | Testing, Dependencies |
| **Effort** | M |
| **Dependencies** | TASK-03 |

### User Story

As a **developer**, I want to know whether an upgrade from vitest 3.x to 4.x is compatible with our project, so that we benefit from bug fixes and performance improvements and do not remain on an outdated major release.

### Background

Report section: **NS4 — Evaluate major version upgrades (vitest 3→4)** + **C2 — Dependency Update Policy**. `vitest` and `@vitest/coverage-v8` are at 3.2.4; the current version is 4.0.18. A major upgrade requires a breaking-changes analysis.

### Acceptance Criteria

- [ ] vitest 4.x migration guide read and documented
- [ ] List of breaking changes that affect our project created
- [ ] Test run with vitest 4.x performed (feature branch)
- [ ] Result documented: upgrade possible (yes/no) + estimated effort
- [ ] If yes: implementation task with a concrete scope created

### Technical Notes

```bash
# Test in a feature branch:
npm install vitest@4 @vitest/coverage-v8@4 --save-dev
npm test
npm run test:coverage
```

- Check the vitest changelog and migration guide at https://vitest.dev
- Check `vitest.config.ts` for deprecated/removed options
- Verify coverage provider compatibility (V8)
- 244 tests must continue to pass

### Definition of Done

- [ ] Spike result documented in `docs/SPIKE-VITEST-4.md`
- [ ] Decision made: perform upgrade / backlog / wait
- [ ] Follow-up task created if needed

---

## TASK-08: Modernize the postinstall script to ESM syntax

| Field | Content |
|------|--------|
| **Type** | Chore |
| **Priority** | P3 – Low |
| **Component** | Packaging |
| **Effort** | S |
| **Dependencies** | None |

### User Story

As a **developer**, I want the postinstall script to be consistent with the package's ESM module format, so that there is no confusion from mixed CJS/ESM syntax and future Node.js versions do not produce deprecation warnings.

### Background

Report section: **NS5 — Modernize the postinstall script**. The current script uses `require('child_process')` in a `"type": "module"` package. This works because `node -e` creates its own CJS context, but it is inconsistent.

### Acceptance Criteria

- [ ] postinstall script uses ESM-compatible syntax or `node --input-type=module`
- [ ] Script works on Node 20 and 22
- [ ] Script continues to check the availability of the `claude` CLI
- [ ] `npm install` in a clean directory prints the warning when the Claude CLI is missing

### Technical Notes

Option A — `node --input-type=module -e`:
```json
"postinstall": "node --input-type=module -e \"import{execSync}from'child_process';try{execSync('claude --version',{stdio:'pipe'})}catch{console.warn('\\n⚠ datasynx-cartography requires Claude CLI: npm i -g @anthropic-ai/claude-code\\n')}\""
```

Option B — Separate script file `scripts/postinstall.mjs`:
```js
import { execSync } from 'child_process';
try { execSync('claude --version', { stdio: 'pipe' }); }
catch { console.warn('\n⚠ datasynx-cartography requires Claude CLI: npm i -g @anthropic-ai/claude-code\n'); }
```

Option B is more readable and easier to maintain. The file must be added to `"files"` in `package.json`.

### Definition of Done

- [ ] Code reviewed & merged
- [ ] Tests pass (`npm test`)
- [ ] Manually verified: `npm install` prints the correct warning

---

## Implementation Roadmap

### Phase 0 — Blockers & mandatory conditions (before go-live)

Without these tasks, no enterprise approval is possible.

```
├── TASK-01: npm audit as CI gate
└── TASK-02: Configure Dependabot
```

### Phase 1 — Stabilization & quality assurance

Immediately implementable improvements with low risk.

```
├── TASK-03: Update semver-compatible dependencies
├── TASK-04: .npmrc security defaults
└── TASK-05: LGPL compliance assessment (Spike)
```

### Phase 2 — Integration & optimization

Requires results from Phase 1 or Phase 0.

```
├── TASK-06: SBOM generation (depends on TASK-01)
└── TASK-07: vitest 4.x upgrade spike (depends on TASK-03)
```

### Phase 3 — Long-term measures (backlog)

Nice-to-have, not a blocker for enterprise operation.

```
└── TASK-08: postinstall ESM modernization
```

---

## Effort Overview

| Task | Title | Type | Priority | Effort | Phase |
|------|-------|-----|-----------|---------|-------|
| TASK-01 | npm audit CI gate | Blocker | P0 | S | 0 |
| TASK-02 | Configure Dependabot | Required | P0 | S | 0 |
| TASK-03 | Apply semver updates | Chore | P1 | S | 1 |
| TASK-04 | .npmrc security defaults | Chore | P1 | S | 1 |
| TASK-05 | LGPL compliance spike | Spike | P1 | M | 1 |
| TASK-06 | SBOM generation | Feature | P2 | M | 2 |
| TASK-07 | vitest 4.x spike | Spike | P2 | M | 2 |
| TASK-08 | postinstall ESM | Chore | P3 | S | 3 |
| | | | | **Total** | **5S + 3M ≈ 18 SP** |

*Estimate: S = 2 SP, M = 5 SP*

---

## Notes for the Dev Team

- **Phase 0** is sprint-mandatory — without TASK-01 and TASK-02, no merge into main.
- **TASK-05** (LGPL spike) requires coordination with Legal — kick it off early.
- **TASK-03** is low risk and can be assigned as a warmup task.
- All tasks are atomic and can be worked on in parallel (provided there is no dependency).
- After completing Phase 0+1: re-request enterprise approval.
