import { z } from 'zod';
import type { CartographyDB } from './db.js';
import { NODE_TYPES, EDGE_RELATIONSHIPS, EVENT_TYPES, SOPStepSchema } from './types.js';
import { scanAllBookmarks } from './bookmarks.js';

// Lazy import to avoid hard-wiring SDK at module parse time
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpServer = any;

export interface CartographyToolsOptions {
  /** Called when the agent needs a human answer. Return the user's response. */
  onAskUser?: (question: string, context?: string) => Promise<string>;
}

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

export async function createCartographyTools(
  db: CartographyDB,
  sessionId: string,
  opts: CartographyToolsOptions = {},
): Promise<McpServer> {
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

    tool('ask_user', 'Rückfrage an den User stellen — bei Unklarheiten, fehlenden Credentials-Hinweisen oder wenn Kontext fehlt', {
      question: z.string().describe('Die Frage an den User (klar und konkret)'),
      context: z.string().optional().describe('Optionaler Zusatzkontext warum die Frage relevant ist'),
    }, async (args) => {
      const question = args['question'] as string;
      const context = args['context'] as string | undefined;

      if (opts.onAskUser) {
        const answer = await opts.onAskUser(question, context);
        return { content: [{ type: 'text', text: answer }] };
      }

      // Fallback when not interactive (piped input, daemon, etc.)
      return {
        content: [{ type: 'text', text: '(Kein interaktiver Modus — bitte ohne diese Information fortfahren)' }],
      };
    }),

    tool('scan_bookmarks', 'Alle Browser-Lesezeichen scannen — nur Hostnamen, keine persönlichen Daten', {
      minConfidence: z.number().min(0).max(1).default(0.5).optional(),
    }, async () => {
      const hosts = await scanAllBookmarks();
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: hosts.length,
            hosts: hosts.map(h => ({
              hostname: h.hostname,
              port: h.port,
              protocol: h.protocol,
              source: h.source,
            })),
            note: 'Nur Hostnamen — keine Pfade, keine persönlichen Daten. Entscheide selbst welche davon Business-Tools sind.',
          }),
        }],
      };
    }),

    tool('scan_k8s_resources', 'Kubernetes-Cluster via kubectl scannen — 100% readonly (get, describe)', {
      namespace: z.string().optional().describe('Namespace filtern — leer = alle Namespaces'),
    }, async (args) => {
      const { execSync } = await import('node:child_process');
      const ns = args['namespace'] as string | undefined;
      const nsFlag = ns ? `-n ${ns}` : '--all-namespaces';
      const run = (cmd: string): string => {
        try {
          return execSync(cmd, { stdio: 'pipe', timeout: 15_000, shell: '/bin/sh' }).toString().trim();
        } catch (e) {
          return `(error: ${e instanceof Error ? e.message.split('\n')[0] : String(e)})`;
        }
      };
      const sections: [string, string][] = [
        ['CONTEXT', 'kubectl config current-context 2>/dev/null || echo "(kein Context gesetzt)"'],
        ['NODES', 'kubectl get nodes -o wide'],
        ['NAMESPACES', 'kubectl get namespaces'],
        ['SERVICES', `kubectl get services ${nsFlag}`],
        ['DEPLOYMENTS', `kubectl get deployments ${nsFlag}`],
        ['STATEFULSETS', `kubectl get statefulsets ${nsFlag}`],
        ['INGRESSES', `kubectl get ingress ${nsFlag} 2>/dev/null || echo "(keine)"`],
        ['PODS_RUNNING', `kubectl get pods ${nsFlag} --field-selector=status.phase=Running 2>/dev/null | head -60`],
        ['CONFIGMAPS_SYSTEM', 'kubectl get configmaps -n kube-system 2>/dev/null | head -30'],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${run(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_aws_resources', 'AWS-Infrastruktur via AWS CLI scannen — 100% readonly (describe, list)', {
      region: z.string().optional().describe('AWS Region — default: AWS_DEFAULT_REGION oder Profil'),
      profile: z.string().optional().describe('AWS CLI Profil'),
    }, async (args) => {
      const { execSync } = await import('node:child_process');
      const region = args['region'] as string | undefined;
      const profile = args['profile'] as string | undefined;
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (region) env['AWS_DEFAULT_REGION'] = region;
      const pf = profile ? `--profile ${profile}` : '';
      const run = (cmd: string): string => {
        try {
          return execSync(cmd, { stdio: 'pipe', timeout: 20_000, shell: '/bin/sh', env }).toString().trim();
        } catch (e) {
          return `(error: ${e instanceof Error ? e.message.split('\n')[0] : String(e)})`;
        }
      };
      const sections: [string, string][] = [
        ['IDENTITY', `aws sts get-caller-identity ${pf} --output json`],
        ['EC2', `aws ec2 describe-instances ${pf} --query 'Reservations[*].Instances[*].[InstanceId,InstanceType,State.Name,PublicIpAddress,PrivateIpAddress,Tags[?Key==\`Name\`].Value|[0]]' --output table`],
        ['RDS', `aws rds describe-db-instances ${pf} --query 'DBInstances[*].[DBInstanceIdentifier,Engine,DBInstanceStatus,Endpoint.Address,Endpoint.Port]' --output table`],
        ['ELB_V2', `aws elbv2 describe-load-balancers ${pf} --query 'LoadBalancers[*].[LoadBalancerName,DNSName,Type,State.Code]' --output table`],
        ['EKS', `aws eks list-clusters ${pf} --output json`],
        ['ELASTICACHE', `aws elasticache describe-cache-clusters ${pf} --query 'CacheClusters[*].[CacheClusterId,Engine,CacheClusterStatus]' --output table 2>/dev/null || echo "(nicht verfügbar)"`],
        ['S3', `aws s3 ls ${pf} 2>/dev/null || echo "(nicht verfügbar)"`],
        ['VPC', `aws ec2 describe-vpcs ${pf} --query 'Vpcs[*].[VpcId,CidrBlock,IsDefault,Tags[?Key==\`Name\`].Value|[0]]' --output table`],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${run(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_gcp_resources', 'Google Cloud Platform via gcloud CLI scannen — 100% readonly (list, describe)', {
      project: z.string().optional().describe('GCP Project ID — default: aktuelles gcloud-Projekt'),
    }, async (args) => {
      const { execSync } = await import('node:child_process');
      const project = args['project'] as string | undefined;
      const pf = project ? `--project ${project}` : '';
      const run = (cmd: string): string => {
        try {
          return execSync(cmd, { stdio: 'pipe', timeout: 20_000, shell: '/bin/sh' }).toString().trim();
        } catch (e) {
          return `(error: ${e instanceof Error ? e.message.split('\n')[0] : String(e)})`;
        }
      };
      const sections: [string, string][] = [
        ['IDENTITY', `gcloud config list account --format='value(core.account)' 2>/dev/null; gcloud config get-value project 2>/dev/null`],
        ['COMPUTE_INSTANCES', `gcloud compute instances list ${pf} 2>/dev/null || echo "(error)"`],
        ['SQL_INSTANCES', `gcloud sql instances list ${pf} 2>/dev/null || echo "(error)"`],
        ['GKE_CLUSTERS', `gcloud container clusters list ${pf} 2>/dev/null || echo "(error)"`],
        ['CLOUD_RUN', `gcloud run services list ${pf} --platform managed 2>/dev/null || echo "(error)"`],
        ['CLOUD_FUNCTIONS', `gcloud functions list ${pf} 2>/dev/null || echo "(error)"`],
        ['REDIS', `gcloud redis instances list ${pf} --regions=- 2>/dev/null || echo "(error)"`],
        ['PUBSUB', `gcloud pubsub topics list ${pf} 2>/dev/null || echo "(error)"`],
        ['SPANNER', `gcloud spanner instances list ${pf} 2>/dev/null || echo "(error)"`],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${run(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_azure_resources', 'Azure-Infrastruktur via az CLI scannen — 100% readonly (list, show)', {
      subscription: z.string().optional().describe('Azure Subscription ID'),
      resourceGroup: z.string().optional().describe('Resource Group filtern'),
    }, async (args) => {
      const { execSync } = await import('node:child_process');
      const sub = args['subscription'] as string | undefined;
      const rg = args['resourceGroup'] as string | undefined;
      const sf = sub ? `--subscription ${sub}` : '';
      const rf = rg ? `--resource-group ${rg}` : '';
      const run = (cmd: string): string => {
        try {
          return execSync(cmd, { stdio: 'pipe', timeout: 20_000, shell: '/bin/sh' }).toString().trim();
        } catch (e) {
          return `(error: ${e instanceof Error ? e.message.split('\n')[0] : String(e)})`;
        }
      };
      const sections: [string, string][] = [
        ['IDENTITY', `az account show --output json ${sf} 2>/dev/null || echo "(nicht eingeloggt — az login)"`],
        ['VMS', `az vm list ${sf} ${rf} --output table 2>/dev/null || echo "(error)"`],
        ['AKS', `az aks list ${sf} ${rf} --output table 2>/dev/null || echo "(error)"`],
        ['SQL_SERVERS', `az sql server list ${sf} ${rf} --output table 2>/dev/null || echo "(error)"`],
        ['POSTGRES', `az postgres server list ${sf} ${rf} --output table 2>/dev/null || echo "(error)"`],
        ['REDIS', `az redis list ${sf} ${rf} --output table 2>/dev/null || echo "(error)"`],
        ['WEBAPPS', `az webapp list ${sf} ${rf} --output table 2>/dev/null || echo "(error)"`],
        ['CONTAINER_APPS', `az containerapp list ${sf} ${rf} --output table 2>/dev/null || echo "(error)"`],
        ['FUNCTIONS', `az functionapp list ${sf} ${rf} --output table 2>/dev/null || echo "(error)"`],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${run(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
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
    name: 'cartography',
    version: '0.1.0',
    tools,
  });
}
