# Task Specification — Enterprise npm Evaluation Report

**Abgeleitet aus:** [EVALUATION-REPORT.md](./EVALUATION-REPORT.md)
**Erstellt:** 2026-03-06
**Product Owner:** Enterprise Platform Team
**Sprint-Ready:** Ja — alle Tasks sind eigenständig umsetzbar

---

## TASK-01: npm audit als Pflicht-Gate in CI-Pipeline einbinden

| Feld | Inhalt |
|------|--------|
| **Typ** | Blocker |
| **Priorität** | P0 – Kritisch |
| **Komponente** | CI/CD, Security |
| **Aufwand** | S |
| **Abhängigkeiten** | Keine |

### User Story

Als **Security Engineer** möchte ich, dass die CI-Pipeline bei bekannten npm-Vulnerabilities (High/Critical) automatisch fehlschlägt, damit keine verwundbaren Dependencies in Production gelangen.

### Hintergrund

Report-Abschnitt: **C1 — npm audit als CI-Gate einbinden** + **Dimension CI/CD Security Gates (❌)**. Die aktuelle `ci.yml` führt `npm ci`, `lint`, `test` und `build` aus, enthält jedoch keinen `npm audit`-Step. Vulnerabilities werden aktuell nicht automatisch erkannt.

### Akzeptanzkriterien

- [ ] `.github/workflows/ci.yml` enthält einen Step `npm audit --audit-level=high`, der **vor** dem Build-Step ausgeführt wird
- [ ] Der CI-Job bricht ab (Exit Code ≠ 0), wenn Vulnerabilities mit Severity `high` oder `critical` gefunden werden
- [ ] Vulnerabilities mit Severity `low` oder `moderate` brechen den Build **nicht** ab
- [ ] Der Step ist in der Node.js-Matrix (20, 22) eingebunden und läuft auf allen Matrix-Varianten

### Technische Hinweise

In `.github/workflows/ci.yml` nach dem Step `Install dependencies` einfügen:

```yaml
- name: Security audit
  run: npm audit --audit-level=high
```

`npm audit` nutzt die lokale `package-lock.json` und benötigt keinen Netzwerkzugriff über npm hinaus. `--audit-level=high` ignoriert Low/Moderate und bricht nur bei High/Critical ab.

### Definition of Done

- [ ] Code reviewed & gemergt
- [ ] CI-Pipeline läuft grün (da aktuell 0 Vulnerabilities)
- [ ] Verifikation: Manuell eine verwundbare Dependency simuliert → Build bricht ab

---

## TASK-02: Dependabot für automatische Dependency-Updates konfigurieren

| Feld | Inhalt |
|------|--------|
| **Typ** | Required |
| **Priorität** | P0 – Kritisch |
| **Komponente** | CI/CD, Security |
| **Aufwand** | S |
| **Abhängigkeiten** | Keine |

### User Story

Als **DevOps Engineer** möchte ich, dass Dependency-Updates automatisch als Pull Requests vorgeschlagen werden, damit Sicherheitspatches zeitnah eingespielt werden und keine manuelle Überwachung nötig ist.

### Hintergrund

Report-Abschnitt: **C4 — Automated Dependency Updates konfigurieren**. Weder Dependabot noch Renovate sind konfiguriert. Aktuell 4 veraltete Packages, Updates erfolgen rein manuell.

### Akzeptanzkriterien

- [ ] Datei `.github/dependabot.yml` existiert im Repository
- [ ] Ecosystem `npm` ist konfiguriert mit `directory: "/"`
- [ ] Update-Frequenz ist auf `weekly` gesetzt
- [ ] PR-Limit ist auf maximal 5 offene PRs konfiguriert
- [ ] Security-Updates sind aktiviert (default bei Dependabot)
- [ ] Target-Branch ist `main`

### Technische Hinweise

Datei `.github/dependabot.yml` erstellen:

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

Optional: `groups` nutzen, um Dev-Dependencies (vitest, tsup, tsx, typescript) in einem PR zu bündeln.

