import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CartographyDB } from './db.js';
import type { NodeRow, EdgeRow, SOP } from './types.js';

// ── Icons & Labels ───────────────────────────────────────────────────────────

const MERMAID_ICONS: Record<string, string> = {
  host: '🖥',
  database_server: '🗄',
  database: '🗄',
  table: '📋',
  web_service: '🌐',
  api_endpoint: '🔌',
  cache_server: '⚡',
  message_broker: '📨',
  queue: '📬',
  topic: '📢',
  container: '📦',
  pod: '☸',
  k8s_cluster: '☸',
  config_file: '📄',
  saas_tool: '☁',
  unknown: '❓',
};

const EDGE_LABELS: Record<string, string> = {
  connects_to: '→',
  reads_from: 'reads',
  writes_to: 'writes',
  calls: 'calls',
  contains: 'contains',
  depends_on: 'depends on',
};

// Class colors per type (dark-theme friendly)
const MERMAID_CLASSES: Record<string, string> = {
  host:           'fill:#1e3352,stroke:#4a82c4,color:#cce',
  database_server:'fill:#1e3352,stroke:#4a82c4,color:#cce',
  database:       'fill:#163352,stroke:#3a8ad4,color:#bdf',
  table:          'fill:#0f2a40,stroke:#2a6090,color:#9bd',
  web_service:    'fill:#1a3a1a,stroke:#3a9a3a,color:#bfb',
  api_endpoint:   'fill:#0f2a0f,stroke:#2a7a2a,color:#9d9',
  cache_server:   'fill:#3a2a0a,stroke:#ca8a0a,color:#fda',
  message_broker: 'fill:#2a1a3a,stroke:#7a3aaa,color:#daf',
  queue:          'fill:#1f1030,stroke:#5a2a8a,color:#caf',
  topic:          'fill:#1f1030,stroke:#5a2a8a,color:#caf',
  container:      'fill:#1a2a3a,stroke:#3a6a9a,color:#acd',
  pod:            'fill:#0f1f2f,stroke:#2a5a8a,color:#8bc',
  k8s_cluster:    'fill:#0a1520,stroke:#1a4a7a,color:#7ab',
  config_file:    'fill:#2a2a1a,stroke:#7a7a2a,color:#ddc',
  saas_tool:      'fill:#2a1a2a,stroke:#9a3a9a,color:#daf',
  unknown:        'fill:#2a2a2a,stroke:#5a5a5a,color:#aaa',
};

// ── Mermaid ──────────────────────────────────────────────────────────────────

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function nodeLabel(node: NodeRow): string {
  const icon = MERMAID_ICONS[node.type] ?? '?';
  const parts = node.id.split(':');
  // Extract host:port or just name from ID
  const location = parts.length >= 3
    ? `${parts[1]}:${parts[2]}`   // e.g. localhost:5432
    : parts[1] ?? '';              // e.g. github.com
  const conf = `${Math.round(node.confidence * 100)}%`;
  const loc = location ? `<br/><small>${location}</small>` : '';
  return `"${icon} <b>${node.name}</b>${loc}<br/><small>${node.type} · ${conf}</small>"`;
}

function groupByHost(nodes: NodeRow[]): Map<string, NodeRow[]> {
  const groups = new Map<string, NodeRow[]>();
  for (const node of nodes) {
    const parts = node.id.split(':');
    // Nodes with host:port go into a subgraph per host; saas_tools get their own group
    const group = node.type === 'saas_tool'
      ? '__saas__'
      : (parts.length >= 3 ? parts[1] : '__local__');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(node);
  }
  return groups;
}

export function generateTopologyMermaid(nodes: NodeRow[], edges: EdgeRow[]): string {
  if (nodes.length === 0) return 'graph TB\n    empty["No nodes discovered yet"]';

  const lines: string[] = ['graph TB'];

  // classDef per type
  const usedTypes = new Set(nodes.map(n => n.type));
  for (const type of usedTypes) {
    const style = MERMAID_CLASSES[type] ?? MERMAID_CLASSES['unknown']!;
    lines.push(`    classDef ${type.replace(/_/g, '')} ${style}`);
  }
  lines.push('');

  const groups = groupByHost(nodes);

  for (const [group, groupNodes] of groups) {
    const isSubgraph = groups.size > 1;
    if (isSubgraph) {
      const label = group === '__saas__' ? 'SaaS Tools ☁' : group === '__local__' ? 'Local' : group;
      lines.push(`    subgraph ${sanitize(group)}["${label}"]`);
    }
    for (const node of groupNodes) {
      lines.push(`    ${sanitize(node.id)}${nodeLabel(node)}:::${node.type.replace(/_/g, '')}`);
    }
    if (isSubgraph) lines.push('    end');
    lines.push('');
  }

  for (const edge of edges) {
    const src = sanitize(edge.sourceId);
    const tgt = sanitize(edge.targetId);
    const label = EDGE_LABELS[edge.relationship] ?? edge.relationship;
    const conf = edge.confidence < 0.6 ? ' ?' : '';
    lines.push(`    ${src} -->|"${label}${conf}"| ${tgt}`);
  }

  return lines.join('\n');
}

