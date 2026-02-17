# Shadow Skill

Kontinuierliche System-Beobachtung via Snapshot-Diff-Analyse.

## Ablauf

1. Daemon sammelt Snapshots (`ss -tnp` + `ps aux` + optional `xdotool`)
2. String-Equality-Vergleich: identisch → kein API-Call
3. Nur bei Änderung: Claude Haiku analysiert den Diff

## Analyse-Aufgaben

- Neue/geschlossene TCP-Verbindungen → `save_event`
- Neue/beendete Prozesse → `save_event`
- Bisher unbekannte Services → `get_catalog` prüfen, dann `save_node`
- Task-Grenzen (Inaktivität, Tool-Wechsel) → `manage_task`

## Regeln

- **Kein Bash** im Shadow-Cycle — Daemon macht Snapshots, Claude analysiert nur
- `target` = NUR Host:Port
- Kurz und effizient — maxTurns: 5, Model: haiku
- Inaktivitäts-Schwelle: 5 Minuten → Task-Grenze

## Kosten-Optimierung

- 30s Default-Intervall (min 15s wegen Agent SDK Overhead)
- Diff-Check spart 90%+ API-Calls bei ruhigem System
- ~$0.12–0.36/Stunde bei aktivem System, ~$0.02/Stunde bei ruhigem
