import { describe, it, expect } from 'vitest';
import { stripSensitive, createScanRunner, clampText } from '../src/tools.js';

describe('stripSensitive', () => {
  it('strips path from tcp addresses', () => {
    expect(stripSensitive('localhost:5432/mydb')).toBe('localhost:5432');
  });

  it('strips credentials from URLs', () => {
    expect(stripSensitive('http://user:pass@host:5432/db')).toBe('host:5432');
  });

  it('strips query strings', () => {
    expect(stripSensitive('localhost:3000?token=secret')).toBe('localhost:3000');
  });

  it('keeps plain host:port', () => {
    expect(stripSensitive('redis:6379')).toBe('redis:6379');
  });

  it('handles HTTP URLs', () => {
    expect(stripSensitive('http://api.internal:8080/v1/users')).toBe('api.internal:8080');
  });

  it('handles bare hostnames', () => {
    expect(stripSensitive('postgres')).toBe('postgres');
  });

  // ── Edge Cases ──

  it('handles HTTPS URLs', () => {
    expect(stripSensitive('https://api.example.com/v1/users')).toBe('api.example.com');
  });

  it('handles URL with port and path', () => {
    expect(stripSensitive('https://api.example.com:8443/health')).toBe('api.example.com:8443');
  });

  it('handles IPv4 addresses', () => {
    expect(stripSensitive('192.168.1.1:3306')).toBe('192.168.1.1:3306');
  });

  it('handles URL with fragment', () => {
    expect(stripSensitive('http://example.com:8080/path#section')).toBe('example.com:8080');
  });

  it('strips user@ without password', () => {
    expect(stripSensitive('http://admin@host:5432/db')).toBe('host:5432');
  });

  it('handles empty port in URL', () => {
    expect(stripSensitive('http://example.com')).toBe('example.com');
  });

  it('handles hostname with dots', () => {
    expect(stripSensitive('my.internal.service:9090')).toBe('my.internal.service:9090');
  });

  it('handles host:port with trailing slash', () => {
    expect(stripSensitive('localhost:3000/')).toBe('localhost:3000');
  });

  it('returns empty string for empty input', () => {
    expect(stripSensitive('')).toBe('');
  });

  it('trims whitespace', () => {
    expect(stripSensitive('  localhost:3000  ')).toBe('localhost:3000');
  });

  it('never returns empty for valid URL', () => {
    const result = stripSensitive('http://');
    expect(result.length).toBeGreaterThan(0);
  });

  it('preserves bare IP without port', () => {
    expect(stripSensitive('10.0.0.1')).toBe('10.0.0.1');
  });
});

describe('clampText (output limit + sanitization)', () => {
  it('returns short output unchanged', () => {
    expect(clampText('hello', 100)).toBe('hello');
  });

  it('truncates output over the limit and appends a notice', () => {
    const out = clampText('x'.repeat(500), 100);
    expect(out.startsWith('x'.repeat(100))).toBe(true);
    expect(out).toContain('output truncated');
    expect(out).toContain('400 more characters');
  });

  it('sanitizes invisible characters before measuring/returning', () => {
    const zwsp = String.fromCodePoint(0x200b);
    expect(clampText(`a${zwsp}b${zwsp}c`, 100)).toBe('abc');
  });

  it('counts length after sanitization (invisible chars do not consume budget)', () => {
    const zwsp = String.fromCodePoint(0x200b);
    const raw = ('a' + zwsp).repeat(100); // 200 chars raw, 100 after strip
    expect(clampText(raw, 100)).toBe('a'.repeat(100));
  });
});

describe('createScanRunner (circuit breaker)', () => {
  it('returns output for successful commands', () => {
    const runner = createScanRunner(() => 'ok');
    expect(runner('test')).toBe('ok');
  });

  it('resets counter after success', () => {
    let callCount = 0;
    const runner = createScanRunner(() => {
      callCount++;
      return callCount === 2 ? 'ok' : '';
    }, { threshold: 3 });

    expect(runner('a')).toBe('(error or not available)');
    expect(runner('b')).toBe('ok');
    expect(runner('c')).toBe('(error or not available)');
    expect(runner('d')).toBe('(error or not available)');
    // Counter was reset at call 2, so only 2 consecutive failures now
    expect(runner('e')).toBe('(error or not available)');
    // Now 3 consecutive → tripped
    expect(runner('f')).toContain('circuit breaker');
  });

  it('trips after threshold consecutive failures', () => {
    const runner = createScanRunner(() => '', { threshold: 2 });
    expect(runner('a')).toBe('(error or not available)');
    expect(runner('b')).toBe('(error or not available)');
    // Now tripped
    expect(runner('c')).toContain('circuit breaker');
    expect(runner('d')).toContain('circuit breaker');
  });

  it('uses default threshold of 3', () => {
    const runner = createScanRunner(() => '');
    runner('a');
    runner('b');
    expect(runner('c')).toBe('(error or not available)');
    expect(runner('d')).toContain('circuit breaker');
  });

  it('passes timeout and env to runFn', () => {
    let receivedOpts: { timeout?: number; env?: NodeJS.ProcessEnv } | undefined;
    const env = { PATH: '/usr/bin' };
    const runner = createScanRunner((_cmd, opts) => {
      receivedOpts = opts;
      return 'ok';
    }, { timeout: 5000, env });

    runner('test');
    expect(receivedOpts?.timeout).toBe(5000);
    expect(receivedOpts?.env).toBe(env);
  });

  it('uses 20s default timeout', () => {
    let receivedTimeout: number | undefined;
    const runner = createScanRunner((_cmd, opts) => {
      receivedTimeout = opts?.timeout;
      return 'ok';
    });

    runner('test');
    expect(receivedTimeout).toBe(20_000);
  });
});
