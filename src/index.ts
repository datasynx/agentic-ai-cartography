export { CartographyDB } from './db.js';
export type { GraphSummary, TraversalResult } from './db.js';
// MCP server — the headline interface
export { createMcpServer, runStdio, runHttp } from './mcp/index.js';
export type { CreateMcpServerOptions, SearchFn, DiscoveryFn, HttpOptions } from './mcp/index.js';
// Scanner plugin system + deterministic local discovery
export { ScannerRegistry, defaultRegistry, bookmarksScanner, installedAppsScanner, portsScanner, extractListeningPorts } from './scanners/registry.js';
export type { Scanner, ScanContext, ScanResult } from './scanners/registry.js';
export { runLocalDiscovery, localDiscoveryFn } from './discovery/local.js';
export type { LocalDiscoveryOptions } from './discovery/local.js';
// Semantic search
export { createSemanticSearch, createLocalEmbedder, createHashEmbedder, VectorStore } from './semantic/search.js';
export type { EmbeddingProvider } from './semantic/search.js';
// Install harness — register the MCP server into any host's native config
export {
  planInstall, applyInstall, renderDiff, defaultContext, currentOs,
  parseConfig, serializeConfig, deepMerge, mcpServerObject,
  defaultServerEntry, DEFAULT_SERVER_NAME, PACKAGE_NAME, MCP_BIN,
  CLIENTS, getClient, listClients,
} from './installer/index.js';
export type {
  ClientSpec, ConfigFormat, OsKind, ResolveContext, Scope, ServerEntry,
  InstallPlan, PlanOptions, EntryOptions,
} from './installer/index.js';
export { createCartographyTools, stripSensitive, createScanRunner } from './tools.js';
export { safetyHook } from './safety.js';
export { checkReadOnly, isReadOnlyCommand, assertReadOnly, splitSegments } from './allowlist.js';
export type { PolicyResult, ShellKind } from './allowlist.js';
export { runDiscovery } from './agent.js';
export type { DiscoveryEvent } from './agent.js';
export {
  exportAll,
  exportJSON,
  exportJGF,
  exportBackstageYAML,
  exportDiscoveryApp,
  generateTopologyMermaid,
  generateDependencyMermaid,
} from './exporter.js';
export {
  hexToPixel, pixelToHex, hexCorners, hexNeighbors,
  hexDistance, hexRing, hexSpiral,
} from './hex.js';
export {
  groupByDomain, layoutClusters, assignColors,
  computeCentroid, computeClusterBounds, shadeVariant,
} from './cluster.js';
export { nodesToAssets, edgesToConnections, buildMapData } from './mapper.js';
export { defaultConfig } from './types.js';
export { checkPrerequisites } from './preflight.js';
export { safeEnv } from './platform.js';
export { cleanupTempFiles } from './bookmarks.js';
export { log, logInfo, logError, logWarn, logDebug, setVerbose } from './logger.js';
export type { LogLevel, LogEntry } from './logger.js';
export type * from './types.js';
