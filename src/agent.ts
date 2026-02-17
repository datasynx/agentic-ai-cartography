import type { CartographDB } from './db.js';
import { createCartographTools } from './tools.js';
import { safetyHook } from './safety.js';
import type { CartographConfig, TaskRow } from './types.js';

// ── runDiscovery ─────────────────────────────────────────────────────────────

export async function runDiscovery(
  config: CartographConfig,
  db: CartographDB,
  sessionId: string,
  onOutput?: (text: string) => void,
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');
  const tools = await createCartographTools(db, sessionId);

  const systemPrompt = `Du bist ein Infrastruktur-Discovery-Agent.
Kartographiere die gesamte Systemlandschaft.

STRATEGIE:
1. ss -tlnp + ps aux → Überblick
2. Jeden Service tiefer (Datenbanken→Tabellen, APIs→Endpoints, Queues→Topics)
3. save_node + save_edge für alles. get_catalog → keine Duplikate.
4. Config-Files folgen: .env (nur Host:Port!), docker-compose.yml, application.yml
5. Backtrack wenn Spur erschöpft. Stop wenn alles explored.

PORT-MAPPING: 5432=postgres, 3306=mysql, 27017=mongodb, 6379=redis,
9092=kafka, 5672=rabbitmq, 80/443/8080/3000=web_service,
9090=prometheus, 8500=consul, 8200=vault, 2379=etcd

REGELN:
- NUR read-only Commands (ss, ps, cat, head, curl -s, docker inspect, kubectl get)
- Targets NUR Host:Port — KEINE URLs, Pfade, Credentials
- Node IDs: "{type}:{host}:{port}" oder "{type}:{name}"
- Confidence: 0.9 direkt beobachtet, 0.7 aus Config, 0.5 Vermutung
- KEINE Credentials speichern

Entrypoints: ${config.entryPoints.join(', ')}`;

  for await (const msg of query({
    prompt: systemPrompt,
    options: {
      model: config.agentModel,
      maxTurns: config.maxTurns,
      customSystemPrompt: systemPrompt,
      mcpServers: { cartograph: tools },
      allowedTools: [
        'Bash',
        'mcp__cartograph__save_node',
        'mcp__cartograph__save_edge',
        'mcp__cartograph__get_catalog',
      ],
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [safetyHook] }],
      },
      permissionMode: 'bypassPermissions',
    },
  })) {
    if (msg.type === 'assistant' && onOutput) {
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          onOutput(block.text);
        }
      }
    }
    if (msg.type === 'result') return;
  }
}

// ── runShadowCycle ───────────────────────────────────────────────────────────

export async function runShadowCycle(
  config: CartographConfig,
  db: CartographDB,
  sessionId: string,
  prevSnapshot: string,
  currSnapshot: string,
  onOutput?: (msg: unknown) => void,
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');
  const tools = await createCartographTools(db, sessionId);

  const prompt = `Analysiere den Diff zwischen diesen beiden System-Snapshots.
Finde:
- Neue/geschlossene TCP-Verbindungen → save_event
- Neue/beendete Prozesse → save_event
- Bisher unbekannte Services → get_catalog prüfen, dann save_node
- Task-Grenzen (Inaktivität, Tool-Wechsel) → manage_task
target = NUR Host:Port. Kurz und effizient.

=== VORHER ===
${prevSnapshot}

=== JETZT ===
${currSnapshot}`;

  for await (const msg of query({
    prompt,
    options: {
      model: config.shadowModel,
      maxTurns: 5,
      mcpServers: { cartograph: tools },
      allowedTools: [
        'mcp__cartograph__save_event',
        'mcp__cartograph__save_node',
        'mcp__cartograph__save_edge',
        'mcp__cartograph__get_catalog',
        'mcp__cartograph__manage_task',
      ],
      permissionMode: 'bypassPermissions',
    },
  })) {
    if (onOutput) onOutput(msg);
  }
}

// ── generateSOPs ─────────────────────────────────────────────────────────────

export async function generateSOPs(db: CartographDB, sessionId: string): Promise<number> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();

  const tasks = db.getTasks(sessionId).filter(t => t.status === 'completed');
  if (tasks.length === 0) return 0;

  // Cluster tasks by involved services
  const clusters = clusterTasks(tasks);
  let generated = 0;

  for (const cluster of clusters) {
    const workflowId = crypto.randomUUID();
    const involved = JSON.parse(cluster[0]?.involvedServices ?? '[]') as string[];

    const taskDescriptions = cluster
      .map((t, i) => `Task ${i + 1}: ${t.description ?? 'Unnamed'}\nSteps: ${t.steps}`)
      .join('\n\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Generiere eine SOP (Standard Operating Procedure) für diesen wiederkehrenden Workflow.
Antworte NUR mit validen JSON im Format:
{
  "title": "...",
  "description": "...",
  "steps": [{"order": 1, "instruction": "...", "tool": "...", "target": "...", "notes": "..."}],
  "involvedSystems": ["..."],
  "estimatedDuration": "~N Minuten",
  "frequency": "Xmal täglich",
  "confidence": 0.8
}

Tasks:
${taskDescriptions}

Beteiligte Services: ${involved.join(', ')}`,
      }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]) as {
        title: string;
        description: string;
        steps: Array<{ order: number; instruction: string; tool: string; target?: string; notes?: string }>;
        involvedSystems: string[];
        estimatedDuration: string;
        frequency: string;
        confidence: number;
      };

      db.insertSOP({ workflowId, ...parsed });
      generated++;
    } catch {
      // Skip malformed responses
    }
  }

  return generated;
}

function clusterTasks(tasks: TaskRow[]): TaskRow[][] {
  // Simple clustering: group by overlapping involved services
  const clusters: TaskRow[][] = [];
  const assigned = new Set<string>();

  for (const task of tasks) {
    if (assigned.has(task.id)) continue;

    const cluster = [task];
    assigned.add(task.id);

    const taskServices = new Set(JSON.parse(task.involvedServices ?? '[]') as string[]);

    for (const other of tasks) {
      if (assigned.has(other.id)) continue;
      const otherServices = new Set(JSON.parse(other.involvedServices ?? '[]') as string[]);
      // Check overlap
      const overlap = [...taskServices].filter(s => otherServices.has(s));
      if (overlap.length > 0) {
        cluster.push(other);
        assigned.add(other.id);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}