export function generateDependencyMermaid(nodes: NodeRow[], edges: EdgeRow[]): string {
  const depEdges = edges.filter(e =>
    ['calls', 'reads_from', 'writes_to', 'depends_on'].includes(e.relationship)
  );

  if (depEdges.length === 0) return 'graph LR\n    empty["No dependency edges found"]';

  const lines: string[] = ['graph LR'];

  const usedIds = new Set<string>();
  for (const edge of depEdges) {
    usedIds.add(edge.sourceId);
    usedIds.add(edge.targetId);
  }

  const usedNodes = nodes.filter(n => usedIds.has(n.id));
  const usedTypes = new Set(usedNodes.map(n => n.type));
  for (const type of usedTypes) {
    const style = MERMAID_CLASSES[type] ?? MERMAID_CLASSES['unknown']!;
    lines.push(`    classDef ${type.replace(/_/g, '')} ${style}`);
  }
  lines.push('');

  for (const node of usedNodes) {
    lines.push(`    ${sanitize(node.id)}${nodeLabel(node)}:::${node.type.replace(/_/g, '')}`);
  }
  lines.push('');

  for (const edge of depEdges) {
    const label = EDGE_LABELS[edge.relationship] ?? edge.relationship;
    lines.push(`    ${sanitize(edge.sourceId)} -->|"${label}"| ${sanitize(edge.targetId)}`);
  }

  return lines.join('\n');
}

export function generateWorkflowMermaid(sop: SOP): string {
  const lines: string[] = ['flowchart TD'];

  for (const step of sop.steps) {
    const nodeId = `S${step.order}`;
    const label = `${step.order}. ${step.instruction.substring(0, 60)}`;
    lines.push(`    ${nodeId}["${label}"]`);

    if (step.order > 1) {
      lines.push(`    S${step.order - 1} --> ${nodeId}`);
    }
  }

  return lines.join('\n');
}

// ── Backstage YAML ───────────────────────────────────────────────────────────

export function exportBackstageYAML(nodes: NodeRow[], edges: EdgeRow[], org?: string): string {
  const owner = org ?? 'unknown';
  const docs: string[] = [];

  for (const node of nodes) {
    const isComponent = ['web_service', 'container', 'pod'].includes(node.type);
    const isAPI = node.type === 'api_endpoint';
    const kind = isComponent ? 'Component' : isAPI ? 'API' : 'Resource';

    const deps = edges
      .filter(e => e.sourceId === node.id)
      .map(e => `    - resource:default/${sanitize(e.targetId)}`);

    const doc = [
      `apiVersion: backstage.io/v1alpha1`,
      `kind: ${kind}`,
      `metadata:`,
      `  name: ${sanitize(node.id)}`,
      `  annotations:`,
      `    cartography/discovered-at: "${node.discoveredAt}"`,
      `    cartography/confidence: "${node.confidence}"`,
      `spec:`,
      `  type: ${node.type}`,
      `  lifecycle: production`,
      `  owner: ${owner}`,
      ...(deps.length > 0 ? ['  dependsOn:', ...deps] : []),
    ].join('\n');

    docs.push(doc);
  }

  return docs.join('\n---\n');
}

// ── JSON ─────────────────────────────────────────────────────────────────────

export function exportJSON(db: CartographyDB, sessionId: string): string {
  const nodes = db.getNodes(sessionId);
  const edges = db.getEdges(sessionId);
  const events = db.getEvents(sessionId);
  const tasks = db.getTasks(sessionId);
  const sops = db.getSOPs(sessionId);
  const stats = db.getStats(sessionId);

  return JSON.stringify({
    sessionId,
    exportedAt: new Date().toISOString(),
    stats,
    nodes,
    edges,
    events,
    tasks,
    sops,
  }, null, 2);
}

// ── HTML (D3.js Force-Graph) ──────────────────────────────────────────────────

