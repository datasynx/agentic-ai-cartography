import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CartographyDB } from './db.js';
import type { NodeRow, EdgeRow, SOP } from './types.js';
import { buildMapData } from './mapper.js';
import { shadeVariant } from './cluster.js';
import { hexToPixel } from './hex.js';

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
  other:     '❓ Other',
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

// ── HTML (D3.js Hexagonal Cartography Map) ────────────────────────────────────

export function exportHTML(nodes: NodeRow[], edges: EdgeRow[]): string {
  const graphData = JSON.stringify({
    nodes: nodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      layer: nodeLayer(n.type),
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cartography — Infrastructure Map</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0e14; color: #e6edf3; font-family: 'SF Mono','Fira Code','Cascadia Code',monospace; display: flex; overflow: hidden; height: 100vh; }

    /* ── Left node panel ─────────────────────────────── */
    #node-panel {
      width: 220px; min-width: 220px; height: 100vh; overflow: hidden;
      background: #0d1117; border-right: 1px solid #1b2028;
      display: flex; flex-direction: column;
    }
    #node-panel-header {
      padding: 10px 12px 8px; border-bottom: 1px solid #1b2028;
      font-size: 11px; color: #6e7681; text-transform: uppercase; letter-spacing: 0.6px;
    }
    #node-search {
      width: calc(100% - 16px); margin: 8px; padding: 5px 8px;
      background: #161b22; border: 1px solid #30363d; border-radius: 5px;
      color: #e6edf3; font-size: 11px; font-family: inherit; outline: none;
    }
    #node-search:focus { border-color: #58a6ff; }
    #node-list { flex: 1; overflow-y: auto; padding-bottom: 8px; }
    .node-list-item {
      padding: 5px 12px; cursor: pointer; font-size: 11px;
      display: flex; align-items: center; gap: 6px; border-left: 2px solid transparent;
    }
    .node-list-item:hover { background: #161b22; }
    .node-list-item.active { background: #1a2436; border-left-color: #58a6ff; }
    .node-list-dot { width: 7px; height: 7px; border-radius: 2px; flex-shrink: 0; }
    .node-list-name { color: #c9d1d9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
    .node-list-type { color: #484f58; font-size: 9px; flex-shrink: 0; }

    /* ── Center graph ────────────────────────────────── */
    #graph { flex: 1; height: 100vh; position: relative; }
    svg { width: 100%; height: 100%; }
    .hull { opacity: 0.12; stroke-width: 1.5; stroke-opacity: 0.25; }
    .hull-label { font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; fill-opacity: 0.5; pointer-events: none; }
    .link { stroke-opacity: 0.4; }
    .link-label { font-size: 8px; fill: #6e7681; pointer-events: none; opacity: 0; }
    .node-hex { stroke-width: 1.8; cursor: pointer; transition: opacity 0.15s; }
    .node-hex:hover { filter: brightness(1.3); stroke-width: 3; }
    .node-hex.selected { stroke-width: 3.5; filter: brightness(1.5); }
    .node-label { font-size: 10px; fill: #c9d1d9; pointer-events: none; opacity: 0; }

    /* ── Right sidebar ───────────────────────────────── */
    #sidebar {
      width: 300px; min-width: 300px; height: 100vh; overflow-y: auto;
      background: #0d1117; border-left: 1px solid #1b2028;
      padding: 16px; font-size: 12px; line-height: 1.6;
    }
    #sidebar h2 { margin: 0 0 8px; font-size: 14px; color: #58a6ff; }
    #sidebar .meta-table { width: 100%; border-collapse: collapse; }
    #sidebar .meta-table td { padding: 3px 6px; border-bottom: 1px solid #161b22; vertical-align: top; }
    #sidebar .meta-table td:first-child { color: #6e7681; white-space: nowrap; width: 90px; }
    #sidebar .tag { display: inline-block; background: #161b22; border-radius: 3px; padding: 1px 5px; margin: 1px; font-size: 10px; }
    #sidebar .conf-bar { height: 5px; border-radius: 3px; background: #161b22; margin-top: 3px; }
    #sidebar .conf-fill { height: 100%; border-radius: 3px; }
    #sidebar .edges-list { margin-top: 12px; }
    #sidebar .edge-item { padding: 4px 0; border-bottom: 1px solid #161b22; color: #6e7681; font-size: 11px; }
    #sidebar .edge-item span { color: #c9d1d9; }
    #sidebar .action-row { display: flex; gap: 6px; margin-top: 14px; }
    .btn-delete {
      flex: 1; padding: 6px 10px; background: transparent; border: 1px solid #6e191d;
      color: #f85149; border-radius: 5px; font-size: 11px; font-family: inherit;
      cursor: pointer; text-align: center;
    }
    .btn-delete:hover { background: #3d0c0c; }
    .hint { color: #3d434b; font-size: 11px; margin-top: 8px; }

    /* ── HUD ─────────────────────────────────────────── */
    #hud { position: absolute; top: 10px; left: 10px; background: rgba(10,14,20,0.88);
           padding: 10px 14px; border-radius: 8px; font-size: 12px; border: 1px solid #1b2028; pointer-events: none; }
    #hud strong { color: #58a6ff; }
    #hud .stats { color: #6e7681; }
    #hud .zoom-level { color: #3d434b; font-size: 10px; margin-top: 2px; }

    /* ── Toolbar (filters + JGF export) ─────────────── */
    #toolbar { position: absolute; top: 10px; right: 10px; display: flex; flex-wrap: wrap; gap: 4px; pointer-events: auto; align-items: center; }
    .filter-btn {
      background: rgba(10,14,20,0.85); border: 1px solid #1b2028; border-radius: 6px;
      color: #c9d1d9; padding: 4px 10px; font-size: 11px; cursor: pointer;
      font-family: inherit; display: flex; align-items: center; gap: 5px;
    }
    .filter-btn:hover { border-color: #30363d; }
    .filter-btn.off { opacity: 0.35; }
    .filter-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
    .export-btn {
      background: rgba(10,14,20,0.85); border: 1px solid #1b2028; border-radius: 6px;
      color: #58a6ff; padding: 4px 12px; font-size: 11px; cursor: pointer;
      font-family: inherit;
    }
    .export-btn:hover { border-color: #58a6ff; background: rgba(88,166,255,0.08); }
  </style>
</head>
<body>

<!-- Left: node list panel -->
<div id="node-panel">
  <div id="node-panel-header">Nodes (${nodes.length})</div>
  <input id="node-search" type="text" placeholder="Search nodes…" autocomplete="off" spellcheck="false">
  <div id="node-list"></div>
</div>

<!-- Center: graph -->
<div id="graph">
  <div id="hud">
    <strong>Cartography</strong> &nbsp;
    <span class="stats" id="hud-stats">${nodes.length} nodes · ${edges.length} edges</span><br>
    <span class="zoom-level">Scroll = zoom · Drag = pan · Click = details</span>
  </div>
  <div id="toolbar"></div>
  <svg></svg>
</div>

<!-- Right: detail sidebar -->
<div id="sidebar">
  <h2>Infrastructure Map</h2>
  <p class="hint">Click a node to view details.</p>
</div>

<script>
const data = ${graphData};

// ── Color palette per node type ───────────────────────────────────────────
const TYPE_COLORS = {
  host: '#4a9eff', database_server: '#ff6b6b', database: '#ff8c42',
  web_service: '#6bcb77', api_endpoint: '#4d96ff', cache_server: '#ffd93d',
  message_broker: '#c77dff', queue: '#e0aaff', topic: '#9d4edd',
  container: '#48cae4', pod: '#00b4d8', k8s_cluster: '#0077b6',
  config_file: '#adb5bd', saas_tool: '#c084fc', table: '#f97316', unknown: '#6c757d',
};

const LAYER_COLORS = {
  saas: '#c084fc', web: '#6bcb77', data: '#ff6b6b',
  messaging: '#c77dff', infra: '#4a9eff', config: '#adb5bd', other: '#6c757d',
};
const LAYER_NAMES = {
  saas: 'SaaS Tools', web: 'Web / API', data: 'Data Layer',
  messaging: 'Messaging', infra: 'Infrastructure', config: 'Config', other: 'Other',
};

// ── Hexagon path ──────────────────────────────────────────────────────────
const HEX_SIZE = { saas_tool: 16, host: 18, database_server: 18, k8s_cluster: 20, default: 14 };
function hexSize(d) { return HEX_SIZE[d.type] || HEX_SIZE.default; }
function hexPath(size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    pts.push([size * Math.cos(angle), size * Math.sin(angle)]);
  }
  return 'M' + pts.map(p => p.join(',')).join('L') + 'Z';
}

// ── Left panel ────────────────────────────────────────────────────────────
const nodeListEl = document.getElementById('node-list');
const nodeSearchEl = document.getElementById('node-search');
let selectedNodeId = null;

function buildNodeList(filter) {
  const q = (filter || '').toLowerCase();
  nodeListEl.innerHTML = '';
  const sorted = [...data.nodes].sort((a, b) => a.name.localeCompare(b.name));
  for (const d of sorted) {
    if (q && !d.name.toLowerCase().includes(q) && !d.type.includes(q) && !d.id.toLowerCase().includes(q)) continue;
    const item = document.createElement('div');
    item.className = 'node-list-item' + (d.id === selectedNodeId ? ' active' : '');
    item.dataset.id = d.id;
    const color = TYPE_COLORS[d.type] || '#aaa';
    item.innerHTML = \`<span class="node-list-dot" style="background:\${color}"></span>
      <span class="node-list-name" title="\${d.id}">\${d.name}</span>
      <span class="node-list-type">\${d.type.replace(/_/g,' ')}</span>\`;
    item.onclick = () => { selectNode(d); focusNode(d); };
    nodeListEl.appendChild(item);
  }
}

nodeSearchEl.addEventListener('input', e => buildNodeList(e.target.value));

// ── Sidebar detail view ───────────────────────────────────────────────────
const sidebar = document.getElementById('sidebar');

function selectNode(d) {
  selectedNodeId = d.id;
  buildNodeList(nodeSearchEl.value);
  showNode(d);
  // highlight hex
  d3.selectAll('.node-hex').classed('selected', nd => nd.id === d.id);
}

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
      <tr><td>Type</td><td><span style="color:\${c}">\${d.type}</span></td></tr>
      <tr><td>Layer</td><td>\${d.layer}</td></tr>
      <tr><td>Confidence</td><td>
        \${confPct}%
        <div class="conf-bar"><div class="conf-fill" style="width:\${confPct}%;background:\${c}"></div></div>
      </td></tr>
      <tr><td>Discovered via</td><td>\${d.discoveredVia || '—'}</td></tr>
      <tr><td>Timestamp</td><td>\${d.discoveredAt ? d.discoveredAt.substring(0,19).replace('T',' ') : '—'}</td></tr>
      \${tags ? '<tr><td>Tags</td><td>'+tags+'</td></tr>' : ''}
      \${metaRows}
    </table>
    \${related.length > 0 ? '<div class="edges-list"><strong>Connections (' + related.length + '):</strong>'+edgeItems+'</div>' : ''}
    <div class="action-row">
      <button class="btn-delete" onclick="deleteNode('\${d.id}')">🗑 Delete node</button>
    </div>
  \`;
}

// ── Delete node ───────────────────────────────────────────────────────────
function deleteNode(id) {
  const idx = data.nodes.findIndex(n => n.id === id);
  if (idx === -1) return;
  data.nodes.splice(idx, 1);
  data.links = data.links.filter(l =>
    (l.source.id || l.source) !== id && (l.target.id || l.target) !== id
  );
  selectedNodeId = null;
  sidebar.innerHTML = '<h2>Infrastructure Map</h2><p class="hint">Node deleted.</p>';
  document.getElementById('hud-stats').textContent =
    data.nodes.length + ' nodes · ' + data.links.length + ' edges';
  rebuildGraph();
  buildNodeList(nodeSearchEl.value);
}

// ── SVG setup ─────────────────────────────────────────────────────────────
const svgEl = d3.select('svg');
const graphDiv = document.getElementById('graph');
const W = () => graphDiv.clientWidth;
const H = () => graphDiv.clientHeight;
const g = svgEl.append('g');

svgEl.append('defs').append('marker')
  .attr('id', 'arrow').attr('viewBox', '0 0 10 6')
  .attr('refX', 10).attr('refY', 3)
  .attr('markerWidth', 8).attr('markerHeight', 6)
  .attr('orient', 'auto')
  .append('path').attr('d', 'M0,0 L10,3 L0,6 Z').attr('fill', '#555');

let currentZoom = 1;
const zoomBehavior = d3.zoom().scaleExtent([0.08, 6]).on('zoom', e => {
  g.attr('transform', e.transform);
  currentZoom = e.transform.k;
  updateLOD(currentZoom);
});
svgEl.call(zoomBehavior);

// ── Layer filter state ────────────────────────────────────────────────────
const layers = [...new Set(data.nodes.map(d => d.layer))];
const layerVisible = {};
layers.forEach(l => layerVisible[l] = true);

const toolbarEl = document.getElementById('toolbar');

// Filter buttons
layers.forEach(layer => {
  const btn = document.createElement('button');
  btn.className = 'filter-btn';
  btn.innerHTML = \`<span class="filter-dot" style="background:\${LAYER_COLORS[layer]||'#666'}"></span>\${LAYER_NAMES[layer]||layer}\`;
  btn.onclick = () => {
    layerVisible[layer] = !layerVisible[layer];
    btn.classList.toggle('off', !layerVisible[layer]);
    updateVisibility();
  };
  toolbarEl.appendChild(btn);
});

// JGF export button
const jgfBtn = document.createElement('button');
jgfBtn.className = 'export-btn';
jgfBtn.textContent = '↓ JGF';
jgfBtn.title = 'Export JSON Graph Format';
jgfBtn.onclick = exportJGF;
toolbarEl.appendChild(jgfBtn);

// ── JGF export ────────────────────────────────────────────────────────────
function exportJGF() {
  const jgf = {
    graph: {
      directed: true,
      type: 'cartography',
      label: 'Infrastructure Map',
      metadata: { exportedAt: new Date().toISOString() },
      nodes: Object.fromEntries(data.nodes.map(n => [n.id, {
        label: n.name,
        metadata: { type: n.type, layer: n.layer, confidence: n.confidence,
          discoveredVia: n.discoveredVia, discoveredAt: n.discoveredAt,
          tags: n.tags, ...n.metadata }
      }])),
      edges: data.links.map(l => ({
        source: l.source.id || l.source,
        target: l.target.id || l.target,
        relation: l.relationship,
        metadata: { confidence: l.confidence, evidence: l.evidence }
      })),
    }
  };
  const blob = new Blob([JSON.stringify(jgf, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'cartography-graph.jgf.json'; a.click();
  URL.revokeObjectURL(url);
}

// ── Cluster force ─────────────────────────────────────────────────────────
function clusterForce(alpha) {
  const centroids = {};
  const counts = {};
  data.nodes.forEach(d => {
    if (!centroids[d.layer]) { centroids[d.layer] = { x: 0, y: 0 }; counts[d.layer] = 0; }
    centroids[d.layer].x += d.x || 0;
    centroids[d.layer].y += d.y || 0;
    counts[d.layer]++;
  });
  for (const l in centroids) { centroids[l].x /= counts[l]; centroids[l].y /= counts[l]; }
  const strength = alpha * 0.15;
  data.nodes.forEach(d => {
    const c = centroids[d.layer];
    if (c) { d.vx += (c.x - d.x) * strength; d.vy += (c.y - d.y) * strength; }
  });
}

// ── Hull group ────────────────────────────────────────────────────────────
const hullGroup = g.append('g').attr('class', 'hulls');
const hullPaths = {};
const hullLabels = {};
layers.forEach(layer => {
  hullPaths[layer] = hullGroup.append('path').attr('class', 'hull')
    .attr('fill', LAYER_COLORS[layer] || '#666').attr('stroke', LAYER_COLORS[layer] || '#666');
  hullLabels[layer] = hullGroup.append('text').attr('class', 'hull-label')
    .attr('fill', LAYER_COLORS[layer] || '#666').text(LAYER_NAMES[layer] || layer);
});

function updateHulls() {
  layers.forEach(layer => {
    if (!layerVisible[layer]) { hullPaths[layer].attr('d', null); hullLabels[layer].attr('x', -9999); return; }
    const pts = data.nodes.filter(d => d.layer === layer && layerVisible[d.layer]).map(d => [d.x, d.y]);
    if (pts.length < 3) {
      hullPaths[layer].attr('d', null);
      if (pts.length > 0) hullLabels[layer].attr('x', pts[0][0]).attr('y', pts[0][1] - 30);
      else hullLabels[layer].attr('x', -9999);
      return;
    }
    const hull = d3.polygonHull(pts);
    if (!hull) { hullPaths[layer].attr('d', null); return; }
    const cx = d3.mean(hull, p => p[0]);
    const cy = d3.mean(hull, p => p[1]);
    const padded = hull.map(p => {
      const dx = p[0] - cx, dy = p[1] - cy;
      const len = Math.sqrt(dx*dx + dy*dy) || 1;
      return [p[0] + dx/len * 40, p[1] + dy/len * 40];
    });
    hullPaths[layer].attr('d', 'M' + padded.join('L') + 'Z');
    hullLabels[layer].attr('x', cx).attr('y', cy - d3.max(hull, p => Math.abs(p[1] - cy)) - 30);
  });
}

// ── Graph rendering (rebuildable after delete) ────────────────────────────
let linkSel, linkLabelSel, nodeSel, nodeLabelSel, sim;
const linkGroup = g.append('g');
const nodeGroup = g.append('g');

function focusNode(d) {
  if (!d.x || !d.y) return;
  const w = W(), h = H();
  svgEl.transition().duration(500).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(w / 2, h / 2).scale(Math.min(3, currentZoom < 1 ? 1.5 : currentZoom)).translate(-d.x, -d.y)
  );
}

function rebuildGraph() {
  if (sim) sim.stop();

  // Links
  linkSel = linkGroup.selectAll('line').data(data.links, d => \`\${d.source.id||d.source}>\${d.target.id||d.target}\`);
  linkSel.exit().remove();
  const linkEnter = linkSel.enter().append('line').attr('class', 'link');
  linkSel = linkEnter.merge(linkSel)
    .attr('stroke', d => d.confidence < 0.6 ? '#2a2e35' : '#3d434b')
    .attr('stroke-dasharray', d => d.confidence < 0.6 ? '4 3' : null)
    .attr('stroke-width', d => d.confidence < 0.6 ? 0.8 : 1.2)
    .attr('marker-end', 'url(#arrow)');
  linkSel.select('title').remove();
  linkSel.append('title').text(d => \`\${d.relationship} (\${Math.round(d.confidence*100)}%)\n\${d.evidence||''}\`);

  // Link labels
  linkLabelSel = linkGroup.selectAll('text').data(data.links, d => \`\${d.source.id||d.source}>\${d.target.id||d.target}\`);
  linkLabelSel.exit().remove();
  linkLabelSel = linkLabelSel.enter().append('text').attr('class', 'link-label').merge(linkLabelSel)
    .text(d => d.relationship);

  // Nodes
  nodeSel = nodeGroup.selectAll('g').data(data.nodes, d => d.id);
  nodeSel.exit().remove();
  const nodeEnter = nodeSel.enter().append('g')
    .call(d3.drag()
      .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
    )
    .on('click', (e, d) => { e.stopPropagation(); selectNode(d); });
  nodeEnter.append('path').attr('class', 'node-hex');
  nodeEnter.append('title');
  nodeEnter.append('text').attr('class', 'node-label').attr('text-anchor', 'middle');

  nodeSel = nodeEnter.merge(nodeSel);
  nodeSel.select('.node-hex')
    .attr('d', d => hexPath(hexSize(d)))
    .attr('fill', d => TYPE_COLORS[d.type] || '#aaa')
    .attr('stroke', d => { const c = d3.color(TYPE_COLORS[d.type] || '#aaa'); return c ? c.brighter(0.8).formatHex() : '#ccc'; })
    .attr('fill-opacity', d => 0.6 + d.confidence * 0.4)
    .classed('selected', d => d.id === selectedNodeId);
  nodeSel.select('title').text(d => \`\${d.name} (\${d.type})\nconf: \${Math.round(d.confidence*100)}%\`);
  nodeLabelSel = nodeSel.select('.node-label')
    .attr('dy', d => hexSize(d) + 13)
    .text(d => d.name.length > 20 ? d.name.substring(0, 18) + '…' : d.name);

  // Simulation
  sim = d3.forceSimulation(data.nodes)
    .force('link', d3.forceLink(data.links).id(d => d.id).distance(d => d.relationship === 'contains' ? 50 : 100).strength(0.4))
    .force('charge', d3.forceManyBody().strength(-280))
    .force('center', d3.forceCenter(W() / 2, H() / 2))
    .force('collision', d3.forceCollide().radius(d => hexSize(d) + 10))
    .force('cluster', clusterForce)
    .on('tick', () => {
      updateHulls();
      linkSel.attr('x1', d => d.source.x).attr('y1', d => d.source.y)
             .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
      linkLabelSel.attr('x', d => (d.source.x + d.target.x) / 2)
                  .attr('y', d => (d.source.y + d.target.y) / 2 - 4);
      nodeSel.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
    });
}

// ── LOD & visibility ──────────────────────────────────────────────────────
function updateLOD(k) {
  if (nodeLabelSel) nodeLabelSel.style('opacity', k > 0.5 ? Math.min(1, (k - 0.5) * 2) : 0);
  if (linkLabelSel) linkLabelSel.style('opacity', k > 1.2 ? Math.min(1, (k - 1.2) * 3) : 0);
  d3.selectAll('.hull-label').style('font-size', k < 0.4 ? '18px' : '13px');
}

function updateVisibility() {
  if (!nodeSel) return;
  nodeSel.style('display', d => layerVisible[d.layer] ? null : 'none');
  linkSel.style('display', d => {
    const s = data.nodes.find(n => n.id === (d.source.id||d.source));
    const t = data.nodes.find(n => n.id === (d.target.id||d.target));
    return (s && layerVisible[s.layer]) && (t && layerVisible[t.layer]) ? null : 'none';
  });
  linkLabelSel.style('display', d => {
    const s = data.nodes.find(n => n.id === (d.source.id||d.source));
    const t = data.nodes.find(n => n.id === (d.target.id||d.target));
    return (s && layerVisible[s.layer]) && (t && layerVisible[t.layer]) ? null : 'none';
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
rebuildGraph();
buildNodeList();
updateLOD(1);

svgEl.on('click', () => {
  selectedNodeId = null;
  d3.selectAll('.node-hex').classed('selected', false);
  buildNodeList(nodeSearchEl.value);
  sidebar.innerHTML = '<h2>Infrastructure Map</h2><p class="hint">Click a node to view details.</p>';
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
    `**Description:** ${sop.description}`,
    `**Systems:** ${sop.involvedSystems.join(', ')}`,
    `**Duration:** ${sop.estimatedDuration}`,
    `**Frequency:** ${sop.frequency}`,
    `**Confidence:** ${sop.confidence.toFixed(2)}`,
    '',
    '## Steps',
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

// ── SOP Dashboard HTML ───────────────────────────────────────────────────────

export function exportSOPDashboard(sops: Array<SOP & { id: string; workflowId: string; generatedAt?: string }>): string {
  const sopsJson = JSON.stringify(sops.map(s => ({
    id: s.id,
    title: s.title,
    description: s.description,
    steps: s.steps,
    systems: s.involvedSystems,
    duration: s.estimatedDuration,
    frequency: s.frequency,
    confidence: s.confidence,
    generatedAt: s.generatedAt ?? new Date().toISOString(),
  })));

  // System frequency: how many SOPs reference each system
  const systemCount: Record<string, number> = {};
  for (const sop of sops) {
    for (const sys of sop.involvedSystems) {
      systemCount[sys] = (systemCount[sys] ?? 0) + 1;
    }
  }
  const systemsJson = JSON.stringify(
    Object.entries(systemCount).sort((a, b) => b[1] - a[1])
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Cartography — SOP Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0d1117; color: #e6edf3;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      padding: 0; line-height: 1.6;
    }
    .header {
      background: linear-gradient(135deg, #161b22 0%, #1a1f2e 100%);
      border-bottom: 1px solid #30363d; padding: 32px 40px;
    }
    .header h1 { font-size: 24px; color: #58a6ff; margin-bottom: 8px; }
    .header .subtitle { color: #8b949e; font-size: 14px; }
    .stats-row {
      display: flex; gap: 24px; margin-top: 16px; flex-wrap: wrap;
    }
    .stat-card {
      background: #21262d; border: 1px solid #30363d; border-radius: 8px;
      padding: 12px 20px; min-width: 140px;
    }
    .stat-card .value { font-size: 28px; font-weight: 700; color: #58a6ff; }
    .stat-card .label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px 40px; }
    .section-title { font-size: 18px; color: #c9d1d9; margin: 32px 0 16px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
    /* Systems bar chart */
    .systems-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
    .sys-tag {
      background: #21262d; border: 1px solid #30363d; border-radius: 6px;
      padding: 6px 12px; font-size: 12px; cursor: default;
    }
    .sys-tag .count { color: #58a6ff; font-weight: 600; margin-left: 4px; }
    /* SOP cards */
    .sop-card {
      background: #161b22; border: 1px solid #30363d; border-radius: 8px;
      margin-bottom: 16px; overflow: hidden; transition: border-color 0.2s;
    }
    .sop-card:hover { border-color: #58a6ff; }
    .sop-header {
      padding: 16px 20px; cursor: pointer; display: flex;
      justify-content: space-between; align-items: center;
    }
    .sop-header h3 { font-size: 16px; color: #e6edf3; }
    .sop-meta { display: flex; gap: 16px; align-items: center; font-size: 12px; color: #8b949e; }
    .sop-meta .freq { color: #3fb950; font-weight: 600; }
    .sop-meta .dur { color: #d29922; }
    .sop-meta .conf {
      display: inline-flex; align-items: center; gap: 4px;
    }
    .conf-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .sop-body { display: none; padding: 0 20px 20px; border-top: 1px solid #21262d; }
    .sop-body.open { display: block; padding-top: 16px; }
    .sop-desc { color: #8b949e; font-size: 13px; margin-bottom: 12px; }
    .sop-systems { margin-bottom: 12px; }
    .sop-systems span { background: #0d419d33; color: #58a6ff; border-radius: 4px; padding: 2px 8px; font-size: 11px; margin-right: 4px; }
    .steps-list { list-style: none; counter-reset: step; }
    .steps-list li {
      counter-increment: step; position: relative;
      padding: 10px 12px 10px 44px; border-left: 2px solid #30363d;
      margin-left: 14px; font-size: 13px;
    }
    .steps-list li:last-child { border-left-color: transparent; }
    .steps-list li::before {
      content: counter(step);
      position: absolute; left: -14px; top: 8px;
      width: 26px; height: 26px; border-radius: 50%;
      background: #21262d; border: 2px solid #30363d;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 600; color: #58a6ff;
    }
    .step-tool { color: #d2a8ff; font-weight: 600; }
    .step-target { color: #7ee787; font-size: 12px; }
    .step-notes { color: #8b949e; font-style: italic; font-size: 12px; margin-top: 2px; }
    .step-instr { color: #c9d1d9; }
    .toggle-icon { color: #8b949e; font-size: 18px; transition: transform 0.2s; }
    .toggle-icon.open { transform: rotate(90deg); }
    .empty { color: #484f58; font-size: 14px; padding: 40px; text-align: center; }
    .gen-time { color: #484f58; font-size: 11px; margin-top: 8px; }
  </style>
</head>
<body>
<div class="header">
  <h1>SOP Dashboard</h1>
  <div class="subtitle">Cartography — Standard Operating Procedures</div>
  <div class="stats-row">
    <div class="stat-card"><div class="value" id="sop-count">0</div><div class="label">SOPs</div></div>
    <div class="stat-card"><div class="value" id="step-count">0</div><div class="label">Total Steps</div></div>
    <div class="stat-card"><div class="value" id="sys-count">0</div><div class="label">Systems</div></div>
    <div class="stat-card"><div class="value" id="avg-conf">—</div><div class="label">Avg Confidence</div></div>
  </div>
</div>
<div class="container">
  <h2 class="section-title">Involved Systems</h2>
  <div class="systems-grid" id="systems"></div>

  <h2 class="section-title">SOPs</h2>
  <div id="sop-list"></div>
</div>
<script>
const sops = ${sopsJson};
const systems = ${systemsJson};

document.getElementById('sop-count').textContent = sops.length;
document.getElementById('step-count').textContent = sops.reduce((a, s) => a + s.steps.length, 0);
document.getElementById('sys-count').textContent = systems.length;
const avgConf = sops.length > 0
  ? (sops.reduce((a, s) => a + s.confidence, 0) / sops.length * 100).toFixed(0) + '%'
  : '—';
document.getElementById('avg-conf').textContent = avgConf;

const sysDiv = document.getElementById('systems');
systems.forEach(([name, count]) => {
  const el = document.createElement('div');
  el.className = 'sys-tag';
  el.innerHTML = name + '<span class="count">x' + count + '</span>';
  sysDiv.appendChild(el);
});

const listDiv = document.getElementById('sop-list');
if (sops.length === 0) {
  listDiv.innerHTML = '<div class="empty">No SOPs found. Run a discovery session first.</div>';
}

sops.forEach((sop, i) => {
  const confColor = sop.confidence >= 0.8 ? '#3fb950' : sop.confidence >= 0.5 ? '#d29922' : '#f85149';
  const card = document.createElement('div');
  card.className = 'sop-card';
  card.innerHTML = \`
    <div class="sop-header" onclick="toggle(\${i})">
      <h3>\${sop.title}</h3>
      <div class="sop-meta">
        <span class="freq">\${sop.frequency}</span>
        <span class="dur">\${sop.duration}</span>
        <span class="conf"><span class="conf-dot" style="background:\${confColor}"></span>\${Math.round(sop.confidence*100)}%</span>
        <span class="toggle-icon" id="icon-\${i}">▸</span>
      </div>
    </div>
    <div class="sop-body" id="body-\${i}">
      <div class="sop-desc">\${sop.description}</div>
      <div class="sop-systems">\${sop.systems.map(s => '<span>'+s+'</span>').join('')}</div>
      <ol class="steps-list">
        \${sop.steps.map(st => \`
          <li>
            <span class="step-tool">\${st.tool}</span>
            \${st.target ? '<span class="step-target"> → '+st.target+'</span>' : ''}
            <div class="step-instr">\${st.instruction}</div>
            \${st.notes ? '<div class="step-notes">'+st.notes+'</div>' : ''}
          </li>
        \`).join('')}
      </ol>
      <div class="gen-time">Generated: \${sop.generatedAt ? sop.generatedAt.substring(0,19).replace('T',' ') : '—'}</div>
    </div>
  \`;
  listDiv.appendChild(card);
});

function toggle(i) {
  const body = document.getElementById('body-'+i);
  const icon = document.getElementById('icon-'+i);
  body.classList.toggle('open');
  icon.classList.toggle('open');
}
</script>
</body>
</html>`;
}

// ── Cartography Map Export ─────────────────────────────────────────────────────

export function exportCartographyMap(
  nodes: NodeRow[],
  edges: EdgeRow[],
  options?: { theme?: 'light' | 'dark' },
): string {
  const mapData = buildMapData(nodes, edges, options);
  const { assets, clusters, connections, meta } = mapData;
  const isEmpty = assets.length === 0;
  const HEX_SIZE = 24;

  const dataJson = JSON.stringify({
    assets: assets.map(a => ({
      id: a.id, name: a.name, domain: a.domain, subDomain: a.subDomain ?? null,
      qualityScore: a.qualityScore ?? null, metadata: a.metadata,
      q: a.position.q, r: a.position.r,
    })),
    clusters: clusters.map(c => ({
      id: c.id, label: c.label, domain: c.domain, color: c.color,
      assetIds: c.assetIds, centroid: c.centroid,
    })),
    connections: connections.map(c => ({
      id: c.id, sourceAssetId: c.sourceAssetId, targetAssetId: c.targetAssetId,
      type: c.type ?? 'connection',
    })),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Data Cartography Map</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{display:flex;flex-direction:column;background:${meta.theme === 'dark' ? '#0f172a' : '#f8fafc'};color:${meta.theme === 'dark' ? '#e2e8f0' : '#1e293b'}}
#topbar{
  height:48px;display:flex;align-items:center;gap:16px;padding:0 20px;
  background:${meta.theme === 'dark' ? '#1e293b' : '#fff'};border-bottom:1px solid ${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};z-index:10;flex-shrink:0;
}
#topbar h1{font-size:15px;font-weight:600;letter-spacing:-0.01em}
#search-box{
  display:flex;align-items:center;gap:8px;background:${meta.theme === 'dark' ? '#334155' : '#f1f5f9'};
  border-radius:8px;padding:5px 10px;margin-left:auto;
}
#search-box input{
  border:none;background:transparent;font-size:13px;outline:none;width:180px;color:inherit;
}
#search-box input::placeholder{color:#94a3b8}
#main{flex:1;display:flex;overflow:hidden;position:relative}
#canvas-wrap{flex:1;position:relative;overflow:hidden;cursor:grab}
#canvas-wrap.dragging{cursor:grabbing}
#canvas-wrap.connecting{cursor:crosshair}
canvas{display:block;width:100%;height:100%}
/* Detail panel */
#detail-panel{
  width:280px;background:${meta.theme === 'dark' ? '#1e293b' : '#fff'};border-left:1px solid ${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};
  display:flex;flex-direction:column;transform:translateX(100%);
  transition:transform .2s ease;z-index:5;flex-shrink:0;overflow-y:auto;
}
#detail-panel.open{transform:translateX(0)}
#detail-panel .panel-header{
  padding:16px;border-bottom:1px solid ${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};display:flex;align-items:center;gap:10px;
}
#detail-panel .panel-header h3{font-size:14px;font-weight:600;flex:1;word-break:break-word}
#detail-panel .close-btn{
  width:24px;height:24px;border:none;background:transparent;cursor:pointer;
  color:#94a3b8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:16px;
}
#detail-panel .close-btn:hover{background:${meta.theme === 'dark' ? '#334155' : '#f1f5f9'}}
#detail-panel .panel-body{padding:12px 16px;display:flex;flex-direction:column;gap:12px}
#detail-panel .meta-row{display:flex;flex-direction:column;gap:3px}
#detail-panel .meta-label{font-size:11px;font-weight:500;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
#detail-panel .meta-value{font-size:13px;word-break:break-all}
#detail-panel .quality-bar{height:6px;border-radius:3px;background:${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};margin-top:4px}
#detail-panel .quality-fill{height:6px;border-radius:3px;transition:width .3s}
/* Bottom-left toolbar */
#toolbar-left{
  position:absolute;bottom:20px;left:20px;display:flex;gap:8px;z-index:10;
}
.tb-btn{
  width:40px;height:40px;border-radius:10px;border:1px solid ${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};
  background:${meta.theme === 'dark' ? '#1e293b' : '#fff'};box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:18px;
  transition:all .15s;color:inherit;
}
.tb-btn:hover{border-color:#94a3b8}
.tb-btn.active{background:${meta.theme === 'dark' ? '#1e3a5f' : '#eff6ff'};border-color:#3b82f6}
/* Bottom-right toolbar */
#toolbar-right{
  position:absolute;bottom:20px;right:20px;display:flex;flex-direction:column;
  align-items:flex-end;gap:8px;z-index:10;
}
#zoom-controls{display:flex;align-items:center;gap:6px}
.zoom-btn{
  width:34px;height:34px;border-radius:8px;border:1px solid ${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};
  background:${meta.theme === 'dark' ? '#1e293b' : '#fff'};cursor:pointer;
  font-size:18px;color:inherit;display:flex;align-items:center;justify-content:center;
}
.zoom-btn:hover{background:${meta.theme === 'dark' ? '#334155' : '#f1f5f9'}}
#zoom-pct{font-size:12px;font-weight:500;color:#64748b;min-width:38px;text-align:center}
#detail-selector{display:flex;flex-direction:column;gap:4px}
.detail-btn{
  width:34px;height:34px;border-radius:8px;border:1px solid ${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};
  background:${meta.theme === 'dark' ? '#1e293b' : '#fff'};cursor:pointer;
  font-size:12px;font-weight:600;color:#64748b;display:flex;align-items:center;justify-content:center;
}
.detail-btn:hover{background:${meta.theme === 'dark' ? '#334155' : '#f1f5f9'}}
.detail-btn.active{background:${meta.theme === 'dark' ? '#1e3a5f' : '#eff6ff'};border-color:#3b82f6;color:#2563eb}
#connect-btn{
  width:40px;height:40px;border-radius:10px;border:1px solid ${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};
  background:${meta.theme === 'dark' ? '#1e293b' : '#fff'};cursor:pointer;
  font-size:18px;display:flex;align-items:center;justify-content:center;color:inherit;
}
#connect-btn.active{background:#fef3c7;border-color:#f59e0b}
/* Tooltip */
#tooltip{
  position:fixed;background:#1e293b;color:#fff;border-radius:8px;
  padding:8px 12px;font-size:12px;pointer-events:none;z-index:100;
  display:none;max-width:220px;box-shadow:0 4px 12px rgba(0,0,0,.15);
}
#tooltip .tt-name{font-weight:600;margin-bottom:2px}
#tooltip .tt-domain{color:#94a3b8;font-size:11px}
#tooltip .tt-quality{font-size:11px;margin-top:2px}
/* Empty state */
#empty-state{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:12px;color:#94a3b8;
}
#empty-state p{font-size:14px}
/* Theme toggle */
#theme-btn{
  width:40px;height:40px;border-radius:10px;border:1px solid ${meta.theme === 'dark' ? '#334155' : '#e2e8f0'};
  background:${meta.theme === 'dark' ? '#1e293b' : '#fff'};cursor:pointer;
  font-size:18px;display:flex;align-items:center;justify-content:center;color:inherit;
}
/* Dark mode overrides (toggled via JS) */
body.dark{background:#0f172a;color:#e2e8f0}
body.dark #topbar{background:#1e293b;border-color:#334155}
body.dark #search-box{background:#334155}
body.dark #detail-panel{background:#1e293b;border-color:#334155}
body.dark .tb-btn,body.dark .zoom-btn,body.dark .detail-btn,body.dark #connect-btn,body.dark #theme-btn{
  background:#1e293b;border-color:#334155;color:#e2e8f0;
}
/* Light mode overrides */
body.light{background:#f8fafc;color:#1e293b}
body.light #topbar{background:#fff;border-color:#e2e8f0}
/* Connection hint */
#connect-hint{
  position:absolute;top:12px;left:50%;transform:translateX(-50%);
  background:#fef3c7;border:1px solid #f59e0b;color:#92400e;
  padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500;
  display:none;z-index:20;pointer-events:none;
}
/* Screen reader only */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
</style>
</head>
<body class="${meta.theme}">
<!-- Top bar -->
<div id="topbar">
  <h1>Data Cartography Map</h1>
  <div id="search-box">
    <span style="color:#94a3b8;font-size:14px">&#8981;</span>
    <input id="search-input" type="text" placeholder="Search assets..." aria-label="Search data assets"/>
  </div>
  <button id="theme-btn" title="Toggle dark/light mode" aria-label="Toggle theme">${meta.theme === 'dark' ? '&#9788;' : '&#9790;'}</button>
</div>
<!-- SR summary -->
<div class="sr-only" role="status" aria-live="polite" id="sr-summary">
  Data cartography map with ${assets.length} assets in ${clusters.length} clusters.
</div>
<!-- Main area -->
<div id="main">
  <div id="canvas-wrap" role="application" aria-label="Data cartography hex map" tabindex="0">
    <canvas id="hexmap" aria-hidden="true"></canvas>
    ${isEmpty ? '<div id="empty-state"><p style="font-size:48px">&#128506;</p><p>No data assets available</p><p style="font-size:12px">Run <code>datasynx-cartography discover</code> to populate the map</p></div>' : ''}
  </div>
  <div id="detail-panel" role="complementary" aria-label="Asset details">
    <div class="panel-header">
      <h3 id="dp-name">&mdash;</h3>
      <button class="close-btn" id="dp-close" aria-label="Close panel">&#10005;</button>
    </div>
    <div class="panel-body" id="dp-body"></div>
  </div>
</div>
<!-- Bottom-left toolbar -->
<div id="toolbar-left">
  <button class="tb-btn active" id="btn-labels" title="Show labels" aria-pressed="true" aria-label="Toggle labels">&#127991;</button>
  <button class="tb-btn" id="btn-quality" title="Quality layer" aria-pressed="false" aria-label="Toggle quality layer">&#128065;</button>
</div>
<!-- Bottom-right toolbar -->
<div id="toolbar-right">
  <div id="zoom-controls">
    <button class="zoom-btn" id="zoom-out" aria-label="Zoom out">&minus;</button>
    <span id="zoom-pct">100%</span>
    <button class="zoom-btn" id="zoom-in" aria-label="Zoom in">+</button>
  </div>
  <div id="detail-selector">
    <button class="detail-btn" id="dl-1" aria-label="Detail level 1">1</button>
    <button class="detail-btn active" id="dl-2" aria-label="Detail level 2">2</button>
    <button class="detail-btn" id="dl-3" aria-label="Detail level 3">3</button>
    <button class="detail-btn" id="dl-4" aria-label="Detail level 4">4</button>
  </div>
  <button id="connect-btn" title="Connection tool" aria-label="Toggle connection tool">&#128279;</button>
</div>
<!-- Connection hint -->
<div id="connect-hint">Click two assets to create a connection</div>
<!-- Tooltip -->
<div id="tooltip" role="tooltip">
  <div class="tt-name" id="tt-name"></div>
  <div class="tt-domain" id="tt-domain"></div>
  <div class="tt-quality" id="tt-quality"></div>
</div>

<script>
(function() {
'use strict';

// ── Data ─────────────────────────────────────────────────────────────────────
const MAP = ${dataJson};
const HEX_SIZE = ${HEX_SIZE};
const IS_EMPTY = ${isEmpty};

// Build asset index
const assetIndex = new Map();
const clusterByAsset = new Map();
for (const c of MAP.clusters) {
  for (const aid of c.assetIds) {
    clusterByAsset.set(aid, c);
  }
}
for (const a of MAP.assets) {
  assetIndex.set(a.id, a);
}

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('hexmap');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvas-wrap');
let W = 0, H = 0;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = wrap.clientWidth; H = wrap.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}
window.addEventListener('resize', resize);

// ── Viewport ──────────────────────────────────────────────────────────────────
let vx = 0, vy = 0, scale = 1;
let detailLevel = 2, showLabels = true, showQuality = false;
let isDark = document.body.classList.contains('dark');
let connectMode = false, connectFirst = null;
let hoveredAssetId = null, selectedAssetId = null;
let searchQuery = '';
let localConnections = [...MAP.connections];

// Flat-top hex math
function htp_x(q, r) { return HEX_SIZE * (3/2 * q); }
function htp_y(q, r) { return HEX_SIZE * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r); }
function w2s(wx, wy) { return { x: wx*scale+vx, y: wy*scale+vy }; }
function s2w(sx, sy) { return { x: (sx-vx)/scale, y: (sy-vy)/scale }; }

function fitToView() {
  if (IS_EMPTY || MAP.assets.length === 0) { vx = 0; vy = 0; scale = 1; return; }
  let mnx=Infinity,mny=Infinity,mxx=-Infinity,mxy=-Infinity;
  for (const a of MAP.assets) {
    const px=htp_x(a.q,a.r), py=htp_y(a.q,a.r);
    if(px<mnx)mnx=px;if(py<mny)mny=py;if(px>mxx)mxx=px;if(py>mxy)mxy=py;
  }
  const pw=mxx-mnx+HEX_SIZE*4, ph=mxy-mny+HEX_SIZE*4;
  scale = Math.min(W/pw, H/ph, 2) * 0.85;
  vx = W/2 - ((mnx+mxx)/2)*scale;
  vy = H/2 - ((mny+mxy)/2)*scale;
}

// ── Drawing ───────────────────────────────────────────────────────────────────
function hexPath(cx, cy, r) {
  ctx.beginPath();
  for (let i=0;i<6;i++) {
    const angle = Math.PI/180*(60*i);
    const x=cx+r*Math.cos(angle), y=cy+r*Math.sin(angle);
    i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
  }
  ctx.closePath();
}

function shadeV(hex, amt) {
  if(!hex||hex.length<7)return hex;
  const n=parseInt(hex.replace('#',''),16);
  const r=Math.min(255,(n>>16)+amt), g=Math.min(255,((n>>8)&0xff)+amt), b=Math.min(255,(n&0xff)+amt);
  return '#'+r.toString(16).padStart(2,'0')+g.toString(16).padStart(2,'0')+b.toString(16).padStart(2,'0');
}

function draw() {
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
  ctx.fillRect(0,0,W,H);
  if (IS_EMPTY) return;

  const size = HEX_SIZE * scale;
  const matchedIds = getSearchMatches();
  const hasSearch = searchQuery.length > 0;

  // Draw connections
  ctx.save();
  ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.25)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4,4]);
  for (const conn of localConnections) {
    const src = assetIndex.get(conn.sourceAssetId);
    const tgt = assetIndex.get(conn.targetAssetId);
    if (!src||!tgt) continue;
    const sp=w2s(htp_x(src.q,src.r),htp_y(src.q,src.r));
    const tp=w2s(htp_x(tgt.q,tgt.r),htp_y(tgt.q,tgt.r));
    ctx.beginPath();ctx.moveTo(sp.x,sp.y);ctx.lineTo(tp.x,tp.y);ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // Draw hexagons per cluster
  for (const cluster of MAP.clusters) {
    const baseColor = cluster.color;
    const clusterAssets = cluster.assetIds.map(id=>assetIndex.get(id)).filter(Boolean);
    const isClusterMatch = !hasSearch || clusterAssets.some(a => matchedIds.has(a.id));
    const clusterDim = hasSearch && !isClusterMatch;

    for (let ai=0; ai<clusterAssets.length; ai++) {
      const asset = clusterAssets[ai];
      const wx=htp_x(asset.q,asset.r), wy=htp_y(asset.q,asset.r);
      const s=w2s(wx,wy);
      const cx=s.x, cy=s.y;

      // Frustum cull
      if(cx+size<0||cx-size>W||cy+size<0||cy-size>H) continue;

      // Shade variation
      const shade = ai%3===0?18:ai%3===1?8:0;
      let fillColor = shadeV(baseColor, shade);

      // Quality overlay
      if (showQuality && asset.qualityScore !== null && asset.qualityScore !== undefined) {
        const q = asset.qualityScore;
        if (q < 40) fillColor = '#ef4444';
        else if (q < 70) fillColor = '#f97316';
      }

      const alpha = clusterDim ? 0.18 : 1;
      const isHovered = asset.id === hoveredAssetId;
      const isSelected = asset.id === selectedAssetId;
      const isConnectFirst = asset.id === connectFirst;

      ctx.save();
      ctx.globalAlpha = alpha;
      hexPath(cx, cy, size*0.92);

      if (isDark && (isHovered||isSelected||isConnectFirst)) {
        ctx.shadowColor = fillColor;
        ctx.shadowBlur = isSelected ? 16 : 8;
      }

      ctx.fillStyle = fillColor;
      ctx.fill();

      if (isSelected||isConnectFirst) {
        ctx.strokeStyle = isConnectFirst ? '#f59e0b' : '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (isHovered) {
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();

      // Quality dot
      if (showQuality && asset.qualityScore!==null && asset.qualityScore!==undefined && size>8) {
        const q = asset.qualityScore;
        if (q < 70) {
          ctx.beginPath();
          ctx.arc(cx+size*0.4, cy-size*0.4, Math.max(3,size*0.14), 0, Math.PI*2);
          ctx.fillStyle = q<40?'#ef4444':'#f97316';
          ctx.fill();
        }
      }

      // Asset labels (detail 4, or 3 at high zoom)
      const showAssetLabel = showLabels && !clusterDim &&
        ((detailLevel>=4)||(detailLevel===3 && scale>=0.8));
      if (showAssetLabel && size>14) {
        const label = asset.name.length>12 ? asset.name.substring(0,11)+'...' : asset.name;
        ctx.save();
        ctx.font = Math.max(8,Math.min(11,size*0.38))+'px -apple-system,sans-serif';
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.9)';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(label, cx, cy);
        ctx.restore();
      }
    }
  }

  // Cluster labels (pill badges)
  if (showLabels && detailLevel>=1) {
    for (const cluster of MAP.clusters) {
      if (cluster.assetIds.length===0) continue;
      if (hasSearch && !cluster.assetIds.some(id=>matchedIds.has(id))) continue;
      const s=w2s(cluster.centroid.x, cluster.centroid.y);
      drawPill(s.x, s.y-size*1.2, cluster.label, cluster.color, 14);
    }
  }

  // Sub-domain labels (detail 2+)
  if (showLabels && detailLevel>=2) {
    const subGroups = new Map();
    for (const a of MAP.assets) {
      if (!a.subDomain) continue;
      const key = a.domain+'|'+a.subDomain;
      if (!subGroups.has(key)) subGroups.set(key, []);
      subGroups.get(key).push(a);
    }
    for (const [, group] of subGroups) {
      let sx=0,sy=0;
      for (const a of group) { sx+=htp_x(a.q,a.r); sy+=htp_y(a.q,a.r); }
      const cx=sx/group.length, cy=sy/group.length;
      const s = w2s(cx, cy);
      drawPill(s.x, s.y+size*1.5, group[0].subDomain, '#64748b', 11);
    }
  }
}

function drawPill(x, y, text, color, fontSize) {
  if(!text) return;
  ctx.save();
  ctx.font = '600 '+fontSize+'px -apple-system,sans-serif';
  const tw=ctx.measureText(text).width;
  const ph=fontSize+8, pw=tw+20;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x-pw/2, y-ph/2, pw, ph, ph/2);
  else { ctx.rect(x-pw/2, y-ph/2, pw, ph); }
  ctx.fillStyle = isDark ? 'rgba(30,41,59,0.9)' : 'rgba(255,255,255,0.92)';
  ctx.shadowColor='rgba(0,0,0,0.15)'; ctx.shadowBlur=6;
  ctx.fill(); ctx.shadowBlur=0;
  ctx.fillStyle = isDark ? '#e2e8f0' : '#0f172a';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ── Hit testing ───────────────────────────────────────────────────────────────
function getAssetAt(sx, sy) {
  const w=s2w(sx,sy);
  for (const a of MAP.assets) {
    const wx=htp_x(a.q,a.r), wy=htp_y(a.q,a.r);
    const dx=Math.abs(w.x-wx), dy=Math.abs(w.y-wy);
    if (dx>HEX_SIZE||dy>HEX_SIZE) continue;
    if (dx*dx+dy*dy < HEX_SIZE*HEX_SIZE) return a;
  }
  return null;
}

// ── Search ────────────────────────────────────────────────────────────────────
function getSearchMatches() {
  if(!searchQuery) return new Set();
  const q=searchQuery.toLowerCase();
  const m=new Set();
  for(const a of MAP.assets){
    if(a.name.toLowerCase().includes(q)||(a.domain&&a.domain.toLowerCase().includes(q))||
       (a.subDomain&&a.subDomain.toLowerCase().includes(q))) m.add(a.id);
  }
  return m;
}

// ── Pan & Zoom ────────────────────────────────────────────────────────────────
let dragging=false, lastMX=0, lastMY=0;

wrap.addEventListener('mousedown', e=>{
  if(e.button!==0)return;
  dragging=true; lastMX=e.clientX; lastMY=e.clientY;
  wrap.classList.add('dragging');
});
window.addEventListener('mouseup', ()=>{dragging=false;wrap.classList.remove('dragging');});
window.addEventListener('mousemove', e=>{
  if(dragging){
    vx+=e.clientX-lastMX; vy+=e.clientY-lastMY;
    lastMX=e.clientX; lastMY=e.clientY; draw(); return;
  }
  const rect=wrap.getBoundingClientRect();
  const sx=e.clientX-rect.left, sy=e.clientY-rect.top;
  const asset=getAssetAt(sx,sy);
  const newId=asset?asset.id:null;
  if(newId!==hoveredAssetId){hoveredAssetId=newId;draw();}
  const tt=document.getElementById('tooltip');
  if(asset){
    document.getElementById('tt-name').textContent=asset.name;
    document.getElementById('tt-domain').textContent=asset.domain+(asset.subDomain?' > '+asset.subDomain:'');
    document.getElementById('tt-quality').textContent=asset.qualityScore!==null?'Quality: '+asset.qualityScore+'/100':'';
    tt.style.display='block';tt.style.left=(e.clientX+12)+'px';tt.style.top=(e.clientY-8)+'px';
  } else { tt.style.display='none'; }
});

wrap.addEventListener('click', e=>{
  const rect=wrap.getBoundingClientRect();
  const sx=e.clientX-rect.left, sy=e.clientY-rect.top;
  const asset=getAssetAt(sx,sy);
  if(connectMode){
    if(!asset) return;
    if(!connectFirst){connectFirst=asset.id;draw();}
    else if(connectFirst!==asset.id){
      localConnections.push({id:crypto.randomUUID(),sourceAssetId:connectFirst,targetAssetId:asset.id,type:'connection'});
      connectFirst=null;draw();
    }
    return;
  }
  if(asset){selectedAssetId=asset.id;showDetailPanel(asset);}
  else{selectedAssetId=null;document.getElementById('detail-panel').classList.remove('open');}
  draw();
});

// Touch
let lastTouches=[];
wrap.addEventListener('touchstart',e=>{lastTouches=[...e.touches];},{passive:true});
wrap.addEventListener('touchmove',e=>{
  if(e.touches.length===1){
    vx+=e.touches[0].clientX-lastTouches[0].clientX;
    vy+=e.touches[0].clientY-lastTouches[0].clientY;draw();
  } else if(e.touches.length===2){
    const d0=Math.hypot(lastTouches[0].clientX-lastTouches[1].clientX,lastTouches[0].clientY-lastTouches[1].clientY);
    const d1=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    const mx=(e.touches[0].clientX+e.touches[1].clientX)/2;
    const my=(e.touches[0].clientY+e.touches[1].clientY)/2;
    applyZoom(d1/d0,mx,my);
  }
  lastTouches=[...e.touches];
},{passive:true});

wrap.addEventListener('wheel',e=>{
  e.preventDefault();
  const rect=wrap.getBoundingClientRect();
  applyZoom(e.deltaY<0?1.12:1/1.12,e.clientX-rect.left,e.clientY-rect.top);
},{passive:false});

function applyZoom(factor,sx,sy){
  const ns=Math.max(0.05,Math.min(8,scale*factor));
  const wx=(sx-vx)/scale,wy=(sy-vy)/scale;
  scale=ns;vx=sx-wx*scale;vy=sy-wy*scale;
  document.getElementById('zoom-pct').textContent=Math.round(scale*100)+'%';draw();
}
document.getElementById('zoom-in').addEventListener('click',()=>applyZoom(1.25,W/2,H/2));
document.getElementById('zoom-out').addEventListener('click',()=>applyZoom(1/1.25,W/2,H/2));

// Keyboard
wrap.addEventListener('keydown',e=>{
  const step=40;
  if(e.key==='ArrowLeft'){vx+=step;draw();}
  else if(e.key==='ArrowRight'){vx-=step;draw();}
  else if(e.key==='ArrowUp'){vy+=step;draw();}
  else if(e.key==='ArrowDown'){vy-=step;draw();}
  else if(e.key==='+'||e.key==='=')applyZoom(1.2,W/2,H/2);
  else if(e.key==='-')applyZoom(1/1.2,W/2,H/2);
  else if(e.key==='Escape'){
    selectedAssetId=null;document.getElementById('detail-panel').classList.remove('open');
    if(connectMode)toggleConnect();draw();
  }
});

// ── Detail Panel ──────────────────────────────────────────────────────────────
function showDetailPanel(asset) {
  document.getElementById('dp-name').textContent=asset.name;
  const body=document.getElementById('dp-body');
  const rows=[['Domain',asset.domain],['Sub-domain',asset.subDomain],
    ['Quality Score',asset.qualityScore!==null?renderQuality(asset.qualityScore):null],
    ...Object.entries(asset.metadata||{}).slice(0,8).map(([k,v])=>[k,String(v)])
  ].filter(([,v])=>v!==null&&v!==undefined&&v!=='');
  body.innerHTML=rows.map(([l,v])=>'<div class="meta-row"><div class="meta-label">'+esc(String(l))+'</div><div class="meta-value">'+v+'</div></div>').join('');
  const related=localConnections.filter(c=>c.sourceAssetId===asset.id||c.targetAssetId===asset.id);
  if(related.length>0){
    body.innerHTML+='<div class="meta-row"><div class="meta-label">Connections ('+related.length+')</div><div>'+
      related.map(c=>{const oid=c.sourceAssetId===asset.id?c.targetAssetId:c.sourceAssetId;
        const o=assetIndex.get(oid);return '<div class="meta-value" style="margin-top:4px;font-size:12px">'+(o?esc(o.name):oid)+'</div>';}).join('')+'</div></div>';
  }
  document.getElementById('detail-panel').classList.add('open');
}
function renderQuality(s){
  const c=s>=70?'#22c55e':s>=40?'#f97316':'#ef4444';
  return s+'/100 <div class="quality-bar"><div class="quality-fill" style="width:'+s+'%;background:'+c+'"></div></div>';
}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
document.getElementById('dp-close').addEventListener('click',()=>{
  document.getElementById('detail-panel').classList.remove('open');selectedAssetId=null;draw();
});

// ── Toolbar ───────────────────────────────────────────────────────────────────
[1,2,3,4].forEach(n=>{
  document.getElementById('dl-'+n).addEventListener('click',()=>{
    detailLevel=n;document.querySelectorAll('.detail-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('dl-'+n).classList.add('active');draw();
  });
});
document.getElementById('btn-labels').addEventListener('click',()=>{
  showLabels=!showLabels;document.getElementById('btn-labels').classList.toggle('active',showLabels);draw();
});
document.getElementById('btn-quality').addEventListener('click',()=>{
  showQuality=!showQuality;document.getElementById('btn-quality').classList.toggle('active',showQuality);draw();
});
function toggleConnect(){
  connectMode=!connectMode;connectFirst=null;
  document.getElementById('connect-btn').classList.toggle('active',connectMode);
  wrap.classList.toggle('connecting',connectMode);
  document.getElementById('connect-hint').style.display=connectMode?'block':'none';draw();
}
document.getElementById('connect-btn').addEventListener('click',toggleConnect);
document.getElementById('theme-btn').addEventListener('click',()=>{
  isDark=!isDark;
  document.body.classList.toggle('dark',isDark);document.body.classList.toggle('light',!isDark);
  document.getElementById('theme-btn').innerHTML=isDark?'&#9788;':'&#9790;';draw();
});
document.getElementById('search-input').addEventListener('input',e=>{searchQuery=e.target.value.trim();draw();});

// ── Init ──────────────────────────────────────────────────────────────────────
resize(); fitToView();
document.getElementById('zoom-pct').textContent=Math.round(scale*100)+'%';
draw();
})();
</script>
</body>
</html>`;
}

// ── Discovery App (Combined Enterprise Frontend) ──────────────────────────────

export function exportDiscoveryApp(
  nodes: NodeRow[],
  edges: EdgeRow[],
  options?: { theme?: 'light' | 'dark' },
): string {
  const theme = options?.theme ?? 'dark';

  // ── Topology D3 data ──────────────────────────────────────────────────────
  const graphData = JSON.stringify({
    nodes: nodes.map(n => ({
      id: n.id, name: n.name, type: n.type, layer: nodeLayer(n.type),
      confidence: n.confidence, discoveredVia: n.discoveredVia,
      discoveredAt: n.discoveredAt, tags: n.tags, metadata: n.metadata,
    })),
    links: edges.map(e => ({
      source: e.sourceId, target: e.targetId,
      relationship: e.relationship, confidence: e.confidence, evidence: e.evidence,
    })),
  });

  // ── Hex map data ──────────────────────────────────────────────────────────
  const { assets, clusters, connections } = buildMapData(nodes, edges, { theme });
  const isEmpty = assets.length === 0;
  const HEX_SIZE = 24;
  const mapJson = JSON.stringify({
    assets: assets.map(a => ({
      id: a.id, name: a.name, domain: a.domain, subDomain: a.subDomain ?? null,
      qualityScore: a.qualityScore ?? null, metadata: a.metadata,
      q: a.position.q, r: a.position.r,
    })),
    clusters: clusters.map(c => ({
      id: c.id, label: c.label, domain: c.domain, color: c.color,
      assetIds: c.assetIds, centroid: c.centroid,
    })),
    connections: connections.map(c => ({
      id: c.id, sourceAssetId: c.sourceAssetId, targetAssetId: c.targetAssetId,
      type: c.type ?? 'connection',
    })),
  });

  const nodeCount = nodes.length;
  const edgeCount = edges.length;
  const assetCount = assets.length;
  const clusterCount = clusters.length;

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Cartography \u2014 Datasynx Discovery</title>
<script src="https://d3js.org/d3.v7.min.js"><\/script>
<style>
/* ── CSS Custom Properties ──────────────────────────────────────────────── */
:root{
  --bg-base:#0f172a;--bg-surface:#1e293b;--bg-elevated:#273148;
  --border:#334155;--border-dim:#1e293b;
  --text:#e2e8f0;--text-muted:#94a3b8;--text-dim:#475569;
  --accent:#3b82f6;--accent-hover:#2563eb;--accent-dim:rgba(59,130,246,.12);
}
[data-theme="light"]{
  --bg-base:#f8fafc;--bg-surface:#ffffff;--bg-elevated:#f1f5f9;
  --border:#e2e8f0;--border-dim:#f1f5f9;
  --text:#0f172a;--text-muted:#64748b;--text-dim:#94a3b8;
  --accent:#2563eb;--accent-hover:#1d4ed8;--accent-dim:rgba(37,99,235,.08);
}

/* ── Reset ──────────────────────────────────────────────────────────────── */
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',sans-serif}
body{display:flex;flex-direction:column;background:var(--bg-base);color:var(--text)}

/* ── Topbar ─────────────────────────────────────────────────────────────── */
#topbar{
  height:56px;display:flex;align-items:center;gap:16px;padding:0 20px;
  background:var(--bg-surface);border-bottom:1px solid var(--border);z-index:100;flex-shrink:0;
}
.tb-left{display:flex;align-items:center;gap:10px}
.brand-logo{flex-shrink:0}
.brand-name{font-size:15px;font-weight:700;color:var(--accent);letter-spacing:-.02em}
.brand-product{font-size:14px;font-weight:500;color:var(--text-muted);margin-left:2px}
.brand-sep{width:1px;height:24px;background:var(--border);margin:0 6px}
.tb-center{display:flex;align-items:center;gap:2px;margin-left:auto;
  background:var(--bg-elevated);border-radius:8px;padding:3px}
.tab-btn{
  padding:6px 16px;border:none;border-radius:6px;font-size:13px;font-weight:500;
  cursor:pointer;color:var(--text-muted);background:transparent;font-family:inherit;
  transition:all .15s;
}
.tab-btn:hover{color:var(--text)}
.tab-btn.active{background:var(--accent);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.tb-right{display:flex;align-items:center;gap:8px;margin-left:auto}
.tb-search{
  display:flex;align-items:center;gap:6px;background:var(--bg-elevated);
  border:1px solid var(--border);border-radius:8px;padding:5px 10px;
}
.tb-search input{
  border:none;background:transparent;font-size:13px;outline:none;width:160px;
  color:var(--text);font-family:inherit;
}
.tb-search input::placeholder{color:var(--text-dim)}
.tb-search svg{flex-shrink:0;color:var(--text-dim)}
.icon-btn{
  width:36px;height:36px;border-radius:8px;border:1px solid var(--border);
  background:var(--bg-surface);cursor:pointer;display:flex;align-items:center;
  justify-content:center;color:var(--text-muted);text-decoration:none;transition:all .15s;font-size:16px;
}
.icon-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}
.tb-stats{font-size:11px;color:var(--text-dim);white-space:nowrap}

/* ── Views ──────────────────────────────────────────────────────────────── */
.view{flex:1;display:none;overflow:hidden;position:relative}
.view.active{display:flex}

/* ═══════════════════════════════════════════════════════════════════════════
   MAP VIEW
   ═══════════════════════════════════════════════════════════════════════════ */
#map-wrap{flex:1;position:relative;overflow:hidden;cursor:grab}
#map-wrap.dragging{cursor:grabbing}
#map-wrap.connecting{cursor:crosshair}
#map-wrap canvas{display:block;width:100%;height:100%}
#map-detail{
  width:280px;background:var(--bg-surface);border-left:1px solid var(--border);
  display:flex;flex-direction:column;transform:translateX(100%);
  transition:transform .2s ease;z-index:5;flex-shrink:0;overflow-y:auto;
}
#map-detail.open{transform:translateX(0)}
#map-detail .panel-header{
  padding:16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;
}
#map-detail .panel-header h3{font-size:14px;font-weight:600;flex:1;word-break:break-word}
.close-btn{
  width:24px;height:24px;border:none;background:transparent;cursor:pointer;
  color:var(--text-muted);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:16px;
}
.close-btn:hover{background:var(--bg-elevated)}
.panel-body{padding:12px 16px;display:flex;flex-direction:column;gap:12px}
.meta-row{display:flex;flex-direction:column;gap:3px}
.meta-label{font-size:11px;font-weight:500;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em}
.meta-value{font-size:13px;word-break:break-all}
.quality-bar{height:6px;border-radius:3px;background:var(--bg-elevated);margin-top:4px}
.quality-fill{height:6px;border-radius:3px;transition:width .3s}

/* Map toolbars */
#map-tb-left{position:absolute;bottom:20px;left:20px;display:flex;gap:8px;z-index:10}
#map-tb-right{position:absolute;bottom:20px;right:20px;display:flex;flex-direction:column;align-items:flex-end;gap:8px;z-index:10}
.tb-tool{
  width:40px;height:40px;border-radius:10px;border:1px solid var(--border);
  background:var(--bg-surface);box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:18px;
  transition:all .15s;color:var(--text);
}
.tb-tool:hover{border-color:var(--text-muted)}
.tb-tool.active{background:var(--accent-dim);border-color:var(--accent)}
.map-zoom{display:flex;align-items:center;gap:6px}
.zoom-btn{
  width:34px;height:34px;border-radius:8px;border:1px solid var(--border);
  background:var(--bg-surface);cursor:pointer;font-size:18px;color:var(--text);
  display:flex;align-items:center;justify-content:center;
}
.zoom-btn:hover{background:var(--bg-elevated)}
#map-zoom-pct{font-size:12px;font-weight:500;color:var(--text-dim);min-width:38px;text-align:center}
.detail-btns{display:flex;flex-direction:column;gap:4px}
.dl-btn{
  width:34px;height:34px;border-radius:8px;border:1px solid var(--border);
  background:var(--bg-surface);cursor:pointer;font-size:12px;font-weight:600;
  color:var(--text-dim);display:flex;align-items:center;justify-content:center;
}
.dl-btn:hover{background:var(--bg-elevated)}
.dl-btn.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
#map-connect-hint{
  position:absolute;top:12px;left:50%;transform:translateX(-50%);
  background:#fef3c7;border:1px solid #f59e0b;color:#92400e;
  padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500;
  display:none;z-index:20;pointer-events:none;
}
#map-tooltip{
  position:fixed;background:var(--bg-surface);color:var(--text);border-radius:8px;
  padding:8px 12px;font-size:12px;pointer-events:none;z-index:200;
  display:none;max-width:220px;box-shadow:0 4px 12px rgba(0,0,0,.25);border:1px solid var(--border);
}
#map-tooltip .tt-name{font-weight:600;margin-bottom:2px}
#map-tooltip .tt-domain{color:var(--text-muted);font-size:11px}
#map-tooltip .tt-quality{font-size:11px;margin-top:2px}
#map-empty{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:12px;color:var(--text-muted);
}
#map-empty p{font-size:14px}

/* ═══════════════════════════════════════════════════════════════════════════
   TOPOLOGY VIEW
   ═══════════════════════════════════════════════════════════════════════════ */
#topo-panel{
  width:220px;min-width:220px;height:100%;overflow:hidden;
  background:var(--bg-surface);border-right:1px solid var(--border);
  display:flex;flex-direction:column;
}
#topo-panel-header{
  padding:10px 12px 8px;border-bottom:1px solid var(--border);
  font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.6px;
}
#topo-search{
  width:calc(100% - 16px);margin:8px;padding:5px 8px;
  background:var(--bg-elevated);border:1px solid var(--border);border-radius:5px;
  color:var(--text);font-size:11px;font-family:inherit;outline:none;
}
#topo-search:focus{border-color:var(--accent)}
#topo-list{flex:1;overflow-y:auto;padding-bottom:8px}
.topo-item{
  padding:5px 12px;cursor:pointer;font-size:11px;
  display:flex;align-items:center;gap:6px;border-left:2px solid transparent;
}
.topo-item:hover{background:var(--bg-elevated)}
.topo-item.active{background:var(--accent-dim);border-left-color:var(--accent)}
.topo-dot{width:7px;height:7px;border-radius:2px;flex-shrink:0}
.topo-name{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.topo-type{color:var(--text-dim);font-size:9px;flex-shrink:0}

#topo-graph{flex:1;height:100%;position:relative}
#topo-graph svg{width:100%;height:100%}
.hull{opacity:.12;stroke-width:1.5;stroke-opacity:.25}
.hull-label{font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase;fill-opacity:.5;pointer-events:none}
.link{stroke-opacity:.4}
.link-label{font-size:8px;fill:var(--text-dim);pointer-events:none;opacity:0}
.node-hex{stroke-width:1.8;cursor:pointer;transition:opacity .15s}
.node-hex:hover{filter:brightness(1.3);stroke-width:3}
.node-hex.selected{stroke-width:3.5;filter:brightness(1.5)}
.node-label{font-size:10px;fill:var(--text);pointer-events:none;opacity:0}

#topo-sidebar{
  width:300px;min-width:300px;height:100%;overflow-y:auto;
  background:var(--bg-surface);border-left:1px solid var(--border);
  padding:16px;font-size:12px;line-height:1.6;
}
#topo-sidebar h2{margin:0 0 8px;font-size:14px;color:var(--accent)}
#topo-sidebar .meta-table{width:100%;border-collapse:collapse}
#topo-sidebar .meta-table td{padding:3px 6px;border-bottom:1px solid var(--border-dim);vertical-align:top}
#topo-sidebar .meta-table td:first-child{color:var(--text-dim);white-space:nowrap;width:90px}
#topo-sidebar .tag{display:inline-block;background:var(--bg-elevated);border-radius:3px;padding:1px 5px;margin:1px;font-size:10px}
#topo-sidebar .conf-bar{height:5px;border-radius:3px;background:var(--bg-elevated);margin-top:3px}
#topo-sidebar .conf-fill{height:100%;border-radius:3px}
#topo-sidebar .edges-list{margin-top:12px}
#topo-sidebar .edge-item{padding:4px 0;border-bottom:1px solid var(--border-dim);color:var(--text-dim);font-size:11px}
#topo-sidebar .edge-item span{color:var(--text)}
.hint{color:var(--text-dim);font-size:11px;margin-top:8px}

#topo-hud{
  position:absolute;top:10px;left:10px;background:rgba(15,23,42,.88);
  padding:10px 14px;border-radius:8px;font-size:12px;border:1px solid var(--border);pointer-events:none;
}
#topo-hud strong{color:var(--accent)}
#topo-hud .stats{color:var(--text-dim)}
#topo-hud .zoom-level{color:var(--text-dim);font-size:10px;margin-top:2px}

#topo-toolbar{position:absolute;top:10px;right:10px;display:flex;flex-wrap:wrap;gap:4px;pointer-events:auto;align-items:center}
.filter-btn{
  background:rgba(15,23,42,.85);border:1px solid var(--border);border-radius:6px;
  color:var(--text);padding:4px 10px;font-size:11px;cursor:pointer;
  font-family:inherit;display:flex;align-items:center;gap:5px;
}
.filter-btn:hover{border-color:var(--text-dim)}
.filter-btn.off{opacity:.35}
.filter-dot{width:8px;height:8px;border-radius:2px;display:inline-block}
.export-btn{
  background:rgba(15,23,42,.85);border:1px solid var(--border);border-radius:6px;
  color:var(--accent);padding:4px 12px;font-size:11px;cursor:pointer;font-family:inherit;
}
.export-btn:hover{border-color:var(--accent);background:var(--accent-dim)}
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════════════════════════
     TOPBAR
     ═══════════════════════════════════════════════════════════════════════════ -->
<header id="topbar">
  <div class="tb-left">
    <svg class="brand-logo" width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M16 1.5L29.5 8.75V23.25L16 30.5L2.5 23.25V8.75L16 1.5Z" fill="#0F2347" stroke="#2563EB" stroke-width="1.2"/>
      <circle cx="10" cy="16" r="2.8" fill="#60A5FA"/><circle cx="22" cy="10.5" r="2.2" fill="#38BDF8"/>
      <circle cx="22" cy="21.5" r="2.2" fill="#38BDF8"/>
      <line x1="12.5" y1="14.8" x2="19.8" y2="11.2" stroke="#93C5FD" stroke-width="1.2"/>
      <line x1="12.5" y1="17.2" x2="19.8" y2="20.8" stroke="#93C5FD" stroke-width="1.2"/>
      <line x1="22" y1="12.7" x2="22" y2="19.3" stroke="#93C5FD" stroke-width="1" stroke-dasharray="2 1.5"/>
    </svg>
    <span class="brand-name">datasynx</span>
    <span class="brand-sep"></span>
    <span class="brand-product">Cartography</span>
  </div>
  <div class="tb-center">
    <button class="tab-btn active" id="tab-map-btn" data-tab="map">Map</button>
    <button class="tab-btn" id="tab-topo-btn" data-tab="topo">Topology</button>
  </div>
  <div class="tb-right">
    <span class="tb-stats">${nodeCount} nodes &middot; ${edgeCount} edges</span>
    <div class="tb-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
      </svg>
      <input id="global-search" type="text" placeholder="Search..." autocomplete="off" spellcheck="false"/>
    </div>
    <a href="https://www.linkedin.com/company/datasynx-ai/" target="_blank" rel="noopener noreferrer"
       class="icon-btn" title="Datasynx on LinkedIn" aria-label="LinkedIn">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
    </a>
    <button id="theme-btn" class="icon-btn" title="Toggle theme" aria-label="Toggle theme">
      ${theme === 'dark' ? '&#9788;' : '&#9790;'}
    </button>
  </div>
</header>

<!-- ═══════════════════════════════════════════════════════════════════════════
     MAP VIEW
     ═══════════════════════════════════════════════════════════════════════════ -->
<div id="view-map" class="view active">
  <div id="map-wrap" tabindex="0" aria-label="Data cartography hex map">
    <canvas id="hexmap" aria-hidden="true"></canvas>
    ${isEmpty ? '<div id="map-empty"><p style="font-size:48px">&#128506;</p><p>No data assets discovered yet</p><p style="font-size:12px">Run <code>datasynx-cartography discover</code> to populate the map</p></div>' : ''}
  </div>
  <div id="map-detail">
    <div class="panel-header">
      <h3 id="md-name">&mdash;</h3>
      <button class="close-btn" id="md-close" aria-label="Close">&#10005;</button>
    </div>
    <div class="panel-body" id="md-body"></div>
  </div>
  <div id="map-tb-left">
    <button class="tb-tool active" id="btn-labels" title="Toggle labels">&#127991;</button>
    <button class="tb-tool" id="btn-quality" title="Quality layer">&#128065;</button>
    <button class="tb-tool" id="btn-connect" title="Connection tool">&#128279;</button>
  </div>
  <div id="map-tb-right">
    <div class="map-zoom">
      <button class="zoom-btn" id="mz-out">&minus;</button>
      <span id="map-zoom-pct">100%</span>
      <button class="zoom-btn" id="mz-in">+</button>
    </div>
    <div class="detail-btns">
      <button class="dl-btn" data-dl="1">1</button>
      <button class="dl-btn active" data-dl="2">2</button>
      <button class="dl-btn" data-dl="3">3</button>
      <button class="dl-btn" data-dl="4">4</button>
    </div>
  </div>
  <div id="map-connect-hint">Click two assets to create a connection</div>
  <div id="map-tooltip"><div class="tt-name" id="mtt-name"></div><div class="tt-domain" id="mtt-domain"></div><div class="tt-quality" id="mtt-quality"></div></div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════════════
     TOPOLOGY VIEW
     ═══════════════════════════════════════════════════════════════════════════ -->
<div id="view-topo" class="view">
  <div id="topo-panel">
    <div id="topo-panel-header">Nodes (${nodeCount})</div>
    <input id="topo-search" type="text" placeholder="Search nodes\u2026" autocomplete="off" spellcheck="false"/>
    <div id="topo-list"></div>
  </div>
  <div id="topo-graph">
    <div id="topo-hud">
      <strong>Topology</strong>&nbsp;
      <span class="stats">${nodeCount} nodes &middot; ${edgeCount} edges</span><br/>
      <span class="zoom-level">Scroll = zoom &middot; Drag = pan &middot; Click = details</span>
    </div>
    <div id="topo-toolbar"></div>
    <svg></svg>
  </div>
  <div id="topo-sidebar">
    <h2>Infrastructure Map</h2>
    <p class="hint">Click a node to view details.</p>
  </div>
</div>

<script>
// ═══════════════════════════════════════════════════════════════════════════════
// SHARED STATE
// ═══════════════════════════════════════════════════════════════════════════════
let isDark = document.documentElement.getAttribute('data-theme') === 'dark';
let currentTab = 'map';
let topoInited = false;

// ── Theme toggle ─────────────────────────────────────────────────────────────
document.getElementById('theme-btn').addEventListener('click', function() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  this.innerHTML = isDark ? '\\u2606' : '\\u263E';
  if (typeof drawMap === 'function') drawMap();
});

// ── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var tab = this.getAttribute('data-tab');
    if (tab === currentTab) return;
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active');
    document.querySelectorAll('.view').forEach(function(v) { v.classList.remove('active'); });
    document.getElementById('view-' + tab).classList.add('active');
    if (tab === 'topo' && !topoInited) { initTopology(); topoInited = true; }
    if (tab === 'map' && typeof drawMap === 'function') { resizeMap(); }
  });
});

// ── Global search ────────────────────────────────────────────────────────────
document.getElementById('global-search').addEventListener('input', function(e) {
  var q = e.target.value.trim();
  if (typeof setMapSearch === 'function') setMapSearch(q);
  if (typeof setTopoSearch === 'function') setTopoSearch(q);
});

// ═══════════════════════════════════════════════════════════════════════════════
// MAP VIEW
// ═══════════════════════════════════════════════════════════════════════════════
var MAP = ${mapJson};
var MAP_HEX = ${HEX_SIZE};
var MAP_EMPTY = ${isEmpty};

var mapAssetIndex = new Map();
var mapClusterByAsset = new Map();
for (var ci = 0; ci < MAP.clusters.length; ci++) {
  var c = MAP.clusters[ci];
  for (var ai = 0; ai < c.assetIds.length; ai++) mapClusterByAsset.set(c.assetIds[ai], c);
}
for (var ni = 0; ni < MAP.assets.length; ni++) mapAssetIndex.set(MAP.assets[ni].id, MAP.assets[ni]);

var mapCanvas = document.getElementById('hexmap');
var mapCtx = mapCanvas.getContext('2d');
var mapWrap = document.getElementById('map-wrap');
var mW = 0, mH = 0;
var mvx = 0, mvy = 0, mScale = 1;
var mDetailLevel = 2, mShowLabels = true, mShowQuality = false;
var mConnectMode = false, mConnectFirst = null;
var mHoveredId = null, mSelectedId = null;
var mSearchQuery = '';
var mLocalConns = MAP.connections.slice();

function setMapSearch(q) { mSearchQuery = q; drawMap(); }

function resizeMap() {
  var dpr = window.devicePixelRatio || 1;
  mW = mapWrap.clientWidth; mH = mapWrap.clientHeight;
  mapCanvas.width = mW * dpr; mapCanvas.height = mH * dpr;
  mapCanvas.style.width = mW + 'px'; mapCanvas.style.height = mH + 'px';
  mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMap();
}
window.addEventListener('resize', function() { if (currentTab === 'map') resizeMap(); });

function mHtp_x(q, r) { return MAP_HEX * (1.5 * q); }
function mHtp_y(q, r) { return MAP_HEX * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r); }
function mW2s(wx, wy) { return { x: wx * mScale + mvx, y: wy * mScale + mvy }; }
function mS2w(sx, sy) { return { x: (sx - mvx) / mScale, y: (sy - mvy) / mScale }; }

function mapFitToView() {
  if (MAP_EMPTY || MAP.assets.length === 0) { mvx = 0; mvy = 0; mScale = 1; return; }
  var mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (var i = 0; i < MAP.assets.length; i++) {
    var a = MAP.assets[i], px = mHtp_x(a.q, a.r), py = mHtp_y(a.q, a.r);
    if (px < mnx) mnx = px; if (py < mny) mny = py; if (px > mxx) mxx = px; if (py > mxy) mxy = py;
  }
  var pw = mxx - mnx + MAP_HEX * 4, ph = mxy - mny + MAP_HEX * 4;
  mScale = Math.min(mW / pw, mH / ph, 2) * 0.85;
  mvx = mW / 2 - ((mnx + mxx) / 2) * mScale;
  mvy = mH / 2 - ((mny + mxy) / 2) * mScale;
}

function mHexPath(cx, cy, r) {
  mapCtx.beginPath();
  for (var i = 0; i < 6; i++) {
    var angle = Math.PI / 180 * (60 * i);
    var x = cx + r * Math.cos(angle), y = cy + r * Math.sin(angle);
    i === 0 ? mapCtx.moveTo(x, y) : mapCtx.lineTo(x, y);
  }
  mapCtx.closePath();
}

function mShadeV(hex, amt) {
  if (!hex || hex.length < 7) return hex;
  var n = parseInt(hex.replace('#', ''), 16);
  var r = Math.min(255, (n >> 16) + amt), g = Math.min(255, ((n >> 8) & 0xff) + amt), b = Math.min(255, (n & 0xff) + amt);
  return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

function mGetSearchMatches() {
  if (!mSearchQuery) return new Set();
  var q = mSearchQuery.toLowerCase(), m = new Set();
  for (var i = 0; i < MAP.assets.length; i++) {
    var a = MAP.assets[i];
    if (a.name.toLowerCase().includes(q) || (a.domain && a.domain.toLowerCase().includes(q)) ||
        (a.subDomain && a.subDomain.toLowerCase().includes(q))) m.add(a.id);
  }
  return m;
}

function mDrawPill(x, y, text, color, fontSize) {
  if (!text) return;
  mapCtx.save();
  mapCtx.font = '600 ' + fontSize + 'px -apple-system,sans-serif';
  var tw = mapCtx.measureText(text).width;
  var ph = fontSize + 8, pw = tw + 20;
  mapCtx.beginPath();
  if (mapCtx.roundRect) mapCtx.roundRect(x - pw / 2, y - ph / 2, pw, ph, ph / 2);
  else mapCtx.rect(x - pw / 2, y - ph / 2, pw, ph);
  mapCtx.fillStyle = isDark ? 'rgba(30,41,59,0.9)' : 'rgba(255,255,255,0.92)';
  mapCtx.shadowColor = 'rgba(0,0,0,0.15)'; mapCtx.shadowBlur = 6;
  mapCtx.fill(); mapCtx.shadowBlur = 0;
  mapCtx.fillStyle = isDark ? '#e2e8f0' : '#0f172a';
  mapCtx.textAlign = 'center'; mapCtx.textBaseline = 'middle';
  mapCtx.fillText(text, x, y);
  mapCtx.restore();
}

function drawMap() {
  mapCtx.clearRect(0, 0, mW, mH);
  var bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim();
  mapCtx.fillStyle = bg || (isDark ? '#0f172a' : '#f8fafc');
  mapCtx.fillRect(0, 0, mW, mH);
  if (MAP_EMPTY) return;

  var size = MAP_HEX * mScale;
  var matchedIds = mGetSearchMatches();
  var hasSearch = mSearchQuery.length > 0;

  // Connections
  mapCtx.save();
  mapCtx.strokeStyle = isDark ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.25)';
  mapCtx.lineWidth = 1.5; mapCtx.setLineDash([4, 4]);
  for (var ci = 0; ci < mLocalConns.length; ci++) {
    var conn = mLocalConns[ci];
    var src = mapAssetIndex.get(conn.sourceAssetId), tgt = mapAssetIndex.get(conn.targetAssetId);
    if (!src || !tgt) continue;
    var sp = mW2s(mHtp_x(src.q, src.r), mHtp_y(src.q, src.r));
    var tp = mW2s(mHtp_x(tgt.q, tgt.r), mHtp_y(tgt.q, tgt.r));
    mapCtx.beginPath(); mapCtx.moveTo(sp.x, sp.y); mapCtx.lineTo(tp.x, tp.y); mapCtx.stroke();
  }
  mapCtx.setLineDash([]); mapCtx.restore();

  // Hexagons per cluster
  for (var cli = 0; cli < MAP.clusters.length; cli++) {
    var cluster = MAP.clusters[cli];
    var baseColor = cluster.color;
    var clusterAssets = cluster.assetIds.map(function(id) { return mapAssetIndex.get(id); }).filter(Boolean);
    var isClusterMatch = !hasSearch || clusterAssets.some(function(a) { return matchedIds.has(a.id); });
    var clusterDim = hasSearch && !isClusterMatch;

    for (var ai = 0; ai < clusterAssets.length; ai++) {
      var asset = clusterAssets[ai];
      var wx = mHtp_x(asset.q, asset.r), wy = mHtp_y(asset.q, asset.r);
      var s = mW2s(wx, wy), cx = s.x, cy = s.y;
      if (cx + size < 0 || cx - size > mW || cy + size < 0 || cy - size > mH) continue;

      var shade = ai % 3 === 0 ? 18 : ai % 3 === 1 ? 8 : 0;
      var fillColor = mShadeV(baseColor, shade);
      if (mShowQuality && asset.qualityScore !== null && asset.qualityScore !== undefined) {
        if (asset.qualityScore < 40) fillColor = '#ef4444';
        else if (asset.qualityScore < 70) fillColor = '#f97316';
      }

      var alpha = clusterDim ? 0.18 : 1;
      var isHov = asset.id === mHoveredId, isSel = asset.id === mSelectedId, isCF = asset.id === mConnectFirst;

      mapCtx.save(); mapCtx.globalAlpha = alpha;
      mHexPath(cx, cy, size * 0.92);
      if (isDark && (isHov || isSel || isCF)) { mapCtx.shadowColor = fillColor; mapCtx.shadowBlur = isSel ? 16 : 8; }
      mapCtx.fillStyle = fillColor; mapCtx.fill();
      if (isSel || isCF) { mapCtx.strokeStyle = isCF ? '#f59e0b' : '#fff'; mapCtx.lineWidth = 2.5; mapCtx.stroke(); }
      else if (isHov) { mapCtx.strokeStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.2)'; mapCtx.lineWidth = 1.5; mapCtx.stroke(); }
      else { mapCtx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.4)'; mapCtx.lineWidth = 1; mapCtx.stroke(); }
      mapCtx.restore();

      if (mShowQuality && asset.qualityScore !== null && asset.qualityScore !== undefined && size > 8 && asset.qualityScore < 70) {
        mapCtx.beginPath(); mapCtx.arc(cx + size * 0.4, cy - size * 0.4, Math.max(3, size * 0.14), 0, Math.PI * 2);
        mapCtx.fillStyle = asset.qualityScore < 40 ? '#ef4444' : '#f97316'; mapCtx.fill();
      }

      var showAssetLabel = mShowLabels && !clusterDim && ((mDetailLevel >= 4) || (mDetailLevel === 3 && mScale >= 0.8));
      if (showAssetLabel && size > 14) {
        var label = asset.name.length > 12 ? asset.name.substring(0, 11) + '...' : asset.name;
        mapCtx.save();
        mapCtx.font = Math.max(8, Math.min(11, size * 0.38)) + 'px -apple-system,sans-serif';
        mapCtx.fillStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.9)';
        mapCtx.textAlign = 'center'; mapCtx.textBaseline = 'middle';
        mapCtx.fillText(label, cx, cy); mapCtx.restore();
      }
    }
  }

  // Cluster labels
  if (mShowLabels && mDetailLevel >= 1) {
    for (var cli2 = 0; cli2 < MAP.clusters.length; cli2++) {
      var cl = MAP.clusters[cli2];
      if (cl.assetIds.length === 0) continue;
      if (hasSearch && !cl.assetIds.some(function(id) { return matchedIds.has(id); })) continue;
      var sc = mW2s(cl.centroid.x, cl.centroid.y);
      mDrawPill(sc.x, sc.y - size * 1.2, cl.label, cl.color, 14);
    }
  }

  // Sub-domain labels
  if (mShowLabels && mDetailLevel >= 2) {
    var subGroups = new Map();
    for (var si = 0; si < MAP.assets.length; si++) {
      var sa = MAP.assets[si];
      if (!sa.subDomain) continue;
      var key = sa.domain + '|' + sa.subDomain;
      if (!subGroups.has(key)) subGroups.set(key, []);
      subGroups.get(key).push(sa);
    }
    subGroups.forEach(function(group) {
      var sx = 0, sy = 0;
      for (var gi = 0; gi < group.length; gi++) { sx += mHtp_x(group[gi].q, group[gi].r); sy += mHtp_y(group[gi].q, group[gi].r); }
      var cxs = sx / group.length, cys = sy / group.length;
      var spt = mW2s(cxs, cys);
      mDrawPill(spt.x, spt.y + size * 1.5, group[0].subDomain, '#64748b', 11);
    });
  }
}

// ── Map hit test ─────────────────────────────────────────────────────────────
function mGetAssetAt(sx, sy) {
  var w = mS2w(sx, sy);
  for (var i = 0; i < MAP.assets.length; i++) {
    var a = MAP.assets[i], wx = mHtp_x(a.q, a.r), wy = mHtp_y(a.q, a.r);
    var dx = Math.abs(w.x - wx), dy = Math.abs(w.y - wy);
    if (dx > MAP_HEX || dy > MAP_HEX) continue;
    if (dx * dx + dy * dy < MAP_HEX * MAP_HEX) return a;
  }
  return null;
}

// ── Map pan / zoom ───────────────────────────────────────────────────────────
var mDragging = false, mLastMX = 0, mLastMY = 0;
mapWrap.addEventListener('mousedown', function(e) {
  if (e.button !== 0) return;
  mDragging = true; mLastMX = e.clientX; mLastMY = e.clientY;
  mapWrap.classList.add('dragging');
});
window.addEventListener('mouseup', function() { mDragging = false; mapWrap.classList.remove('dragging'); });
window.addEventListener('mousemove', function(e) {
  if (currentTab !== 'map') return;
  if (mDragging) {
    mvx += e.clientX - mLastMX; mvy += e.clientY - mLastMY;
    mLastMX = e.clientX; mLastMY = e.clientY; drawMap(); return;
  }
  var rect = mapWrap.getBoundingClientRect();
  var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  var asset = mGetAssetAt(sx, sy);
  var newId = asset ? asset.id : null;
  if (newId !== mHoveredId) { mHoveredId = newId; drawMap(); }
  var tt = document.getElementById('map-tooltip');
  if (asset) {
    document.getElementById('mtt-name').textContent = asset.name;
    document.getElementById('mtt-domain').textContent = asset.domain + (asset.subDomain ? ' > ' + asset.subDomain : '');
    document.getElementById('mtt-quality').textContent = asset.qualityScore !== null ? 'Quality: ' + asset.qualityScore + '/100' : '';
    tt.style.display = 'block'; tt.style.left = (e.clientX + 12) + 'px'; tt.style.top = (e.clientY - 8) + 'px';
  } else { tt.style.display = 'none'; }
});

mapWrap.addEventListener('click', function(e) {
  var rect = mapWrap.getBoundingClientRect();
  var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  var asset = mGetAssetAt(sx, sy);
  if (mConnectMode) {
    if (!asset) return;
    if (!mConnectFirst) { mConnectFirst = asset.id; drawMap(); }
    else if (mConnectFirst !== asset.id) {
      mLocalConns.push({ id: crypto.randomUUID(), sourceAssetId: mConnectFirst, targetAssetId: asset.id, type: 'connection' });
      mConnectFirst = null; drawMap();
    }
    return;
  }
  if (asset) { mSelectedId = asset.id; mShowDetail(asset); }
  else { mSelectedId = null; document.getElementById('map-detail').classList.remove('open'); }
  drawMap();
});

mapWrap.addEventListener('wheel', function(e) {
  e.preventDefault();
  var rect = mapWrap.getBoundingClientRect();
  mApplyZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });

function mApplyZoom(factor, sx, sy) {
  var ns = Math.max(0.05, Math.min(8, mScale * factor));
  var wx = (sx - mvx) / mScale, wy = (sy - mvy) / mScale;
  mScale = ns; mvx = sx - wx * mScale; mvy = sy - wy * mScale;
  document.getElementById('map-zoom-pct').textContent = Math.round(mScale * 100) + '%';
  drawMap();
}

document.getElementById('mz-in').addEventListener('click', function() { mApplyZoom(1.25, mW / 2, mH / 2); });
document.getElementById('mz-out').addEventListener('click', function() { mApplyZoom(1 / 1.25, mW / 2, mH / 2); });

// ── Map detail panel ─────────────────────────────────────────────────────────
function mEsc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function mRenderQ(s) {
  var c = s >= 70 ? '#22c55e' : s >= 40 ? '#f97316' : '#ef4444';
  return s + '/100 <div class="quality-bar"><div class="quality-fill" style="width:' + s + '%;background:' + c + '"></div></div>';
}
function mShowDetail(asset) {
  document.getElementById('md-name').textContent = asset.name;
  var body = document.getElementById('md-body');
  var rows = [['Domain', asset.domain], ['Sub-domain', asset.subDomain],
    ['Quality', asset.qualityScore !== null ? mRenderQ(asset.qualityScore) : null]
  ].concat(Object.entries(asset.metadata || {}).slice(0, 8).map(function(kv) { return [kv[0], String(kv[1])]; }))
   .filter(function(r) { return r[1] !== null && r[1] !== undefined && r[1] !== ''; });
  body.innerHTML = rows.map(function(r) {
    return '<div class="meta-row"><div class="meta-label">' + mEsc(String(r[0])) + '</div><div class="meta-value">' + r[1] + '</div></div>';
  }).join('');
  var related = mLocalConns.filter(function(cn) { return cn.sourceAssetId === asset.id || cn.targetAssetId === asset.id; });
  if (related.length > 0) {
    body.innerHTML += '<div class="meta-row"><div class="meta-label">Connections (' + related.length + ')</div><div>' +
      related.map(function(cn) {
        var oid = cn.sourceAssetId === asset.id ? cn.targetAssetId : cn.sourceAssetId;
        var o = mapAssetIndex.get(oid);
        return '<div class="meta-value" style="margin-top:4px;font-size:12px">' + (o ? mEsc(o.name) : oid) + '</div>';
      }).join('') + '</div></div>';
  }
  document.getElementById('map-detail').classList.add('open');
}
document.getElementById('md-close').addEventListener('click', function() {
  document.getElementById('map-detail').classList.remove('open'); mSelectedId = null; drawMap();
});

// ── Map toolbar ──────────────────────────────────────────────────────────────
document.querySelectorAll('.dl-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    mDetailLevel = parseInt(this.getAttribute('data-dl'));
    document.querySelectorAll('.dl-btn').forEach(function(b) { b.classList.remove('active'); });
    this.classList.add('active'); drawMap();
  });
});
document.getElementById('btn-labels').addEventListener('click', function() {
  mShowLabels = !mShowLabels; this.classList.toggle('active', mShowLabels); drawMap();
});
document.getElementById('btn-quality').addEventListener('click', function() {
  mShowQuality = !mShowQuality; this.classList.toggle('active', mShowQuality); drawMap();
});
document.getElementById('btn-connect').addEventListener('click', function() {
  mConnectMode = !mConnectMode; mConnectFirst = null;
  this.classList.toggle('active', mConnectMode);
  mapWrap.classList.toggle('connecting', mConnectMode);
  document.getElementById('map-connect-hint').style.display = mConnectMode ? 'block' : 'none'; drawMap();
});

// Map keyboard
mapWrap.addEventListener('keydown', function(e) {
  if (e.key === 'ArrowLeft') { mvx += 40; drawMap(); }
  else if (e.key === 'ArrowRight') { mvx -= 40; drawMap(); }
  else if (e.key === 'ArrowUp') { mvy += 40; drawMap(); }
  else if (e.key === 'ArrowDown') { mvy -= 40; drawMap(); }
  else if (e.key === '+' || e.key === '=') mApplyZoom(1.2, mW / 2, mH / 2);
  else if (e.key === '-') mApplyZoom(1 / 1.2, mW / 2, mH / 2);
  else if (e.key === 'Escape') {
    mSelectedId = null; document.getElementById('map-detail').classList.remove('open');
    if (mConnectMode) { mConnectMode = false; mConnectFirst = null; mapWrap.classList.remove('connecting'); document.getElementById('map-connect-hint').style.display = 'none'; document.getElementById('btn-connect').classList.remove('active'); }
    drawMap();
  }
});

// Map init
resizeMap(); mapFitToView();
document.getElementById('map-zoom-pct').textContent = Math.round(mScale * 100) + '%';
drawMap();

// ═══════════════════════════════════════════════════════════════════════════════
// TOPOLOGY VIEW (lazy init)
// ═══════════════════════════════════════════════════════════════════════════════
var TOPO = ${graphData};

var TYPE_COLORS = {
  host:'#4a9eff',database_server:'#ff6b6b',database:'#ff8c42',
  web_service:'#6bcb77',api_endpoint:'#4d96ff',cache_server:'#ffd93d',
  message_broker:'#c77dff',queue:'#e0aaff',topic:'#9d4edd',
  container:'#48cae4',pod:'#00b4d8',k8s_cluster:'#0077b6',
  config_file:'#adb5bd',saas_tool:'#c084fc',table:'#f97316',unknown:'#6c757d'
};
var LAYER_COLORS = { saas:'#c084fc',web:'#6bcb77',data:'#ff6b6b',messaging:'#c77dff',infra:'#4a9eff',config:'#adb5bd',other:'#6c757d' };
var LAYER_NAMES = { saas:'SaaS Tools',web:'Web / API',data:'Data Layer',messaging:'Messaging',infra:'Infrastructure',config:'Config',other:'Other' };

var topoSelectedId = null;

function setTopoSearch(q) {
  var el = document.getElementById('topo-search');
  if (el) { el.value = q; buildTopoList(q); }
}

function buildTopoList(filter) {
  var listEl = document.getElementById('topo-list');
  var q = (filter || '').toLowerCase();
  listEl.innerHTML = '';
  var sorted = TOPO.nodes.slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
  for (var i = 0; i < sorted.length; i++) {
    var d = sorted[i];
    if (q && !d.name.toLowerCase().includes(q) && !d.type.includes(q) && !d.id.toLowerCase().includes(q)) continue;
    var item = document.createElement('div');
    item.className = 'topo-item' + (d.id === topoSelectedId ? ' active' : '');
    item.dataset.id = d.id;
    var color = TYPE_COLORS[d.type] || '#aaa';
    item.innerHTML = '<span class="topo-dot" style="background:' + color + '"></span>' +
      '<span class="topo-name" title="' + d.id + '">' + d.name + '</span>' +
      '<span class="topo-type">' + d.type.replace(/_/g, ' ') + '</span>';
    (function(dd) { item.onclick = function() { selectTopoNode(dd); focusTopoNode(dd); }; })(d);
    listEl.appendChild(item);
  }
}

document.getElementById('topo-search').addEventListener('input', function(e) { buildTopoList(e.target.value); });

var topoSidebar = document.getElementById('topo-sidebar');

function selectTopoNode(d) {
  topoSelectedId = d.id;
  buildTopoList(document.getElementById('topo-search').value);
  showTopoNode(d);
  if (typeof d3 !== 'undefined') d3.selectAll('.node-hex').classed('selected', function(nd) { return nd.id === d.id; });
}

function showTopoNode(d) {
  var c = TYPE_COLORS[d.type] || '#aaa';
  var confPct = Math.round(d.confidence * 100);
  var tags = (d.tags || []).map(function(t) { return '<span class="tag">' + t + '</span>'; }).join('');
  var metaRows = Object.entries(d.metadata || {})
    .filter(function(kv) { return kv[1] !== null && kv[1] !== undefined && String(kv[1]).length > 0; })
    .map(function(kv) { return '<tr><td>' + kv[0] + '</td><td>' + JSON.stringify(kv[1]) + '</td></tr>'; }).join('');
  var related = TOPO.links.filter(function(l) {
    return (l.source.id || l.source) === d.id || (l.target.id || l.target) === d.id;
  });
  var edgeItems = related.map(function(l) {
    var isOut = (l.source.id || l.source) === d.id;
    var other = isOut ? (l.target.id || l.target) : (l.source.id || l.source);
    return '<div class="edge-item">' + (isOut ? '\\u2192' : '\\u2190') + ' <span>' + other + '</span> <small>[' + l.relationship + ']</small></div>';
  }).join('');

  topoSidebar.innerHTML =
    '<h2>' + d.name + '</h2>' +
    '<table class="meta-table">' +
    '<tr><td>ID</td><td style="font-size:10px;word-break:break-all">' + d.id + '</td></tr>' +
    '<tr><td>Type</td><td><span style="color:' + c + '">' + d.type + '</span></td></tr>' +
    '<tr><td>Layer</td><td>' + d.layer + '</td></tr>' +
    '<tr><td>Confidence</td><td>' + confPct + '% <div class="conf-bar"><div class="conf-fill" style="width:' + confPct + '%;background:' + c + '"></div></div></td></tr>' +
    '<tr><td>Via</td><td>' + (d.discoveredVia || '\\u2014') + '</td></tr>' +
    '<tr><td>Timestamp</td><td>' + (d.discoveredAt ? d.discoveredAt.substring(0, 19).replace('T', ' ') : '\\u2014') + '</td></tr>' +
    (tags ? '<tr><td>Tags</td><td>' + tags + '</td></tr>' : '') +
    metaRows + '</table>' +
    (related.length > 0 ? '<div class="edges-list"><strong>Connections (' + related.length + '):</strong>' + edgeItems + '</div>' : '') +
    '<div style="margin-top:14px"><button class="export-btn" style="width:100%" onclick="deleteTopoNode(\\'' + d.id.replace(/'/g, "\\\\'") + '\\')">Delete node</button></div>';
}

function deleteTopoNode(id) {
  var idx = TOPO.nodes.findIndex(function(n) { return n.id === id; });
  if (idx === -1) return;
  TOPO.nodes.splice(idx, 1);
  TOPO.links = TOPO.links.filter(function(l) {
    return (l.source.id || l.source) !== id && (l.target.id || l.target) !== id;
  });
  topoSelectedId = null;
  topoSidebar.innerHTML = '<h2>Infrastructure Map</h2><p class="hint">Node deleted.</p>';
  if (typeof rebuildTopoGraph === 'function') rebuildTopoGraph();
  buildTopoList(document.getElementById('topo-search').value);
}

function initTopology() {
  if (typeof d3 === 'undefined') return;

  var svgEl = d3.select('#topo-graph svg');
  var graphDiv = document.getElementById('topo-graph');
  var gW = function() { return graphDiv.clientWidth; };
  var gH = function() { return graphDiv.clientHeight; };
  var g = svgEl.append('g');

  svgEl.append('defs').append('marker')
    .attr('id', 'arrow').attr('viewBox', '0 0 10 6')
    .attr('refX', 10).attr('refY', 3)
    .attr('markerWidth', 8).attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path').attr('d', 'M0,0 L10,3 L0,6 Z').attr('fill', '#555');

  var currentZoom = 1;
  var zoomBehavior = d3.zoom().scaleExtent([0.08, 6]).on('zoom', function(e) {
    g.attr('transform', e.transform); currentZoom = e.transform.k; updateTopoLOD(currentZoom);
  });
  svgEl.call(zoomBehavior);

  // Layer filters
  var layers = Array.from(new Set(TOPO.nodes.map(function(d) { return d.layer; })));
  var layerVisible = {};
  layers.forEach(function(l) { layerVisible[l] = true; });

  var toolbarEl = document.getElementById('topo-toolbar');
  layers.forEach(function(layer) {
    var btn = document.createElement('button');
    btn.className = 'filter-btn';
    btn.innerHTML = '<span class="filter-dot" style="background:' + (LAYER_COLORS[layer] || '#666') + '"></span>' + (LAYER_NAMES[layer] || layer);
    btn.onclick = function() { layerVisible[layer] = !layerVisible[layer]; btn.classList.toggle('off', !layerVisible[layer]); updateTopoVisibility(); };
    toolbarEl.appendChild(btn);
  });

  // JGF export button
  var jgfBtn = document.createElement('button');
  jgfBtn.className = 'export-btn'; jgfBtn.textContent = '\\u2193 JGF'; jgfBtn.title = 'Export JSON Graph Format';
  jgfBtn.onclick = function() {
    var jgf = { graph: { directed: true, type: 'cartography', label: 'Infrastructure Map',
      metadata: { exportedAt: new Date().toISOString() },
      nodes: Object.fromEntries(TOPO.nodes.map(function(n) { return [n.id, { label: n.name, metadata: { type: n.type, layer: n.layer, confidence: n.confidence, discoveredVia: n.discoveredVia, discoveredAt: n.discoveredAt, tags: n.tags } }]; })),
      edges: TOPO.links.map(function(l) { return { source: l.source.id || l.source, target: l.target.id || l.target, relation: l.relationship, metadata: { confidence: l.confidence, evidence: l.evidence } }; })
    }};
    var blob = new Blob([JSON.stringify(jgf, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'cartography-graph.jgf.json'; a.click();
    URL.revokeObjectURL(url);
  };
  toolbarEl.appendChild(jgfBtn);

  // Hex helpers
  var T_HEX = { saas_tool: 16, host: 18, database_server: 18, k8s_cluster: 20, default: 14 };
  function tHexSize(d) { return T_HEX[d.type] || T_HEX.default; }
  function tHexPath(size) {
    var pts = [];
    for (var i = 0; i < 6; i++) {
      var angle = (Math.PI / 3) * i - Math.PI / 6;
      pts.push([size * Math.cos(angle), size * Math.sin(angle)]);
    }
    return 'M' + pts.map(function(p) { return p.join(','); }).join('L') + 'Z';
  }

  // Cluster force
  function clusterForce(alpha) {
    var centroids = {}, counts = {};
    TOPO.nodes.forEach(function(d) {
      if (!centroids[d.layer]) { centroids[d.layer] = { x: 0, y: 0 }; counts[d.layer] = 0; }
      centroids[d.layer].x += d.x || 0; centroids[d.layer].y += d.y || 0; counts[d.layer]++;
    });
    for (var l in centroids) { centroids[l].x /= counts[l]; centroids[l].y /= counts[l]; }
    var strength = alpha * 0.15;
    TOPO.nodes.forEach(function(d) {
      var cn = centroids[d.layer];
      if (cn) { d.vx += (cn.x - d.x) * strength; d.vy += (cn.y - d.y) * strength; }
    });
  }

  // Hulls
  var hullGroup = g.append('g').attr('class', 'hulls');
  var hullPaths = {}, hullLabels = {};
  layers.forEach(function(layer) {
    hullPaths[layer] = hullGroup.append('path').attr('class', 'hull')
      .attr('fill', LAYER_COLORS[layer] || '#666').attr('stroke', LAYER_COLORS[layer] || '#666');
    hullLabels[layer] = hullGroup.append('text').attr('class', 'hull-label')
      .attr('fill', LAYER_COLORS[layer] || '#666').text(LAYER_NAMES[layer] || layer);
  });

  function updateHulls() {
    layers.forEach(function(layer) {
      if (!layerVisible[layer]) { hullPaths[layer].attr('d', null); hullLabels[layer].attr('x', -9999); return; }
      var pts = TOPO.nodes.filter(function(d) { return d.layer === layer && layerVisible[d.layer]; }).map(function(d) { return [d.x, d.y]; });
      if (pts.length < 3) {
        hullPaths[layer].attr('d', null);
        if (pts.length > 0) hullLabels[layer].attr('x', pts[0][0]).attr('y', pts[0][1] - 30);
        else hullLabels[layer].attr('x', -9999);
        return;
      }
      var hull = d3.polygonHull(pts);
      if (!hull) { hullPaths[layer].attr('d', null); return; }
      var cx = d3.mean(hull, function(p) { return p[0]; });
      var cy = d3.mean(hull, function(p) { return p[1]; });
      var padded = hull.map(function(p) {
        var dx = p[0] - cx, dy = p[1] - cy;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        return [p[0] + dx / len * 40, p[1] + dy / len * 40];
      });
      hullPaths[layer].attr('d', 'M' + padded.join('L') + 'Z');
      hullLabels[layer].attr('x', cx).attr('y', cy - d3.max(hull, function(p) { return Math.abs(p[1] - cy); }) - 30);
    });
  }

  // Graph
  var linkSel, linkLabelSel, nodeSel, nodeLabelSel, sim;
  var linkGroup = g.append('g');
  var nodeGroup = g.append('g');

  function focusTopoNode(d) {
    if (!d.x || !d.y) return;
    var w = gW(), h = gH();
    svgEl.transition().duration(500).call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(w / 2, h / 2).scale(Math.min(3, currentZoom < 1 ? 1.5 : currentZoom)).translate(-d.x, -d.y)
    );
  }
  window.focusTopoNode = focusTopoNode;

  function rebuildTopoGraph() {
    if (sim) sim.stop();

    linkSel = linkGroup.selectAll('line').data(TOPO.links, function(d) { return (d.source.id || d.source) + '>' + (d.target.id || d.target); });
    linkSel.exit().remove();
    var linkEnter = linkSel.enter().append('line').attr('class', 'link');
    linkSel = linkEnter.merge(linkSel)
      .attr('stroke', function(d) { return d.confidence < 0.6 ? '#2a2e35' : '#3d434b'; })
      .attr('stroke-dasharray', function(d) { return d.confidence < 0.6 ? '4 3' : null; })
      .attr('stroke-width', function(d) { return d.confidence < 0.6 ? 0.8 : 1.2; })
      .attr('marker-end', 'url(#arrow)');
    linkSel.select('title').remove();
    linkSel.append('title').text(function(d) { return d.relationship + ' (' + Math.round(d.confidence * 100) + '%)\\n' + (d.evidence || ''); });

    linkLabelSel = linkGroup.selectAll('text').data(TOPO.links, function(d) { return (d.source.id || d.source) + '>' + (d.target.id || d.target); });
    linkLabelSel.exit().remove();
    linkLabelSel = linkLabelSel.enter().append('text').attr('class', 'link-label').merge(linkLabelSel).text(function(d) { return d.relationship; });

    nodeSel = nodeGroup.selectAll('g').data(TOPO.nodes, function(d) { return d.id; });
    nodeSel.exit().remove();
    var nodeEnter = nodeSel.enter().append('g')
      .call(d3.drag()
        .on('start', function(e, d) { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', function(e, d) { d.fx = e.x; d.fy = e.y; })
        .on('end', function(e, d) { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
      )
      .on('click', function(e, d) { e.stopPropagation(); selectTopoNode(d); });
    nodeEnter.append('path').attr('class', 'node-hex');
    nodeEnter.append('title');
    nodeEnter.append('text').attr('class', 'node-label').attr('text-anchor', 'middle');

    nodeSel = nodeEnter.merge(nodeSel);
    nodeSel.select('.node-hex')
      .attr('d', function(d) { return tHexPath(tHexSize(d)); })
      .attr('fill', function(d) { return TYPE_COLORS[d.type] || '#aaa'; })
      .attr('stroke', function(d) { var c = d3.color(TYPE_COLORS[d.type] || '#aaa'); return c ? c.brighter(0.8).formatHex() : '#ccc'; })
      .attr('fill-opacity', function(d) { return 0.6 + d.confidence * 0.4; })
      .classed('selected', function(d) { return d.id === topoSelectedId; });
    nodeSel.select('title').text(function(d) { return d.name + ' (' + d.type + ')\\nconf: ' + Math.round(d.confidence * 100) + '%'; });
    nodeLabelSel = nodeSel.select('.node-label')
      .attr('dy', function(d) { return tHexSize(d) + 13; })
      .text(function(d) { return d.name.length > 20 ? d.name.substring(0, 18) + '\\u2026' : d.name; });

    sim = d3.forceSimulation(TOPO.nodes)
      .force('link', d3.forceLink(TOPO.links).id(function(d) { return d.id; }).distance(function(d) { return d.relationship === 'contains' ? 50 : 100; }).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-280))
      .force('center', d3.forceCenter(gW() / 2, gH() / 2))
      .force('collision', d3.forceCollide().radius(function(d) { return tHexSize(d) + 10; }))
      .force('cluster', clusterForce)
      .on('tick', function() {
        updateHulls();
        linkSel.attr('x1', function(d) { return d.source.x; }).attr('y1', function(d) { return d.source.y; })
               .attr('x2', function(d) { return d.target.x; }).attr('y2', function(d) { return d.target.y; });
        linkLabelSel.attr('x', function(d) { return (d.source.x + d.target.x) / 2; })
                    .attr('y', function(d) { return (d.source.y + d.target.y) / 2 - 4; });
        nodeSel.attr('transform', function(d) { return 'translate(' + d.x + ',' + d.y + ')'; });
      });
  }
  window.rebuildTopoGraph = rebuildTopoGraph;

  function updateTopoLOD(k) {
    if (nodeLabelSel) nodeLabelSel.style('opacity', k > 0.5 ? Math.min(1, (k - 0.5) * 2) : 0);
    if (linkLabelSel) linkLabelSel.style('opacity', k > 1.2 ? Math.min(1, (k - 1.2) * 3) : 0);
    d3.selectAll('.hull-label').style('font-size', k < 0.4 ? '18px' : '13px');
  }

  function updateTopoVisibility() {
    if (!nodeSel) return;
    nodeSel.style('display', function(d) { return layerVisible[d.layer] ? null : 'none'; });
    linkSel.style('display', function(d) {
      var s = TOPO.nodes.find(function(n) { return n.id === (d.source.id || d.source); });
      var t = TOPO.nodes.find(function(n) { return n.id === (d.target.id || d.target); });
      return (s && layerVisible[s.layer]) && (t && layerVisible[t.layer]) ? null : 'none';
    });
    linkLabelSel.style('display', function(d) {
      var s = TOPO.nodes.find(function(n) { return n.id === (d.source.id || d.source); });
      var t = TOPO.nodes.find(function(n) { return n.id === (d.target.id || d.target); });
      return (s && layerVisible[s.layer]) && (t && layerVisible[t.layer]) ? null : 'none';
    });
  }

  rebuildTopoGraph();
  buildTopoList();
  updateTopoLOD(1);

  svgEl.on('click', function() {
    topoSelectedId = null;
    d3.selectAll('.node-hex').classed('selected', false);
    buildTopoList(document.getElementById('topo-search').value);
    topoSidebar.innerHTML = '<h2>Infrastructure Map</h2><p class="hint">Click a node to view details.</p>';
  });
}

// Init topology node list (non-D3 part)
buildTopoList();
<\/script>
</body>
</html>`;
}

// ── exportAll ─────────────────────────────────────────────────────────────────

export function exportAll(
  db: CartographyDB,
  sessionId: string,
  outputDir: string,
  formats: string[] = ['mermaid', 'json', 'yaml', 'html', 'map', 'discovery', 'sops'],
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

  if (formats.includes('map')) {
    writeFileSync(join(outputDir, 'cartography-map.html'), exportCartographyMap(nodes, edges));
    process.stderr.write('✓ cartography-map.html\n');
  }

  if (formats.includes('discovery')) {
    writeFileSync(join(outputDir, 'discovery.html'), exportDiscoveryApp(nodes, edges));
    process.stderr.write('✓ discovery.html\n');
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
