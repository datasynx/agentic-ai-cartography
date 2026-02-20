import { z } from 'zod';
import type { CartographyDB } from './db.js';
import { NODE_TYPES, EDGE_RELATIONSHIPS, SOPStepSchema } from './types.js';
import { scanAllBookmarks, scanAllHistory } from './bookmarks.js';

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
    tool('save_node', 'Save an infrastructure node to the catalog', {
      id: z.string(),
      type: z.enum(NODE_TYPES),
      name: z.string(),
      discoveredVia: z.string(),
      confidence: z.number().min(0).max(1),
      metadata: z.record(z.unknown()).optional(),
      tags: z.array(z.string()).optional(),
      domain: z.string().optional().describe('Business domain, e.g. "Marketing", "Finance"'),
      subDomain: z.string().optional().describe('Sub-domain, e.g. "Forecast client orders"'),
      qualityScore: z.number().min(0).max(100).optional().describe('Data quality score 0–100'),
    }, async (args) => {
      const node = {
        id: stripSensitive(args['id'] as string),
        type: args['type'] as typeof NODE_TYPES[number],
        name: args['name'] as string,
        discoveredVia: args['discoveredVia'] as string,
        confidence: args['confidence'] as number,
        metadata: (args['metadata'] as Record<string, unknown>) ?? {},
        tags: (args['tags'] as string[]) ?? [],
        domain: args['domain'] as string | undefined,
        subDomain: args['subDomain'] as string | undefined,
        qualityScore: args['qualityScore'] as number | undefined,
      };
      db.upsertNode(sessionId, node);
      return { content: [{ type: 'text', text: `✓ Node: ${node.id}` }] };
    }),

    tool('save_edge', 'Save a relationship (edge) between two nodes — ALWAYS save edges when connections are clear', {
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

    tool('get_catalog', 'Get the current catalog — use before save_node to avoid duplicates', {
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

    tool('ask_user', 'Ask the user a question — for clarifications, missing context, or consent (e.g. before scanning browser history)', {
      question: z.string().describe('The question for the user (clear and specific)'),
      context: z.string().optional().describe('Optional context explaining why this is relevant'),
    }, async (args) => {
      const question = args['question'] as string;
      const context = args['context'] as string | undefined;

      if (opts.onAskUser) {
        const answer = await opts.onAskUser(question, context);
        return { content: [{ type: 'text', text: answer }] };
      }

      // Fallback when not interactive (piped input, daemon, etc.)
      return {
        content: [{ type: 'text', text: '(Non-interactive mode — please continue without this information)' }],
      };
    }),

    tool('scan_bookmarks', 'Scan all browser bookmarks — hostnames only, no personal data (Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Firefox)', {
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
            note: 'Hostnames only — no paths, no personal data. Classify each as a business tool (save_node) or ignore (social media, news, shopping).',
          }),
        }],
      };
    }),

    tool('scan_browser_history', 'Scan browser history — anonymized hostnames + visit frequency. ALWAYS call ask_user for consent before using this tool.', {
      minVisits: z.number().min(1).default(3).optional().describe('Minimum visit count to include a host (filters rarely-visited sites)'),
    }, async (args) => {
      const minVisits = (args['minVisits'] as number | undefined) ?? 3;
      const hosts = await scanAllHistory();
      const filtered = hosts.filter(h => h.visitCount >= minVisits);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: filtered.length,
            note: 'Anonymized — hostnames only, no URLs, no paths, no personal data. Classify business tools as saas_tool nodes.',
            hosts: filtered.map(h => ({
              hostname: h.hostname,
              visitCount: h.visitCount,
              protocol: h.protocol,
              source: h.source,
            })),
          }),
        }],
      };
    }),

    tool('scan_local_databases', 'Scan for local database files and running DB servers — PostgreSQL databases, MySQL, SQLite files from installed apps', {
      deep: z.boolean().default(false).optional().describe('Also search home directory recursively for SQLite/DB files (slower)'),
    }, async (args) => {
      const { execSync } = await import('node:child_process');
      const { homedir } = await import('node:os');
      const { existsSync } = await import('node:fs');
      const deep = (args['deep'] as boolean | undefined) ?? false;
      const HOME = homedir();

      const run = (cmd: string): string => {
        try {
          return execSync(cmd, { stdio: 'pipe', timeout: 10_000, shell: '/bin/sh' }).toString().trim();
        } catch {
          return '';
        }
      };

      const results: Record<string, string> = {};

      // PostgreSQL
      results['POSTGRES_DATABASES'] = run('psql -lqt 2>/dev/null | grep -v "template0\\|template1" | awk \'{print $1}\' | grep -v "^$\\|^|"') || '(psql not running or not available)';
      results['POSTGRES_CLUSTERS'] = run('pg_lsclusters 2>/dev/null') || '(pg_lsclusters not available)';

      // MySQL / MariaDB
      results['MYSQL_DATABASES'] = run('mysql --connect-timeout=3 -e "SHOW DATABASES;" 2>/dev/null') || '(mysql not running or requires auth)';

      // MongoDB
      results['MONGODB_DATABASES'] = run('mongosh --quiet --eval "db.adminCommand({listDatabases:1}).databases.map(d=>d.name).join(\'\\n\')" 2>/dev/null') || '(mongosh not available)';

      // Redis
      results['REDIS_INFO'] = run('redis-cli info server 2>/dev/null | head -5') || '(redis-cli not available)';

      // SQLite files in app data directories
      const appDirs = [`${HOME}/.config`, `${HOME}/.local/share`, `${HOME}/Library/Application Support`, '/var/lib'].filter(d => existsSync(d));
      if (appDirs.length > 0) {
        const findCmds = appDirs.map(d => `find "${d}" -maxdepth 4 \\( -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db" \\) 2>/dev/null`).join('; ');
        results['SQLITE_APP_FILES'] = run(`{ ${findCmds}; } | head -80`) || '(none found)';
      }

      // Deep home scan
      if (deep) {
        results['SQLITE_DEEP_SCAN'] = run(`find "${HOME}" -maxdepth 6 \\( -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db" \\) -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -100`) || '(none found)';
      }

      // DB config files (no credentials extracted)
      results['DB_CONFIG_FILES'] = run(`find "${HOME}" -maxdepth 4 \\( -name ".env" -o -name ".env.local" -o -name "database.yml" -o -name "database.json" -o -name "docker-compose.yml" \\) 2>/dev/null | head -20`) || '(none found)';

      const out = Object.entries(results).map(([k, v]) => `=== ${k} ===\n${v}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_k8s_resources', 'Scan Kubernetes cluster via kubectl — 100% readonly (get, describe)', {
      namespace: z.string().optional().describe('Filter by namespace — empty = all namespaces'),
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
        ['CONTEXT', 'kubectl config current-context 2>/dev/null || echo "(no context set)"'],
        ['NODES', 'kubectl get nodes -o wide'],
        ['NAMESPACES', 'kubectl get namespaces'],
        ['SERVICES', `kubectl get services ${nsFlag}`],
        ['DEPLOYMENTS', `kubectl get deployments ${nsFlag}`],
        ['STATEFULSETS', `kubectl get statefulsets ${nsFlag}`],
        ['INGRESSES', `kubectl get ingress ${nsFlag} 2>/dev/null || echo "(none)"`],
        ['PODS_RUNNING', `kubectl get pods ${nsFlag} --field-selector=status.phase=Running 2>/dev/null | head -60`],
        ['CONFIGMAPS_SYSTEM', 'kubectl get configmaps -n kube-system 2>/dev/null | head -30'],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${run(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_aws_resources', 'Scan AWS infrastructure via AWS CLI — 100% readonly (describe, list)', {
      region: z.string().optional().describe('AWS Region — default: AWS_DEFAULT_REGION or profile'),
      profile: z.string().optional().describe('AWS CLI profile'),
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
        ['ELASTICACHE', `aws elasticache describe-cache-clusters ${pf} --query 'CacheClusters[*].[CacheClusterId,Engine,CacheClusterStatus]' --output table 2>/dev/null || echo "(not available)"`],
        ['S3', `aws s3 ls ${pf} 2>/dev/null || echo "(not available)"`],
        ['VPC', `aws ec2 describe-vpcs ${pf} --query 'Vpcs[*].[VpcId,CidrBlock,IsDefault,Tags[?Key==\`Name\`].Value|[0]]' --output table`],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${run(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_gcp_resources', 'Scan Google Cloud Platform via gcloud CLI — 100% readonly (list, describe)', {
      project: z.string().optional().describe('GCP Project ID — default: current gcloud project'),
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

    tool('scan_azure_resources', 'Scan Azure infrastructure via az CLI — 100% readonly (list, show)', {
      subscription: z.string().optional().describe('Azure Subscription ID'),
      resourceGroup: z.string().optional().describe('Filter by resource group'),
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
        ['IDENTITY', `az account show --output json ${sf} 2>/dev/null || echo "(not logged in — az login)"`],
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

    tool('scan_installed_apps', 'Scan all installed apps and tools — IDEs, office, dev tools, business apps, databases', {
      searchHint: z.string().optional().describe('Optional search term to find specific tools (e.g. "hubspot windsurf cursor")'),
    }, async (args) => {
      const { execSync } = await import('node:child_process');
      const hint = args['searchHint'] as string | undefined;

      const run = (cmd: string): string => {
        try {
          return execSync(cmd, { stdio: 'pipe', timeout: 15_000, shell: '/bin/sh' }).toString().trim();
        } catch {
          return '';
        }
      };

      const platform = process.platform;
      const results: Record<string, string> = {};

      if (platform === 'darwin') {
        // macOS: scan /Applications
        results['APPLICATIONS'] = run('ls /Applications/ 2>/dev/null | head -200') || '(empty)';
        results['USER_APPLICATIONS'] = run('ls ~/Applications/ 2>/dev/null | head -100') || '(empty)';
        // Homebrew
        results['BREW_CASKS'] = run('brew list --cask 2>/dev/null | head -100') || '(brew not installed)';
        results['BREW_FORMULAE'] = run('brew list --formula 2>/dev/null | head -150') || '(brew not installed)';
        // Spotlight — find .app bundles
        results['SPOTLIGHT_APPS'] = run('mdfind "kMDItemKind == \'Application\'" 2>/dev/null | grep -v "^/System" | grep -v "^/Library/Apple" | head -100') || '(Spotlight not available)';
      } else if (platform === 'linux') {
        // Linux: dpkg, snap, flatpak, .desktop files
        results['DPKG'] = run('dpkg --list 2>/dev/null | awk \'{print $2}\' | head -200') || '(dpkg not available)';
        results['SNAP'] = run('snap list 2>/dev/null | head -50') || '(snap not available)';
        results['FLATPAK'] = run('flatpak list 2>/dev/null | head -50') || '(flatpak not available)';
        results['DESKTOP_FILES'] = run('ls /usr/share/applications/*.desktop ~/.local/share/applications/*.desktop 2>/dev/null | xargs -I{} basename {} .desktop 2>/dev/null | head -100') || '(no .desktop files)';
        results['RPM'] = run('rpm -qa 2>/dev/null | head -200') || '(rpm not available)';
      } else if (platform === 'win32') {
        results['WINGET'] = run('winget list 2>/dev/null | head -100') || '(winget not available)';
        results['PROGRAMS_x64'] = run('reg query "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s /v DisplayName 2>/dev/null | findstr DisplayName | head -100') || '(not available)';
      }

      // Check known dev/business tools via `which`
      const knownTools = [
        // IDEs & Editors
        'code', 'code-insiders', 'cursor', 'windsurf', 'zed', 'vim', 'nvim', 'emacs', 'nano', 'sublime_text', 'atom',
        'idea', 'webstorm', 'pycharm', 'goland', 'datagrip', 'clion', 'rider', 'phpstorm', 'rubymine', 'appcode',
        // Dev Tools
        'git', 'gh', 'docker', 'docker-compose', 'podman', 'kubectl', 'helm', 'terraform', 'ansible',
        'node', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'deno',
        'python', 'python3', 'pip', 'pip3', 'pipenv', 'poetry', 'conda',
        'ruby', 'gem', 'bundler', 'rails',
        'java', 'mvn', 'gradle', 'kotlin',
        'go', 'cargo', 'rustc',
        'php', 'composer',
        'dotnet', 'dotnet-sdk',
        // Databases
        'psql', 'mysql', 'mysqladmin', 'mongo', 'mongosh', 'redis-cli', 'sqlite3', 'clickhouse-client',
        // Cloud CLIs
        'aws', 'gcloud', 'az', 'heroku', 'fly', 'vercel', 'netlify', 'wrangler',
        // Infra
        'vagrant', 'packer', 'consul', 'vault', 'nomad',
        // Communication / SaaS
        'slack', 'discord', 'zoom', 'teams', 'skype', 'telegram', 'signal',
        // Browsers
        'google-chrome', 'chromium', 'firefox', 'safari', 'brave', 'opera', 'edge',
        // Monitoring / Analytics
        'datadog-agent', 'newrelic-agent', 'prometheus', 'grafana-cli',
        // Other tools
        'ngrok', 'stripe', 'supabase', 'neon',
      ];

      const found: string[] = [];
      const notFound: string[] = [];
      for (const t of knownTools) {
        const r = run(`which ${t} 2>/dev/null`);
        if (r) found.push(`${t}: ${r}`);
        else notFound.push(t);
      }
      results['WHICH_FOUND'] = found.join('\n') || '(none found)';
      results['WHICH_NOT_FOUND'] = notFound.join(', ');

      // Hint-based search: if user asks for specific tools, do targeted search
      if (hint) {
        const terms = hint.split(/[\s,]+/).filter(Boolean);
        const hintResults: string[] = [];
        for (const term of terms) {
          const safe = term.replace(/[^a-zA-Z0-9._-]/g, '');
          if (!safe) continue;
          const r = run(`which ${safe} 2>/dev/null || find /Applications ~/Applications /usr/bin /usr/local/bin /opt/homebrew/bin ~/.local/bin 2>/dev/null -iname "*${safe}*" -maxdepth 3 2>/dev/null | head -5`);
          if (r) hintResults.push(`${term}: ${r}`);
          else hintResults.push(`${term}: (not found)`);
        }
        results['HINT_SEARCH'] = hintResults.join('\n');
      }

      const out = Object.entries(results)
        .map(([k, v]) => `=== ${k} ===\n${v}`)
        .join('\n\n');

      return { content: [{ type: 'text', text: out }] };
    }),

    tool('save_sop', 'Save a Standard Operating Procedure', {
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