### Definition of Done

- [ ] Code reviewed & gemergt
- [ ] Dependabot erstellt innerhalb einer Woche die ersten PRs für veraltete Dependencies
- [ ] Konfiguration validiert (YAML-Syntax korrekt, GitHub erkennt die Datei)

---

## TASK-03: Semver-kompatible Dependencies aktualisieren

| Feld | Inhalt |
|------|--------|
| **Typ** | Chore |
| **Priorität** | P1 – Hoch |
| **Komponente** | Security, Dependencies |
| **Aufwand** | S |
| **Abhängigkeiten** | Keine |

### User Story

Als **Entwickler** möchte ich, dass alle semver-kompatiblen Dependency-Updates eingespielt werden, damit bekannte Bugfixes und Verbesserungen genutzt werden und die technische Schuld nicht wächst.

### Hintergrund

Report-Abschnitt: **NS3 — Semver-kompatible Dependencies aktualisieren** + **C2 — Dependency Update Policy**. Zwei Packages haben semver-kompatible Updates:
- `@anthropic-ai/claude-agent-sdk`: 0.2.59 → 0.2.70 (Minor/Patch innerhalb `^0.2.59`)
- `@types/node`: 22.19.13 → 22.19.15 (Patch innerhalb `^22.10.0`)

### Akzeptanzkriterien

- [ ] `npm outdated` zeigt für `@anthropic-ai/claude-agent-sdk` und `@types/node` keine semver-kompatiblen Updates mehr an
- [ ] `package-lock.json` ist aktualisiert und committet
- [ ] Alle 244 Tests bestehen nach dem Update (`npm test`)
- [ ] Build ist erfolgreich (`npm run build`)
- [ ] Type-Check ist erfolgreich (`npm run lint`)

### Technische Hinweise

```bash
npm update @anthropic-ai/claude-agent-sdk @types/node
npm test
npm run lint
npm run build
```

`npm update` aktualisiert nur innerhalb der semver-Range aus `package.json`. Kein manuelles Editieren der `package.json` nötig.

### Definition of Done

- [ ] Code reviewed & gemergt
- [ ] CI-Pipeline grün
- [ ] `package-lock.json` Diff reviewed (nur erwartete Versionsänderungen)

---

## TASK-04: .npmrc mit Security-Defaults erstellen

| Feld | Inhalt |
|------|--------|
| **Typ** | Chore |
| **Priorität** | P1 – Hoch |
| **Komponente** | Security, Registry |
| **Aufwand** | S |
| **Abhängigkeiten** | Keine |

### User Story

Als **Security Engineer** möchte ich, dass npm-Security-Defaults projektweit erzwungen werden, damit `npm install` automatisch Audits durchführt und die Engine-Constraints eingehalten werden.

### Hintergrund

Report-Abschnitt: **NS1 — .npmrc mit Security-Defaults erstellen** + **Dimension Registry Security (⚠️)**. Kein `.npmrc` vorhanden. Best Practices fehlen: Audit-on-Install, Engine-Strict-Mode, Fund-Disable.

### Akzeptanzkriterien

- [ ] Datei `.npmrc` existiert im Repository-Root
- [ ] `audit=true` ist gesetzt (automatischer Audit bei `npm install`)
- [ ] `engine-strict=true` ist gesetzt (Installation bricht ab, wenn Node-Version nicht `>=20.0.0` erfüllt)
- [ ] `fund=false` ist gesetzt (unterdrückt Funding-Messages im CI)
- [ ] `.npmrc` ist in Git committed (nicht in `.gitignore`)

### Technische Hinweise

Datei `.npmrc` im Repository-Root erstellen:

```ini
audit=true
engine-strict=true
fund=false
save-exact=false
```

`engine-strict=true` nutzt das `engines`-Feld aus `package.json` (`>=20.0.0`). Bei Node < 20 bricht `npm install` ab.

### Definition of Done

