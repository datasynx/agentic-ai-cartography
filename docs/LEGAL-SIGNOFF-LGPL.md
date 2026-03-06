# Legal Sign-off: LGPL-3.0 License Review

**Package:** `@datasynx/agentic-ai-cartography@1.1.0`
**Datum:** 2026-03-06
**Reviewer:** Legal & Compliance Review, Open Source Program Office
**Referenz-Dokument:** `docs/LICENSE-COMPLIANCE.md`

---

## Entscheidung

> **✅ FREIGEGEBEN** — mit zwei geringfügigen Auflagen

**Begründung (Executive Summary)**

Die LGPL-3.0-lizenzierten Komponenten (`@img/sharp-libvips-*`) werden ausschließlich als dynamisch geladene, vorkompilierte Shared Libraries über die Node.js N-API-Schnittstelle eingebunden. Sie sind transitive Dependencies eines Drittanbieter-SDKs (Anthropic), werden nicht in den eigenen Build-Output gebündelt und verbleiben als separate npm-Pakete in `node_modules/`. Bei dieser Integrationsmethode greift die LGPL-3.0 Library Exception — es entsteht kein Copyleft auf den eigenen Quellcode. Die beiden Auflagen (Lizenzhinweis, Third-Party-Datei) sind Standard-Compliance-Maßnahmen mit minimalem Aufwand.

---

## Risiko-Bewertung

### 1. Linking-Analyse

| Prüfpunkt | Befund | Risiko |
|-----------|--------|--------|
| **Linking-Methode** | Dynamisch — `sharp-libvips` wird als `.so` Shared Library über N-API zur Laufzeit geladen. Kein statisches Linking, kein Einbetten in den eigenen Build-Output (`dist/`). | ✅ Kein Risiko |
| **Copyleft-Trigger** | Die LGPL-3.0 Section 4 (Combined Works) erlaubt explizit die Nutzung der Library über dynamisches Linking, ohne dass das nutzende Programm unter LGPL/GPL gestellt werden muss. Die sog. "Library Exception" der LGPL (Unterscheidung zu GPL) greift hier vollständig. | ✅ Kein Risiko |
| **Eigener Quellcode betroffen** | Nein. Der eigene Code (MIT-lizenziert) interagiert nicht direkt mit `sharp-libvips`. Die Interaktion erfolgt über zwei Abstraktionsebenen: eigener Code → `claude-agent-sdk` → `sharp` → `sharp-libvips`. Selbst bei direkter Nutzung wäre dynamisches Linking LGPL-konform. | ✅ Kein Risiko |

### 2. Distribution & Weitergabe

| Prüfpunkt | Befund | Risiko |
|-----------|--------|--------|
| **Distributionsform** | Das Package wird als npm-Paket publiziert. Die LGPL-Binaries werden **nicht** gebündelt, sondern als eigenständige npm-Pakete über `node_modules/` installiert. Sie sind im `"files"`-Array von `package.json` nicht enthalten — nur `dist/`, `scripts/`, `README.md` und `LICENSE` werden ausgeliefert. | ✅ Kein Risiko |
| **LGPL-Pflichten bei Weitergabe** | Da die LGPL-Komponenten als separate, unveränderte npm-Pakete weitergegeben werden (durch npm-Dependency-Resolution, nicht durch unser Packaging), entstehen keine eigenständigen Weitergabe-Pflichten für uns. Die Pflicht zur Bereitstellung des LGPL-Quelltexts liegt beim Upstream (`@img/sharp-libvips`), der den Quellcode auf GitHub bereitstellt. | ✅ Kein Risiko |
| **SaaS-Deployment** | Falls das Package serverseitig in einem SaaS-Kontext betrieben wird: Der LGPL-Copyleft-Trigger setzt eine "Distribution" (Weitergabe an Dritte) voraus. Reiner serverseitiger Betrieb ohne Weitergabe von Binaries an Endnutzer löst **keine** LGPL-Pflichten aus. Die LGPL enthält — anders als die AGPL — keine Network-Use-Klausel. | ✅ Kein Risiko |

### 3. Modifikationen

| Prüfpunkt | Befund | Risiko |
|-----------|--------|--------|
| **Änderungen am LGPL-Code** | Das Team plant **keine** Modifikationen an `sharp-libvips`. Die Pakete werden unverändert als Prebuilt-Binaries über npm bezogen. | ✅ Kein Risiko |
| **Offenlegungspflichten** | Nicht zutreffend, da keine Modifikationen stattfinden. Hypothetisch: Würde das Team `sharp-libvips` modifizieren und die modifizierte Version **weitergeben**, müssten die Änderungen unter LGPL-3.0 offengelegt werden. Dies ist ein Standard-LGPL-Mechanismus und derzeit nicht relevant. | ✅ Kein Risiko |
| **Private Fork** | Nicht geplant und aufgrund der transitiven Natur der Dependency nicht sinnvoll. Keine Bewertung erforderlich. | ✅ Kein Risiko |

### 4. Policy-Kompatibilität

