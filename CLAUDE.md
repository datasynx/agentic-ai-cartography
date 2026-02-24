# Cartograph

AI-powered Infrastructure Cartography & SOP Generation.
Built on Claude Agent SDK — Claude IS the agent.

## Tech Stack

TypeScript 5.7+ strict, ESM only, Node 18+
@anthropic-ai/claude-code + @anthropic-ai/sdk + better-sqlite3 + commander + zod
Build: tsup | Test: vitest | Dev: tsx

## Coding Rules

Named exports, 2-Space, no `any`, ISO 8601 UTC, IDs: "{type}:{id}"
Terminal to stderr, process.exitCode instead of exit(), .js Extensions

## Commands

```
npm run build   # tsup compile
npm run dev     # tsx src/cli.ts
npm run test    # vitest run
npm run lint    # tsc --noEmit
```

## Spec

@docs/SPEC.md

## Tasks

@docs/tasks.md
