---
date: 2026-06-11T18:43:39Z
researcher: majone
git_commit: 3e15d5457b5e6893aa947fb5dbb48f913b15cf86
branch: main
repository: agentic-ai-cartography
topic: "Package E — MCP / Agent capability enhancements (#71–#74) implementation surface"
tags: [research, codebase, mcp, agent-sdk, tools, hooks, prompts, config, package-e]
status: complete
last_updated: 2026-06-11
last_updated_by: majone
---

# Research: Package E — MCP / Agent Capability Enhancements (#71–#74)

**Date**: 2026-06-11T18:43:39Z
**Researcher**: majone
**Git Commit**: 3e15d5457b5e6893aa947fb5dbb48f913b15cf86
**Branch**: main
**Repository**: datasynx/agentic-ai-cartography

## Research Question
Document the existing code surface for Package E — the four "Research Tier-2" feature issues #71 (readOnly annotations on agent-SDK tools), #72 (PostToolUse audit-logging hook), #73 (fast model role), and #74 (two new MCP prompts) — so each can be planned.

## Summary

All four issues target **already-existing, well-isolated extension points**; none require new subsystems.

- **#71** — `src/tools.ts` defines 12 agent-SDK tools via `tool(name, desc, schema, handler)` with **no 5th `annotations` argument**. The SDK type signature **does** accept an optional `annotations: ToolAnnotations` 5th param (`sdk.d.ts:3233`). The exact annotation pattern to mirror already exists server-side in `src/mcp/server.ts:188-189` (`const readOnly = { readOnlyHint: true, openWorldHint: false }`).
- **#72** — The hook plumbing exists: discovery registers a `PreToolUse` Bash hook in `src/agent.ts:187-189`; there is **no `PostToolUse` hook**. The destination table `activity_events` is fully built (`db.ts:256-268`) with `insertEvent()`/`getEvents()` methods. The SDK exposes `PostToolUseHookInput` with a `tool_response` field (`sdk.d.ts:1228-1236`). The `show` CLI command currently prints only an event **count**, not individual events.
- **#73** — Config carries a single `agentModel: string` (`types.ts:185`, default `'claude-sonnet-4-5-20250929'` at `types.ts:200`). Two distinct LLM call sites exist: the discovery loop via the Agent SDK `query({ options: { model } })` (`agent.ts:168`) and the `chat` command via the Anthropic SDK `messages.create({ model })` (`cli.ts:748`) — the latter reads from a `--model` CLI flag, **not** from config.
- **#74** — Prompts are registered via `server.registerPrompt(name, meta, builder)` in `src/mcp/server.ts:360-411`; **four** prompts exist today (`audit-attack-surface`, `map-service-dependencies`, `compare-environments`, `onboard-to-system`). The tools the new prompts would reference — `get_summary` (returns `topConnected`) and `get_dependencies` — are fully implemented and tested.

## Detailed Findings

### #71 — readOnly annotations on the agent-SDK discovery tools

**Where the tools live** — `src/tools.ts`:
- Symbols imported dynamically: `const { tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk')` (`tools.ts:134`); type-only `McpServerConfig` import at `tools.ts:14`.
- 12 tools, all defined as `tool(name, description, schema, handler)` with **no annotations**:
  - `save_node` (`tools.ts:141`), `save_edge` (`:169`), `get_catalog` (`:186`), `ask_user` (`:202`), `scan_bookmarks` (`:220`), `scan_browser_history` (`:241`), `scan_local_databases` (`:264`), `scan_k8s_resources` (`:357`), `scan_aws_resources` (`:391`), `scan_gcp_resources` (`:418`), `scan_azure_resources` (`:441`), `scan_installed_apps` (`:468`).
- Assembled via `createSdkMcpServer({ name, version, tools })` (`tools.ts:583-587`).

