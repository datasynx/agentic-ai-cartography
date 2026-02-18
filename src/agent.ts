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
  hint?: string,
): Promise<void> {
  const { query } = await import('@anthropic-ai/claude-code');
  const tools = await createCartographyTools(db, sessionId, { onAskUser });

  const hintSection = hint
    ? `\n⚡ USER HINT (HIGH PRIORITY): The user wants to find these specific tools: "${hint}"\n  → Run scan_installed_apps(searchHint: "${hint}") IMMEDIATELY and save found tools as saas_tool nodes!\n`
    : '';

  const systemPrompt = `You are an infrastructure discovery agent. Map the complete system landscape — local services, SaaS tools, AND all installed apps/tools of the user.
${hintSection}
━━ MANDATORY SEQUENCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1 — Browser Bookmarks (ALWAYS FIRST):
  Call scan_bookmarks() → classify every returned domain:
  • Business tools (GitHub, Notion, Jira, Linear, Vercel, AWS, Datadog, etc.) → save_node as saas_tool
  • Internal hosts (IPs, custom.company.com:PORT) → save_node as web_service
  • Personal (social media, news, streaming, shopping) → IGNORE, do NOT save

STEP 2 — Browser History (ASK FOR CONSENT FIRST):
  Call ask_user with question: "May I scan your browser history anonymously? I only extract hostnames (no URLs, no personal data) to discover additional tools you use regularly. Answer yes or no."
  If user says yes → call scan_browser_history(minVisits: 5) → classify business tools as saas_tool nodes
  If user says no → skip and proceed to Step 3

STEP 3 — Installed Apps & Tools (VERY IMPORTANT):
  Call scan_installed_apps() → classify ALL found apps/tools:
  • IDEs (VS Code, Cursor, Windsurf, JetBrains, etc.) → save_node as saas_tool with category="ide"
  • Office & productivity (Word, Excel, Notion, Obsidian, etc.) → save_node as saas_tool with category="productivity"
  • Dev tools (Docker, kubectl, git, Node, Python, etc.) → save_node as saas_tool with category="dev-tool"
  • Business apps (Slack, Zoom, HubSpot, Salesforce, etc.) → save_node as saas_tool with category="business"
  • Browsers (Chrome, Firefox, Safari, etc.) → save_node as saas_tool with category="browser"
  • Design tools (Figma, Sketch, Adobe, etc.) → save_node as saas_tool with category="design"
  Save ALL relevant tools — even offline/local ones!

STEP 4 — Local Databases & Infrastructure:
  Call scan_local_databases() → discover running DB servers and SQLite files from installed apps
  • PostgreSQL running → save_node as database_server (id: "database_server:localhost:5432")
  • MySQL running → save_node as database_server (id: "database_server:localhost:3306")
  • MongoDB running → save_node as database_server
  • Redis running → save_node as cache_server
  • SQLite files in app directories → save_node as database if clearly a business app DB
  Then run: ss -tlnp && ps aux → identify all listening ports/processes
  Deepen each service: DB→schemas, API→endpoints, Queue→topics

STEP 5 — Cloud & Kubernetes (if CLI available):
  scan_k8s_resources() → Nodes, Services, Pods, Deployments, Ingresses
  scan_aws_resources()  → EC2, RDS, ELB, EKS, ElastiCache, S3 (if AWS CLI + credentials)
  scan_gcp_resources()  → Compute, SQL, GKE, Cloud Run, Functions (if gcloud + auth)
  scan_azure_resources() → VMs, AKS, SQL, Redis, WebApps (if az CLI + login)
  Errors / "not available" → ignore, continue with next tool

STEP 6 — Config Files:
  .env, docker-compose.yml, application.yml, kubernetes/*.yml
  Extract host:port only — NO credentials

STEP 7 — Clarifying Questions:
  Use ask_user() when: a service is unclear, context is missing, or user input would be helpful
  Examples: "What environment is this (dev/staging/prod)?", "Is <host> an internal tool?"

STEP 8 — EDGES (CRITICAL — do NOT skip!):
  After discovering nodes, ALWAYS map relationships with save_edge:
  • Developer uses IDE → save_edge("saas_tool:vscode", "saas_tool:github.com", "uses")
  • App connects to Database → save_edge(app_id, db_id, "connects_to")
  • Service calls API → save_edge(service_id, api_id, "calls")
  • Container contains Service → save_edge(container_id, service_id, "contains")
  • Service reads from Queue → save_edge(service_id, queue_id, "reads_from")
  • Service writes to Database → save_edge(service_id, db_id, "writes_to")
  • App depends on Cache → save_edge(app_id, cache_id, "depends_on")
  Think: which tools does the developer use together? What connects to what?
  Use get_catalog to see all node IDs before saving edges.

STEP 9 — Done when all leads are exhausted.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PORT MAPPING: 5432=postgres, 3306=mysql, 27017=mongodb, 6379=redis,
9092=kafka, 5672=rabbitmq, 80/443/8080/3000=web_service,
9090=prometheus, 8500=consul, 8200=vault, 2379=etcd

RULES:
• Read-only only (ss, ps, cat, head, curl -s, docker inspect, kubectl get)
• Node IDs: "type:host:port" or "type:name" — no paths, no credentials
• saas_tool IDs: "saas_tool:github.com", "saas_tool:vscode", "saas_tool:cursor"
• Installed-app IDs: "saas_tool:<appname>" e.g. "saas_tool:slack", "saas_tool:docker-desktop"
• Confidence: 0.9 directly observed, 0.7 from config/bookmarks/apps, 0.5 inferred
• metadata allowed: { description, category, port, version, path } — no passwords
• Call get_catalog before save_node → avoid duplicates
• Save edges whenever connections are clearly identifiable

Entry points: ${config.entryPoints.join(', ')}`;

  const initialPrompt = hint
    ? `Start discovery with USER HINT: "${hint}".
Immediately run scan_installed_apps(searchHint: "${hint}") to search for these tools.
Then scan_bookmarks, then local services.
Use ask_user when you need context from the user.`
    : `Start discovery now.
First, IMMEDIATELY run scan_bookmarks — before using ss or ps.
Then ask for browser history consent (Step 2).
Then scan_installed_apps() for all installed apps and tools.
Then scan_local_databases() for database servers and SQLite files.
Then systematically scan local services, then config files.
Finally, map all edges (Step 8 — critical!) before finishing.
Use ask_user when you need context from the user.`;

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
        'mcp__cartograph__scan_browser_history',
        'mcp__cartograph__scan_installed_apps',
        'mcp__cartograph__scan_local_databases',
        'mcp__cartograph__scan_k8s_resources',
        'mcp__cartograph__scan_aws_resources',
        'mcp__cartograph__scan_gcp_resources',
        'mcp__cartograph__scan_azure_resources',
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

  const prompt = `Analyze the diff between these two system snapshots.
Find:
- New/closed TCP connections → save_event
- New/terminated processes → save_event
- Previously unknown services → check get_catalog, then save_node
- Task boundaries (inactivity, tool switches) → manage_task
target = host:port ONLY. Be concise and efficient.

=== BEFORE ===
${prevSnapshot}

=== NOW ===
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
        content: `Generate a Standard Operating Procedure (SOP) for this recurring workflow.
Reply ONLY with valid JSON in this format:
{
  "title": "...",
  "description": "...",
  "steps": [{"order": 1, "instruction": "...", "tool": "...", "target": "...", "notes": "..."}],
  "involvedSystems": ["..."],
  "estimatedDuration": "~N minutes",
  "frequency": "X times daily",
  "confidence": 0.8
}

Tasks:
${taskDescriptions}

Involved services: ${involved.join(', ')}`,
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
