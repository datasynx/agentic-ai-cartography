# build-next

Reads `docs/tasks.md`, finds the next open task (first line with `- [ ]`),
implements it fully, runs `npm run lint && npm run test`, and
commits with a descriptive message.

Steps:
1. `cat docs/tasks.md` → identify the first open task
2. Read spec (`docs/SPEC.md` → relevant section)
3. Implement file(s) according to spec
4. `npm run lint` — fix all TypeScript errors
5. `npm run test` — all tests green
6. Mark task in `docs/tasks.md` as done (`- [x]`)
7. `git add -A && git commit -m "feat: <task description>"`
