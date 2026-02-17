# SOP Generation Skill

Standard Operating Procedures aus beobachteten Workflows generieren.

## Prozess

1. Abgeschlossene Tasks aus DB laden
2. Tasks nach ähnlichen `involvedServices` + `steps` clustern
3. Pro Cluster: Anthropic Messages API (kein Agent-Loop)
4. Response → `db.insertSOP()`

## SOP-Format

```markdown
# <Titel>
**Beschreibung:** <Was und warum>
**Systeme:** <system1, system2, ...>
**Dauer:** ~<N> Minuten
**Häufigkeit:** <Xmal täglich/wöchentlich>
**Confidence:** <0.0–1.0>

## Schritte
1. **<tool>** → `<target>`
   `<command>`
   _<Erwartetes Ergebnis>_

## Variationen
- <Szenario> → <Handlungsoption>
```

## Qualitätskriterien

- Jeder Schritt hat ein klares Ziel und ein erwartetes Ergebnis
- Variationen decken häufige Fehlerfälle ab
- Keine Credentials oder sensitive Daten
- Confidence ≥ 0.7 für produktionsreife SOPs
