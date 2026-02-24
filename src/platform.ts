/**
 * Cross-platform utilities for Linux, macOS, and Windows.
 * Centralizes all OS-specific logic so scanning tools work everywhere.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// ── Platform detection ───────────────────────────────────────────────────────

export type Platform = 'linux' | 'darwin' | 'win32';

export const PLATFORM: Platform = process.platform as Platform;
export const IS_WIN = PLATFORM === 'win32';
export const IS_MAC = PLATFORM === 'darwin';
export const IS_LINUX = PLATFORM === 'linux';
export const HOME = homedir();

// ── Shell selection ──────────────────────────────────────────────────────────

/**
 * Returns the correct shell for execSync on each platform.
 * - Windows: PowerShell (pwsh if available, otherwise powershell.exe)
 * - macOS/Linux: /bin/sh
 */
export function platformShell(): string {
  if (!IS_WIN) return '/bin/sh';
  // Prefer pwsh (PowerShell 7+) over powershell.exe (5.1)
  try {
    execSync('pwsh -Version', { stdio: 'pipe', timeout: 3000 });
    return 'pwsh';
  } catch {
    return 'powershell.exe';
  }
}

/** Cached shell value (computed once) */
let _shell: string | undefined;
export function getShell(): string {
  if (!_shell) _shell = platformShell();
  return _shell;
}

// ── Cross-platform command runner ────────────────────────────────────────────

