import { homedir, tmpdir } from 'node:os';
import { existsSync, readFileSync, readdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BookmarkHost {
  hostname: string;
  port: number;
  protocol: 'http' | 'https';
  source: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractHost(rawUrl: string, source: string): BookmarkHost | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const protocol = u.protocol === 'https:' ? 'https' as const : 'http' as const;
    // Strip: no paths, no params, no credentials — hostname only
    const port = u.port ? parseInt(u.port, 10) : (protocol === 'https' ? 443 : 80);
    const hostname = u.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') return null;
    return { hostname, port, protocol, source };
  } catch {
    return null;
  }
}

// Chrome/Edge/Brave JSON format
interface ChromeNode {
  type?: string;
  url?: string;
  children?: ChromeNode[];
}

function walkChrome(node: ChromeNode, source: string, out: BookmarkHost[]): void {
  if (node.type === 'url' && node.url) {
    const h = extractHost(node.url, source);
    if (h) out.push(h);
  }
  if (node.children) {
    for (const child of node.children) walkChrome(child, source, out);
  }
}

function readChromeLike(filePath: string, source: string): BookmarkHost[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as {
      roots: Record<string, ChromeNode>;
    };
    const out: BookmarkHost[] = [];
    for (const root of Object.values(raw.roots)) {
      if (root) walkChrome(root, source, out);
    }
    return out;
  } catch {
    return [];
  }
}

async function readFirefox(profileDir: string): Promise<BookmarkHost[]> {
  const src = join(profileDir, 'places.sqlite');
  if (!existsSync(src)) return [];
  const tmp = join(tmpdir(), `cartograph_ff_${Date.now()}.sqlite`);
  try {
    copyFileSync(src, tmp);
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(tmp, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      SELECT DISTINCT p.url
      FROM moz_places p
      JOIN moz_bookmarks b ON b.fk = p.id
      WHERE b.type = 1 AND p.url NOT LIKE 'place:%'
      LIMIT 3000
    `).all() as { url: string }[];
    db.close();
    return rows.map(r => extractHost(r.url, 'firefox')).filter((h): h is BookmarkHost => h !== null);
  } catch {
    return [];
  }
}

// ── Platform paths ────────────────────────────────────────────────────────────

const HOME = homedir();
const IS_MAC = process.platform === 'darwin';

const CHROME_PATHS = IS_MAC
  ? [`${HOME}/Library/Application Support/Google/Chrome/Default/Bookmarks`]
  : [`${HOME}/.config/google-chrome/Default/Bookmarks`];

const EDGE_PATHS = IS_MAC
  ? [`${HOME}/Library/Application Support/Microsoft Edge/Default/Bookmarks`]
  : [`${HOME}/.config/microsoft-edge/Default/Bookmarks`];

const BRAVE_PATHS = IS_MAC
  ? [`${HOME}/Library/Application Support/BraveSoftware/Brave-Browser/Default/Bookmarks`]
  : [`${HOME}/.config/BraveSoftware/Brave-Browser/Default/Bookmarks`];

function firefoxProfileDirs(): string[] {
  const base = IS_MAC
    ? `${HOME}/Library/Application Support/Firefox/Profiles`
    : `${HOME}/.mozilla/firefox`;
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base)
      .filter(d => d.includes('.default') || d.includes('-release'))
      .map(d => join(base, d));
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scanAllBookmarks(): Promise<BookmarkHost[]> {
  const all: BookmarkHost[] = [];

  for (const p of CHROME_PATHS) all.push(...readChromeLike(p, 'chrome'));
  for (const p of EDGE_PATHS)   all.push(...readChromeLike(p, 'edge'));
  for (const p of BRAVE_PATHS)  all.push(...readChromeLike(p, 'brave'));

  for (const dir of firefoxProfileDirs()) {
    all.push(...await readFirefox(dir));
  }

  // Deduplicate by hostname (port not included — same host on 80+443 = same service)
  const seen = new Set<string>();
  return all.filter(h => {
    const key = h.hostname;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