- [ ] Code reviewed & gemergt
- [ ] `npm install` auf Node 18 bricht ab (Engine-Strict-Verifikation)
- [ ] `npm install` auf Node 20/22 funktioniert weiterhin

---

## TASK-05: LGPL-Lizenz-Compliance für transitive Dependencies bewerten

| Feld | Inhalt |
|------|--------|
| **Typ** | Spike |
| **Priorität** | P1 – Hoch |
| **Komponente** | Compliance, Legal |
| **Aufwand** | M |
| **Abhängigkeiten** | Keine |

### User Story

Als **Compliance Officer** möchte ich eine dokumentierte Bewertung der LGPL-3.0-lizenzierten transitiven Dependencies, damit das Unternehmen informierte Entscheidungen über den Einsatz des Packages treffen kann.

### Hintergrund

Report-Abschnitt: **C3 — LGPL-Lizenz-Risiko bewerten** + **Dimension License Compliance (⚠️)**. Zwei transitive Dependencies (`@img/sharp-libvips-linux-x64@1.2.4`, `@img/sharp-libvips-linuxmusl-x64@1.2.4`) stehen unter LGPL-3.0-or-later. Abhängigkeitskette: `claude-agent-sdk → sharp → sharp-libvips`. LGPL erfordert ggf. spezifische Compliance-Maßnahmen (z.B. dynamisches Linking, Re-Linking-Möglichkeit).

### Akzeptanzkriterien

- [ ] Dokumentation erstellt, die klärt: Wie wird `sharp-libvips` gelinkt (statisch vs. dynamisch)?
- [ ] Risikobewertung: Gilt die LGPL-Pflicht für unser Vertriebsmodell (SaaS / CLI-Tool / Library)?
- [ ] Entscheidung dokumentiert: Akzeptieren / Mitigieren / Alternative suchen
- [ ] Falls Mitigation nötig: Follow-up-Task erstellt
- [ ] Dokument im `docs/` Verzeichnis abgelegt

### Technische Hinweise

- `sharp-libvips` ist ein Prebuilt-Binary (native Addon). LGPL-3.0 erlaubt dynamisches Linking ohne Copyleft-Auswirkung auf den Rest der Anwendung.
- Da `sharp` als optionale Dependency von `claude-agent-sdk` geladen wird und die Prebuilt-Binaries als separate npm Packages installiert werden, ist das Risiko typischerweise gering.
- Prüfung mit Legal/Compliance-Team abstimmen.
- Relevante Ressource: LGPL-3.0 FAQ, sharp-libvips Lizenzierung auf GitHub.

### Definition of Done

- [ ] Compliance-Bewertung reviewed und abgenommen (Legal + Engineering)
- [ ] Entscheidung im `docs/LICENSE-COMPLIANCE.md` dokumentiert
- [ ] Ggf. Follow-up-Tasks angelegt

---

## TASK-06: SBOM-Generierung in CI-Pipeline integrieren

| Feld | Inhalt |
|------|--------|
| **Typ** | Feature |
| **Priorität** | P2 – Mittel |
| **Komponente** | CI/CD, Compliance |
| **Aufwand** | M |
| **Abhängigkeiten** | TASK-01 |

### User Story

Als **Security Engineer** möchte ich, dass bei jedem CI-Build automatisch eine Software Bill of Materials (SBOM) generiert wird, damit die Supply-Chain-Transparenz gewährleistet ist und Enterprise-Compliance-Anforderungen erfüllt werden.

### Hintergrund

Report-Abschnitt: **NS2 — SBOM-Generierung für Supply-Chain-Transparenz** + **Dimension SBOM / Supply Chain (❌)**. Keine SBOM wird aktuell generiert. Für Enterprise-Deployments zunehmend gefordert (EO 14028, EU CRA).

### Akzeptanzkriterien

