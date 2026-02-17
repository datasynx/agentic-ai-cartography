import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CartographyDB } from './db.js';
import type { NodeRow, EdgeRow, SOP } from './types.js';

// ── Layer assignment ─────────────────────────────────────────────────────────

function nodeLayer(type: string): string {
  if (type === 'saas_tool') return 'saas';
  if (['web_service', 'api_endpoint'].includes(type)) return 'web';
  if (['database_server', 'database', 'table', 'cache_server'].includes(type)) return 'data';
  if (['message_broker', 'queue', 'topic'].includes(type)) return 'messaging';
  if (['host', 'container', 'pod', 'k8s_cluster'].includes(type)) return 'infra';
  if (type === 'config_file') return 'config';
  return 'other';
}

const LAYER_LABELS: Record<string, string> = {
  saas:      '☁ SaaS Tools',
  web:       '🌐 Web / API',
  data:      '🗄 Data Layer',
  messaging: '📨 Messaging',
  infra:     '🖥 Infrastructure',
  config:    '📄 Config',
  other:     '❓ Sonstige',
};

const LAYER_ORDER = ['saas', 'web', 'data', 'messaging', 'infra', 'config', 'other'];

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
  const location = parts.length >= 3 ? `${parts[1]}:${parts[2]}` : parts[1] ?? '';
  const conf = `${Math.round(node.confidence * 100)}%`;

  // Pull 1-2 key metadata fields (no credentials)
  const meta = node.metadata as Record<string, unknown>;
  const extras: string[] = [];
  for (const key of ['category', 'version', 'description']) {
    const v = meta[key];
    if (typeof v === 'string' && v.length > 0) {
      extras.push(v.substring(0, 28));
      break; // max 1 extra line for readability
    }
  }

  const locLine = location ? `<br/><small>${location}</small>` : '';
  const extraLine = extras.length ? `<br/><small>${extras[0]}</small>` : '';
  return `["${icon} <b>${node.name}</b>${locLine}${extraLine}<br/><small>${node.type} · ${conf}</small>"]`;
}