**The pattern to mirror** — `src/mcp/server.ts`:
- `const readOnly = { readOnlyHint: true, openWorldHint: false } as const` (`server.ts:188-189`), applied to `get_summary`, `query_infrastructure`, `search_topology`, `list_services`, `get_node`, `get_dependencies`, `diff_topology` (`server.ts:193-304`).
- `run_discovery` uses `{ readOnlyHint: false, destructiveHint: false, openWorldHint: true }` (`server.ts:334-340`) — the model for a write-but-non-destructive tool (e.g. `save_node`/`save_edge`).

**Feasibility confirmed in the SDK type defs** — `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:
- `tool<Schema>(_name, _description, _inputSchema, _handler, _extras?: { annotations?: ToolAnnotations }): SdkMcpToolDefinition` (`sdk.d.ts:3233-3235`).
- `SdkMcpToolDefinition` carries optional `annotations?: ToolAnnotations` (`sdk.d.ts:1859-1865`).
- `ToolAnnotations` fields (from `@modelcontextprotocol/sdk/types`): `title?`, `readOnlyHint?`, `destructiveHint?`, `idempotentHint?`, `openWorldHint?`.

**Tests** — `test/tools.test.ts` and `test/tools-hardening.test.ts` cover `stripSensitive`, `clampText`, `createScanRunner`, `assertSafeScanArg`, `redactSecrets`, `redactValue`; **no assertions on tool annotations** today.

### #72 — PostToolUse audit-logging hook → `activity_events`

**Hook registration** — `src/agent.ts`:
- `query` imported from the Agent SDK (`agent.ts:29`); `safetyHook` imported from `./safety.js` (`agent.ts:1-5`).
- Hooks registered in the discovery `query()` options (`agent.ts:187-189`):
  ```
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [safetyHook] }] }
  ```
- **No `PostToolUse` entry exists.**

**Existing hook implementation** — `src/safety.ts`:
- `safetyHook: HookCallback` (`safety.ts:12-41`); signature `(input, _toolUseID, _options) => Promise<HookJSONOutput>`.
- Reads `input.tool_name` / `(input.tool_input)?.command` (`safety.ts:14-17`), calls `checkReadOnly(cmd)` (`safety.ts:24`), returns `{ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow'|'deny', permissionDecisionReason? } }`.

**SDK hook types** — `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:
- `HookCallback = (input: HookInput, toolUseID, options) => Promise<HookJSONOutput>` (`sdk.d.ts:402-404`).
- `HookCallbackMatcher = { matcher?, hooks: HookCallback[], timeout? }` (`sdk.d.ts:409-413`).
- `PostToolUseHookInput = BaseHookInput & { hook_event_name: 'PostToolUse'; tool_name; tool_input; tool_response; tool_use_id }` (`sdk.d.ts:1228-1236`) — **carries the tool result** (`tool_response`), which is the source of the "result size / bytes" the issue describes.
- `HOOK_EVENTS` includes `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, … (`sdk.d.ts:397`).

**Destination table** — `src/db.ts`:
- `CREATE TABLE activity_events` with columns `id, session_id, task_id, timestamp, event_type, process, pid, target, target_type, port, duration_ms` (`db.ts:256-268`); indexes `idx_events_session`, `idx_events_task` (`db.ts:305-306`).
- `EventRowSchema` Zod validator (`db.ts:61-73`); `EventRow` TS interface (`db.ts:166-178`).
- `insertEvent(sessionId, event: Pick<EventRow, 'eventType'|'process'|'pid'|'target'|'targetType'|'port'>, taskId?)` (`db.ts:562-573`) — generates UUID + ISO timestamp internally.
- `getEvents(sessionId, since?)` (`db.ts:575-595`); event count in `getStats()` (`db.ts:904-910`).

**Surfacing** — `src/cli.ts`:
- `show` command (`cli.ts:537-580`) prints aggregate `stats.events` count (`cli.ts:565`); it does **not** list individual events. No MCP resource/tool currently exposes `activity_events`.

### #73 — `fast` model role for helper LLM tasks

**Config** — `src/types.ts`:
- `CartographyConfig` interface (`types.ts:181-192`) with `agentModel: string` (`types.ts:185`).
- `defaultConfig()` (`types.ts:194-207`) sets `agentModel: 'claude-sonnet-4-5-20250929'` (`types.ts:200`).

**Consumer 1 — discovery (Agent SDK)** — `src/agent.ts`:
- `query()` options object (`agent.ts:165-192`) with `model: config.agentModel` (`agent.ts:168`) alongside `maxTurns`, `systemPrompt`, `mcpServers`, `allowedTools`, `hooks`, `permissionMode`.

**Consumer 2 — chat helper (Anthropic SDK)** — `src/cli.ts`:
- `chat` command (`cli.ts:675-771`); `--model` option default `'claude-sonnet-4-5-20250929'` (`cli.ts:678`).
- Dynamic `import('@anthropic-ai/sdk')` + `new Anthropic()` (`cli.ts:706-707`).
- `client.messages.create({ model: opts.model, max_tokens: 1024, system, messages })` (`cli.ts:747-752`); model read from the CLI flag, **not** from `config.agentModel`.

**CLI wiring** — `src/cli.ts`:
- `discover` `--model` option default Sonnet (`cli.ts:77`); merged into config as `agentModel: opts.model` (`cli.ts:117`); logged/displayed (`cli.ts:126,165`); documented in `docs` help (`cli.ts:828`).

**Tests** — `test/agent.test.ts:25` (`makeConfig` uses Sonnet), `test/types.test.ts:323-326` (`defaultConfig` asserts `agentModel` contains `'claude'`), `test/index.test.ts:64-69` (`defaultConfig` export).

### #74 — New MCP prompts: find-single-points-of-failure, generate-runbook

**Registration API** — `src/mcp/server.ts`:
- `McpServer` created with `capabilities: { resources, tools: {}, prompts: {}, logging: {} }` (`server.ts:107-116`).
- Prompts registered via `server.registerPrompt(name, { title, description, argsSchema? }, builder)` (`server.ts:360-411`). Builder returns `{ messages: [{ role: 'user', content: { type: 'text', text } }] }`. `argsSchema` uses Zod (imported `server.ts:12`); interpolated args available as `builder(args)`.

**Existing prompts (4):**
| Name | Lines | Args | Tools referenced |
|---|---|---|---|
| `audit-attack-surface` | `server.ts:360-371` | none | `get_dependencies` |
| `map-service-dependencies` | `server.ts:373-387` | `service: string` | `query_infrastructure`, `get_dependencies` |
| `compare-environments` | `server.ts:389-399` | none | `diff_topology` |
| `onboard-to-system` | `server.ts:401-411` | none | (Resources) |

`compare-environments` full text (reference pattern): instructs the model to "Call diff_topology to compare the two most recent discovery sessions… Summarize what was added, removed, and changed… Recommend what an operator should verify." (`server.ts:389-399`).

**Tools the new prompts would drive:**
- `get_summary` handler (`server.ts:191-199`, empty input schema) → `GraphSummary` (`db.ts:114-121`) via `getGraphSummary()` (`db.ts:872-900`). Fields: `sessionId`, `totals{nodes,edges}`, `nodesByType`, `nodesByDomain`, `edgesByRelationship`, and **`topConnected: Array<{id,name,type,degree}>`** (up to 10, sorted by degree desc) — the chokepoint signal #74 references.
- `get_dependencies` handler (`server.ts:267-291`; input `{ id, direction?, maxDepth? }`) → `TraversalResult` (`db.ts:156-162`) via `getDependencies()` (`db.ts:824-869`). Returns `{ root, direction, count, nodes[{…,depth}], edges[{from,to,rel}] }`.

**Tests** — `test/mcp-server.test.ts:115-122` (`"exposes prompts"`) lists all four prompt names and asserts argument substitution on `map-service-dependencies`; tool tests for `query_infrastructure`/`get_dependencies`/`diff_topology` at `:69-106`.

## Code References
- `src/tools.ts:134` — dynamic import of `tool`/`createSdkMcpServer`
- `src/tools.ts:141-468` — 12 `tool()` definitions, no annotations
- `src/tools.ts:583-587` — `createSdkMcpServer({ name, version, tools })`
- `src/mcp/server.ts:188-189` — `readOnly` annotation literal (pattern for #71)
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:3233-3235` — `tool()` accepts `_extras.annotations`
- `src/agent.ts:187-189` — `hooks: { PreToolUse: [...] }` registration (no PostToolUse)
- `src/safety.ts:12-41` — `safetyHook` implementation
- `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1228-1236` — `PostToolUseHookInput` with `tool_response`
- `src/db.ts:256-268` — `activity_events` schema
- `src/db.ts:562-595` — `insertEvent()` / `getEvents()`
- `src/cli.ts:537-580` — `show` command (event count only)
- `src/types.ts:185,200` — `agentModel` field + Sonnet default
- `src/agent.ts:168` — discovery passes `model: config.agentModel`
- `src/cli.ts:678,747-752` — `chat` reads `--model`, calls `messages.create({ model })`
- `src/mcp/server.ts:360-411` — `registerPrompt` calls (4 prompts)
- `src/db.ts:114-121,872-900` — `GraphSummary` / `getGraphSummary` (`topConnected`)
- `src/db.ts:156-162,824-869` — `TraversalResult` / `getDependencies`
- `test/mcp-server.test.ts:115-122` — prompt-exposure test

## Architecture Documentation
- **Two distinct tool/annotation surfaces:** the in-process agent-SDK tools (`src/tools.ts`, via `@anthropic-ai/claude-agent-sdk`'s `tool()`/`createSdkMcpServer`) used by the discovery loop, and the server-side MCP tools (`src/mcp/server.ts`, via `@modelcontextprotocol/sdk`'s `McpServer.registerTool`). Only the latter currently declares `annotations` (#71 closes that gap on the former).
- **Hook plumbing** is a single `hooks` object on the discovery `query()` options keyed by hook-event name, each holding `{ matcher, hooks[] }` (`agent.ts:187`). PreToolUse returns a permission decision; PostToolUse (#72) would receive `tool_response` and write via `db.insertEvent()`.
- **Model is a single string** threaded config → `query()`/`messages.create()`. Discovery and chat are separate call sites with separate model sources (config vs CLI flag) — the two seams #73 would unify under a `models.{lead,fast}` shape.
- **Prompts are pure text builders** that instruct the model to call existing tools; adding prompts (#74) is additive registration in `server.ts` with no new tool work, since `get_summary.topConnected` and `get_dependencies` already expose the needed data.

## Historical Context (from thoughts/)
- `thoughts/shared/research/2026-06-11-open-issues-clustering.md` — the clustering pass that defined Package E and selected it as the next research target; records that #71 was verified open (SDK tools carry no annotations) and that #72/#73/#74 were filed 2026-06-11 as "Research Tier-2" follow-ups.

## Related Research
- `thoughts/shared/research/2026-06-11-open-issues-clustering.md`

## Open Questions
- **#71 scope of `save_node`/`save_edge`:** mirror `run_discovery`'s `{ readOnlyHint: false, destructiveHint: false }` (writes catalog) vs the pure-read scanners' `readOnlyHint: true` — confirm intended annotation per tool.
- **#72 column mapping:** `activity_events` has no free-text "command" or "bytes" column; the issue's `{tool, command, bytes, timestamp}` would map onto existing columns (`event_type`/`process`/`target`/`port`) or require a schema addition — which is intended?
- **#72 surfacing:** whether `show` should gain a per-event listing and/or a new MCP resource/tool over `getEvents()`.
- **#73 chat call site:** the `chat` command reads `--model` independently of config; confirm whether "fast" routing should also re-home chat onto `config.models.fast`, and whether `agentModel` is retained as an alias for `models.lead`.
- **#74 arguments:** whether `generate-runbook` / `find-single-points-of-failure` take a `service`/`session` argument (like `map-service-dependencies`) or are argument-free (like `compare-environments`).
