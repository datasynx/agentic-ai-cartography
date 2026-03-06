import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';

// We need to mock child_process and fs before importing
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import { checkPrerequisites } from '../src/preflight.js';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('checkPrerequisites', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetAllMocks();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('succeeds when Claude CLI exists and API key is set', () => {
    mockExecSync.mockReturnValue(Buffer.from('1.0.0'));
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    expect(() => checkPrerequisites()).not.toThrow();
  });

  it('throws when Claude CLI is not found', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(() => checkPrerequisites()).toThrow('Claude CLI not found');
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('warns when no auth is configured', () => {
    mockExecSync.mockReturnValue(Buffer.from('1.0.0'));
    mockExistsSync.mockReturnValue(false);
    checkPrerequisites();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Keine Authentifizierung');
  });

  it('succeeds with OAuth login (no API key)', () => {
    mockExecSync.mockReturnValue(Buffer.from('1.0.0'));
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      claudeAiOauth: { accessToken: 'valid-token' },
    }));
    checkPrerequisites();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Eingeloggt via claude login');
  });

  it('handles malformed credentials file gracefully', () => {
    mockExecSync.mockReturnValue(Buffer.from('1.0.0'));
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('not valid json{{{');
    // No API key either — should warn about missing auth
    checkPrerequisites();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Keine Authentifizierung');
  });

  it('handles empty accessToken', () => {
    mockExecSync.mockReturnValue(Buffer.from('1.0.0'));
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({
      claudeAiOauth: { accessToken: '' },
    }));
    checkPrerequisites();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Keine Authentifizierung');
  });

  it('handles missing claudeAiOauth field', () => {
    mockExecSync.mockReturnValue(Buffer.from('1.0.0'));
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ someOtherField: true }));
    checkPrerequisites();
    const output = stderrSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('Keine Authentifizierung');
  });
});