export function generateTopologyMermaid(nodes: NodeRow[], edges: EdgeRow[]): string {
  if (nodes.length === 0) return 'graph TB\n    empty["No nodes discovered yet"]';

  const lines: string[] = ['graph TB'];

  // classDef per used type
  const usedTypes = new Set(nodes.map(n => n.type));
  for (const type of usedTypes) {
    const style = MERMAID_CLASSES[type] ?? MERMAID_CLASSES['unknown']!;
    lines.push(`    classDef ${type.replace(/_/g, '')} ${style}`);
  }
  lines.push('');

  // Group by semantic layer (ordered top→bottom)
  const layerMap = new Map<string, NodeRow[]>();
  for (const node of nodes) {
    const layer = nodeLayer(node.type);
    if (!layerMap.has(layer)) layerMap.set(layer, []);
    layerMap.get(layer)!.push(node);
  }

  for (const layerKey of LAYER_ORDER) {
    const layerNodes = layerMap.get(layerKey);
    if (!layerNodes || layerNodes.length === 0) continue;
    const label = LAYER_LABELS[layerKey] ?? layerKey;
    lines.push(`    subgraph ${layerKey}["${label}"]`);
    for (const node of layerNodes) {
      lines.push(`      ${sanitize(node.id)}${nodeLabel(node)}:::${node.type.replace(/_/g, '')}`);
    }
    lines.push('    end');
    lines.push('');
  }

  // Edges: dashed for low-confidence (<0.6), solid otherwise
  for (const edge of edges) {
    const src = sanitize(edge.sourceId);
    const tgt = sanitize(edge.targetId);
    const label = EDGE_LABELS[edge.relationship] ?? edge.relationship;
    const arrow = edge.confidence < 0.6 ? `-. "${label}" .->` : `-->|"${label}"|`;
    lines.push(`    ${src} ${arrow} ${tgt}`);
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
    nodes: nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      confidence: n.confidence,
      discoveredVia: n.discoveredVia,
      discoveredAt: n.discoveredAt,
      tags: n.tags,
      metadata: n.metadata,
    })),
    links: edges.map(e => ({
      source: e.sourceId,
      target: e.targetId,
      relationship: e.relationship,
      confidence: e.confidence,
      evidence: e.evidence,
    })),
  });

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Cartography — Topology</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #0d1117; color: #e6edf3; font-family: 'SF Mono', 'Fira Code', monospace; display: flex; }
    #graph { flex: 1; height: 100vh; }
    svg { width: 100%; height: 100%; }
    .link { stroke-opacity: 0.5; }
    .link-label { font-size: 9px; fill: #8b949e; }
    .node circle { stroke-width: 2px; cursor: pointer; transition: r 0.15s; }
    .node circle:hover { r: 14; }
    .node text { font-size: 11px; fill: #c9d1d9; pointer-events: none; }
    /* ── Sidebar ── */
    #sidebar {
      width: 300px; min-width: 300px; height: 100vh; overflow-y: auto;
      background: #161b22; border-left: 1px solid #30363d;
      padding: 16px; font-size: 12px; line-height: 1.6;
    }
    #sidebar h2 { margin: 0 0 8px; font-size: 14px; color: #58a6ff; }
    #sidebar .meta-table { width: 100%; border-collapse: collapse; }
    #sidebar .meta-table td { padding: 3px 6px; border-bottom: 1px solid #21262d; vertical-align: top; }
    #sidebar .meta-table td:first-child { color: #8b949e; white-space: nowrap; width: 90px; }
    #sidebar .tag { display: inline-block; background: #21262d; border-radius: 3px; padding: 1px 5px; margin: 1px; }
    #sidebar .conf-bar { height: 6px; border-radius: 3px; background: #21262d; margin-top: 3px; }
    #sidebar .conf-fill { height: 100%; border-radius: 3px; }
    #sidebar .edges-list { margin-top: 12px; }
    #sidebar .edge-item { padding: 4px 0; border-bottom: 1px solid #21262d; color: #8b949e; }
    #sidebar .edge-item span { color: #c9d1d9; }
    .hint { color: #484f58; font-size: 11px; margin-top: 8px; }
    #header { position: fixed; top: 10px; left: 10px; background: rgba(13,17,23,0.85);
              padding: 8px 12px; border-radius: 6px; font-size: 12px; border: 1px solid #30363d; }
    #header strong { color: #58a6ff; }
  </style>
</head>
<body>
<div id="graph">
  <div id="header">
    <strong>Cartography</strong> &nbsp;
    <span style="color:#8b949e">${nodes.length} Nodes · ${edges.length} Edges</span><br>
    <span style="color:#484f58;font-size:10px">Scroll=zoom · Drag=pan · Click=details</span>
  </div>
  <svg></svg>
</div>
<div id="sidebar">
  <h2>Infrastructure Map</h2>
  <p class="hint">Klicke einen Node um Details anzuzeigen.</p>
</div>
<script>
const data = ${graphData};

const TYPE_COLORS = {
  host: '#4a9eff', database_server: '#ff6b6b', database: '#ff8c42',
  web_service: '#6bcb77', api_endpoint: '#4d96ff', cache_server: '#ffd93d',
  message_broker: '#c77dff', queue: '#e0aaff', topic: '#9d4edd',
  container: '#48cae4', pod: '#00b4d8', k8s_cluster: '#0077b6',
  config_file: '#adb5bd', saas_tool: '#da8bff', unknown: '#6c757d',
};

const NODE_RADIUS = { saas_tool: 10, host: 11, database_server: 11, k8s_cluster: 13, default: 8 };
const radius = d => NODE_RADIUS[d.type] || NODE_RADIUS.default;

const sidebar = document.getElementById('sidebar');

function showNode(d) {
  const c = TYPE_COLORS[d.type] || '#aaa';
  const confPct = Math.round(d.confidence * 100);
  const tags = (d.tags || []).map(t => \`<span class="tag">\${t}</span>\`).join('');
  const metaRows = Object.entries(d.metadata || {})
    .filter(([,v]) => v !== null && v !== undefined && String(v).length > 0)
    .map(([k,v]) => \`<tr><td>\${k}</td><td>\${JSON.stringify(v)}</td></tr>\`)
    .join('');
  const related = data.links.filter(l =>
    (l.source.id||l.source) === d.id || (l.target.id||l.target) === d.id
  );
  const edgeItems = related.map(l => {
    const isOut = (l.source.id||l.source) === d.id;
    const other = isOut ? (l.target.id||l.target) : (l.source.id||l.source);
    return \`<div class="edge-item">\${isOut ? '→' : '←'} <span>\${other}</span> <small>[\${l.relationship}]</small></div>\`;
  }).join('');

  sidebar.innerHTML = \`
    <h2>\${d.name}</h2>
    <table class="meta-table">
      <tr><td>ID</td><td style="font-size:10px;word-break:break-all">\${d.id}</td></tr>
      <tr><td>Typ</td><td><span style="color:\${c}">\${d.type}</span></td></tr>
      <tr><td>Confidence</td><td>
        \${confPct}%
        <div class="conf-bar"><div class="conf-fill" style="width:\${confPct}%;background:\${c}"></div></div>
      </td></tr>
      <tr><td>Entdeckt via</td><td>\${d.discoveredVia || '—'}</td></tr>
      <tr><td>Zeitpunkt</td><td>\${d.discoveredAt ? d.discoveredAt.substring(0,19).replace('T',' ') : '—'}</td></tr>
      \${tags ? '<tr><td>Tags</td><td>'+tags+'</td></tr>' : ''}
      \${metaRows}
    </table>
    \${related.length > 0 ? '<div class="edges-list"><strong>Verbindungen:</strong>'+edgeItems+'</div>' : ''}
  \`;
}

const svgEl = d3.select('svg');
const graphDiv = document.getElementById('graph');
const width = () => graphDiv.clientWidth;
const height = () => graphDiv.clientHeight;
const g = svgEl.append('g');

svgEl.call(d3.zoom().scaleExtent([0.1, 4]).on('zoom', e => g.attr('transform', e.transform)));

const sim = d3.forceSimulation(data.nodes)
  .force('link', d3.forceLink(data.links).id(d => d.id).distance(d => d.relationship === 'contains' ? 60 : 120))
  .force('charge', d3.forceManyBody().strength(-320))
  .force('center', d3.forceCenter(width() / 2, height() / 2))
  .force('collision', d3.forceCollide().radius(d => radius(d) + 20));

const link = g.append('g')
  .selectAll('line').data(data.links).join('line')
  .attr('class', 'link')
  .attr('stroke', d => d.confidence < 0.6 ? '#444' : '#555')
  .attr('stroke-dasharray', d => d.confidence < 0.6 ? '4 3' : null)
  .attr('stroke-width', d => d.confidence < 0.6 ? 1 : 1.5);

link.append('title').text(d => \`\${d.relationship} (conf:\${d.confidence})\n\${d.evidence||''}\`);

const node = g.append('g')
  .selectAll('g').data(data.nodes).join('g').attr('class', 'node')
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
  )
  .on('click', (e, d) => { e.stopPropagation(); showNode(d); });

node.append('circle')
  .attr('r', radius)
  .attr('fill', d => TYPE_COLORS[d.type] || '#aaa')
  .attr('stroke', d => d3.color(TYPE_COLORS[d.type] || '#aaa').brighter(1).formatHex())
  .append('title').text(d => \`\${d.id}\nconf:\${d.confidence}\`);

node.append('text').attr('dx', d => radius(d) + 4).attr('dy', '.35em').text(d => d.name);

sim.on('tick', () => {
  link.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
});

svgEl.on('click', () => {
  sidebar.innerHTML = '<h2>Infrastructure Map</h2><p class="hint">Klicke einen Node um Details anzuzeigen.</p>';
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
