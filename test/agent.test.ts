import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiscoveryEvent } from '../src/agent.js';
import type { CartographyConfig } from '../src/types.js';

// Mock the Claude Agent SDK
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock tools.ts to avoid SDK dependency
vi.mock('../src/tools.js', () => ({
  createCartographyTools: vi.fn().mockResolvedValue({}),
}));

// Mock safety.ts
vi.mock('../src/safety.js', () => ({
  safetyHook: vi.fn(),
}));

function makeConfig(overrides: Partial<CartographyConfig> = {}): CartographyConfig {
  return {
    maxDepth: 8,
    maxTurns: 5,
    entryPoints: ['localhost'],
    agentModel: 'claude-sonnet-4-5-20250929',
    outputDir: '/tmp/test-output',
    dbPath: '/tmp/test.db',
    verbose: false,
    ...overrides,
  };
}

function makeMockDb() {
  return {
    upsertNode: vi.fn(),
    insertEdge: vi.fn(),
    getNodes: vi.fn().mockReturnValue([]),
    getEdges: vi.fn().mockReturnValue([]),
    createSession: vi.fn().mockReturnValue('test-session'),
    endSession: vi.fn(),
    close: vi.fn(),
  } as unknown as import('../src/db.js').CartographyDB;
}

describe('agent.ts — runDiscovery', () => {
  let mockQuery: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    mockQuery = sdk.query as ReturnType<typeof vi.fn>;
  });

  it('emits done event on successful completion', async () => {
    // Simulate a query that yields a result message immediately
    async function* fakeQuery() {
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await runDiscovery(config, db, 'session-1', (e) => events.push(e));

    expect(events.some(e => e.kind === 'done')).toBe(true);
  });

  it('emits turn and thinking events for assistant messages', async () => {
    async function* fakeQuery() {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Scanning infrastructure...' },
          ],
        },
      };
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await runDiscovery(config, db, 'session-1', (e) => events.push(e));

    expect(events.some(e => e.kind === 'turn')).toBe(true);
    expect(events.some(e => e.kind === 'thinking')).toBe(true);
    const thinking = events.find(e => e.kind === 'thinking') as Extract<DiscoveryEvent, { kind: 'thinking' }>;
    expect(thinking.text).toBe('Scanning infrastructure...');
  });

  it('emits tool_call events for tool_use blocks', async () => {
    async function* fakeQuery() {
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'mcp__cartograph__save_node',
              input: { id: 'test:node', type: 'host' },
            },
          ],
        },
      };
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await runDiscovery(config, db, 'session-1', (e) => events.push(e));

    const toolCall = events.find(e => e.kind === 'tool_call') as Extract<DiscoveryEvent, { kind: 'tool_call' }>;
    expect(toolCall).toBeDefined();
    expect(toolCall.tool).toBe('mcp__cartograph__save_node');
    expect(toolCall.input).toEqual({ id: 'test:node', type: 'host' });
  });

  it('emits tool_result events for user messages with tool results', async () => {
    async function* fakeQuery() {
      yield {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-123',
              content: 'Node saved',
            },
          ],
        },
      };
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await runDiscovery(config, db, 'session-1', (e) => events.push(e));

    const toolResult = events.find(e => e.kind === 'tool_result') as Extract<DiscoveryEvent, { kind: 'tool_result' }>;
    expect(toolResult).toBeDefined();
    expect(toolResult.output).toBe('Node saved');
  });

  it('emits error event and rethrows on query failure', async () => {
    async function* fakeQuery() {
      throw new Error('API rate limit exceeded');
      yield; // never reached
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await expect(
      runDiscovery(config, db, 'session-1', (e) => events.push(e))
    ).rejects.toThrow('API rate limit exceeded');

    const errorEvent = events.find(e => e.kind === 'error') as Extract<DiscoveryEvent, { kind: 'error' }>;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.text).toContain('API rate limit exceeded');
  });

  it('works without onEvent callback', async () => {
    async function* fakeQuery() {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'test' }] },
      };
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const config = makeConfig();
    const db = makeMockDb();

    // Should not throw without onEvent
    await expect(
      runDiscovery(config, db, 'session-1')
    ).resolves.toBeUndefined();
  });

  it('handles non-Error throw in catch block', async () => {
    async function* fakeQuery() {
      throw 'string error'; // non-Error throw
      yield;
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await expect(
      runDiscovery(config, db, 'session-1', (e) => events.push(e))
    ).rejects.toBe('string error');

    const errorEvent = events.find(e => e.kind === 'error') as Extract<DiscoveryEvent, { kind: 'error' }>;
    expect(errorEvent.text).toContain('string error');
  });

  it('increments turn count for each assistant message', async () => {
    async function* fakeQuery() {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'turn 1' }] },
      };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'turn 2' }] },
      };
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'turn 3' }] },
      };
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await runDiscovery(config, db, 'session-1', (e) => events.push(e));

    const turns = events.filter(e => e.kind === 'turn') as Extract<DiscoveryEvent, { kind: 'turn' }>[];
    expect(turns).toHaveLength(3);
    expect(turns[0]!.turn).toBe(1);
    expect(turns[1]!.turn).toBe(2);
    expect(turns[2]!.turn).toBe(3);
  });

  it('passes hint to system prompt when provided', async () => {
    async function* fakeQuery() {
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const config = makeConfig();
    const db = makeMockDb();

    await runDiscovery(config, db, 'session-1', undefined, undefined, 'hubspot windsurf');

    // Verify query was called with hint in the prompt
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockQuery.mock.calls[0][0];
    expect(callArgs.prompt).toContain('hubspot windsurf');
  });

  it('handles mixed content blocks in assistant messages', async () => {
    async function* fakeQuery() {
      yield {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Thinking about tools...' },
            { type: 'tool_use', name: 'Bash', input: { command: 'ss -tlnp' } },
            { type: 'text', text: 'Analyzing results...' },
          ],
        },
      };
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await runDiscovery(config, db, 'session-1', (e) => events.push(e));

    const thinkingEvents = events.filter(e => e.kind === 'thinking');
    const toolCallEvents = events.filter(e => e.kind === 'tool_call');
    expect(thinkingEvents).toHaveLength(2);
    expect(toolCallEvents).toHaveLength(1);
  });

  it('handles user messages with non-array content', async () => {
    async function* fakeQuery() {
      yield {
        type: 'user',
        message: { content: 'plain string content' },
      };
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    // Should not throw
    await runDiscovery(config, db, 'session-1', (e) => events.push(e));
    expect(events.some(e => e.kind === 'done')).toBe(true);
  });

  it('handles user messages with null message', async () => {
    async function* fakeQuery() {
      yield { type: 'user', message: null };
      yield { type: 'result' };
    }
    mockQuery.mockReturnValue(fakeQuery());

    const { runDiscovery } = await import('../src/agent.js');
    const events: DiscoveryEvent[] = [];
    const config = makeConfig();
    const db = makeMockDb();

    await runDiscovery(config, db, 'session-1', (e) => events.push(e));
    expect(events.some(e => e.kind === 'done')).toBe(true);
  });
});