| Prüfpunkt | Befund | Risiko |
|-----------|--------|--------|
| **Interne OSS-Policy** | LGPL-3.0 bei dynamischem Linking ist in den meisten Enterprise-OSS-Policies als "Category B" (erlaubt mit Prüfung) oder "Approved" eingestuft. Die vorliegende Nutzung (unmodifiziert, dynamisch, transitiv) fällt in die risikoärmste Kategorie. | ⚠️ Bedingtes Risiko |
| **Kommerzielle Lizenzkonflikte** | MIT (eigene Lizenz) ist vollständig kompatibel mit LGPL-3.0 bei dynamischem Linking. Alle weiteren Dependencies (ISC, Apache-2.0, BSD-3-Clause, BlueOak-1.0.0) sind permissiv und kompatibel. Kein Lizenzkonflikt identifiziert. | ✅ Kein Risiko |
| **Kundenvertragliche Restriktionen** | Abhängig von spezifischen Kundenverträgen. Standard-Klauseln verbieten typischerweise GPL (starkes Copyleft), nicht LGPL bei dynamischem Linking. Empfehlung: Bei Kunden mit expliziten "No-GPL-Family"-Klauseln gesondert prüfen. | ⚠️ Bedingtes Risiko |

**Erläuterung zu ⚠️:** Das bedingte Risiko bezieht sich nicht auf die technische oder lizenzrechtliche Bewertung (die ist eindeutig), sondern auf die Tatsache, dass unternehmensinterne Policies und individuelle Kundenverträge variieren können. Die beiden Auflagen unten adressieren dies.

### 5. Nutzungspflichten

| Prüfpunkt | Befund | Risiko |
|-----------|--------|--------|
| **Interne Nutzung (kein Distribution)** | Bei rein interner Nutzung ohne Weitergabe an Dritte entstehen **keine** LGPL-Pflichten. Weder Quellcode-Offenlegung noch Lizenzhinweise sind erforderlich. | ✅ Kein Risiko |
| **Lizenzhinweis** | Best Practice (und bei Distribution Pflicht): LGPL-3.0-Lizenztext muss beigelegt werden, wenn LGPL-Komponenten an Dritte weitergegeben werden. Da die Komponenten als separate npm-Pakete installiert werden, erfüllt der `LICENSE`-Eintrag in den jeweiligen `@img/sharp-libvips-*` Paketen diese Pflicht automatisch. Empfehlung: Zusätzlich in einer `THIRD-PARTY-LICENSES`-Datei dokumentieren. | ⚠️ Bedingtes Risiko |
| **Endnutzer-Information** | Keine gesetzliche Pflicht bei dynamischem Linking ohne Modifikation. Best Practice: In einer Third-Party-Notices-Datei auflisten. | ✅ Kein Risiko |

---

## Auflagen & Pflichten

Bei Freigabe sind folgende zwei Maßnahmen umzusetzen:

- [ ] **Auflage 1 — Third-Party-Licenses-Datei erstellen:** Eine Datei `THIRD-PARTY-LICENSES` im Repository-Root anlegen, die alle transitiven LGPL-lizenzierten Dependencies auflistet (Paketname, Version, Lizenz, Link zum Quellcode). Dies ist Standard-Compliance-Practice und schützt bei Distribution. Beispielinhalt:

  ```
  @img/sharp-libvips-linux-x64@1.2.4
  License: LGPL-3.0-or-later
  Source: https://github.com/lovell/sharp-libvips
  ```

- [ ] **Auflage 2 — Monitoring bei Dependency-Updates einrichten:** Bei Updates von `@anthropic-ai/claude-agent-sdk` prüfen, ob neue LGPL- oder GPL-lizenzierte transitive Dependencies hinzukommen. Dies wird durch den bereits konfigurierten Dependabot (TASK-02) unterstützt. Empfehlung: `license-checker --production --failOn "GPL-3.0-only;GPL-2.0-only;AGPL-3.0-only"` als optionalen CI-Check ergänzen.

---

## Bedingungen für Ablehnung

Nicht zutreffend — die Freigabe wird erteilt.

Eine **erneute Prüfung** wäre erforderlich, falls:
- Das Team beginnt, `sharp-libvips` oder `sharp` zu modifizieren (Fork)
- Die Build-Konfiguration geändert wird, sodass LGPL-Binaries in `dist/` gebündelt werden (statisches Linking)
- Ein Kundenvertrag explizit jegliche LGPL-Dependencies (auch bei dynamischem Linking) ausschließt
- `@anthropic-ai/claude-agent-sdk` zusätzliche GPL-3.0-only (nicht LGPL) Dependencies einführt

---

## Rechtlicher Vorbehalt

Diese Bewertung gilt für die beschriebene Integrationsmethode (dynamisches Linking über N-API, unmodifizierte Prebuilt-Binaries als separate npm-Pakete) und die aktuelle Nutzungsform (CLI-Tool und Library, MIT-lizenziert). Änderungen an Integrationsstrategie, Distributionsmodell oder Modifikation der LGPL-Komponenten erfordern eine erneute Prüfung durch Legal/Compliance.

Diese Bewertung stellt keine Rechtsberatung dar und ersetzt nicht die Konsultation eines spezialisierten Open-Source-Rechtsanwalts bei Zweifelsfällen.

---

**Digital Sign-off**
Legal & Compliance Review — 2026-03-06 — REF: OSS-REVIEW-2026-0306-001

**Status:** ✅ Freigegeben mit Auflagen (2 Maßnahmen)
