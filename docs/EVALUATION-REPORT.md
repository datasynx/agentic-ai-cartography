# Enterprise npm Evaluation Report

**Package:** `@datasynx/agentic-ai-cartography@1.1.0`
**Date:** 2026-03-06
**Evaluator:** Automated Enterprise Assessment
**Status:** Conditional Approval

---

## Executive Summary

Das Package `@datasynx/agentic-ai-cartography` ist ein AI-gestütztes Infrastructure-Discovery-Tool auf Basis des Claude Agent SDK. Die Evaluation identifiziert **keine kritischen Sicherheitslücken** (`npm audit`: 0 Vulnerabilities), aber mehrere Conditions for Approval in den Bereichen Dependency Management, CI/CD-Hardening und License Compliance.

---

## Dimension Ratings

| Dimension | Rating | Details |
|-----------|--------|---------|
| Security (npm audit) | ✅ | 0 known vulnerabilities |
| Dependency Freshness | ⚠️ | 4 outdated packages, 2 major versions behind |
| CI/CD Security Gates | ❌ | Kein `npm audit` Step in CI, kein Dependency-Bot |
| License Compliance | ⚠️ | 2x LGPL-3.0-or-later (transitive via sharp-libvips) |
| Build & Tests | ✅ | 244/244 Tests pass, Build OK, Type Check OK |
| Lockfile Hygiene | ✅ | package-lock.json vorhanden und aktuell |
| Registry Security | ⚠️ | Keine `.npmrc` mit Security-Konfiguration |
| SBOM / Supply Chain | ❌ | Kein SBOM-Generierung, keine Provenance |
| Dependency Tree Size | ✅ | 7 direkte, ~90 transitive (akzeptabel) |
| Documentation | ✅ | README, CHANGELOG, CLAUDE.md vorhanden |

---

## Critical Issues

Keine kritischen Vulnerabilities gefunden.

---

## Conditions for Approval

### C1: npm audit als CI-Gate einbinden
Die CI-Pipeline (`ci.yml`) führt **keinen** `npm audit` durch. Vulnerabilities könnten unbemerkt in Production gelangen.

### C2: Dependency Update Policy etablieren
4 Packages sind veraltet:
- `@anthropic-ai/claude-agent-sdk`: 0.2.59 → 0.2.70 (semver-kompatibel, sofort aktualisierbar)
- `@types/node`: 22.19.13 → 25.3.5 (Major-Version-Sprung, @types/node@22 noch mit Patches)
- `vitest`: 3.2.4 → 4.0.18 (Major-Version-Sprung)
- `@vitest/coverage-v8`: 3.2.4 → 4.0.18 (Major-Version-Sprung)

### C3: LGPL-Lizenz-Risiko bewerten
2 transitive Dependencies (`@img/sharp-libvips-linux-x64@1.2.4`, `@img/sharp-libvips-linuxmusl-x64@1.2.4`) stehen unter LGPL-3.0-or-later. Diese kommen via `claude-agent-sdk → sharp`. LGPL erfordert ggf. spezifische Compliance-Maßnahmen in Enterprise-Umgebungen.

### C4: Automated Dependency Updates konfigurieren
Weder Dependabot noch Renovate sind konfiguriert. Dependency-Updates erfolgen nur manuell.

---

## Next Steps

### NS1: `.npmrc` mit Security-Defaults erstellen
Kein `.npmrc` vorhanden. Best Practices: `audit=true`, `fund=false`, `engine-strict=true`.

### NS2: SBOM-Generierung für Supply-Chain-Transparenz
Keine Software Bill of Materials (SBOM) wird generiert. Für Enterprise-Compliance empfohlen (CycloneDX oder SPDX).

### NS3: Semver-kompatible Dependencies aktualisieren
`@anthropic-ai/claude-agent-sdk` und `@types/node` (Patch) können ohne Breaking Changes aktualisiert werden.

### NS4: Major-Version-Upgrades evaluieren (vitest 3→4)
vitest 4.x ist ein Major-Upgrade. Migration Guide prüfen, Breaking Changes identifizieren.

### NS5: postinstall-Script modernisieren
Das `postinstall`-Script nutzt `require()` in einem ESM-Package. Funktioniert, ist aber inkonsistent.

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

Transitive Dependencies: ~90 Packages
Lizenzen: MIT (169), ISC (17), Apache-2.0 (8), BSD-3-Clause (7), LGPL-3.0-or-later (2)
