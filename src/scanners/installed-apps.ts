import type { Scanner, ScanResult } from './types.js';
import type { DiscoveryNode } from '../types.js';
import { commandExists } from '../platform.js';

/** Known CLIs/tools grouped by category — detected deterministically via `commandExists`. */
const KNOWN_TOOLS: Record<string, string[]> = {
  ide: ['code', 'code-insiders', 'cursor', 'windsurf', 'zed', 'nvim', 'vim', 'emacs', 'idea', 'webstorm', 'pycharm', 'goland', 'datagrip', 'clion', 'rider', 'phpstorm'],
  'dev-tool': ['git', 'gh', 'docker', 'docker-compose', 'podman', 'kubectl', 'helm', 'terraform', 'ansible', 'vagrant', 'packer', 'consul', 'vault', 'nomad'],
  runtime: ['node', 'npm', 'pnpm', 'yarn', 'bun', 'deno', 'python', 'python3', 'pip', 'poetry', 'ruby', 'rails', 'java', 'mvn', 'gradle', 'go', 'cargo', 'rustc', 'php', 'composer', 'dotnet'],
  database: ['psql', 'mysql', 'mongosh', 'redis-cli', 'sqlite3', 'clickhouse-client'],
  cloud: ['aws', 'gcloud', 'az', 'heroku', 'fly', 'vercel', 'netlify', 'wrangler', 'supabase'],
  browser: ['google-chrome', 'chromium', 'firefox', 'brave', 'opera'],
  observability: ['prometheus', 'grafana-cli', 'datadog-agent', 'newrelic-agent'],
};

export const installedAppsScanner: Scanner = {
  id: 'installed-apps',
  title: 'Installed apps & developer tools',
  platforms: 'all',
  allowedCommands: ['which', 'command', 'Get-Command'],
  detect: () => true,
  async scan(ctx): Promise<ScanResult> {
    const nodes: DiscoveryNode[] = [];
    const hintTerms = (ctx.hint ?? '').toLowerCase().split(/[\s,]+/).filter(Boolean);
    for (const [category, tools] of Object.entries(KNOWN_TOOLS)) {
      for (const tool of tools) {
        const path = commandExists(tool);
        if (!path) continue;
        const boosted = hintTerms.some((t) => tool.includes(t));
        nodes.push({
          id: `saas_tool:${tool}`,
          type: 'saas_tool',
          name: tool,
          discoveredVia: 'installed-app',
          confidence: boosted ? 0.95 : 0.9,
          tags: [category],
          metadata: { category, path },
        });
      }
    }
    return { nodes, edges: [] };
  },
};