- [ ] CI-Pipeline generiert bei jedem Build eine SBOM im CycloneDX-Format (JSON)
- [ ] SBOM-Datei wird als CI-Artifact hochgeladen und ist downloadbar
- [ ] SBOM enthält alle Production-Dependencies mit Versionen und Lizenzen
- [ ] SBOM-Generierung bricht den Build **nicht** ab (informativ, nicht blockierend)

### Technische Hinweise

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

CycloneDX ist der Enterprise-Standard für npm-SBOMs. SPDX ist eine Alternative.

### Definition of Done

- [ ] Code reviewed & gemergt
- [ ] CI-Pipeline generiert SBOM-Artifact bei jedem Build
- [ ] SBOM-Datei validiert (z.B. via `cyclonedx-cli validate`)
- [ ] Dokumentation in README unter "CI/CD" aktualisiert

---

## TASK-07: vitest 3.x → 4.x Major-Upgrade evaluieren

| Feld | Inhalt |
|------|--------|
| **Typ** | Spike |
| **Priorität** | P2 – Mittel |
| **Komponente** | Testing, Dependencies |
| **Aufwand** | M |
| **Abhängigkeiten** | TASK-03 |

### User Story

Als **Entwickler** möchte ich wissen, ob ein Upgrade von vitest 3.x auf 4.x mit unserem Projekt kompatibel ist, damit wir von Bugfixes und Performance-Verbesserungen profitieren und nicht auf einem veralteten Major-Release verbleiben.

### Hintergrund

Report-Abschnitt: **NS4 — Major-Version-Upgrades evaluieren (vitest 3→4)** + **C2 — Dependency Update Policy**. `vitest` und `@vitest/coverage-v8` sind bei 3.2.4, aktuell ist 4.0.18. Major-Upgrade erfordert Breaking-Changes-Analyse.

### Akzeptanzkriterien

- [ ] vitest 4.x Migration Guide gelesen und dokumentiert
- [ ] Liste der Breaking Changes erstellt, die unser Projekt betreffen
- [ ] Testlauf mit vitest 4.x durchgeführt (Feature-Branch)
- [ ] Ergebnis dokumentiert: Upgrade möglich (ja/nein) + geschätzter Aufwand
- [ ] Falls ja: Implementierungs-Task mit konkretem Scope erstellt

### Technische Hinweise

```bash
# In Feature-Branch testen:
npm install vitest@4 @vitest/coverage-v8@4 --save-dev
npm test
npm run test:coverage
```

- vitest-Changelog und Migration Guide unter https://vitest.dev prüfen
- `vitest.config.ts` auf deprecated/entfernte Optionen prüfen
- Coverage-Provider-Kompatibilität verifizieren (V8)
- 244 Tests müssen weiterhin bestehen

### Definition of Done

- [ ] Spike-Ergebnis dokumentiert in `docs/SPIKE-VITEST-4.md`
- [ ] Entscheidung getroffen: Upgrade durchführen / Backlog / Warten
- [ ] Ggf. Follow-up-Task angelegt

---

## TASK-08: postinstall-Script auf ESM-Syntax modernisieren

| Feld | Inhalt |
|------|--------|
| **Typ** | Chore |
| **Priorität** | P3 – Niedrig |
| **Komponente** | Packaging |
| **Aufwand** | S |
| **Abhängigkeiten** | Keine |

### User Story

Als **Entwickler** möchte ich, dass das postinstall-Script konsistent mit dem ESM-Modulformat des Packages ist, damit keine Verwirrung durch gemischte CJS/ESM-Syntax entsteht und zukünftige Node.js-Versionen keine Deprecation-Warnings erzeugen.

### Hintergrund

Report-Abschnitt: **NS5 — postinstall-Script modernisieren**. Das aktuelle Script nutzt `require('child_process')` in einem `"type": "module"` Package. Das funktioniert, weil `node -e` einen eigenen CJS-Kontext erzeugt, ist aber inkonsistent.

### Akzeptanzkriterien

