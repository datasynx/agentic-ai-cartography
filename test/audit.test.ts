import { describe, it, expect } from 'vitest';
import { createAuditHook } from '../src/audit.js';
import { CartographyDB } from '../src/db.js';
import { defaultConfig } from '../src/types.js';

describe('createAuditHook (#72)', () => {
  it('records an executed tool call into activity_events', async () => {
    const db = new CartographyDB(':memory:');
    const sessionId = db.createSession('discover', defaultConfig());
    const hook = createAuditHook(db, sessionId);

    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'kubectl get pods' },
      tool_response: 'pod-a\npod-b\n',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await hook(input as any, 'tool-use-1', { signal: new AbortController().signal });

    const events = db.getEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]?.process).toBe('Bash');
    expect(events[0]?.command).toBe('kubectl get pods');
    expect(events[0]?.resultBytes).toBe(Buffer.byteLength('pod-a\npod-b\n'));
    db.close();
  });

  it('ignores inputs without a tool_name', async () => {
    const db = new CartographyDB(':memory:');
    const sessionId = db.createSession('discover', defaultConfig());
    const hook = createAuditHook(db, sessionId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await hook({ hook_event_name: 'Stop' } as any, undefined, { signal: new AbortController().signal });
    expect(db.getEvents(sessionId)).toHaveLength(0);
    db.close();
  });
});
