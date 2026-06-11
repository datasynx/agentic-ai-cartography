# Issues #51 / #54 / #75 — Governance close-out, semantic-degradation log, threat model — Implementation Plan

## Overview

Resolve three open `documentation` issues whose scope has diverged sharply from when they were
filed. At commit `d6559f4` the tree already satisfies #51 entirely and #54 almost entirely. The
only *code* work is a single observability fix (#54), and the only *new artifact* is a structured
threat-model document (#75). This plan delivers all three to a closeable state.

- **#51** — governance files: verify-and-close (no code).
- **#54** — README/reference gaps: README already covers the four sub-items; implement the one
  missing runtime behavior — an explicit log when semantic search degrades to lexical.
- **#75** — author `docs/explanation/threat-model.md`, wire it into docs/llms generation, and
  cross-link it.

## Current State Analysis

Grounded in the research at `thoughts/shared/research/2026-06-12-issues-51-54-75-governance-docs-and-threat-model.md`.

**#51 — already present.** `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`.github/PULL_REQUEST_TEMPLATE.md`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`,
`.github/CODEOWNERS`, `LICENSE`, `CHANGELOG.md` all exist. Conventional-Commits enforcement is
wired via `.releaserc.json` + `.github/workflows/pr-title.yml`. Nothing to build.

**#54 — README covers it; one runtime gap.** The README documents semantic-search fallback
(`README.md:271-274`), two-mode release (`README.md:439-459`), Smithery `env: {}`
(`README.md:105-113`), and HTTP auth (`README.md:156-169`). The behavioral gap:

- `src/mcp/start.ts:67-70` logs `'semantic search: ready'` **unconditionally** whenever
  `opts.semantic !== false`, even when `createSemanticSearch` has silently returned a lexical-only
  function.
- `src/semantic/search.ts:30,33` decide the fallback (no embedder → lexical; no vector store →
  lexical) but emit nothing.
- `src/semantic/embeddings.ts:50` and `src/semantic/store.ts` `catch {}` discard the failure
  reason. Result: a user on `--omit=optional` sees `semantic search: ready` and a silently lexical
  server.

**#75 — absent.** `docs/explanation/` contains only `index.md` ("Why MCP-first?"). No
`threat-model.md`. The mitigations such a doc would map are implemented and inventoried in the
research doc (allowlist, `safeEnv`/`run` chokepoint, `sanitizeUntrusted`, `clampText`, credential
redaction, HTTP bearer-token + DNS-rebind). `SECURITY.md:30-53` has a prose guarantee list but no
structured attacker-model/assets/boundaries mapping.

### Key Discoveries

- `createSemanticSearch(db, embedder?)` is a **public export** (`src/index.ts:12`; asserted by
  `test/index.test.ts:81`, `test/e2e/consumer-{esm,cjs}`). `embedder` is the 2nd positional arg and
  tests call `createSemanticSearch(db, createHashEmbedder(256))` (`test/semantic.test.ts:56,64`).
  → Any logging change must be **non-breaking**: add a 3rd optional `opts` arg, do not touch the
  first two positionals.
- Docs site `docs/index.html` is **hand-authored HTML**, not rendered from markdown. Markdown under
  `docs/` feeds `llms.txt`/`llms-full.txt` via `scripts/build-llms.mjs` `SECTIONS`
  (`build-llms.mjs:20-41`). The "Explanation" section currently lists only `explanation/index.md`.
- `test/llms.test.ts:24-27` fails the build unless the committed `llms.txt`/`llms-full.txt` exactly
  equal a fresh `generate()`. → After editing `SECTIONS`, regenerate with `npm run docs:llms`.
- `llms-full.txt` embeds the **full body** of every `SECTIONS` page (`build-llms.mjs:64-70`), so a
  registered threat-model page becomes agent-discoverable automatically.
- Deep content links out to GitHub blobs on the single-page site (the `#adapters` section links to
  `…/blob/main/docs/adapters.md`). → The new llms entry's `url` should be the threat-model GitHub
  blob URL, not a non-existent `index.html` anchor.

## Desired End State

- #51 closed as already-satisfied, GitHub Community Standards confirmed green.
- Starting the MCP server without the optional deps logs an explicit, dependency-named
  "→ lexical search" line instead of a false `semantic search: ready`; with the deps present it
  still logs `semantic search: ready` exactly once. `npm test` green.
- `docs/explanation/threat-model.md` exists, is registered in `build-llms.mjs`, embedded in
  `llms-full.txt`, cross-linked from `SECURITY.md` and `docs/explanation/index.md`, and
  `test/llms.test.ts` passes.

## What We're NOT Doing

- Not adding new governance files for #51 (all exist) — no `FUNDING.yml`, no new templates.
- Not rewriting README prose for #54 beyond an optional one-line note that degradation is now logged.
- Not adding a new hand-authored `<section>` to `docs/index.html` for the threat model (the site is
  manually maintained; the page is reachable via GitHub blob + llms-full.txt).
- Not plumbing the caught error out of `embeddings.ts`/`store.ts` to distinguish "not installed"
  vs "load failed" (the chosen #54 depth is mode + dependency-name, not exact failure cause).
- Not addressing the incidental `CLAUDE.md → @docs/SPEC.md` missing-file finding (out of scope;
  recorded in the research doc's Open Questions).

## Implementation Approach

Three independent phases, orderable in parallel. Phase 1 is a code+test change; Phase 2 is a new
doc + generator wiring; Phase 3 is administrative verification. Recommended order: 1 → 2 → 3.

---

## Phase 1: Explicit semantic-degradation logging (#54)

### Overview
Make `createSemanticSearch` report which mode it resolved to, via an injected logger, and have the
MCP entrypoint stop logging a false "ready". Non-breaking to the public signature.

### Changes Required

#### 1. `src/semantic/search.ts` — add optional logger + branch logging
**Changes**: Add a 3rd optional `opts` arg (after `embedder`), log at each resolution point.

```typescript
/** Options for {@link createSemanticSearch}. */
export interface SemanticSearchOptions {
  /** Logger for mode/degradation diagnostics (stderr). No-op if omitted. */
  log?: (msg: string) => void;
}

export async function createSemanticSearch(
  db: CartographyDB,
  embedder?: EmbeddingProvider,
  opts: SemanticSearchOptions = {},
): Promise<SearchFn> {
  const log = opts.log;
  const provider = embedder ?? (await createLocalEmbedder());
  if (!provider) {
    log?.('semantic search: embeddings unavailable (@huggingface/transformers not installed or failed to load) — using lexical search');
    return lexicalSearch();
  }
  const store = new VectorStore(db, provider);
  const ok = await store.init();
  if (!ok) {
    log?.('semantic search: vector store unavailable (sqlite-vec not installed or failed to load) — using lexical search');
    return lexicalSearch();
  }
  log?.('semantic search: ready');

  return async (d, sid, query, opts2): Promise<Array<{ node: NodeRow; score?: number }>> => {
    // …unchanged body…
  };
}
```
(Rename the inner closure's `opts` param to avoid shadowing the new outer `opts`, e.g. `opts2`, or
keep the inner name and rename the outer to `options` — pick one; the diff must not change query
behavior.)

#### 2. `src/index.ts` — export the new option type (optional, for parity)
**Changes**: add `SemanticSearchOptions` to the type re-export line.

```typescript
export type { EmbeddingProvider, SemanticSearchOptions } from './semantic/search.js';
```

#### 3. `src/mcp/start.ts` — pass the logger, drop the false unconditional "ready"
**Changes**: lines 66-70.

```typescript
  let search: SearchFn | undefined;
  if (opts.semantic !== false) {
    search = await createSemanticSearch(db, undefined, { log });
  }
```
(Remove the standalone `log('semantic search: ready');` — search.ts now owns that message.)

#### 4. `test/semantic.test.ts` — assert the success message
**Changes**: add a case that a spy logger receives `'semantic search: ready'` on the happy path
(hash embedder + sqlite-vec available, which the suite already exercises).

```typescript
it('logs readiness when semantic search is available', async () => {
  const msgs: string[] = [];
  await createSemanticSearch(db, createHashEmbedder(256), { log: (m) => msgs.push(m) });
  expect(msgs).toContain('semantic search: ready');
});
```

### Success Criteria

#### Automated Verification:
- [x] Type check passes: `npm run lint`
- [x] Tests pass incl. the new readiness assertion: `npm test`
- [x] Public API surface intact: `test/index.test.ts` and the ESM/CJS consumer e2e tests still pass.

#### Manual Verification:
- [ ] With optional deps absent (`npm ci --omit=optional` in a scratch checkout, or temporarily
  unresolvable), `npx cartography-mcp` logs the `… unavailable (…) — using lexical search` line and
  NOT `semantic search: ready`.
- [ ] With optional deps present, startup logs `semantic search: ready` exactly once.

---

## Phase 2: Structured threat-model document (#75)

### Overview
Author `docs/explanation/threat-model.md` (structured: attacker model, assets, trust boundaries,
mitigations-per-boundary mapped to `file:line`), register it in the docs/llms generator, and
cross-link it.

### Changes Required

#### 1. New file `docs/explanation/threat-model.md`
**Changes**: New page, house style (no frontmatter, matching `explanation/index.md`). Sections:

- **Threat model** — one-paragraph scope: read-only discovery tool; safety boundary is the
  allowlist in `src/allowlist.ts` enforced by `run()` (`src/platform.ts`).
- **Attacker model** — (a) a malicious/compromised MCP client or agent issuing tool calls;
  (b) untrusted scanned content (bookmark titles, history, CLI stdout) carrying prompt-injection;
  (c) a network attacker against the HTTP transport.
- **Assets** — local command-execution surface; cloud/cluster credentials; scanned PII
  (bookmarks/history); catalog contents re-entering LLM context.
- **Trust boundaries** — agent/client → tool params; scanner output → catalog/LLM; HTTP transport;
  catalog persistence.
- **Mitigations per boundary** — a table mirroring the research doc's mapping, each row citing
  `file:line` (allowlist `src/allowlist.ts:14-29,44-65,181-222`; `$()`/backtick block `:211`;
  `assertSafeScanArg` `src/tools.ts:83-114`; `sanitizeUntrusted` `src/sanitize.ts:18-45` applied at
  `src/db.ts:475-492,539-550`; `clampText`/`maxToolResponseBytes` `src/tools.ts:48-65`,
  `src/types.ts:194,213`; redaction `src/tools.ts:67-81,111-126`; HTTP bearer-token + DNS-rebind
  `src/mcp/transports.ts:36-107`; `safeEnv` `src/platform.ts:60-75`).
- **Residual risk / assumptions** — host CLIs (aws/gcloud/az/kubectl) and their creds are trusted;
  allowlist correctness is the trust root; out-of-process secrets are not Cartography's concern.
- Closing line pointing reporters to `SECURITY.md`.

#### 2. `scripts/build-llms.mjs` — register the page in `SECTIONS`
**Changes**: extend the Explanation `pages` array (line 39).

```javascript
{
  heading: 'Explanation',
  pages: [
    { file: 'docs/explanation/index.md', url: `${SITE}/#architecture`, title: 'Why MCP-first', desc: 'The design rationale.' },
    { file: 'docs/explanation/threat-model.md', url: 'https://github.com/datasynx/agentic-ai-cartography/blob/main/docs/explanation/threat-model.md', title: 'Threat model', desc: 'Attacker model, trust boundaries and mitigations.' },
  ],
},
```

#### 3. Regenerate the committed llms files
**Changes**: run `npm run docs:llms` and commit the updated `llms.txt`, `llms-full.txt`, and their
`docs/` mirrors (the script writes both).

#### 4. `docs/explanation/index.md` — cross-link
**Changes**: append a short "See also" line linking to `./threat-model.md`.

#### 5. `SECURITY.md` — cross-link
**Changes**: add a line under `## Security model` (after the guarantee list, ~line 51) pointing to
`docs/explanation/threat-model.md` for the structured boundary→mitigation mapping.

### Success Criteria

#### Automated Verification:
- [x] llms drift test passes (committed files match `generate()`): `npm test` (`test/llms.test.ts`)
- [x] `llms-full.txt` embeds the threat-model body: `grep -q "Attacker model" llms-full.txt`
- [x] Type check / full suite unaffected: `npm run lint && npm test`

#### Manual Verification:
- [ ] `docs/explanation/threat-model.md` renders correctly on GitHub (table + links resolve).
- [ ] Every `file:line` citation in the mitigations table resolves to the intended code.
- [ ] Links from `SECURITY.md` and `explanation/index.md` reach the new page.

---

## Phase 3: Close out #51 (governance) and #54 (docs)

### Overview
Administrative verification; no code beyond an optional README one-liner.

### Changes Required

#### 1. Verify GitHub Community Standards (#51)
**Changes**: confirm the Insights → Community Standards checklist is green (SECURITY, CONTRIBUTING,
CODE_OF_CONDUCT, issue templates, PR template, CODEOWNERS, LICENSE, README all detected). Close #51
referencing the files that satisfy each acceptance-criterion bullet.

#### 2. (Optional) one-line README note (#54)
**Changes**: in the semantic-search note (`README.md:271-274`), add that degradation now emits a
stderr log naming the missing optional dependency — so the runtime behavior matches the docs.

#### 3. Close #54
**Changes**: comment on #54 mapping each acceptance bullet to its location (README sections from the
research doc) plus the Phase 1 logging change; close.

### Success Criteria

#### Automated Verification:
- [x] `npm run lint && npm test && npm run build` all pass on the branch.

#### Manual Verification:
- [ ] GitHub Community Standards checklist shows all items green.
- [ ] #51 and #54 closed with the mapping comments; #75 closed by the merged doc.

---

## Testing Strategy

### Unit Tests
- New: `createSemanticSearch(..., { log })` emits `semantic search: ready` on the available path
  (`test/semantic.test.ts`).
- Existing: `test/llms.test.ts` enforces the regenerated llms files; `test/index.test.ts` and the
  ESM/CJS consumer e2e tests enforce the unchanged public export surface.

### Integration / Manual
- Launch `cartography-mcp` with and without optional deps; observe the startup log line differs and
  is accurate (the fallback branches are environment-dependent and not unit-tested, so verified by
  hand).

## Performance Considerations
None. Phase 1 adds at most three log calls at startup; Phases 2-3 are docs/admin.

## Migration Notes
None. No schema, config, or API-shape changes (the `createSemanticSearch` 3rd arg is optional and
backward-compatible).

## References

- Research: `thoughts/shared/research/2026-06-12-issues-51-54-75-governance-docs-and-threat-model.md`
- Issues: #51 (governance files), #54 (README/reference gaps), #75 (structured threat model)
- Key code: `src/semantic/search.ts:25-50`, `src/mcp/start.ts:62-90`,
  `src/semantic/embeddings.ts:24-53`, `scripts/build-llms.mjs:20-41`, `test/llms.test.ts:24-27`,
  `SECURITY.md:30-53`, `docs/explanation/index.md`
