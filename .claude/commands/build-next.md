# build-next

Liest `docs/tasks.md`, findet den nächsten offenen Task (erste Zeile mit `- [ ]`),
implementiert ihn vollständig, führt `npm run lint && npm run test` aus und
committet mit einer beschreibenden Nachricht.

Schritte:
1. `cat docs/tasks.md` → ersten offenen Task identifizieren
2. Spec lesen (`docs/SPEC.md` → relevanter Abschnitt)
3. Datei(en) implementieren gemäß Spec
4. `npm run lint` — alle TypeScript-Fehler beheben
5. `npm run test` — alle Tests grün
6. Task in `docs/tasks.md` als erledigt markieren (`- [x]`)
7. `git add -A && git commit -m "feat: <task description>"`
