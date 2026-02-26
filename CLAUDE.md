# Cartograph

AI-powered Infrastructure Discovery & Agentic AI Cartography.
Gebaut auf Claude Agent SDK — Claude IST der Agent.

## Tech Stack

TypeScript 5.7+ strict, ESM only, Node 18+
@anthropic-ai/claude-code + @anthropic-ai/sdk + better-sqlite3 + commander + zod
Build: tsup | Test: vitest | Dev: tsx

## Coding Rules

Named exports, 2-Space, kein `any`, ISO 8601 UTC, IDs: "{type}:{id}"
Terminal auf stderr, process.exitCode statt exit(), .js Extensions

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
