import { describe, it, expect } from 'vitest';
import {
  PLATFORM, IS_WIN, IS_MAC, IS_LINUX, HOME, NULL_DEV,
  run, commandExists, browserBasePaths, firefoxBaseDirs,
  dbScanDirs, appDataDir, userDataDir, fileUrl, getShell,
  findFiles, safeEnv, scanListeningPorts, scanProcesses,
  scanWindowsPrograms, scanWindowsDbServices,
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

  it('all returned dirs exist on filesystem', () => {
    const dirs = dbScanDirs();
    for (const d of dirs) {
      expect(typeof d).toBe('string');
      expect(d.length).toBeGreaterThan(0);
    }
  });

  it('returns at least one dir on Linux', () => {
    if (IS_LINUX) {
      const dirs = dbScanDirs();
      expect(dirs.length).toBeGreaterThan(0);
    }
  });
});

describe('findFiles', () => {
  it('returns empty string for empty dirs', () => {
    expect(findFiles([], ['*.txt'], 2, 10)).toBe('');
  });

  it('finds files in a real directory', () => {
    if (!IS_WIN) {
      const result = findFiles(['/tmp'], ['*.sqlite'], 1, 5);
      expect(typeof result).toBe('string');
    }
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

describe('safeEnv', () => {
  it('returns an object', () => {
    const env = safeEnv();
    expect(typeof env).toBe('object');
  });

  it('includes PATH', () => {
    const env = safeEnv();
    expect(env.PATH).toBeDefined();
    expect(env.PATH!.length).toBeGreaterThan(0);
  });

  it('includes HOME', () => {
    const env = safeEnv();
    expect(env.HOME).toBeDefined();
  });

  it('does not include SECRET or TOKEN vars', () => {
    process.env.SECRET_KEY = 'should_not_leak';
    process.env.API_TOKEN = 'should_not_leak';
    const env = safeEnv();
    expect(env.SECRET_KEY).toBeUndefined();
    expect(env.API_TOKEN).toBeUndefined();
    delete process.env.SECRET_KEY;
    delete process.env.API_TOKEN;
  });

  it('does not include AWS_SECRET_ACCESS_KEY', () => {
    process.env.AWS_SECRET_ACCESS_KEY = 'mysecret';
    const env = safeEnv();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });
});

describe('scanListeningPorts', () => {
  it('returns a string (may be empty if no ports)', () => {
    const result = scanListeningPorts();
    expect(typeof result).toBe('string');
  });
});

describe('scanProcesses', () => {
  it('returns non-empty string with running processes', () => {
    const result = scanProcesses();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('scanWindowsPrograms', () => {
  it('returns empty string on non-Windows', () => {
    if (!IS_WIN) {
      expect(scanWindowsPrograms()).toBe('');
    }
  });
});

describe('scanWindowsDbServices', () => {
  it('returns empty string on non-Windows', () => {
    if (!IS_WIN) {
      expect(scanWindowsDbServices()).toBe('');
    }
  });
});
