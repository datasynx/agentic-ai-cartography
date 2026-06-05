/**
 * Public surface of the install harness: register Cartography's MCP server into
 * any supported host's native config, with parse-merge (never clobber), dry-run
 * planning, and global/project scopes.
 */

export type { ClientSpec, ConfigFormat, OsKind, ResolveContext, Scope, ServerEntry } from './types.js';
export { parseConfig, serializeConfig } from './format.js';
export { deepMerge } from './merge.js';
export { mcpServerObject } from './shapes.js';
export { defaultServerEntry, DEFAULT_SERVER_NAME, PACKAGE_NAME, MCP_BIN } from './entry.js';
export type { EntryOptions } from './entry.js';
export { planInstall, applyInstall, renderDiff, defaultContext, currentOs } from './install.js';
export type { InstallPlan, PlanOptions } from './install.js';
export { CLIENTS, getClient, listClients } from './registry.js';
