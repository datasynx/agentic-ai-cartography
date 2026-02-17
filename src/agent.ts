import type { CartographyDB } from './db.js';
import { createCartographyTools } from './tools.js';
import { safetyHook } from './safety.js';
import type { CartographyConfig, TaskRow } from './types.js';

// ── Discovery Event Types ────────────────────────────────────────────────────

export type DiscoveryEvent =
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; tool: string; output: string }
  | { kind: 'turn'; turn: number }
  | { kind: 'done' };

export type AskUserFn = (question: string, context?: string) => Promise<string>;

// ── runDiscovery ─────────────────────────────────────────────────────────────

export async function runDiscovery(
  config: CartographyConfig,
  db: CartographyDB,
  sessionId: string,
  onEvent?: (event: DiscoveryEvent) => void,
  onAskUser?: AskUserFn,
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');
  const tools = await createCartographyTools(db, sessionId, { onAskUser });

  const systemPrompt = `Du bist ein Infrastruktur-Discovery-Agent. Kartographiere die gesamte Systemlandschaft — lokale Services UND SaaS-Tools des Users.

━━ PFLICHT-REIHENFOLGE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCHRITT 1 — Browser-Lesezeichen (IMMER ZUERST):
  scan_bookmarks() aufrufen → jede zurückgegebene Domain klassifizieren:
  • Business-Tools (GitHub, Notion, Jira, Linear, Vercel, AWS, Datadog, etc.) → save_node als saas_tool
  • Interne Hosts (IPs, custom.company.com:PORT) → save_node als web_service
  • Persönliches (Social Media, News, Streaming, Shopping) → IGNORIEREN, NICHT speichern

SCHRITT 2 — Lokale Infrastruktur:
  ss -tlnp && ps aux → alle lauschenden Ports/Prozesse identifizieren
  Jeden Service vertiefen: DB→Schemas, API→Endpoints, Queue→Topics

SCHRITT 3 — Config-Files:
  .env, docker-compose.yml, application.yml, kubernetes/*.yml
  Nur Host:Port extrahieren — KEINE Credentials

SCHRITT 4 — Rückfragen bei Unklarheit:
  ask_user() nutzen wenn: Dienst unklar ist, Kontext fehlt, oder User Input sinnvoll wäre
  Beispiele: "Welche Umgebung ist das (dev/staging/prod)?", "Ist <host> ein internes Tool?"

SCHRITT 5 — Fertig wenn alle Spuren erschöpft.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PORT-MAPPING: 5432=postgres, 3306=mysql, 27017=mongodb, 6379=redis,
9092=kafka, 5672=rabbitmq, 80/443/8080/3000=web_service,
9090=prometheus, 8500=consul, 8200=vault, 2379=etcd

REGELN:
• Nur read-only (ss, ps, cat, head, curl -s, docker inspect, kubectl get)
• Node IDs: "type:host:port" oder "type:name" — keine Pfade, keine Credentials
• saas_tool IDs: "saas_tool:github.com", "saas_tool:notion.so"
• Confidence: 0.9 direkt gesehen, 0.7 aus Config/Bookmarks, 0.5 Vermutung
• metadata erlaubt: { description, category, port, version } — keine Passwörter
• get_catalog vor save_node → Duplikate vermeiden
• Edges speichern wenn Verbindungen klar erkennbar sind

Entrypoints: ${config.entryPoints.join(', ')}`;

  const initialPrompt = `Starte Discovery jetzt.
Führe SOFORT als erstes scan_bookmarks aus — noch bevor du ss oder ps verwendest.
Dann systematisch lokale Services, dann Config-Files.
Nutze ask_user wenn du Kontext vom User brauchst.`;

  let turnCount = 0;

  for await (const msg of query({
    prompt: initialPrompt,
    options: {
      model: config.agentModel,
      maxTurns: config.maxTurns,
      customSystemPrompt: systemPrompt,
      mcpServers: { cartography: tools },
      allowedTools: [
        'Bash',
        'mcp__cartograph__save_node',
        'mcp__cartograph__save_edge',
        'mcp__cartograph__get_catalog',
        'mcp__cartograph__scan_bookmarks',
        'mcp__cartograph__ask_user',
      ],
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [safetyHook] }],
      },
      permissionMode: 'bypassPermissions',
    },
  })) {
    if (!onEvent) continue;

    if (msg.type === 'assistant') {
      turnCount++;
      onEvent({ kind: 'turn', turn: turnCount });

      for (const block of msg.message.content) {
        if (block.type === 'text') {
          onEvent({ kind: 'thinking', text: block.text });
        }
        if (block.type === 'tool_use') {
          onEvent({
            kind: 'tool_call',
            tool: block.name as string,
            input: block.input as Record<string, unknown>,
          });
        }
      }
    }

    if (msg.type === 'user') {
      const content = msg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'object' && block !== null && 'type' in block && (block as { type: string }).type === 'tool_result') {
            const tb = block as { tool_use_id?: string; content?: unknown };
            const text = typeof tb.content === 'string' ? tb.content : '';
            onEvent({ kind: 'tool_result', tool: tb.tool_use_id ?? '', output: text });
          }
        }
      }
    }

    if (msg.type === 'result') {
      onEvent({ kind: 'done' });
      return;
    }
  }
}

// ── runShadowCycle ───────────────────────────────────────────────────────────

export async function runShadowCycle(
  config: CartographyConfig,
  db: CartographyDB,
  sessionId: string,
  prevSnapshot: string,
  currSnapshot: string,
  onOutput?: (msg: unknown) => void,
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');
  const tools = await createCartographyTools(db, sessionId);

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
      mcpServers: { cartography: tools },
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

export async function generateSOPs(db: CartographyDB, sessionId: string): Promise<number> {
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
