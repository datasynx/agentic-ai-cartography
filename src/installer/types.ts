/**
 * Types for the `install` harness — the layer that writes Cartography's MCP
 * server entry into each host's native config file (JSON / TOML / YAML).
 *
 * A {@link ClientSpec} is a declarative description of one host: where its config
 * lives per OS and scope, what serialization format it uses, and how to splice a
 * server entry into that host's particular schema (`mcpServers`, `servers`,
 * `context_servers`, `[mcp_servers]`, `extensions`, …). The merge engine and CLI
 * are generic; all host-specific knowledge lives in specs.
 */

export type ConfigFormat = 'json' | 'toml' | 'yaml';
export type Scope = 'global' | 'project';
export type OsKind = 'mac' | 'win' | 'linux';

/** A transport-agnostic description of the Cartography MCP server to register. */
export interface ServerEntry {
  /** stdio command (mutually exclusive with `url`). */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Streamable HTTP endpoint (mutually exclusive with `command`). */
  url?: string;
}

/** Everything a spec needs to resolve a config path; injectable for tests. */
export interface ResolveContext {
  scope: Scope;
  os: OsKind;
  /** User home directory. */
  home: string;
  /** Project/working directory (for project-scoped configs). */
  cwd: string;
  /** Environment variables (for `%APPDATA%` etc. on Windows). */
  env: Record<string, string | undefined>;
}

export interface ClientSpec {
  /** Stable id used on the CLI, e.g. `claude-code`. */
  id: string;
  /** Human label, e.g. `Claude Code`. */
  label: string;
  format: ConfigFormat;
  /** Resolve the absolute config path for the given scope/OS, or undefined if unsupported. */
  path(ctx: ResolveContext): string | undefined;
  /** Pure: return a new config object with `entry` spliced in under `serverName`. */
  apply(existing: Record<string, unknown>, serverName: string, entry: ServerEntry): Record<string, unknown>;
  /** Optional caveat surfaced to the user (e.g. "uses `servers`, not `mcpServers`"). */
  note?: string;
}
