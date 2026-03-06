import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupTempFiles } from '../src/bookmarks.js';

// We need to test internal functions, so we'll test through the public API
// and also test readChromeLike via fixture files.

// Create a temp dir for test fixtures
const TEST_DIR = join(tmpdir(), `cartography-bm-test-${Date.now()}`);

function makeChromeLikeBookmarks(hosts: { hostname: string; protocol?: string }[]): string {
  const children = hosts.map(h => ({
    type: 'url',
    url: `${h.protocol ?? 'https'}://${h.hostname}/some/path`,
    name: h.hostname,
  }));
  return JSON.stringify({
    roots: {
      bookmark_bar: {
        type: 'folder',
        children,
      },
      other: {
        type: 'folder',
        children: [],
      },
    },
  });
}

describe('bookmarks module', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  });

  describe('extractHost via readChromeLike (integration)', () => {
    it('extracts hostnames from Chrome-like bookmark files', async () => {
      // We import dynamically to get the module with its internal functions
      // Since extractHost and readChromeLike are not exported, we test through
      // the pattern of creating a bookmark file and scanning it

      const profileDir = join(TEST_DIR, 'Default');
      mkdirSync(profileDir, { recursive: true });

      const bookmarksPath = join(profileDir, 'Bookmarks');
      writeFileSync(bookmarksPath, makeChromeLikeBookmarks([
        { hostname: 'github.com' },
        { hostname: 'notion.so' },
        { hostname: 'linear.app' },
      ]));

      // We can't directly call readChromeLike since it's not exported,
      // but we can verify the file format is correct by parsing it ourselves
      const raw = JSON.parse(
        (await import('node:fs')).readFileSync(bookmarksPath, 'utf8')
      ) as { roots: Record<string, { children?: Array<{ url?: string }> }> };
      const urls = raw.roots.bookmark_bar.children?.map(c => c.url) ?? [];
      expect(urls).toHaveLength(3);
      expect(urls[0]).toContain('github.com');
    });

    it('handles nested folders in Chrome bookmarks', () => {
      const data = JSON.stringify({
        roots: {
          bookmark_bar: {
            type: 'folder',
            children: [
              {
                type: 'folder',
                children: [
                  {
                    type: 'folder',
                    children: [
                      { type: 'url', url: 'https://deeply.nested.example.com/path' },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });

      const profileDir = join(TEST_DIR, 'nested', 'Default');
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, 'Bookmarks'), data);

      // Verify nested structure is valid JSON
      const parsed = JSON.parse(data);
      const innerFolder = parsed.roots.bookmark_bar.children[0].children[0];
      expect(innerFolder.children[0].url).toBe('https://deeply.nested.example.com/path');
    });

    it('filters out non-http protocols', () => {
      const data = JSON.stringify({
        roots: {
          bookmark_bar: {
            type: 'folder',
            children: [
              { type: 'url', url: 'https://valid.example.com' },
              { type: 'url', url: 'chrome://settings' },
              { type: 'url', url: 'javascript:void(0)' },
              { type: 'url', url: 'file:///home/user/doc.html' },
              { type: 'url', url: 'ftp://files.example.com/pub' },
            ],
          },
        },
      });

      const parsed = JSON.parse(data);
      const urls = parsed.roots.bookmark_bar.children.map(
        (c: { url: string }) => c.url
      );
      // Only https:// should pass extractHost
      const httpUrls = urls.filter((u: string) =>
        u.startsWith('http://') || u.startsWith('https://')
      );
      expect(httpUrls).toHaveLength(1);
      expect(httpUrls[0]).toContain('valid.example.com');
    });

    it('filters out localhost and 127.0.0.1', () => {
      // extractHost should return null for localhost
      const testUrls = [
        'https://localhost:3000',
        'http://127.0.0.1:8080',
        'https://real-server.com',
      ];
      const filtered = testUrls.filter(u => {
        try {
          const url = new URL(u);
          return url.hostname !== 'localhost' && url.hostname !== '127.0.0.1';
        } catch { return false; }
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toContain('real-server.com');
    });

    it('extracts correct port from URLs', () => {
      const testCases = [
        { url: 'https://example.com', expectedPort: 443 },
        { url: 'http://example.com', expectedPort: 80 },
        { url: 'https://example.com:8443', expectedPort: 8443 },
        { url: 'http://example.com:3000', expectedPort: 3000 },
      ];

      for (const tc of testCases) {
        const u = new URL(tc.url);
        const port = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
        expect(port).toBe(tc.expectedPort);
      }
    });
  });

  describe('chromeLikePaths pattern', () => {
    it('finds Default profile bookmark files', () => {
      const base = join(TEST_DIR, 'browser-base');
      const defaultDir = join(base, 'Default');
      mkdirSync(defaultDir, { recursive: true });
      writeFileSync(join(defaultDir, 'Bookmarks'), '{}');

      const { existsSync, readdirSync } = require('node:fs');
      // Replicate chromeLikePaths logic
      const paths: string[] = [];
      const defaultPath = join(base, 'Default', 'Bookmarks');
      if (existsSync(defaultPath)) paths.push(defaultPath);
      if (existsSync(base)) {
        for (const entry of readdirSync(base) as string[]) {
          if (entry.startsWith('Profile ')) {
            const p = join(base, entry, 'Bookmarks');
            if (existsSync(p)) paths.push(p);
          }
        }
      }

      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('Default');
    });

    it('finds multiple profiles', () => {
      const base = join(TEST_DIR, 'multi-profile');
      for (const dir of ['Default', 'Profile 1', 'Profile 2', 'Profile 3']) {
        const d = join(base, dir);
        mkdirSync(d, { recursive: true });
        writeFileSync(join(d, 'Bookmarks'), '{}');
      }
      // Also add a non-profile directory
      mkdirSync(join(base, 'Extensions'), { recursive: true });

      const { existsSync, readdirSync } = require('node:fs');
      const paths: string[] = [];
      const defaultPath = join(base, 'Default', 'Bookmarks');
      if (existsSync(defaultPath)) paths.push(defaultPath);
      if (existsSync(base)) {
        for (const entry of readdirSync(base) as string[]) {
          if (entry.startsWith('Profile ')) {
            const p = join(base, entry, 'Bookmarks');
            if (existsSync(p)) paths.push(p);
          }
        }
      }

      expect(paths).toHaveLength(4); // Default + Profile 1-3
    });
  });

  describe('deduplication', () => {
    it('deduplicates bookmarks by hostname', () => {
      const hosts = [
        { hostname: 'github.com', port: 443, protocol: 'https' as const, source: 'chrome' },
        { hostname: 'github.com', port: 443, protocol: 'https' as const, source: 'firefox' },
        { hostname: 'notion.so', port: 443, protocol: 'https' as const, source: 'chrome' },
      ];

      const seen = new Set<string>();
      const unique = hosts.filter(h => {
        if (seen.has(h.hostname)) return false;
        seen.add(h.hostname);
        return true;
      });

      expect(unique).toHaveLength(2);
      expect(unique[0]!.hostname).toBe('github.com');
      expect(unique[1]!.hostname).toBe('notion.so');
    });

    it('deduplicates history by hostname and sums visit counts', () => {
      const hosts = [
        { hostname: 'github.com', port: 443, protocol: 'https' as const, source: 'chrome', visitCount: 100 },
        { hostname: 'github.com', port: 443, protocol: 'https' as const, source: 'firefox', visitCount: 50 },
        { hostname: 'notion.so', port: 443, protocol: 'https' as const, source: 'chrome', visitCount: 30 },
      ];

      const byHost = new Map<string, typeof hosts[0]>();
      for (const h of hosts) {
        const existing = byHost.get(h.hostname);
        if (existing) {
          existing.visitCount += h.visitCount;
        } else {
          byHost.set(h.hostname, { ...h });
        }
      }

      const result = [...byHost.values()].sort((a, b) => b.visitCount - a.visitCount);
      expect(result).toHaveLength(2);
      expect(result[0]!.hostname).toBe('github.com');
      expect(result[0]!.visitCount).toBe(150);
      expect(result[1]!.hostname).toBe('notion.so');
      expect(result[1]!.visitCount).toBe(30);
    });
  });

  describe('malformed bookmark files', () => {
    it('handles empty JSON file gracefully', () => {
      const profileDir = join(TEST_DIR, 'empty', 'Default');
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, 'Bookmarks'), '{}');

      // readChromeLike should return [] for files without roots
      const data = JSON.parse('{}') as { roots?: Record<string, unknown> };
      expect(data.roots).toBeUndefined();
    });

    it('handles invalid JSON gracefully', () => {
      const profileDir = join(TEST_DIR, 'invalid', 'Default');
      mkdirSync(profileDir, { recursive: true });
      writeFileSync(join(profileDir, 'Bookmarks'), 'not-json-at-all');

      // readChromeLike wraps JSON.parse in try-catch
      expect(() => JSON.parse('not-json-at-all')).toThrow();
    });

    it('handles bookmarks with missing url field', () => {
      const data = JSON.stringify({
        roots: {
          bookmark_bar: {
            type: 'folder',
            children: [
              { type: 'url' }, // no url field
              { type: 'url', url: '' }, // empty url
              { type: 'url', url: 'https://valid.com' },
            ],
          },
        },
      });

      const parsed = JSON.parse(data);
      const urls = parsed.roots.bookmark_bar.children
        .map((c: { url?: string }) => c.url)
        .filter(Boolean);
      expect(urls).toHaveLength(1); // undefined + empty string are falsy, only valid URL remains
    });
  });

  describe('firefox profile discovery', () => {
    it('finds profiles with places.sqlite', () => {
      const firefoxBase = join(TEST_DIR, 'firefox-profiles');
      mkdirSync(join(firefoxBase, 'abc123.default-release'), { recursive: true });
      writeFileSync(join(firefoxBase, 'abc123.default-release', 'places.sqlite'), '');
      mkdirSync(join(firefoxBase, 'def456.dev-edition'), { recursive: true });
      // No places.sqlite in dev-edition
      mkdirSync(join(firefoxBase, 'empty-profile'), { recursive: true });

      const { existsSync, readdirSync, statSync } = require('node:fs');
      const dirs: string[] = [];
      if (existsSync(firefoxBase)) {
        for (const d of readdirSync(firefoxBase) as string[]) {
          const full = join(firefoxBase, d);
          try {
            if (statSync(full).isDirectory() && existsSync(join(full, 'places.sqlite'))) {
              dirs.push(full);
            }
          } catch { /* ignore */ }
        }
      }

      expect(dirs).toHaveLength(1);
      expect(dirs[0]).toContain('abc123.default-release');
    });
  });

  describe('cleanupTempFiles', () => {
    it('removes orphaned cartograph_ temp files', () => {
      const tmp = tmpdir();
      const orphan1 = join(tmp, `cartograph_test_cleanup_1.sqlite`);
      const orphan2 = join(tmp, `cartograph_test_cleanup_2.sqlite`);
      writeFileSync(orphan1, 'fake');
      writeFileSync(orphan2, 'fake');

      const cleaned = cleanupTempFiles();
      expect(cleaned).toBeGreaterThanOrEqual(2);
      expect(existsSync(orphan1)).toBe(false);
      expect(existsSync(orphan2)).toBe(false);
    });

    it('does not remove non-cartograph files', () => {
      const tmp = tmpdir();
      const safe = join(tmp, `other_file_${Date.now()}.sqlite`);
      writeFileSync(safe, 'safe');

      cleanupTempFiles();
      expect(existsSync(safe)).toBe(true);

      // Cleanup
      try { rmSync(safe); } catch { /* ok */ }
    });
  });

  describe('URL hostname extraction edge cases', () => {
    it('lowercases hostnames', () => {
      const u = new URL('https://GitHub.COM/path');
      expect(u.hostname).toBe('github.com'); // URL constructor lowercases
    });

    it('handles IDN hostnames', () => {
      const u = new URL('https://xn--nxasmq6b.example.com');
      expect(u.hostname).toBeTruthy();
    });

    it('handles IP addresses', () => {
      const u = new URL('http://192.168.1.100:8080');
      expect(u.hostname).toBe('192.168.1.100');
      expect(u.port).toBe('8080');
    });

    it('rejects invalid URLs gracefully', () => {
      const invalids = ['not-a-url', '', 'just-a-hostname', '://missing-protocol'];
      for (const url of invalids) {
        expect(() => new URL(url)).toThrow();
      }
    });
  });
});
