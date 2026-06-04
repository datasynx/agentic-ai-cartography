# Legal Sign-off: LGPL-3.0 License Review

**Package:** `@datasynx/agentic-ai-cartography@1.1.0`
**Date:** 2026-03-06
**Reviewer:** Legal & Compliance Review, Open Source Program Office
**Reference Document:** `docs/LICENSE-COMPLIANCE.md`

---

## Decision

> **✅ APPROVED** — subject to two minor conditions

**Rationale (Executive Summary)**

The LGPL-3.0-licensed components (`@img/sharp-libvips-*`) are integrated exclusively as dynamically loaded, precompiled shared libraries via the Node.js N-API interface. They are transitive dependencies of a third-party SDK (Anthropic), are not bundled into our own build output, and remain as separate npm packages in `node_modules/`. With this integration method, the LGPL-3.0 Library Exception applies — no copyleft attaches to our own source code. The two conditions (license notice, third-party file) are standard compliance measures requiring minimal effort.

---

## Risk Assessment

### 1. Linking Analysis

| Checkpoint | Finding | Risk |
|-----------|--------|--------|
| **Linking method** | Dynamic — `sharp-libvips` is loaded at runtime as a `.so` shared library via N-API. No static linking, no embedding into our own build output (`dist/`). | ✅ No risk |
| **Copyleft trigger** | LGPL-3.0 Section 4 (Combined Works) explicitly permits the use of the library via dynamic linking without requiring the consuming program to be placed under LGPL/GPL. The so-called "Library Exception" of the LGPL (the distinction from the GPL) applies in full here. | ✅ No risk |
| **Own source code affected** | No. Our own code (MIT-licensed) does not interact directly with `sharp-libvips`. The interaction takes place across two layers of abstraction: own code → `claude-agent-sdk` → `sharp` → `sharp-libvips`. Even with direct use, dynamic linking would be LGPL-compliant. | ✅ No risk |

### 2. Distribution & Redistribution

| Checkpoint | Finding | Risk |
|-----------|--------|--------|
| **Distribution form** | The package is published as an npm package. The LGPL binaries are **not** bundled, but installed as standalone npm packages via `node_modules/`. They are not included in the `"files"` array of `package.json` — only `dist/`, `scripts/`, `README.md`, and `LICENSE` are shipped. | ✅ No risk |
| **LGPL obligations on redistribution** | Since the LGPL components are redistributed as separate, unmodified npm packages (through npm dependency resolution, not through our packaging), no independent redistribution obligations arise for us. The obligation to provide the LGPL source code lies with the upstream (`@img/sharp-libvips`), which provides the source code on GitHub. | ✅ No risk |
| **SaaS deployment** | If the package is operated server-side in a SaaS context: the LGPL copyleft trigger requires a "distribution" (conveyance to third parties). Pure server-side operation without conveying binaries to end users does **not** trigger any LGPL obligations. The LGPL — unlike the AGPL — contains no network-use clause. | ✅ No risk |

### 3. Modifications

| Checkpoint | Finding | Risk |
|-----------|--------|--------|
| **Changes to the LGPL code** | The team plans **no** modifications to `sharp-libvips`. The packages are obtained unmodified as prebuilt binaries via npm. | ✅ No risk |
| **Disclosure obligations** | Not applicable, since no modifications take place. Hypothetically: were the team to modify `sharp-libvips` and **redistribute** the modified version, the changes would have to be disclosed under LGPL-3.0. This is a standard LGPL mechanism and is currently not relevant. | ✅ No risk |
| **Private fork** | Not planned, and not sensible given the transitive nature of the dependency. No assessment required. | ✅ No risk |

### 4. Policy Compatibility

| Checkpoint | Finding | Risk |
|-----------|--------|--------|
| **Internal OSS policy** | LGPL-3.0 with dynamic linking is classified in most enterprise OSS policies as "Category B" (permitted subject to review) or "Approved". The present use (unmodified, dynamic, transitive) falls into the lowest-risk category. | ⚠️ Conditional risk |
| **Commercial license conflicts** | MIT (our own license) is fully compatible with LGPL-3.0 under dynamic linking. All other dependencies (ISC, Apache-2.0, BSD-3-Clause, BlueOak-1.0.0) are permissive and compatible. No license conflict identified. | ✅ No risk |
| **Customer contractual restrictions** | Dependent on specific customer contracts. Standard clauses typically prohibit GPL (strong copyleft), not LGPL under dynamic linking. Recommendation: review separately for customers with explicit "No-GPL-Family" clauses. | ⚠️ Conditional risk |

**Note on ⚠️:** The conditional risk does not relate to the technical or licensing assessment (which is unambiguous), but to the fact that internal company policies and individual customer contracts may vary. The two conditions below address this.

### 5. Usage Obligations

| Checkpoint | Finding | Risk |
|-----------|--------|--------|
| **Internal use (no distribution)** | With purely internal use without conveyance to third parties, **no** LGPL obligations arise. Neither source-code disclosure nor license notices are required. | ✅ No risk |
| **License notice** | Best practice (and mandatory upon distribution): the LGPL-3.0 license text must be included when LGPL components are conveyed to third parties. Since the components are installed as separate npm packages, the `LICENSE` entry in the respective `@img/sharp-libvips-*` packages fulfills this obligation automatically. Recommendation: additionally document this in a `THIRD-PARTY-LICENSES` file. | ⚠️ Conditional risk |
| **End-user information** | No statutory obligation under dynamic linking without modification. Best practice: list in a third-party notices file. | ✅ No risk |

---

## Conditions & Obligations

Upon approval, the following two measures are to be implemented:

- [ ] **Condition 1 — Create a third-party licenses file:** Create a file `THIRD-PARTY-LICENSES` in the repository root that lists all transitive LGPL-licensed dependencies (package name, version, license, link to source code). This is standard compliance practice and provides protection in the event of distribution. Example content:

  ```
  @img/sharp-libvips-linux-x64@1.2.4
  License: LGPL-3.0-or-later
  Source: https://github.com/lovell/sharp-libvips
  ```

- [ ] **Condition 2 — Set up monitoring for dependency updates:** On updates of `@anthropic-ai/claude-agent-sdk`, check whether new LGPL- or GPL-licensed transitive dependencies are introduced. This is supported by the already-configured Dependabot (TASK-02). Recommendation: add `license-checker --production --failOn "GPL-3.0-only;GPL-2.0-only;AGPL-3.0-only"` as an optional CI check.

---

## Conditions for Rejection

Not applicable — approval is granted.

A **re-review** would be required if:
- The team begins to modify `sharp-libvips` or `sharp` (fork)
- The build configuration is changed such that LGPL binaries are bundled into `dist/` (static linking)
- A customer contract explicitly excludes any LGPL dependencies (even under dynamic linking)
- `@anthropic-ai/claude-agent-sdk` introduces additional GPL-3.0-only (not LGPL) dependencies

---

## Legal Disclaimer

This assessment applies to the integration method described (dynamic linking via N-API, unmodified prebuilt binaries as separate npm packages) and the current form of use (CLI tool and library, MIT-licensed). Changes to the integration strategy, distribution model, or modification of the LGPL components require a re-review by Legal/Compliance.

This assessment does not constitute legal advice and does not replace the consultation of a specialized open-source attorney in cases of doubt.

---

**Digital Sign-off**
Legal & Compliance Review — 2026-03-06 — REF: OSS-REVIEW-2026-0306-001

**Status:** ✅ Approved with conditions (2 measures)
