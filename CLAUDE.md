# Cartograph

MCP-first infrastructure & agentic-AI cartography.
Primary interface: a Model Context Protocol server. The Claude Agent SDK loop is one optional adapter.

## Tech Stack

TypeScript 5.7+ strict, dual ESM/CJS, Node 20+
Core: @modelcontextprotocol/sdk + better-sqlite3 + commander + zod
Optional: @anthropic-ai/claude-agent-sdk + @anthropic-ai/sdk (Claude loop), sqlite-vec + @huggingface/transformers (semantic search)
Build: tsup | Test: vitest | Dev: tsx

## Coding Rules

Named exports, 2-Space, no `any`, ISO 8601 UTC, IDs: "{type}:{id}"
Terminal to stderr, process.exitCode instead of exit(), .js Extensions
Exception: `src/smithery.ts` has one default export, required by Smithery's TypeScript runtime (re-exported from a named `createServer`).

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
