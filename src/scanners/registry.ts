import { ScannerRegistry } from './types.js';
import { bookmarksScanner } from './bookmarks.js';
import { installedAppsScanner } from './installed-apps.js';
import { portsScanner } from './ports.js';

export { ScannerRegistry } from './types.js';
export type { Scanner, ScanContext, ScanResult } from './types.js';
export { bookmarksScanner } from './bookmarks.js';
export { installedAppsScanner } from './installed-apps.js';
export { portsScanner, extractListeningPorts } from './ports.js';

/** A registry pre-loaded with the built-in deterministic scanners. */
export function defaultRegistry(): ScannerRegistry {
  return new ScannerRegistry()
    .register(bookmarksScanner)
    .register(installedAppsScanner)
    .register(portsScanner);
}
