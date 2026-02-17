import { z } from 'zod';
import type { CartographDB } from './db.js';
import { NODE_TYPES, EDGE_RELATIONSHIPS, EVENT_TYPES, SOPStepSchema } from './types.js';

// Lazy import to avoid hard-wiring SDK at module parse time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpServer = any;

export function stripSensitive(target: string): string {
  try {
    const url = new URL(target.startsWith('http') ? target : `tcp://${target}`);
    return `${url.hostname}${url.port ? ':' + url.port : ''}`;
  } catch {
    return target
      .replace(/\/.*$/, '')
      .replace(/\?.*$/, '')
      .replace(/@.*:/, ':');
  }
}

export async function createCartographTools(db: CartographDB, sessionId: string): Promise<McpServer> {
  // Dynamically import the SDK so missing package doesn't crash at load time
  const sdk = await import('@anthropic-ai/claude-code');
  const { tool, createSdkMcpServer } = sdk as {
    tool: (name: string, description: string, schema: z.ZodRawShape, handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>) => unknown;
    createSdkMcpServer: (opts: { name: string; version: string; tools: unknown[] }) => McpServer;
  };

  const tools = [
    tool('save_node', 'Infrastructure-Node speichern', {
      id: z.string(),
      type: z.enum(NODE_TYPES),
      name: z.string(),
      discoveredVia: z.string(),
      confidence: z.number().min(0).max(1),
      metadata: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
    }, async (args) => {
      const node = {
        id: stripSensitive(args['id'] as string),
        type: args['type'] as typeof NODE_TYPES[number],
        name: args['name'] as string,
        discoveredVia: args['discoveredVia'] as string,
        confidence: args['confidence'] as number,
        metadata: (args['metadata'] as Record<string, unknown>) ?? {},
        tags: (args['tags'] as string[]) ?? [],
      };
      db.upsertNode(sessionId, node);
      return { content: [{ type: 'text', text: `✓ Node: ${node.id}` }] };
    }),

    tool('save_edge', 'Verbindung zwischen zwei Nodes speichern', {
      sourceId: z.string(),
      targetId: z.string(),
      relationship: z.enum(EDGE_RELATIONSHIPS),
      evidence: z.string(),
      confidence: z.number().min(0).max(1),
    }, async (args) => {
      db.insertEdge(sessionId, {
        sourceId: args['sourceId'] as string,
        targetId: args['targetId'] as string,
        relationship: args['relationship'] as typeof EDGE_RELATIONSHIPS[number],
        evidence: args['evidence'] as string,
        confidence: args['confidence'] as number,
      });
      return { content: [{ type: 'text', text: `✓ ${args['sourceId']}→${args['targetId']}` }] };
    }),

    tool('save_event', 'Activity-Event (Prozess/Verbindung) speichern', {
      eventType: z.enum(EVENT_TYPES),
      process: z.string(),
      pid: z.number(),
      target: z.string().optional(),
      targetType: z.enum(NODE_TYPES).optional(),
      port: z.number().optional(),
    }, async (args) => {
      db.insertEvent(sessionId, {
        eventType: args['eventType'] as typeof EVENT_TYPES[number],
        process: args['process'] as string,
        pid: args['pid'] as number,
        target: args['target'] ? stripSensitive(args['target'] as string) : undefined,
        targetType: args['targetType'] as typeof NODE_TYPES[number] | undefined,
        port: args['port'] as number | undefined,
      });
      return { content: [{ type: 'text', text: `✓ ${args['eventType']}` }] };
    }),

    tool('get_catalog', 'Aktuellen Katalog abrufen (Duplikat-Check)', {
      includeEdges: z.boolean().default(true),
    }, async (args) => {
      const nodes = db.getNodes(sessionId);
      const edges = (args['includeEdges'] as boolean) ? db.getEdges(sessionId) : [];
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: { nodes: nodes.length, edges: edges.length },
            nodeIds: nodes.map(n => n.id),
          }),
        }],
      };
    }),

    tool('manage_task', 'Task starten, beenden oder beschreiben', {
      action: z.enum(['start', 'end', 'describe']),
      description: z.string().optional(),
    }, async (args) => {
      const action = args['action'] as string;
      if (action === 'start') {
        const id = db.startTask(sessionId, args['description'] as string | undefined);
        return { content: [{ type: 'text', text: `✓ Task gestartet: ${id}` }] };
      }
      if (action === 'end') {
        db.endCurrentTask(sessionId);
        return { content: [{ type: 'text', text: '✓ Task beendet' }] };
      }
      db.updateTaskDescription(sessionId, args['description'] as string);
      return { content: [{ type: 'text', text: '✓ Beschreibung aktualisiert' }] };
    }),

    tool('save_sop', 'Standard Operating Procedure speichern', {
      workflowId: z.string(),
      title: z.string(),
      description: z.string(),
      steps: z.array(SOPStepSchema),
      involvedSystems: z.array(z.string()),
      estimatedDuration: z.string(),
      frequency: z.string(),
      confidence: z.number().min(0).max(1),
    }, async (args) => {
      db.insertSOP({
        workflowId: args['workflowId'] as string,
        title: args['title'] as string,
        description: args['description'] as string,
        steps: args['steps'] as ReturnType<typeof SOPStepSchema.parse>[],
        involvedSystems: args['involvedSystems'] as string[],
        estimatedDuration: args['estimatedDuration'] as string,
        frequency: args['frequency'] as string,
        confidence: args['confidence'] as number,
      });
      return { content: [{ type: 'text', text: `✓ SOP: ${args['title']}` }] };
    }),
  ];

  return createSdkMcpServer({
    name: 'cartograph',
    version: '0.1.0',
    tools,
  });
}
