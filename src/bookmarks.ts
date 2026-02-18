import { homedir, tmpdir } from 'node:os';
import { existsSync, readFileSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BookmarkHost {
  hostname: string;
  port: number;
  protocol: 'http' | 'https';
  source: string;
}

export interface HistoryHost extends BookmarkHost {
  visitCount: number;
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

async function readFirefoxBookmarks(profileDir: string): Promise<BookmarkHost[]> {
  const src = join(profileDir, 'places.sqlite');
  if (!existsSync(src)) return [];
  const tmp = join(tmpdir(), `cartograph_ff_bm_${Date.now()}.sqlite`);
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
  } finally {
    try { (await import('node:fs')).unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export async function readFirefoxHistory(profileDir: string): Promise<HistoryHost[]> {
  const src = join(profileDir, 'places.sqlite');
  if (!existsSync(src)) return [];
  const tmp = join(tmpdir(), `cartograph_ff_hist_${Date.now()}.sqlite`);
  try {
    copyFileSync(src, tmp);
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(tmp, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      SELECT url, visit_count
      FROM moz_places
      WHERE url NOT LIKE 'place:%'
        AND visit_count > 0
      ORDER BY visit_count DESC
      LIMIT 5000
    `).all() as { url: string; visit_count: number }[];
    db.close();
    return rows
      .map(r => {
        const h = extractHost(r.url, 'firefox');
        if (!h) return null;
        return { ...h, visitCount: r.visit_count };
      })
      .filter((h): h is HistoryHost => h !== null);
  } catch {
    return [];
  } finally {
    try { (await import('node:fs')).unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function readChromiumHistory(historyPath: string, source: string): Promise<HistoryHost[]> {
  if (!existsSync(historyPath)) return [];
  const tmp = join(tmpdir(), `cartograph_ch_hist_${Date.now()}.sqlite`);
  try {
    copyFileSync(historyPath, tmp);
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(tmp, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      SELECT url, visit_count
      FROM urls
      WHERE hidden = 0
        AND visit_count > 0
      ORDER BY visit_count DESC
      LIMIT 5000
    `).all() as { url: string; visit_count: number }[];
    db.close();
    return rows
      .map(r => {
        const h = extractHost(r.url, source);
        if (!h) return null;
        return { ...h, visitCount: r.visit_count };
      })
      .filter((h): h is HistoryHost => h !== null);
  } catch {
    return [];
  } finally {
    try { (await import('node:fs')).unlinkSync(tmp); } catch { /* ignore */ }
  }
}

// ── Platform paths ────────────────────────────────────────────────────────────

const HOME = homedir();
const IS_MAC = process.platform === 'darwin';

// Browser bookmark file paths (multiple profiles supported)
function chromeLikePaths(base: string): string[] {
  const paths: string[] = [];
  const defaultPath = join(base, 'Default', 'Bookmarks');
  if (existsSync(defaultPath)) paths.push(defaultPath);
  // Also check Profile 1, Profile 2, etc.
  if (existsSync(base)) {
    try {
      for (const entry of readdirSync(base)) {
        if (entry.startsWith('Profile ')) {
          const p = join(base, entry, 'Bookmarks');
          if (existsSync(p)) paths.push(p);
        }
      }
    } catch { /* ignore */ }
  }
  return paths;
}

function chromeLikeHistoryPaths(base: string): string[] {
  const paths: string[] = [];
  const defaultPath = join(base, 'Default', 'History');
  if (existsSync(defaultPath)) paths.push(defaultPath);
  if (existsSync(base)) {
    try {
      for (const entry of readdirSync(base)) {
        if (entry.startsWith('Profile ')) {
          const p = join(base, entry, 'History');
          if (existsSync(p)) paths.push(p);
        }
      }
    } catch { /* ignore */ }
  }
  return paths;
}

const CHROME_BASE = IS_MAC
  ? `${HOME}/Library/Application Support/Google/Chrome`
  : `${HOME}/.config/google-chrome`;

const CHROMIUM_BASE = IS_MAC
  ? `${HOME}/Library/Application Support/Chromium`
  : `${HOME}/.config/chromium`;

const EDGE_BASE = IS_MAC
  ? `${HOME}/Library/Application Support/Microsoft Edge`
  : `${HOME}/.config/microsoft-edge`;

const BRAVE_BASE = IS_MAC
  ? `${HOME}/Library/Application Support/BraveSoftware/Brave-Browser`
  : `${HOME}/.config/BraveSoftware/Brave-Browser`;

const VIVALDI_BASE = IS_MAC
  ? `${HOME}/Library/Application Support/Vivaldi`
  : `${HOME}/.config/vivaldi`;

const OPERA_BASE = IS_MAC
  ? `${HOME}/Library/Application Support/com.operasoftware.Opera`
  : `${HOME}/.config/opera`;

function firefoxProfileDirs(): string[] {
  const base = IS_MAC
    ? `${HOME}/Library/Application Support/Firefox/Profiles`
    : `${HOME}/.mozilla/firefox`;
  if (!existsSync(base)) return [];
  try {
    return readdirSync(base)
      .map(d => join(base, d))
      .filter(d => {
        try {
          return statSync(d).isDirectory() && existsSync(join(d, 'places.sqlite'));
        } catch { return false; }
      });
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scanAllBookmarks(): Promise<BookmarkHost[]> {
  const all: BookmarkHost[] = [];

  for (const p of chromeLikePaths(CHROME_BASE))   all.push(...readChromeLike(p, 'chrome'));
  for (const p of chromeLikePaths(CHROMIUM_BASE)) all.push(...readChromeLike(p, 'chromium'));
  for (const p of chromeLikePaths(EDGE_BASE))     all.push(...readChromeLike(p, 'edge'));
  for (const p of chromeLikePaths(BRAVE_BASE))    all.push(...readChromeLike(p, 'brave'));
  for (const p of chromeLikePaths(VIVALDI_BASE))  all.push(...readChromeLike(p, 'vivaldi'));
  for (const p of chromeLikePaths(OPERA_BASE))    all.push(...readChromeLike(p, 'opera'));

  for (const dir of firefoxProfileDirs()) {
    all.push(...await readFirefoxBookmarks(dir));
  }

  // Deduplicate by hostname
  const seen = new Set<string>();
  return all.filter(h => {
    if (seen.has(h.hostname)) return false;
    seen.add(h.hostname);
    return true;
  });
}

export async function scanAllHistory(): Promise<HistoryHost[]> {
  const all: HistoryHost[] = [];

  for (const p of chromeLikeHistoryPaths(CHROME_BASE))   all.push(...await readChromiumHistory(p, 'chrome'));
  for (const p of chromeLikeHistoryPaths(CHROMIUM_BASE)) all.push(...await readChromiumHistory(p, 'chromium'));
  for (const p of chromeLikeHistoryPaths(EDGE_BASE))     all.push(...await readChromiumHistory(p, 'edge'));
  for (const p of chromeLikeHistoryPaths(BRAVE_BASE))    all.push(...await readChromiumHistory(p, 'brave'));
  for (const p of chromeLikeHistoryPaths(VIVALDI_BASE))  all.push(...await readChromiumHistory(p, 'vivaldi'));
  for (const p of chromeLikeHistoryPaths(OPERA_BASE))    all.push(...await readChromiumHistory(p, 'opera'));

  for (const dir of firefoxProfileDirs()) {
    all.push(...await readFirefoxHistory(dir));
  }

  // Deduplicate by hostname, summing visit counts
  const byHost = new Map<string, HistoryHost>();
  for (const h of all) {
    const existing = byHost.get(h.hostname);
    if (existing) {
      existing.visitCount += h.visitCount;
    } else {
      byHost.set(h.hostname, { ...h });
    }
  }

  // Sort by visit count descending
  return [...byHost.values()].sort((a, b) => b.visitCount - a.visitCount);
}
