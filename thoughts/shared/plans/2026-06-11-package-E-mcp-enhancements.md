# Package E — MCP / Agent Capability Enhancements Implementation Plan

## Overview

Implement the four "Research Tier-2" enhancement issues as one cohesive package:

- **#71** — add read-only / non-destructive `annotations` to the in-process agent-SDK discovery tools (`src/tools.ts`).
- **#73** — introduce an optional `models: { lead, fast }` config role and route the `chat` helper onto the cheaper `fast` model (back-compat via `agentModel`).
- **#72** — add a `PostToolUse` audit-logging hook that records `{tool, command, bytes, timestamp}` into `activity_events`, surfaced in `show` and via a new read-only MCP tool.
- **#74** — add two MCP prompts: `find-single-points-of-failure` (argument-free) and `generate-runbook` (optional `service` arg).

All four extend existing, well-isolated seams; no new subsystems.

## Current State Analysis

- **#71** — `createCartographyTools()` (`src/tools.ts:128-588`) builds 12 tools via `tool(name, desc, schema, handler)` with **no 5th `annotations` arg**. The SDK accepts `tool(_name,_desc,_schema,_handler,_extras?: { annotations?: ToolAnnotations })` (`@anthropic-ai/claude-agent-sdk/sdk.d.ts:3233`). The pattern to mirror is `src/mcp/server.ts:189` (`const readOnly = { readOnlyHint: true, openWorldHint: false }`) and the write-tool variant on `run_discovery` (`server.ts:334-340`).
- **#73** — `CartographyConfig.agentModel: string` (`src/types.ts:185`, default `'claude-sonnet-4-5-20250929'` at `:200`). Discovery passes `model: config.agentModel` to the Agent SDK (`src/agent.ts:168`). `chat` reads a separate `--model` CLI flag (`src/cli.ts:678`) and calls `client.messages.create({ model: opts.model })` (`src/cli.ts:748`) — independent of config.
- **#72** — Hooks are registered on the discovery `query()` options: `hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [safetyHook] }] }` (`src/agent.ts:187-189`). No `PostToolUse`. `activity_events` exists (`src/db.ts:256-268`) with `insertEvent()` (`:562-573`) and `getEvents()` (`:575-595`) but **has no `command` or `result_bytes` column**. The SDK's `PostToolUseHookInput` carries `tool_response` (`sdk.d.ts:1228-1236`). `show` prints only the aggregate event count (`src/cli.ts:565`). The migration chain is a sequential `user_version` if-ladder ending at **v5** (`src/db.ts:324-372`); fresh DBs run `SCHEMA` then set `user_version = 5` (`:326-329`).
- **#74** — Prompts are registered via `server.registerPrompt(name, meta, builder)` (`src/mcp/server.ts:360-411`); 4 exist. Target tools are ready: `get_summary` → `GraphSummary.topConnected` (`db.ts:872-900`), `get_dependencies` → `TraversalResult` (`db.ts:824-869`).

## Desired End State

- Every agent-SDK discovery tool declares `annotations`; a test asserts the hints.
- `defaultConfig()` returns `models: { lead, fast }` with `agentModel === models.lead`; discovery uses `models.lead`, `chat` defaults to `models.fast` (overridable via `--model`).
- Every tool call during discovery writes an `activity_events` row with `command` + `result_bytes`; `show` lists recent activity; a `get_activity_events` MCP tool returns the trail.
- `find-single-points-of-failure` and `generate-runbook` prompts are registered and listed.
- `npm run build`, `npm run test`, `npm run lint` all green.

