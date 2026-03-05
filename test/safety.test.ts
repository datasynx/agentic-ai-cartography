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

  // ── Edge Cases ──

  it('handles empty command string', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: '' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('handles missing command property', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: {} });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('blocks mv command', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'mv /tmp/a /tmp/b' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks chmod', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'chmod 777 /etc/passwd' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks npm install', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'npm install express' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks pip install', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'pip install requests' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks append redirect (>>)', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'echo test >> /tmp/file' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks curl PUT', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'curl -X PUT http://api/data' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks curl DELETE', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'curl -X DELETE http://api/data/1' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks kill command', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'kill -9 1234' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks reboot', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'reboot' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks docker run', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'docker run -it ubuntu' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('allows docker ps', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'docker ps' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('allows kubectl get', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'kubectl get pods' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('blocks PowerShell Remove-Item', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'Remove-Item C:\\temp\\file.txt' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks PowerShell Stop-Process', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'Stop-Process -Id 1234' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('blocks systemctl start', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'systemctl start nginx' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  it('allows systemctl status', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'systemctl status nginx' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  it('passes through non-hook events (no tool_name)', async () => {
    const result = await safetyHook({ some_other_field: 'test' });
    expect(result).toEqual({});
  });

  it('blocks case-insensitive RM command', async () => {
    const result = await safetyHook({ tool_name: 'Bash', tool_input: { command: 'RM -rf /tmp' } });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });
});
