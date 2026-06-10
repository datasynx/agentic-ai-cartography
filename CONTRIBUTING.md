# Contributing

Thanks for your interest in improving `@datasynx/agentic-ai-cartography`.

## Development setup

```bash
git clone https://github.com/datasynx/agentic-ai-cartography.git
cd agentic-ai-cartography
npm install
npm run build
npm test
```

Requirements: **Node.js ≥ 20**.

## Workflow

1. Branch off `main`.
2. Make your change with tests.
3. Run the full local gate before pushing:

   ```bash
   npm run lint     # tsc --noEmit
   npm test         # vitest run
   npm run build    # tsup
   ```

4. Open a pull request against `main`.

## Conventional Commits (required)

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/),
and the PR title is checked by CI, so commits and PR titles **must** follow
[Conventional Commits](https://www.conventionalcommits.org/):

- `feat: …` → minor release
- `fix: …` → patch release
- `feat!: …` / `fix!: …` or a `BREAKING CHANGE:` footer → major release
- `docs:`, `test:`, `chore:`, `refactor:`, `ci:` → no release

## Coding rules

These mirror `CLAUDE.md` and are enforced by review:

- **Named exports only** (the single sanctioned default export is `src/smithery.ts`,
  required by Smithery's runtime).
- 2-space indentation, no `any`.
- Use `process.exitCode`, not `process.exit()`.
- Terminal/log output goes to **stderr** (stdout is reserved for the MCP protocol).
- ISO 8601 UTC timestamps; ids in the form `"{type}:{id}"`.
- Relative imports use explicit `.js` extensions.

## Tests

New behavior needs tests (`vitest`). Run `npm run test:coverage` to see the
coverage report. Aim to keep the MCP server, tools, and scanners well covered.

## Security

Never report vulnerabilities in public issues or PRs — see
[SECURITY.md](./SECURITY.md).