### Key Discoveries
- SDK `tool()` 5th arg accepts annotations — `sdk.d.ts:3233` (#71 is expressible).
- `insertEvent` uses a `Pick<EventRow, …>` shape (`db.ts:562`) — extendable with optional fields without breaking callers.
- Migration idempotency pattern: `PRAGMA table_info` + conditional `ALTER TABLE` (`db.ts:332-335,368-369`).
- `chat` already builds `defaultConfig()` at `cli.ts:680` — `models.fast` is in scope for the default.

## What We're NOT Doing
- No multi-provider abstraction (explicitly out of scope per #73).
- No rename of `agentModel` (kept as a back-compat alias for `models.lead`).
- No retroactive backfill of `activity_events` for old sessions.
- No auth/redaction changes (covered by other packages).
- No change to the `PreToolUse` safety hook behavior.

## Implementation Approach
Four independent phases ordered by ascending risk: annotations (#71) → prompts (#74) → model role (#73) → audit hook + migration (#72). Each phase builds and tests green on its own.

---

## Phase 1: #71 — readOnly annotations on agent-SDK tools

### Overview
Add `annotations` to all 12 tool definitions and make the tool list assertable in tests.

### Changes Required

#### 1. Annotation constants + per-tool 5th arg
**File**: `src/tools.ts`
**Changes**: Define three shared annotation literals near the top of `createCartographyTools` (after line 138) and pass the matching one as the 5th `tool()` argument.

```ts
const readScan = { readOnlyHint: true, openWorldHint: true } as const;   // scanners reach external/system state
const readLocal = { readOnlyHint: true, openWorldHint: false } as const; // reads local catalog / asks user
const writeCatalog = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
```

Per-tool mapping (append `, { annotations: <const> }` after each handler):
- `save_node`, `save_edge` → `writeCatalog`
- `get_catalog`, `ask_user` → `readLocal`
- `scan_bookmarks`, `scan_browser_history`, `scan_local_databases`, `scan_k8s_resources`, `scan_aws_resources`, `scan_gcp_resources`, `scan_azure_resources`, `scan_installed_apps` → `readScan`

Example:
```ts
tool('save_node', 'Save an infrastructure node to the catalog', { /* schema */ }, async (args) => { /* … */ }, { annotations: writeCatalog }),
```

#### 2. Make tool definitions testable
**File**: `src/tools.ts`
**Changes**: Extract the `tools` array into an exported async helper so a test can assert annotations; `createCartographyTools` delegates to it.

```ts
export async function buildCartographyToolDefinitions(db: CartographyDB, sessionId: string, opts: CartographyToolsOptions = {}) {
  const { tool } = await import('@anthropic-ai/claude-agent-sdk');
  // … existing tool(...) array, now with annotations …
  return tools;
}

export async function createCartographyTools(db, sessionId, opts = {}): Promise<McpServerConfig> {
  const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
  const tools = await buildCartographyToolDefinitions(db, sessionId, opts);
  return createSdkMcpServer({ name: 'cartography', version: '0.1.0', tools });
}
```

#### 3. Test
**File**: `test/tools.test.ts`
**Changes**: Add a suite that builds the definitions and asserts annotations.

```ts
it('annotates every tool with read/write hints', async () => {
  const defs = await buildCartographyToolDefinitions(db, sid);
  for (const d of defs) expect(d.annotations).toBeDefined();
  expect(defs.find(d => d.name === 'scan_aws_resources')!.annotations).toMatchObject({ readOnlyHint: true });
  expect(defs.find(d => d.name === 'save_node')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
});
```

### Success Criteria
#### Automated Verification:
- [x] Type check passes: `npm run lint`
- [x] Build passes: `npm run build`
- [x] New annotation test passes: `npm run test`
#### Manual Verification:
- [ ] An MCP host inspecting the discovery server shows read-only hints on `scan_*`/`get_catalog` and write hints on `save_*`.

---

## Phase 2: #74 — New MCP prompts

### Overview
Register two prompts after `onboard-to-system` (`src/mcp/server.ts:411`).

### Changes Required

#### 1. `find-single-points-of-failure` (argument-free)
**File**: `src/mcp/server.ts`
```ts
server.registerPrompt(
  'find-single-points-of-failure',
  { title: 'Find single points of failure', description: 'Rank chokepoints whose loss has the largest blast radius.' },
  () => ({
    messages: [{ role: 'user', content: { type: 'text', text:
      'Call get_summary and read topConnected (the most-connected nodes). For each, call get_dependencies ' +
      '(direction=both) to measure how many services depend on it. Identify single points of failure — nodes ' +
      'whose loss would disconnect or degrade the largest blast radius — rank them by impact, and recommend ' +
      'redundancy or mitigation for each.' } }],
  }),
);
```

#### 2. `generate-runbook` (optional `service` arg)
**File**: `src/mcp/server.ts`
```ts
server.registerPrompt(
  'generate-runbook',
  { title: 'Generate operations runbook', description: 'Produce an operations/onboarding runbook from the topology.',
    argsSchema: { service: z.string().optional().describe('Optional service id/name to scope the runbook') } },
  (args) => ({
    messages: [{ role: 'user', content: { type: 'text', text: args.service
      ? `Use query_infrastructure to locate "${args.service}", then get_dependencies (direction=both). Write an ` +
        `operations runbook for it: purpose, upstream/downstream dependencies, startup/shutdown order, health ` +
        `checks, common failure modes, and escalation steps.`
      : 'Read cartography://graph/summary, then call get_summary and list_services. Write a system-wide operations ' +
        'runbook: major components, how they connect, critical data stores, startup/shutdown order, health checks, ' +
        'and where an on-call engineer should look first.' } }],
  }),
);
```

#### 3. Test
**File**: `test/mcp-server.test.ts`
**Changes**: At the `"exposes prompts"` test (`:115-122`), add both names to the expected set and assert `generate-runbook` interpolates `service`.

### Success Criteria
#### Automated Verification:
- [x] `npm run lint`, `npm run build`, `npm run test` green
- [x] `listPrompts()` returns all six prompts; `generate-runbook` with `{service:'api'}` contains `"api"`
#### Manual Verification:
- [ ] In an MCP client, both prompts render and drive `get_summary`/`get_dependencies` correctly.

---

## Phase 3: #73 — `fast` model role for helper LLM tasks

### Overview
Add `models: { lead, fast }` to config (with `agentModel` kept as the lead alias), route discovery to `lead`, and default `chat` to `fast`.

### Changes Required

#### 1. Config shape + defaults
**File**: `src/types.ts`
```ts
export interface CartographyConfig {
  // … existing fields …
  agentModel: string;                  // back-compat alias for models.lead
  models: { lead: string; fast: string };
  // …
}

const DEFAULT_LEAD_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_FAST_MODEL = 'claude-haiku-4-5-20251001';

export function defaultConfig(overrides: Partial<CartographyConfig> = {}): CartographyConfig {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? '/tmp';
  const merged = { /* existing base */ agentModel: DEFAULT_LEAD_MODEL, /* … */, ...overrides };
  const lead = overrides.models?.lead ?? merged.agentModel;          // --model / agentModel override flows to lead
  const fast = overrides.models?.fast ?? DEFAULT_FAST_MODEL;
  return { ...merged, agentModel: lead, models: { lead, fast } };
}
```
(Keeps the invariant `agentModel === models.lead` so existing `agentModel` readers are unaffected.)

#### 2. Discovery uses the lead role
**File**: `src/agent.ts:168`
```ts
model: config.models.lead,   // === config.agentModel
```

#### 3. Chat defaults to the fast role
**File**: `src/cli.ts`
- Remove the hardcoded default on the option (`:678`): `.option('--model <m>', 'Model (defaults to the fast helper model)')`
- In the action, resolve: `const model = (opts as { model?: string }).model ?? config.models.fast;`
- Pass `model` to `client.messages.create({ model, … })` (`:748`).

#### 4. Tests
**File**: `test/types.test.ts`
```ts
it('derives models.lead from agentModel and provides a fast role', () => {
  const c = defaultConfig();
  expect(c.models.lead).toBe(c.agentModel);
  expect(c.models.fast).toContain('haiku');
});
it('routes an agentModel override into models.lead', () => {
  expect(defaultConfig({ agentModel: 'claude-opus-4-8' }).models.lead).toBe('claude-opus-4-8');
});
```
Confirm `test/agent.test.ts:25` `makeConfig` still satisfies the type (add `models` or rely on `defaultConfig`).

### Success Criteria
#### Automated Verification:
- [x] `npm run lint`, `npm run build`, `npm run test` green
- [x] Config tests assert `models.lead === agentModel` and override propagation
#### Manual Verification:
- [ ] `cartography chat` (no `--model`) runs against the fast model; `--model <x>` still overrides.
- [ ] `cartography discover` still uses Sonnet (lead).

---

## Phase 4: #72 — PostToolUse audit-logging hook

### Overview
Add `command` + `result_bytes` columns (migration v5→v6), an audit hook bound to the session, wire it as `PostToolUse`, and surface the trail in `show` and a new MCP tool.

### Changes Required

#### 1. Schema + migration
**File**: `src/db.ts`
- Add columns to the base `SCHEMA` `activity_events` block (`:256-268`): `command TEXT,` and `result_bytes INTEGER,`.
- Fresh-DB path (`:326-329`): bump `this.db.pragma('user_version = 6')`.
- Append a v5→v6 migration after `:371` (mirrors the idempotent pattern):
```ts
const v5 = this.db.pragma('user_version', { simple: true }) as number;
if (v5 < 6) {
  const cols = (this.db.prepare("PRAGMA table_info(activity_events)").all() as Array<{ name: string }>).map(c => c.name);
  if (!cols.includes('command')) this.db.exec('ALTER TABLE activity_events ADD COLUMN command TEXT');
  if (!cols.includes('result_bytes')) this.db.exec('ALTER TABLE activity_events ADD COLUMN result_bytes INTEGER');
  this.db.pragma('user_version = 6');
}
```

#### 2. Row schema + insert/read
**File**: `src/db.ts`
- `EventRowSchema` (`:61-73`): add `command: z.string().nullable().optional()`, `result_bytes: z.number().nullable().optional()`.
- `EventRow` interface (`:166-178`): add `command?: string; resultBytes?: number;`.
- `insertEvent` (`:562-573`): widen the param to `Pick<EventRow,'eventType'|'process'|'pid'|'target'|'targetType'|'port'> & Partial<Pick<EventRow,'command'|'resultBytes'>>`; add `command, result_bytes` to the INSERT column list and bind `event.command ?? null, event.resultBytes ?? null`.
- `getEvents` mapping (`:579-594`): add `command: v.command ?? undefined, resultBytes: v.result_bytes ?? undefined`.

#### 3. Audit hook (factory bound to db + session)
**File**: `src/audit.ts` (new)
```ts
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import type { CartographyDB } from './db.js';

export function createAuditHook(db: CartographyDB, sessionId: string): HookCallback {
  return async (input) => {
    if (!('tool_name' in input)) return {};
    const i = input as { tool_name: string; tool_input?: { command?: string }; tool_response?: unknown };
    const command = i.tool_input?.command ?? JSON.stringify(i.tool_input ?? {}).slice(0, 2000);
    const resultBytes = Buffer.byteLength(typeof i.tool_response === 'string' ? i.tool_response : JSON.stringify(i.tool_response ?? ''));
    db.insertEvent(sessionId, { eventType: 'tool_executed', process: i.tool_name, pid: process.pid, command, resultBytes });
    return {};
  };
}
```

#### 4. Wire into discovery
**File**: `src/agent.ts:187-189` — add `PostToolUse` alongside the existing `PreToolUse` (bind with the `db` + session id already created in `runDiscovery`):
```ts
hooks: {
  PreToolUse: [{ matcher: 'Bash', hooks: [safetyHook] }],
  PostToolUse: [{ hooks: [createAuditHook(db, sessionId)] }],
},
```

#### 5. Surface in `show`
**File**: `src/cli.ts` (after `:566`)
```ts
const events = db.getEvents(session.id);
if (events.length > 0) {
  process.stdout.write('\n  Recent activity:\n');
  for (const e of events.slice(-15)) {
    const kb = e.resultBytes != null ? ` (${(e.resultBytes / 1024).toFixed(1)} KB)` : '';
    process.stdout.write(`    ${e.timestamp}  ${e.process}  ${(e.command ?? '').slice(0, 60)}${kb}\n`);
  }
}
```

#### 6. New read-only MCP tool
**File**: `src/mcp/server.ts` (after `diff_topology`, ~`:356`)
```ts
server.registerTool(
  'get_activity_events',
  { title: 'Get activity events (audit trail)',
    description: 'Recent executed commands and their result sizes for the current session.',
    inputSchema: { limit: z.number().int().min(1).max(500).default(50).optional() },
    annotations: readOnly },
  (args) => {
    const sid = resolveSession();
    if (!sid) return json({ error: 'No discovery session found.' });
    const events = db.getEvents(sid).slice(-(args.limit ?? 50));
    return json({ count: events.length, events });
  },
);
```

#### 7. Tests
- **File**: `test/db.test.ts` — assert a v5 DB migrates to `user_version = 6` and that `insertEvent` round-trips `command` + `resultBytes` through `getEvents`.
- **File**: `test/mcp-server.test.ts` — call `get_activity_events` and assert the shape.
- **File**: `test/safety.test.ts` (or new `test/audit.test.ts`) — `createAuditHook` writes a row with the tool name + byte count.

### Success Criteria
#### Automated Verification:
- [x] `npm run lint`, `npm run build`, `npm run test` green
- [x] Migration test: a pre-existing v5 DB opens and reports `user_version = 6` with the two new columns
- [x] `insertEvent`/`getEvents` round-trip `command` + `resultBytes`
- [x] `get_activity_events` returns the trail
#### Manual Verification:
- [ ] After `cartography discover`, `cartography show` lists recent commands with KB sizes.
- [ ] Opening an **existing** pre-v6 catalog does not error (idempotent migration) and old rows show null command/bytes.

---

## Testing Strategy

### Unit Tests
- Tool annotations present and correct per role (#71).
- `defaultConfig` model derivation + override propagation (#73).
- Migration v5→v6 idempotency; event round-trip with new columns (#72).
- Prompt registration + `service` interpolation (#74).

### Integration Tests
- In-memory MCP server: `listPrompts` returns 6; `get_activity_events` returns rows (#72/#74).
- Audit hook writes a row given a synthetic `PostToolUseHookInput` (#72).

### Manual Testing Steps
1. `npm run build && npm link`; run `cartography discover` on localhost.
2. `cartography show` → confirm "Recent activity" block with sizes.
3. `cartography chat` → confirm it runs (fast model) and `--model` overrides.
4. Point an MCP client at the server → confirm new prompts and `get_activity_events`.
5. Open a catalog created before this change → confirm clean migration.

## Performance Considerations
- One extra `insertEvent` per tool call during discovery (single indexed INSERT; negligible). `result_bytes` is computed from already-in-memory output.
- `get_activity_events`/`show` read via the existing `idx_events_session` index.

## Migration Notes
- Additive, idempotent v5→v6 (`ALTER TABLE ADD COLUMN`) — no data rewrite, no rollback needed. Pre-existing event rows get `NULL` `command`/`result_bytes`. Fresh DBs created post-change start at `user_version = 6`.

## References
- Research: `thoughts/shared/research/2026-06-11-package-E-mcp-enhancements.md`
- Clustering: `thoughts/shared/research/2026-06-11-open-issues-clustering.md`
- Issues: #71, #72, #73, #74 (epic #55)
- Patterns: `src/mcp/server.ts:189` (annotations), `src/db.ts:324-372` (migration ladder), `src/mcp/server.ts:360-411` (prompts), `src/agent.ts:187-189` (hooks)
