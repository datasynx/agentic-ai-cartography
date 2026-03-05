import { describe, it, expect } from 'vitest';
import {
  PLATFORM, IS_WIN, IS_MAC, IS_LINUX, HOME, NULL_DEV,
  run, commandExists, browserBasePaths, firefoxBaseDirs,
  dbScanDirs, appDataDir, userDataDir, fileUrl, getShell,
  findFiles,
} from '../src/platform.js';

describe('platform constants', () => {
  it('PLATFORM is a valid value', () => {
    expect(['linux', 'darwin', 'win32']).toContain(PLATFORM);
  });

  it('exactly one platform flag is true', () => {
    const trueCount = [IS_WIN, IS_MAC, IS_LINUX].filter(Boolean).length;
    expect(trueCount).toBe(1);
  });

  it('HOME is a non-empty string', () => {
    expect(typeof HOME).toBe('string');
    expect(HOME.length).toBeGreaterThan(0);
  });

  it('NULL_DEV is correct for platform', () => {
    if (IS_WIN) {
      expect(NULL_DEV).toBe('NUL');
    } else {
      expect(NULL_DEV).toBe('/dev/null');
    }
  });
});

describe('run', () => {
  it('returns stdout for a simple command', () => {
    const result = run('echo hello');
    expect(result).toBe('hello');
  });

  it('returns empty string on failed command', () => {
    const result = run('nonexistent_command_12345');
    expect(result).toBe('');
  });

  it('returns empty string on timeout', () => {
    // Command that would take too long
    const result = run('sleep 10', { timeout: 100 });
    expect(result).toBe('');
  });

  it('trims whitespace from output', () => {
    const result = run('echo "  hello  "');
    expect(result).toBe('hello');
  });
});

describe('commandExists', () => {
  it('finds an existing command', () => {
    // 'echo' exists on all platforms
    const result = commandExists('node');
    expect(result.length).toBeGreaterThan(0);
  });

  it('returns empty string for non-existent command', () => {
    const result = commandExists('totally_fake_command_xyz_999');
    expect(result).toBe('');
  });
});

describe('getShell', () => {
  it('returns a non-empty shell path', () => {
    const shell = getShell();
    expect(typeof shell).toBe('string');
    expect(shell.length).toBeGreaterThan(0);
  });

  it('returns /bin/sh on Linux', () => {
    if (IS_LINUX || IS_MAC) {
      expect(getShell()).toBe('/bin/sh');
    }
  });
});

describe('appDataDir', () => {
  it('returns a non-empty string', () => {
    expect(appDataDir().length).toBeGreaterThan(0);
  });
});

describe('userDataDir', () => {
  it('returns a non-empty string', () => {
    expect(userDataDir().length).toBeGreaterThan(0);
  });
});

describe('browserBasePaths', () => {
  it('returns all required browser keys', () => {
    const paths = browserBasePaths();
    expect(paths).toHaveProperty('chrome');
    expect(paths).toHaveProperty('chromium');
    expect(paths).toHaveProperty('edge');
    expect(paths).toHaveProperty('brave');
    expect(paths).toHaveProperty('vivaldi');
    expect(paths).toHaveProperty('opera');
  });

  it('all paths are non-empty strings', () => {
    const paths = browserBasePaths();
    for (const [, v] of Object.entries(paths)) {
      expect(typeof v).toBe('string');
      expect(v.length).toBeGreaterThan(0);
    }
  });
});

describe('firefoxBaseDirs', () => {
  it('returns an array of paths', () => {
    const dirs = firefoxBaseDirs();
    expect(Array.isArray(dirs)).toBe(true);
    expect(dirs.length).toBeGreaterThan(0);
  });
});

describe('dbScanDirs', () => {
  it('returns an array', () => {
    const dirs = dbScanDirs();
    expect(Array.isArray(dirs)).toBe(true);
  });
});

describe('findFiles', () => {
  it('returns empty string for empty dirs', () => {
    expect(findFiles([], ['*.txt'], 2, 10)).toBe('');
  });
});

describe('fileUrl', () => {
  it('creates correct file URL for Unix paths', () => {
    if (!IS_WIN) {
      expect(fileUrl('/home/user/test.html')).toBe('file:///home/user/test.html');
    }
  });

  it('creates correct file URL for Windows paths', () => {
    if (IS_WIN) {
      const url = fileUrl('C:\\Users\\test\\file.html');
      expect(url).toContain('file:///');
      expect(url).toContain('C:/Users/test/file.html');
    }
  });
});