- [ ] postinstall-Script nutzt ESM-kompatible Syntax oder `node --input-type=module`
- [ ] Script funktioniert auf Node 20 und 22
- [ ] Script prüft weiterhin die Verfügbarkeit des `claude` CLI
- [ ] `npm install` in einem sauberen Verzeichnis gibt die Warnung aus, wenn Claude CLI fehlt

### Technische Hinweise

Option A — `node --input-type=module -e`:
```json
"postinstall": "node --input-type=module -e \"import{execSync}from'child_process';try{execSync('claude --version',{stdio:'pipe'})}catch{console.warn('\\n⚠ datasynx-cartography requires Claude CLI: npm i -g @anthropic-ai/claude-code\\n')}\""
```

Option B — Separates Script-File `scripts/postinstall.mjs`:
```js
import { execSync } from 'child_process';
try { execSync('claude --version', { stdio: 'pipe' }); }
catch { console.warn('\n⚠ datasynx-cartography requires Claude CLI: npm i -g @anthropic-ai/claude-code\n'); }
```

Option B ist lesbarer und einfacher zu warten. Die Datei muss in `"files"` in `package.json` aufgenommen werden.

### Definition of Done

- [ ] Code reviewed & gemergt
- [ ] Tests bestehen (`npm test`)
- [ ] Manuell verifiziert: `npm install` gibt korrekte Warnung aus

---

## Umsetzungs-Roadmap

### Phase 0 — Blocker & Pflichtbedingungen (vor Go-Live)

Ohne diese Tasks ist kein Enterprise-Approval möglich.

```
├── TASK-01: npm audit als CI-Gate
└── TASK-02: Dependabot konfigurieren
```

### Phase 1 — Stabilisierung & Qualitätssicherung

Sofort umsetzbare Verbesserungen mit geringem Risiko.

```
├── TASK-03: Semver-kompatible Dependencies aktualisieren
├── TASK-04: .npmrc Security-Defaults
└── TASK-05: LGPL-Compliance-Bewertung (Spike)
```

### Phase 2 — Integration & Optimierung

Erfordert Ergebnisse aus Phase 1 bzw. Phase 0.

```
├── TASK-06: SBOM-Generierung (abhängig von TASK-01)
└── TASK-07: vitest 4.x Upgrade-Spike (abhängig von TASK-03)
```

### Phase 3 — Langfristige Maßnahmen (Backlog)

Nice-to-have, kein Blocker für Enterprise-Betrieb.

```
└── TASK-08: postinstall ESM-Modernisierung
```

---

## Aufwands-Übersicht

| Task | Titel | Typ | Priorität | Aufwand | Phase |
|------|-------|-----|-----------|---------|-------|
| TASK-01 | npm audit CI-Gate | Blocker | P0 | S | 0 |
| TASK-02 | Dependabot konfigurieren | Required | P0 | S | 0 |
| TASK-03 | Semver-Updates einspielen | Chore | P1 | S | 1 |
| TASK-04 | .npmrc Security-Defaults | Chore | P1 | S | 1 |
| TASK-05 | LGPL-Compliance-Spike | Spike | P1 | M | 1 |
| TASK-06 | SBOM-Generierung | Feature | P2 | M | 2 |
| TASK-07 | vitest 4.x Spike | Spike | P2 | M | 2 |
| TASK-08 | postinstall ESM | Chore | P3 | S | 3 |
| | | | | **Gesamt** | **5S + 3M ≈ 18 SP** |

*Schätzung: S = 2 SP, M = 5 SP*

---

## Hinweise für das Dev-Team

- **Phase 0** ist Sprint-Pflicht — ohne TASK-01 und TASK-02 kein Merge in Main.
- **TASK-05** (LGPL-Spike) erfordert Abstimmung mit Legal — frühzeitig anstoßen.
- **TASK-03** ist risikoarm und kann als Warmup-Task zugewiesen werden.
- Alle Tasks sind atomar und können parallel bearbeitet werden (sofern keine Abhängigkeit besteht).
- Nach Abschluss von Phase 0+1: Enterprise-Approval erneut beantragen.
