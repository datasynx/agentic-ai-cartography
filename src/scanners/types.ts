/**
 * Scanner plugin contract.
 *
 * A scanner detects whether it applies to the current machine, then produces a
 * read-only {@link ScanResult}: deterministic nodes/edges where the data is
 * structured enough, plus an optional raw report for an LLM to classify further.
 *
 * Modeled on Steampipe plugins / Backstage processors: new sources can be added
 * (in-tree or via `@datasynx/scanner-*` packages) and registered without forking
 * the core. Each scanner declares the commands it needs, feeding the safety layer.
 */

import type { Platform } from '../platform.js';
import type { DiscoveryNode, DiscoveryEdge } from '../types.js';

export interface ScanContext {
  /** Optional focus hint from the caller (e.g. tool names to look for). */
  hint?: string;
  /** The current platform. */
  platform: Platform;
  /** Allowlist-gated command runner (returns '' on error/blocked). */
  run: (cmd: string, opts?: { timeout?: number; env?: NodeJS.ProcessEnv }) => string;
}

export interface ScanResult {
  /** Deterministically classified nodes. */
  nodes: DiscoveryNode[];
  /** Deterministically classified edges. */
  edges: DiscoveryEdge[];
  /** Optional raw text report for LLM-driven classification. */
  report?: string;
}

export interface Scanner {
  /** Stable id, e.g. "bookmarks", "installed-apps", "cloud-aws". */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Platforms this scanner supports, or 'all'. */
  platforms: Platform[] | 'all';
  /** Read-only commands this scanner may run (declared for the safety layer/docs). */
  allowedCommands?: string[];
  /** Cheap check whether the scanner applies here (e.g. a CLI is installed). */
  detect(ctx: ScanContext): boolean | Promise<boolean>;
  /** Perform the read-only scan. */
  scan(ctx: ScanContext): Promise<ScanResult>;
}

/** A typed registry of scanners with lazy, platform-aware selection. */
export class ScannerRegistry {
  private scanners = new Map<string, Scanner>();

  register(scanner: Scanner): this {
    if (this.scanners.has(scanner.id)) throw new Error(`scanner already registered: ${scanner.id}`);
    this.scanners.set(scanner.id, scanner);
    return this;
  }

  get(id: string): Scanner | undefined {
    return this.scanners.get(id);
  }

  list(): Scanner[] {
    return [...this.scanners.values()];
  }

  /** Scanners whose `platforms` include the given platform. */
  forPlatform(platform: Platform): Scanner[] {
    return this.list().filter((s) => s.platforms === 'all' || s.platforms.includes(platform));
  }
}
