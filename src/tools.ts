import { z } from 'zod';
import type { CartographyDB } from './db.js';
import { NODE_TYPES, EDGE_RELATIONSHIPS } from './types.js';
import { scanAllBookmarks, scanAllHistory } from './bookmarks.js';
import {
  IS_WIN, IS_MAC, IS_LINUX, HOME, PLATFORM,
  run, commandExists, findFiles, dbScanDirs,
  scanListeningPorts, scanProcesses,
  scanWindowsPrograms, scanWindowsDbServices,
} from './platform.js';

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
  const { tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');

  const tools = [
    tool('save_node', 'Save an infrastructure node to the catalog', {
      id: z.string(),
      type: z.enum(NODE_TYPES),
      name: z.string(),
      discoveredVia: z.string(),
      confidence: z.number().min(0).max(1),
      metadata: z.record(z.string(), z.unknown()).optional(),
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
      const deep = (args['deep'] as boolean | undefined) ?? false;
      const results: Record<string, string> = {};

      results['PLATFORM'] = `${PLATFORM} (${IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux'})`;

      // ── Windows: detect DB services via Get-Service / Get-NetTCPConnection ──
      if (IS_WIN) {
        results['DB_SERVICES'] = scanWindowsDbServices() || '(no database services found)';
      }

      // ── PostgreSQL (cross-platform) ──
      if (commandExists('psql')) {
        if (IS_WIN) {
          results['POSTGRES_DATABASES'] = run('psql -lqt', { timeout: 10_000 }) || '(psql found but not running or requires auth)';
        } else {
          results['POSTGRES_DATABASES'] = run('psql -lqt 2>/dev/null | grep -v "template0\\|template1" | awk \'{print $1}\' | grep -v "^$\\|^|"') || '(psql not running or not available)';
          results['POSTGRES_CLUSTERS'] = run('pg_lsclusters 2>/dev/null') || '(pg_lsclusters not available)';
        }
      } else {
        results['POSTGRES_DATABASES'] = '(psql not installed)';
      }

      // ── MySQL / MariaDB (cross-platform) ──
      if (commandExists('mysql')) {
        if (IS_WIN) {
          results['MYSQL_DATABASES'] = run('mysql --connect-timeout=3 -e "SHOW DATABASES;"', { timeout: 10_000 }) || '(mysql not running or requires auth)';
        } else {
          results['MYSQL_DATABASES'] = run('mysql --connect-timeout=3 -e "SHOW DATABASES;" 2>/dev/null') || '(mysql not running or requires auth)';
        }
      } else {
        results['MYSQL_DATABASES'] = '(mysql not installed)';
      }

      // ── MongoDB (cross-platform) ──
      if (commandExists('mongosh')) {
        if (IS_WIN) {
          results['MONGODB_DATABASES'] = run('mongosh --quiet --eval "db.adminCommand({listDatabases:1}).databases.map(d=>d.name).join(\'\\n\')"', { timeout: 10_000 }) || '(mongosh not available)';
        } else {
          results['MONGODB_DATABASES'] = run('mongosh --quiet --eval "db.adminCommand({listDatabases:1}).databases.map(d=>d.name).join(\'\\n\')" 2>/dev/null') || '(mongosh not available)';
        }
      } else {
        results['MONGODB_DATABASES'] = '(mongosh not installed)';
      }

      // ── Redis (cross-platform) ──
      if (commandExists('redis-cli')) {
        if (IS_WIN) {
          results['REDIS_INFO'] = run('redis-cli info server', { timeout: 10_000 }).split('\n').slice(0, 5).join('\n') || '(redis-cli not available)';
        } else {
          results['REDIS_INFO'] = run('redis-cli info server 2>/dev/null | head -5') || '(redis-cli not available)';
        }
      } else {
        results['REDIS_INFO'] = '(redis-cli not installed)';
      }

      // ── SQLite files in app data directories (cross-platform) ──
      const appDirs = dbScanDirs();
      if (appDirs.length > 0) {
        results['SQLITE_APP_FILES'] = findFiles(appDirs, ['*.sqlite', '*.sqlite3', '*.db'], 4, 80) || '(none found)';
      }

      // ── Deep home scan (cross-platform) ──
      if (deep) {
        if (IS_WIN) {
          results['SQLITE_DEEP_SCAN'] = run(
            `Get-ChildItem -Path '${HOME}' -Recurse -Depth 6 -Include '*.sqlite','*.sqlite3','*.db' -ErrorAction SilentlyContinue | ` +
            `Where-Object { $_.FullName -notmatch 'node_modules|\\.git' } | ` +
            `Select-Object -First 100 -ExpandProperty FullName`,
            { timeout: 30_000 },
          ) || '(none found)';
        } else {
          results['SQLITE_DEEP_SCAN'] = run(`find "${HOME}" -maxdepth 6 \\( -name "*.sqlite" -o -name "*.sqlite3" -o -name "*.db" \\) -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -100`) || '(none found)';
        }
      }

      // ── DB config files (cross-platform, no credentials extracted) ──
      if (IS_WIN) {
        results['DB_CONFIG_FILES'] = run(
          `Get-ChildItem -Path '${HOME}' -Recurse -Depth 4 -Include '.env','.env.local','database.yml','database.json','docker-compose.yml' -ErrorAction SilentlyContinue | ` +
          `Select-Object -First 20 -ExpandProperty FullName`,
          { timeout: 15_000 },
        ) || '(none found)';
      } else {
        results['DB_CONFIG_FILES'] = run(`find "${HOME}" -maxdepth 4 \\( -name ".env" -o -name ".env.local" -o -name "database.yml" -o -name "database.json" -o -name "docker-compose.yml" \\) 2>/dev/null | head -20`) || '(none found)';
      }

      const out = Object.entries(results).map(([k, v]) => `=== ${k} ===\n${v}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_k8s_resources', 'Scan Kubernetes cluster via kubectl — 100% readonly (get, describe)', {
      namespace: z.string().optional().describe('Filter by namespace — empty = all namespaces'),
    }, async (args) => {
      const ns = args['namespace'] as string | undefined;
      const nsFlag = ns ? `-n ${ns}` : '--all-namespaces';
      const runK = (cmd: string): string => {
        const r = run(cmd, { timeout: 15_000 });
        return r || `(error or not available)`;
      };
      const sections: [string, string][] = IS_WIN
        ? [
            ['CONTEXT', 'kubectl config current-context'],
            ['NODES', 'kubectl get nodes -o wide'],
            ['NAMESPACES', 'kubectl get namespaces'],
            ['SERVICES', `kubectl get services ${nsFlag}`],
            ['DEPLOYMENTS', `kubectl get deployments ${nsFlag}`],
            ['STATEFULSETS', `kubectl get statefulsets ${nsFlag}`],
            ['INGRESSES', `kubectl get ingress ${nsFlag}`],
            ['PODS_RUNNING', `kubectl get pods ${nsFlag} --field-selector=status.phase=Running`],
            ['CONFIGMAPS_SYSTEM', 'kubectl get configmaps -n kube-system'],
          ]
        : [
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
      const out = sections.map(([l, c]) => `=== ${l} ===\n${runK(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_aws_resources', 'Scan AWS infrastructure via AWS CLI — 100% readonly (describe, list)', {
      region: z.string().optional().describe('AWS Region — default: AWS_DEFAULT_REGION or profile'),
      profile: z.string().optional().describe('AWS CLI profile'),
    }, async (args) => {
      const region = args['region'] as string | undefined;
      const profile = args['profile'] as string | undefined;
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (region) env['AWS_DEFAULT_REGION'] = region;
      const pf = profile ? `--profile ${profile}` : '';
      const runAws = (cmd: string): string => run(cmd, { timeout: 20_000, env }) || '(error or not available)';
      // aws CLI commands work the same on all platforms (aws is cross-platform)
      const sections: [string, string][] = [
        ['IDENTITY', `aws sts get-caller-identity ${pf} --output json`],
        ['EC2', `aws ec2 describe-instances ${pf} --query "Reservations[*].Instances[*].[InstanceId,InstanceType,State.Name,PublicIpAddress,PrivateIpAddress]" --output table`],
        ['RDS', `aws rds describe-db-instances ${pf} --query "DBInstances[*].[DBInstanceIdentifier,Engine,DBInstanceStatus,Endpoint.Address,Endpoint.Port]" --output table`],
        ['ELB_V2', `aws elbv2 describe-load-balancers ${pf} --query "LoadBalancers[*].[LoadBalancerName,DNSName,Type,State.Code]" --output table`],
        ['EKS', `aws eks list-clusters ${pf} --output json`],
        ['ELASTICACHE', `aws elasticache describe-cache-clusters ${pf} --query "CacheClusters[*].[CacheClusterId,Engine,CacheClusterStatus]" --output table`],
        ['S3', `aws s3 ls ${pf}`],
        ['VPC', `aws ec2 describe-vpcs ${pf} --query "Vpcs[*].[VpcId,CidrBlock,IsDefault]" --output table`],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${runAws(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_gcp_resources', 'Scan Google Cloud Platform via gcloud CLI — 100% readonly (list, describe)', {
      project: z.string().optional().describe('GCP Project ID — default: current gcloud project'),
    }, async (args) => {
      const project = args['project'] as string | undefined;
      const pf = project ? `--project ${project}` : '';
      const runGcp = (cmd: string): string => run(cmd, { timeout: 20_000 }) || '(error or not available)';
      // gcloud CLI is cross-platform
      const sections: [string, string][] = [
        ['IDENTITY', `gcloud config list account --format="value(core.account)"`],
        ['COMPUTE_INSTANCES', `gcloud compute instances list ${pf}`],
        ['SQL_INSTANCES', `gcloud sql instances list ${pf}`],
        ['GKE_CLUSTERS', `gcloud container clusters list ${pf}`],
        ['CLOUD_RUN', `gcloud run services list ${pf} --platform managed`],
        ['CLOUD_FUNCTIONS', `gcloud functions list ${pf}`],
        ['REDIS', `gcloud redis instances list ${pf} --regions=-`],
        ['PUBSUB', `gcloud pubsub topics list ${pf}`],
        ['SPANNER', `gcloud spanner instances list ${pf}`],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${runGcp(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_azure_resources', 'Scan Azure infrastructure via az CLI — 100% readonly (list, show)', {
      subscription: z.string().optional().describe('Azure Subscription ID'),
      resourceGroup: z.string().optional().describe('Filter by resource group'),
    }, async (args) => {
      const sub = args['subscription'] as string | undefined;
      const rg = args['resourceGroup'] as string | undefined;
      const sf = sub ? `--subscription ${sub}` : '';
      const rf = rg ? `--resource-group ${rg}` : '';
      const runAz = (cmd: string): string => run(cmd, { timeout: 20_000 }) || '(error or not available)';
      // az CLI is cross-platform
      const sections: [string, string][] = [
        ['IDENTITY', `az account show --output json ${sf}`],
        ['VMS', `az vm list ${sf} ${rf} --output table`],
        ['AKS', `az aks list ${sf} ${rf} --output table`],
        ['SQL_SERVERS', `az sql server list ${sf} ${rf} --output table`],
        ['POSTGRES', `az postgres server list ${sf} ${rf} --output table`],
        ['REDIS', `az redis list ${sf} ${rf} --output table`],
        ['WEBAPPS', `az webapp list ${sf} ${rf} --output table`],
        ['CONTAINER_APPS', `az containerapp list ${sf} ${rf} --output table`],
        ['FUNCTIONS', `az functionapp list ${sf} ${rf} --output table`],
      ];
      const out = sections.map(([l, c]) => `=== ${l} ===\n${runAz(c)}`).join('\n\n');
      return { content: [{ type: 'text', text: out }] };
    }),

    tool('scan_installed_apps', 'Scan all installed apps and tools — IDEs, office, dev tools, business apps, databases', {
      searchHint: z.string().optional().describe('Optional search term to find specific tools (e.g. "hubspot windsurf cursor")'),
    }, async (args) => {
      const hint = args['searchHint'] as string | undefined;
      const results: Record<string, string> = {};
      results['PLATFORM'] = `${PLATFORM} (${IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux'})`;

      if (IS_MAC) {
        // macOS: scan /Applications
        results['APPLICATIONS'] = run('ls /Applications/ 2>/dev/null | head -200') || '(empty)';
        results['USER_APPLICATIONS'] = run('ls ~/Applications/ 2>/dev/null | head -100') || '(empty)';
        // Homebrew
        results['BREW_CASKS'] = run('brew list --cask 2>/dev/null | head -100') || '(brew not installed)';
        results['BREW_FORMULAE'] = run('brew list --formula 2>/dev/null | head -150') || '(brew not installed)';
        // Spotlight — find .app bundles
        results['SPOTLIGHT_APPS'] = run('mdfind "kMDItemKind == \'Application\'" 2>/dev/null | grep -v "^/System" | grep -v "^/Library/Apple" | head -100') || '(Spotlight not available)';
      } else if (IS_LINUX) {
        // Linux: dpkg, snap, flatpak, .desktop files
        results['DPKG'] = run('dpkg --list 2>/dev/null | awk \'{print $2}\' | head -200') || '(dpkg not available)';
        results['SNAP'] = run('snap list 2>/dev/null | head -50') || '(snap not available)';
        results['FLATPAK'] = run('flatpak list 2>/dev/null | head -50') || '(flatpak not available)';
        results['DESKTOP_FILES'] = run('ls /usr/share/applications/*.desktop ~/.local/share/applications/*.desktop 2>/dev/null | xargs -I{} basename {} .desktop 2>/dev/null | head -100') || '(no .desktop files)';
        results['RPM'] = run('rpm -qa 2>/dev/null | head -200') || '(rpm not available)';
      } else if (IS_WIN) {
        // Windows: winget, registry, Get-Package
        results['WINGET'] = run('winget list --accept-source-agreements', { timeout: 20_000 }) || '(winget not available)';
        results['INSTALLED_PROGRAMS'] = scanWindowsPrograms() || '(registry scan failed)';
        // Chocolatey
        results['CHOCO'] = run('choco list --local-only', { timeout: 15_000 }) || '(chocolatey not installed)';
        // Scoop
        results['SCOOP'] = run('scoop list', { timeout: 15_000 }) || '(scoop not installed)';
      }

      // ── Check known dev/business tools via cross-platform commandExists ──
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
        'dotnet',
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
        // Windows-specific
        ...(IS_WIN ? ['pwsh', 'powershell', 'wsl', 'winget', 'choco', 'scoop', 'notepad++'] : []),
        // Monitoring / Analytics
        'datadog-agent', 'newrelic-agent', 'prometheus', 'grafana-cli',
        // Other tools
        'ngrok', 'stripe', 'supabase', 'neon',
      ];

      const found: string[] = [];
      const notFound: string[] = [];
      for (const t of knownTools) {
        const r = commandExists(t);
        if (r) found.push(`${t}: ${r}`);
        else notFound.push(t);
      }
      results['TOOLS_FOUND'] = found.join('\n') || '(none found)';
      results['TOOLS_NOT_FOUND'] = notFound.join(', ');

      // Hint-based search: targeted lookup for user-specified tools
      if (hint) {
        const terms = hint.split(/[\s,]+/).filter(Boolean);
        const hintResults: string[] = [];
        for (const term of terms) {
          const safe = term.replace(/[^a-zA-Z0-9._-]/g, '');
          if (!safe) continue;
          // First try commandExists
          const cmdPath = commandExists(safe);
          if (cmdPath) {
            hintResults.push(`${term}: ${cmdPath}`);
            continue;
          }
          // Platform-specific fallback search
          let fallback = '';
          if (IS_WIN) {
            fallback = run(
              `Get-ChildItem -Path 'C:\\Program Files','C:\\Program Files (x86)','${HOME}\\AppData\\Local\\Programs' ` +
              `-Recurse -Depth 3 -Filter '*${safe}*' -ErrorAction SilentlyContinue | ` +
              `Select-Object -First 5 -ExpandProperty FullName`,
              { timeout: 10_000 },
            );
          } else if (IS_MAC) {
            fallback = run(`mdfind -name "${safe}" 2>/dev/null | head -5`);
          } else {
            fallback = run(`find /usr/bin /usr/local/bin /opt/homebrew/bin ~/.local/bin /Applications ~/Applications 2>/dev/null -iname "*${safe}*" -maxdepth 3 2>/dev/null | head -5`);
          }
          hintResults.push(fallback ? `${term}: ${fallback}` : `${term}: (not found)`);
        }
        results['HINT_SEARCH'] = hintResults.join('\n');
      }

      const out = Object.entries(results)
        .map(([k, v]) => `=== ${k} ===\n${v}`)
        .join('\n\n');

      return { content: [{ type: 'text', text: out }] };
    }),
  ];

  return createSdkMcpServer({
    name: 'cartography',
    version: '0.1.0',
    tools,
  });
}
