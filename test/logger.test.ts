import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, logInfo, logError, logWarn, logDebug, setVerbose } from '../src/logger.js';

describe('structured logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    setVerbose(false);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    setVerbose(false);
  });

  it('outputs JSON to stderr', () => {
    logInfo('test message');
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('INFO');
    expect(parsed.message).toBe('test message');
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('includes context when provided', () => {
    logInfo('with context', { sessionId: 'abc', nodes: 5 });
    const output = stderrSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.context.sessionId).toBe('abc');
    expect(parsed.context.nodes).toBe(5);
  });

  it('omits context key when no context', () => {
    logInfo('no context');
    const output = stderrSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.context).toBeUndefined();
  });

  it('suppresses DEBUG logs when verbose is off', () => {
    logDebug('should be hidden');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('shows DEBUG logs when verbose is on', () => {
    setVerbose(true);
    logDebug('should be visible');
    expect(stderrSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(stderrSpy.mock.calls[0]![0] as string);
    expect(parsed.level).toBe('DEBUG');
  });

  it('logs errors', () => {
    logError('something broke', { error: 'timeout' });
    const parsed = JSON.parse(stderrSpy.mock.calls[0]![0] as string);
    expect(parsed.level).toBe('ERROR');
    expect(parsed.context.error).toBe('timeout');
  });

  it('logs warnings', () => {
    logWarn('heads up');
    const parsed = JSON.parse(stderrSpy.mock.calls[0]![0] as string);
    expect(parsed.level).toBe('WARN');
  });

  it('log() with all levels', () => {
    log('INFO', 'info');
    log('WARN', 'warn');
    log('ERROR', 'error');
    expect(stderrSpy).toHaveBeenCalledTimes(3);
  });

  it('outputs newline-terminated JSON (for log aggregators)', () => {
    logInfo('test');
    const output = stderrSpy.mock.calls[0]![0] as string;
    expect(output.endsWith('\n')).toBe(true);
  });
});
