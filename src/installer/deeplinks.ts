/**
 * One-click install deeplinks for hosts that support them. Cursor expects a
 * **Base64**-encoded server config; VS Code expects **URL-encoded** JSON — mixing
 * the two encodings is a classic mistake, so each has its own helper.
 */

import { mcpServerObject } from './shapes.js';
import type { ServerEntry } from './types.js';

/** `cursor://…/mcp/install?name=<name>&config=<base64 JSON of the server config>`. */
export function cursorDeeplink(name: string, entry: ServerEntry): string {
  const config = Buffer.from(JSON.stringify(mcpServerObject(entry))).toString('base64');
  const params = new URLSearchParams({ name, config });
  return `cursor://anysphere.cursor-deeplink/mcp/install?${params.toString()}`;
}

export interface VscodeDeeplinkOptions {
  /** Target VS Code Insiders (`vscode-insiders://`). */
  insiders?: boolean;
}

/** `vscode://mcp/install?<URL-encoded JSON>` where the JSON is `{ name, ...serverConfig }`. */
export function vscodeDeeplink(name: string, entry: ServerEntry, opts: VscodeDeeplinkOptions = {}): string {
  const scheme = opts.insiders ? 'vscode-insiders' : 'vscode';
  const payload = encodeURIComponent(JSON.stringify({ name, ...mcpServerObject(entry) }));
  return `${scheme}://mcp/install?${payload}`;
}

/** A `code --add-mcp '<json>'` CLI one-liner (alternative to the deeplink). */
export function codeAddMcpCommand(name: string, entry: ServerEntry): string {
  return `code --add-mcp '${JSON.stringify({ name, ...mcpServerObject(entry) })}'`;
}