export interface RunOptions {
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Run a shell command, returning stdout as string. Returns '' on error.
 * Automatically uses the correct shell for the platform.
 */
export function run(cmd: string, opts: RunOptions = {}): string {
  try {
    return execSync(cmd, {
      stdio: 'pipe',
      timeout: opts.timeout ?? 10_000,
      shell: getShell(),
      env: opts.env,
    }).toString().trim();
  } catch {
    return '';
  }
}

// ── Command existence check (cross-platform `which`) ─────────────────────────

/**
 * Check if a command exists. Returns its path or '' if not found.
 * - Unix: `which <cmd>`
 * - Windows: `Get-Command <cmd>` via PowerShell
 */
export function commandExists(cmd: string): string {
  if (IS_WIN) {
    const r = run(`Get-Command ${cmd} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source`, { timeout: 5000 });
    return r;
  }
  return run(`which ${cmd} 2>/dev/null`);
}

// ── Null device ──────────────────────────────────────────────────────────────

export const NULL_DEV = IS_WIN ? 'NUL' : '/dev/null';

// ── App data directories ─────────────────────────────────────────────────────

/** Returns the platform-specific user app data directory */
export function appDataDir(): string {
  if (IS_WIN) return process.env.LOCALAPPDATA ?? join(HOME, 'AppData', 'Local');
  if (IS_MAC) return join(HOME, 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME ?? join(HOME, '.config');
}

/** Returns the platform-specific user data directory (broader than config) */
export function userDataDir(): string {
  if (IS_WIN) return process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming');
  if (IS_MAC) return join(HOME, 'Library', 'Application Support');
  return process.env.XDG_DATA_HOME ?? join(HOME, '.local', 'share');
}

// ── Browser profile base paths (Chromium-based) ──────────────────────────────

export interface BrowserPaths {
  chrome: string;
  chromium: string;
  edge: string;
  brave: string;
  vivaldi: string;
  opera: string;
}

export function browserBasePaths(): BrowserPaths {
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA ?? join(HOME, 'AppData', 'Local');
    return {
      chrome:   join(local, 'Google', 'Chrome', 'User Data'),
      chromium: join(local, 'Chromium', 'User Data'),
      edge:     join(local, 'Microsoft', 'Edge', 'User Data'),
      brave:    join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      vivaldi:  join(local, 'Vivaldi', 'User Data'),
      opera:    join(userDataDir(), 'Opera Software', 'Opera Stable'),
    };
  }
  if (IS_MAC) {
    const lib = join(HOME, 'Library', 'Application Support');
    return {
      chrome:   join(lib, 'Google', 'Chrome'),
      chromium: join(lib, 'Chromium'),
      edge:     join(lib, 'Microsoft Edge'),
      brave:    join(lib, 'BraveSoftware', 'Brave-Browser'),
      vivaldi:  join(lib, 'Vivaldi'),
      opera:    join(lib, 'com.operasoftware.Opera'),
    };
  }
  // Linux
  return {
    chrome:   join(HOME, '.config', 'google-chrome'),
    chromium: join(HOME, '.config', 'chromium'),
    edge:     join(HOME, '.config', 'microsoft-edge'),
    brave:    join(HOME, '.config', 'BraveSoftware', 'Brave-Browser'),
    vivaldi:  join(HOME, '.config', 'vivaldi'),
    opera:    join(HOME, '.config', 'opera'),
  };
}

/** Firefox profile parent directories per platform */
export function firefoxBaseDirs(): string[] {
  if (IS_WIN) {
    const roaming = process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming');
    return [join(roaming, 'Mozilla', 'Firefox', 'Profiles')];
  }
  if (IS_MAC) {
    return [join(HOME, 'Library', 'Application Support', 'Firefox', 'Profiles')];
  }
  // Linux: standard + snap + flatpak
  return [
    join(HOME, '.mozilla', 'firefox'),
    join(HOME, 'snap', 'firefox', 'common', '.mozilla', 'firefox'),
    join(HOME, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox'),
  ];
}

// ── Database scan directories ────────────────────────────────────────────────

/** Returns directories to search for SQLite/DB files per platform */
export function dbScanDirs(): string[] {
  const dirs: string[] = [];
  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA ?? join(HOME, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? join(HOME, 'AppData', 'Roaming');
    dirs.push(local, roaming);
    const pd = join(HOME, 'AppData', 'Local', 'Programs');
    if (existsSync(pd)) dirs.push(pd);
  } else if (IS_MAC) {
    dirs.push(join(HOME, 'Library', 'Application Support'));
    if (existsSync('/var/lib')) dirs.push('/var/lib');
  } else {
    const configDir = join(HOME, '.config');
    const dataDir = join(HOME, '.local', 'share');
    if (existsSync(configDir)) dirs.push(configDir);
    if (existsSync(dataDir)) dirs.push(dataDir);
    if (existsSync('/var/lib')) dirs.push('/var/lib');
  }
  return dirs.filter(d => existsSync(d));
}

// ── File search (cross-platform find) ────────────────────────────────────────

/**
 * Search for files matching glob patterns in given directories.
 * - Unix: `find` command
 * - Windows: PowerShell `Get-ChildItem`
 */
export function findFiles(dirs: string[], patterns: string[], maxDepth: number, limit: number): string {
  if (dirs.length === 0) return '';
  if (IS_WIN) {
    const includes = patterns.map(p => `'${p}'`).join(',');
    const pathList = dirs.map(d => `'${d}'`).join(',');
    return run(
      `Get-ChildItem -Path ${pathList} -Recurse -Depth ${maxDepth} -Include ${includes} -ErrorAction SilentlyContinue | Select-Object -First ${limit} -ExpandProperty FullName`,
      { timeout: 15_000 },
    );
  }
  const nameArgs = patterns.map(p => `-name "${p}"`).join(' -o ');
  const findCmds = dirs.map(d => `find "${d}" -maxdepth ${maxDepth} \\( ${nameArgs} \\) 2>/dev/null`).join('; ');
  return run(`{ ${findCmds}; } | head -${limit}`, { timeout: 15_000 });
}

// ── Network scanning ─────────────────────────────────────────────────────────

/** Get all listening TCP ports and the processes behind them */
export function scanListeningPorts(): string {
  if (IS_WIN) {
    // PowerShell: Get-NetTCPConnection for listening ports + owning process
    return run(
      `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ` +
      `ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; ` +
      `"$($_.LocalAddress):$($_.LocalPort) PID=$($_.OwningProcess) $($p.ProcessName)" } | ` +
      `Sort-Object -Unique`,
      { timeout: 15_000 },
    );
  }
  if (IS_MAC) {
    // macOS: lsof is the most reliable way (ss not available)
    return run('sudo lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null || lsof -iTCP -sTCP:LISTEN -n -P 2>/dev/null', { timeout: 15_000 });
  }
  // Linux: ss is the standard tool
  return run('ss -tlnp 2>/dev/null', { timeout: 10_000 });
}

/** Get running processes (cross-platform) */
export function scanProcesses(): string {
  if (IS_WIN) {
    return run(
      `Get-Process | Select-Object -Property Id, ProcessName, Path | Format-Table -AutoSize | Out-String -Width 200`,
      { timeout: 15_000 },
    );
  }
  return run('ps aux 2>/dev/null', { timeout: 10_000 });
}

// ── Windows-specific: installed programs ─────────────────────────────────────

/** Scan Windows registry for installed programs */
export function scanWindowsPrograms(): string {
  if (!IS_WIN) return '';
  return run(
    `$paths = @(` +
    `'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',` +
    `'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',` +
    `'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'` +
    `); Get-ItemProperty $paths -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.DisplayName } | ` +
    `Select-Object -Property DisplayName, Publisher, DisplayVersion | ` +
    `Sort-Object DisplayName | ` +
    `Format-Table -AutoSize | Out-String -Width 300`,
    { timeout: 20_000 },
  );
}

/** Scan Windows services for database engines */
export function scanWindowsDbServices(): string {
  if (!IS_WIN) return '';
  return run(
    `Get-Service | Where-Object { ` +
    `$_.Name -match 'postgres|mysql|mariadb|mongo|redis|MSSQL|elastic|clickhouse|cassandra' ` +
    `} | Select-Object Name, DisplayName, Status, StartType | Format-Table -AutoSize`,
    { timeout: 10_000 },
  );
}

// ── file:// URL helper ───────────────────────────────────────────────────────

/** Generate a correct file:// URL for the current platform */
export function fileUrl(absPath: string): string {
  if (IS_WIN) {
    // Windows: file:///C:/Users/... (forward slashes, triple slash)
    const normalized = absPath.replace(/\\/g, '/');
    return `file:///${normalized}`;
  }
  return `file://${absPath}`;
}
