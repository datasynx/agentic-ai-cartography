import { describe, it, expect } from 'vitest';
import { safetyHook } from '../src/safety.js';

describe('safetyHook', () => {
  it('allows read-only commands', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'ss -tlnp' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('blocks rm commands', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/test' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks docker rm', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'docker rm mycontainer' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks kubectl delete', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'kubectl delete pod mypod' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks redirect operators', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'echo test > /etc/passwd' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('allows non-Bash tools', async () => {
    const result = await safetyHook({ tool_name: 'Read', tool_input: { path: '/etc/hosts' } });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('allows ps aux', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'ps aux' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('allows curl -s GET', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'curl -s http://localhost:3000/health' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('blocks curl POST', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'curl -X POST http://api/data' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});