export function exportHTML(nodes: NodeRow[], edges: EdgeRow[]): string {
  const graphData = JSON.stringify({
    nodes: nodes.map(n => ({ id: n.id, name: n.name, type: n.type, confidence: n.confidence })),
    links: edges.map(e => ({ source: e.sourceId, target: e.targetId, relationship: e.relationship })),
  });

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Cartography — Topology</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    body { margin: 0; background: #1a1a2e; color: #eee; font-family: monospace; }
    svg { width: 100vw; height: 100vh; }
    .node circle { stroke: #fff; stroke-width: 1.5px; }
    .node text { font-size: 10px; fill: #eee; }
    .link { stroke: #666; stroke-opacity: 0.6; }
    #info { position: fixed; top: 10px; right: 10px; background: rgba(0,0,0,0.7);
            padding: 10px; border-radius: 4px; font-size: 12px; }
  </style>
</head>
<body>
<div id="info">
  <strong>Cartography</strong><br>
  Nodes: ${nodes.length} | Edges: ${edges.length}<br>
  <small>Drag to explore</small>
</div>
<svg></svg>
<script>
const data = ${graphData};

const TYPE_COLORS = {
  host: '#4a9eff', database_server: '#ff6b6b', database: '#ff8c42',
  web_service: '#6bcb77', api_endpoint: '#4d96ff', cache_server: '#ffd93d',
  message_broker: '#c77dff', queue: '#e0aaff', topic: '#9d4edd',
  container: '#48cae4', pod: '#00b4d8', k8s_cluster: '#0077b6',
  config_file: '#adb5bd', unknown: '#6c757d',
};

const svg = d3.select('svg');
const width = window.innerWidth, height = window.innerHeight;
const g = svg.append('g');

svg.call(d3.zoom().on('zoom', e => g.attr('transform', e.transform)));

const sim = d3.forceSimulation(data.nodes)
  .force('link', d3.forceLink(data.links).id(d => d.id).distance(100))
  .force('charge', d3.forceManyBody().strength(-200))
  .force('center', d3.forceCenter(width / 2, height / 2));

const link = g.append('g').selectAll('line')
  .data(data.links).join('line').attr('class', 'link');

const node = g.append('g').selectAll('g')
  .data(data.nodes).join('g').attr('class', 'node')
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
  );

node.append('circle').attr('r', 8).attr('fill', d => TYPE_COLORS[d.type] || '#aaa');
node.append('text').attr('dx', 12).attr('dy', '.35em').text(d => d.name);
node.append('title').text(d => \`\${d.type}: \${d.id}\nConfidence: \${d.confidence}\`);

sim.on('tick', () => {
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
});
</script>
</body>
</html>`;
}

// ── SOP Markdown ─────────────────────────────────────────────────────────────

export function exportSOPMarkdown(sop: SOP): string {
  const lines: string[] = [
    `# ${sop.title}`,
    '',
    `**Beschreibung:** ${sop.description}`,
    `**Systeme:** ${sop.involvedSystems.join(', ')}`,
    `**Dauer:** ${sop.estimatedDuration}`,
    `**Häufigkeit:** ${sop.frequency}`,
    `**Confidence:** ${sop.confidence.toFixed(2)}`,
    '',
    '## Schritte',
    '',
  ];

  for (const step of sop.steps) {
    lines.push(`${step.order}. **${step.tool}**${step.target ? ` → \`${step.target}\`` : ''}`);
    lines.push(`   ${step.instruction}`);
    if (step.notes) lines.push(`   _${step.notes}_`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── exportAll ─────────────────────────────────────────────────────────────────

export function exportAll(
  db: CartographyDB,
  sessionId: string,
  outputDir: string,
  formats: string[] = ['mermaid', 'json', 'yaml', 'html', 'sops'],
): void {
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'sops'), { recursive: true });
  mkdirSync(join(outputDir, 'workflows'), { recursive: true });

  const nodes = db.getNodes(sessionId);
  const edges = db.getEdges(sessionId);

  if (formats.includes('mermaid')) {
    writeFileSync(join(outputDir, 'topology.mermaid'), generateTopologyMermaid(nodes, edges));
    writeFileSync(join(outputDir, 'dependencies.mermaid'), generateDependencyMermaid(nodes, edges));
    process.stderr.write('✓ topology.mermaid, dependencies.mermaid\n');
  }

  if (formats.includes('json')) {
    writeFileSync(join(outputDir, 'catalog.json'), exportJSON(db, sessionId));
    process.stderr.write('✓ catalog.json\n');
  }

  if (formats.includes('yaml')) {
    writeFileSync(join(outputDir, 'catalog-info.yaml'), exportBackstageYAML(nodes, edges));
    process.stderr.write('✓ catalog-info.yaml\n');
  }

  if (formats.includes('html')) {
    writeFileSync(join(outputDir, 'topology.html'), exportHTML(nodes, edges));
    process.stderr.write('✓ topology.html\n');
  }

  if (formats.includes('sops')) {
    const sops = db.getSOPs(sessionId);
    for (const sop of sops) {
      const filename = sop.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
      writeFileSync(join(outputDir, 'sops', filename), exportSOPMarkdown(sop));

      const wfFilename = `workflow-${sop.workflowId.substring(0, 8)}.mermaid`;
      writeFileSync(join(outputDir, 'workflows', wfFilename), generateWorkflowMermaid(sop));
    }
    if (sops.length > 0) {
      process.stderr.write(`✓ ${sops.length} SOPs + workflow diagrams\n`);
    }
  }
}
