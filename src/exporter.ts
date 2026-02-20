import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CartographyDB } from './db.js';
import type { NodeRow, EdgeRow, SOP, ConnectionRow } from './types.js';
import { buildClusterLayout, shadeVariant } from './cluster.js';
import { hexToPixel, hexCorners, pointInHex } from './hex.js';

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

// ── exportAll ─────────────────────────────────────────────────────────────────

export function exportAll(
  db: CartographyDB,
  sessionId: string,
  outputDir: string,
  formats: string[] = ['mermaid', 'json', 'yaml', 'html', 'hexmap', 'sops'],
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

  if (formats.includes('hexmap')) {
    const connections = db.getConnections(sessionId);
    writeFileSync(join(outputDir, 'hexmap.html'), exportHexMap(nodes, connections));
    process.stderr.write('✓ hexmap.html\n');
  }
}

// ── Hex Map Export ────────────────────────────────────────────────────────────

export function exportHexMap(nodes: NodeRow[], connections: ConnectionRow[]): string {
  const layout = buildClusterLayout(nodes);
  const { clusters, subClusters, hexSize, bounds } = layout;

  // Pre-serialise data for the inline script
  const clustersJson = JSON.stringify(clusters.map(c => ({
    id: c.id,
    label: c.label,
    domain: c.domain,
    color: c.color,
    centroid: c.centroid,
    assets: c.assets.map(a => ({
      id: a.id,
      name: a.name,
      domain: a.domain,
      subDomain: a.subDomain ?? null,
      qualityScore: a.qualityScore ?? null,
      metadata: a.metadata,
      q: a.position.q,
      r: a.position.r,
    })),
  })));

  const subClustersJson = JSON.stringify(
    Object.fromEntries(
      Array.from(subClusters.entries()).map(([cid, subs]) => [
        cid,
        subs.map(s => ({ subDomain: s.subDomain, assetIds: s.assetIds, centroid: s.centroid })),
      ])
    )
  );

  const connectionsJson = JSON.stringify(connections.map(c => ({
    id: c.id,
    sourceAssetId: c.sourceAssetId,
    targetAssetId: c.targetAssetId,
    type: c.type ?? 'connection',
  })));

  const hexSizeVal = hexSize;
  const isEmpty = nodes.length === 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Data Cartography Map</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
body{display:flex;flex-direction:column;background:#f8fafc;color:#1e293b}
#topbar{
  height:48px;display:flex;align-items:center;gap:16px;padding:0 20px;
  background:#fff;border-bottom:1px solid #e2e8f0;z-index:10;flex-shrink:0;
}
#topbar h1{font-size:15px;font-weight:600;color:#0f172a;letter-spacing:-0.01em}
#topbar .nav-items{display:flex;gap:4px;margin-left:auto}
#topbar .nav-item{
  padding:5px 12px;border-radius:6px;font-size:13px;cursor:pointer;
  color:#64748b;border:none;background:transparent;
}
#topbar .nav-item:hover{background:#f1f5f9;color:#0f172a}
#topbar .nav-item.active{background:#eff6ff;color:#2563eb;font-weight:500}
#search-box{
  display:flex;align-items:center;gap:8px;background:#f1f5f9;
  border-radius:8px;padding:5px 10px;margin-left:8px;
}
#search-box input{
  border:none;background:transparent;font-size:13px;outline:none;width:160px;color:#0f172a;
}
#search-box input::placeholder{color:#94a3b8}
#search-icon{color:#94a3b8;font-size:14px}
#main{flex:1;display:flex;overflow:hidden;position:relative}
#canvas-wrap{flex:1;position:relative;overflow:hidden;cursor:grab}
#canvas-wrap.dragging{cursor:grabbing}
#canvas-wrap.connecting{cursor:crosshair}
canvas{display:block;width:100%;height:100%}
/* Detail panel */
#detail-panel{
  width:280px;background:#fff;border-left:1px solid #e2e8f0;
  display:flex;flex-direction:column;transform:translateX(100%);
  transition:transform .2s ease;z-index:5;flex-shrink:0;overflow-y:auto;
}
#detail-panel.open{transform:translateX(0)}
#detail-panel .panel-header{
  padding:16px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:10px;
}
#detail-panel .panel-header h3{font-size:14px;font-weight:600;flex:1;word-break:break-word}
#detail-panel .close-btn{
  width:24px;height:24px;border:none;background:transparent;cursor:pointer;
  color:#94a3b8;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:16px;
}
#detail-panel .close-btn:hover{background:#f1f5f9;color:#0f172a}
#detail-panel .panel-body{padding:12px 16px;display:flex;flex-direction:column;gap:12px}
#detail-panel .meta-row{display:flex;flex-direction:column;gap:3px}
#detail-panel .meta-label{font-size:11px;font-weight:500;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}
#detail-panel .meta-value{font-size:13px;color:#1e293b;word-break:break-all}
#detail-panel .quality-bar{height:6px;border-radius:3px;background:#e2e8f0;margin-top:4px}
#detail-panel .quality-fill{height:6px;border-radius:3px;transition:width .3s}
#detail-panel .badge{
  display:inline-flex;align-items:center;gap:4px;padding:2px 8px;
  border-radius:12px;font-size:11px;font-weight:500;
}
/* Bottom-left toolbar */
#toolbar-left{
  position:absolute;bottom:20px;left:20px;display:flex;gap:8px;z-index:10;
}
.tb-btn{
  width:40px;height:40px;border-radius:10px;border:1px solid #e2e8f0;
  background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:18px;
  transition:all .15s;position:relative;
}
.tb-btn:hover{border-color:#94a3b8;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.tb-btn.active{background:#eff6ff;border-color:#3b82f6}
.tb-btn[title]:hover::after{
  content:attr(title);position:absolute;bottom:calc(100% + 6px);left:50%;
  transform:translateX(-50%);background:#1e293b;color:#fff;padding:4px 8px;
  border-radius:5px;font-size:11px;white-space:nowrap;pointer-events:none;
}
/* Bottom-right toolbar */
#toolbar-right{
  position:absolute;bottom:20px;right:20px;display:flex;flex-direction:column;
  align-items:flex-end;gap:8px;z-index:10;
}
#zoom-controls{display:flex;align-items:center;gap:6px}
.zoom-btn{
  width:34px;height:34px;border-radius:8px;border:1px solid #e2e8f0;
  background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;
  font-size:18px;color:#1e293b;display:flex;align-items:center;justify-content:center;
}
.zoom-btn:hover{background:#f1f5f9}
#zoom-pct{
  font-size:12px;font-weight:500;color:#64748b;min-width:38px;text-align:center;
}
#detail-selector{display:flex;flex-direction:column;gap:4px}
.detail-btn{
  width:34px;height:34px;border-radius:8px;border:1px solid #e2e8f0;
  background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;
  font-size:12px;font-weight:600;color:#64748b;display:flex;align-items:center;justify-content:center;
}
.detail-btn:hover{background:#f1f5f9;color:#0f172a}
.detail-btn.active{background:#eff6ff;border-color:#3b82f6;color:#2563eb}
#connect-btn{
  width:40px;height:40px;border-radius:10px;border:1px solid #e2e8f0;
  background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;
  font-size:18px;display:flex;align-items:center;justify-content:center;
}
#connect-btn.active{background:#fef3c7;border-color:#f59e0b}
/* Tooltip */
#tooltip{
  position:fixed;background:#1e293b;color:#fff;border-radius:8px;
  padding:8px 12px;font-size:12px;pointer-events:none;z-index:100;
  display:none;max-width:200px;box-shadow:0 4px 12px rgba(0,0,0,.15);
}
#tooltip .tt-name{font-weight:600;margin-bottom:2px}
#tooltip .tt-domain{color:#94a3b8;font-size:11px}
/* Empty state */
#empty-state{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:12px;color:#94a3b8;
}
#empty-state .es-icon{font-size:48px}
#empty-state p{font-size:14px}
/* Theme toggle */
#theme-btn{
  width:40px;height:40px;border-radius:10px;border:1px solid #e2e8f0;
  background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);cursor:pointer;
  font-size:18px;display:flex;align-items:center;justify-content:center;
}
/* Dark mode overrides */
body.dark{background:#0f172a;color:#e2e8f0}
body.dark #topbar{background:#1e293b;border-color:#334155}
body.dark #topbar h1{color:#f1f5f9}
body.dark #topbar .nav-item{color:#94a3b8}
body.dark #topbar .nav-item:hover{background:#334155;color:#f1f5f9}
body.dark #search-box{background:#334155}
body.dark #search-box input{color:#f1f5f9}
body.dark #detail-panel{background:#1e293b;border-color:#334155}
body.dark #detail-panel .panel-header{border-color:#334155}
body.dark #detail-panel .meta-value{color:#e2e8f0}
body.dark .tb-btn,body.dark .zoom-btn,body.dark .detail-btn,body.dark #connect-btn,body.dark #theme-btn{
  background:#1e293b;border-color:#334155;color:#e2e8f0;
}
body.dark .tb-btn:hover,body.dark .zoom-btn:hover,body.dark .detail-btn:hover{background:#334155}
body.dark #zoom-pct{color:#94a3b8}
/* Connection mode indicator */
#connect-hint{
  position:absolute;top:12px;left:50%;transform:translateX(-50%);
  background:#fef3c7;border:1px solid #f59e0b;color:#92400e;
  padding:6px 14px;border-radius:20px;font-size:12px;font-weight:500;
  display:none;z-index:20;pointer-events:none;
}
</style>
</head>
<body>
<!-- Top bar -->
<div id="topbar">
  <h1>🗺 Data Cartography Map</h1>
  <div class="nav-items">
    <button class="nav-item active">Data Product Map</button>
    <button class="nav-item">Raw Data Map</button>
    <button class="nav-item">Analysis</button>
  </div>
  <div id="search-box">
    <span id="search-icon">⌕</span>
    <input id="search-input" type="text" placeholder="Search assets…" aria-label="Search data assets"/>
  </div>
  <button id="theme-btn" title="Toggle dark/light mode" aria-label="Toggle theme">🌙</button>
</div>

<!-- Main area -->
<div id="main">
  <div id="canvas-wrap" role="application" aria-label="Data cartography hex map" tabindex="0">
    <canvas id="hexmap" aria-hidden="true"></canvas>
    ${isEmpty ? '<div id="empty-state"><div class="es-icon">🗺</div><p>No data assets available</p><p style="font-size:12px">Run <code>datasynx-cartography discover</code> to populate the map</p></div>' : ''}
  </div>
  <div id="detail-panel" role="complementary" aria-label="Asset details">
    <div class="panel-header">
      <h3 id="dp-name">—</h3>
      <button class="close-btn" id="dp-close" aria-label="Close panel">✕</button>
    </div>
    <div class="panel-body" id="dp-body"></div>
  </div>
</div>

<!-- Bottom-left toolbar -->
<div id="toolbar-left">
  <button class="tb-btn active" id="btn-org" title="Organization view" aria-pressed="true" aria-label="Organization view">🏢</button>
  <button class="tb-btn active" id="btn-labels" title="Show labels" aria-pressed="true" aria-label="Toggle labels">🏷</button>
  <button class="tb-btn" id="btn-quality" title="Quality layer" aria-pressed="false" aria-label="Toggle quality layer">👁</button>
</div>

<!-- Bottom-right toolbar -->
<div id="toolbar-right">
  <div id="zoom-controls">
    <button class="zoom-btn" id="zoom-out" aria-label="Zoom out">−</button>
    <span id="zoom-pct">100%</span>
    <button class="zoom-btn" id="zoom-in" aria-label="Zoom in">+</button>
  </div>
  <div id="detail-selector">
    <button class="detail-btn" id="dl-1" aria-label="Detail level 1">1</button>
    <button class="detail-btn active" id="dl-2" aria-label="Detail level 2">2</button>
    <button class="detail-btn" id="dl-3" aria-label="Detail level 3">3</button>
    <button class="detail-btn" id="dl-4" aria-label="Detail level 4">4</button>
  </div>
  <button id="connect-btn" title="Connection tool" aria-label="Toggle connection tool">🔗</button>
</div>

<!-- Connection mode hint -->
<div id="connect-hint">Click two assets to create a connection</div>

<!-- Hover tooltip -->
<div id="tooltip" role="tooltip">
  <div class="tt-name" id="tt-name"></div>
  <div class="tt-domain" id="tt-domain"></div>
</div>

<script>
(function() {
'use strict';

// ── Data ─────────────────────────────────────────────────────────────────────
const CLUSTERS = ${clustersJson};
const SUB_CLUSTERS = ${subClustersJson};
const CONNECTIONS = ${connectionsJson};
const HEX_SIZE = ${hexSizeVal};
const IS_EMPTY = ${isEmpty};

// Build flat asset index
const assetIndex = new Map();
for (const c of CLUSTERS) {
  for (const a of c.assets) {
    assetIndex.set(a.id, { ...a, clusterColor: c.color, clusterId: c.id });
  }
}

// ── Canvas Setup ──────────────────────────────────────────────────────────────
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

// ── Viewport state ────────────────────────────────────────────────────────────
let vx = 0, vy = 0, scale = 1;
let detailLevel = 2;
let showLabels = true;
let showQuality = false;
let showOrg = true;
let isDark = false;
let connectMode = false;
let connectFirst = null;
let hoveredAssetId = null;
let selectedAssetId = null;
let searchQuery = '';
let localConnections = [...CONNECTIONS];

function fitToView() {
  if (IS_EMPTY || CLUSTERS.length === 0) { vx = 0; vy = 0; scale = 1; return; }
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const c of CLUSTERS) for (const a of c.assets) {
    const px = hexToPixelX(a.q, a.r);
    const py = hexToPixelY(a.q, a.r);
    if(px<minX)minX=px; if(py<minY)minY=py;
    if(px>maxX)maxX=px; if(py>maxY)maxY=py;
  }
  const pw = maxX-minX+HEX_SIZE*4, ph = maxY-minY+HEX_SIZE*4;
  scale = Math.min(W/pw, H/ph, 1) * 0.85;
  vx = W/2 - ((minX+maxX)/2)*scale;
  vy = H/2 - ((minY+maxY)/2)*scale;
}

// ── Hex math (inline for self-contained HTML) ─────────────────────────────────
function hexToPixelX(q, r) { return HEX_SIZE * (Math.sqrt(3)*q + Math.sqrt(3)/2*r); }
function hexToPixelY(q, r) { return HEX_SIZE * (3/2*r); }

function worldToScreen(wx, wy) {
  return { x: wx*scale+vx, y: wy*scale+vy };
}
function screenToWorld(sx, sy) {
  return { x: (sx-vx)/scale, y: (sy-vy)/scale };
}

// ── Drawing ───────────────────────────────────────────────────────────────────
function hexPath(cx, cy, r) {
  ctx.beginPath();
  for (let i=0;i<6;i++) {
    const angle = Math.PI/180*(60*i-30);
    const x = cx+r*Math.cos(angle), y = cy+r*Math.sin(angle);
    i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.closePath();
}

function draw() {
  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = isDark ? '#0f172a' : '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  if (IS_EMPTY) return;

  const size = HEX_SIZE * scale;
  const matchedIds = getSearchMatches();
  const hasSearch = searchQuery.length > 0;

  // ── Draw connections (edges) ──────────────────────────────────────────────
  ctx.save();
  ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.4)' : 'rgba(100,116,139,0.3)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4,4]);
  for (const conn of localConnections) {
    const src = assetIndex.get(conn.sourceAssetId);
    const tgt = assetIndex.get(conn.targetAssetId);
    if (!src || !tgt) continue;
    const sp = worldToScreen(hexToPixelX(src.q, src.r), hexToPixelY(src.q, src.r));
    const tp = worldToScreen(hexToPixelX(tgt.q, tgt.r), hexToPixelY(tgt.q, tgt.r));
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // ── Draw hexagons per cluster ─────────────────────────────────────────────
  for (const cluster of CLUSTERS) {
    const baseColor = cluster.color;
    const isClusterMatch = !hasSearch || cluster.assets.some(a =>
      matchedIds.has(a.id)
    );
    const clusterDim = hasSearch && !isClusterMatch;

    for (let ai=0; ai<cluster.assets.length; ai++) {
      const asset = cluster.assets[ai];
      const wx = hexToPixelX(asset.q, asset.r);
      const wy = hexToPixelY(asset.q, asset.r);
      const s = worldToScreen(wx, wy);
      const cx = s.x, cy = s.y;

      // Frustum cull
      if (cx+size<0 || cx-size>W || cy+size<0 || cy-size>H) continue;

      // Shade variation: every 3rd hex slightly lighter
      const shade = ai%3===0 ? 18 : ai%3===1 ? 8 : 0;
      let fillColor = shadeVariant(baseColor, shade);

      // Quality layer override
      if (showQuality && asset.qualityScore !== null) {
        const q = asset.qualityScore;
        if (q < 40) fillColor = '#ef4444';
        else if (q < 70) fillColor = '#f97316';
      }

      // Dim non-matching in search
      const alpha = clusterDim ? 0.18 : 1;

      // Hover / selected highlight
      const isHovered = asset.id === hoveredAssetId;
      const isSelected = asset.id === selectedAssetId;
      const isConnectFirst = asset.id === connectFirst;

      ctx.save();
      ctx.globalAlpha = alpha;

      hexPath(cx, cy, size*0.92);

      if (isDark) {
        // Glow effect in dark mode
        if (isHovered || isSelected || isConnectFirst) {
          ctx.shadowColor = fillColor;
          ctx.shadowBlur = isSelected ? 16 : 8;
        }
      }

      ctx.fillStyle = fillColor;
      ctx.fill();

      if (isSelected || isConnectFirst) {
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

      // Quality dot indicator
      if (showQuality && asset.qualityScore !== null && size > 8) {
        const q = asset.qualityScore;
        if (q < 70) {
          ctx.beginPath();
          ctx.arc(cx+size*0.4, cy-size*0.4, Math.max(3, size*0.14), 0, Math.PI*2);
          ctx.fillStyle = q<40 ? '#ef4444' : '#f97316';
          ctx.fill();
        }
      }

      // Asset-level labels (detail 4, or 3 at high zoom)
      const showAssetLabel = showLabels && !clusterDim && (
        (detailLevel >= 4) ||
        (detailLevel === 3 && scale >= 0.8)
      );
      if (showAssetLabel && size > 14) {
        const label = asset.name.length > 12 ? asset.name.substring(0,11)+'…' : asset.name;
        ctx.save();
        ctx.font = \`\${Math.max(8, Math.min(11, size*0.38))}px -apple-system,sans-serif\`;
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, cx, cy);
        ctx.restore();
      }
    }
  }

  // ── Cluster labels (pill badges) ──────────────────────────────────────────
  if (showLabels && detailLevel >= 1) {
    for (const cluster of CLUSTERS) {
      if (cluster.assets.length === 0) continue;
      const hasSearch_ = searchQuery.length > 0;
      const isMatch = !hasSearch_ || cluster.assets.some(a => getSearchMatches().has(a.id));
      if (hasSearch_ && !isMatch) continue;

      const s = worldToScreen(cluster.centroid.x, cluster.centroid.y);
      drawPillLabel(s.x, s.y, cluster.label, cluster.color, 14, isDark);
    }
  }

  // ── Sub-cluster labels (detail 2+) ───────────────────────────────────────
  if (showLabels && detailLevel >= 2) {
    for (const [clusterId, subs] of Object.entries(SUB_CLUSTERS)) {
      for (const sub of subs) {
        const s = worldToScreen(sub.centroid.x, sub.centroid.y);
        // Offset slightly below cluster centroid
        drawPillLabel(s.x, s.y + size*1.8, sub.subDomain, '#64748b', 11, isDark);
      }
    }
  }
}

function shadeVariant(hex, amount) {
  if (!hex || hex.length < 7) return hex;
  const num = parseInt(hex.replace('#',''), 16);
  const r = Math.min(255, (num>>16) + amount);
  const g = Math.min(255, ((num>>8)&0xff) + amount);
  const b = Math.min(255, (num&0xff) + amount);
  return '#' + r.toString(16).padStart(2,'0') + g.toString(16).padStart(2,'0') + b.toString(16).padStart(2,'0');
}

function drawPillLabel(x, y, text, color, fontSize, dark) {
  if (!text) return;
  ctx.save();
  ctx.font = \`600 \${fontSize}px -apple-system,sans-serif\`;
  const tw = ctx.measureText(text).width;
  const ph = fontSize+8, pw = tw+20;
  // Pill background
  ctx.beginPath();
  ctx.roundRect(x-pw/2, y-ph/2, pw, ph, ph/2);
  ctx.fillStyle = dark ? 'rgba(30,41,59,0.9)' : 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
  // Text
  ctx.fillStyle = dark ? '#e2e8f0' : '#0f172a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ── Hit testing ───────────────────────────────────────────────────────────────
function getAssetAtScreen(sx, sy) {
  const w = screenToWorld(sx, sy);
  const size = HEX_SIZE;
  for (const cluster of CLUSTERS) {
    for (const asset of cluster.assets) {
      const wx = hexToPixelX(asset.q, asset.r);
      const wy = hexToPixelY(asset.q, asset.r);
      const dx = Math.abs(w.x-wx), dy = Math.abs(w.y-wy);
      const hw = Math.sqrt(3)/2*size;
      if (dx > hw || dy > size) continue;
      if (hw*size - size*dx - (hw/2)*dy >= 0) return asset;
    }
  }
  return null;
}

// ── Search ────────────────────────────────────────────────────────────────────
function getSearchMatches() {
  if (!searchQuery) return new Set();
  const q = searchQuery.toLowerCase();
  const matches = new Set();
  for (const c of CLUSTERS) {
    for (const a of c.assets) {
      if (a.name.toLowerCase().includes(q) ||
          (a.domain && a.domain.toLowerCase().includes(q)) ||
          (a.subDomain && a.subDomain.toLowerCase().includes(q))) {
        matches.add(a.id);
      }
    }
  }
  return matches;
}

// ── Pan & Zoom ────────────────────────────────────────────────────────────────
let dragging = false, lastMX = 0, lastMY = 0;

wrap.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  dragging = true; lastMX = e.clientX; lastMY = e.clientY;
  wrap.classList.add('dragging');
});
window.addEventListener('mouseup', () => { dragging = false; wrap.classList.remove('dragging'); });
window.addEventListener('mousemove', e => {
  if (dragging) {
    vx += e.clientX - lastMX; vy += e.clientY - lastMY;
    lastMX = e.clientX; lastMY = e.clientY;
    draw();
    return;
  }
  const rect = wrap.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const asset = getAssetAtScreen(sx, sy);
  const newId = asset ? asset.id : null;
  if (newId !== hoveredAssetId) { hoveredAssetId = newId; draw(); }
  if (asset) {
    const tooltip = document.getElementById('tooltip');
    document.getElementById('tt-name').textContent = asset.name;
    document.getElementById('tt-domain').textContent = asset.domain + (asset.subDomain ? ' › '+asset.subDomain : '');
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX+12)+'px';
    tooltip.style.top = (e.clientY-8)+'px';
  } else {
    document.getElementById('tooltip').style.display = 'none';
  }
});

wrap.addEventListener('click', e => {
  const rect = wrap.getBoundingClientRect();
  const sx = e.clientX-rect.left, sy = e.clientY-rect.top;
  const asset = getAssetAtScreen(sx, sy);
  if (connectMode) {
    if (!asset) return;
    if (!connectFirst) {
      connectFirst = asset.id; draw();
    } else if (connectFirst !== asset.id) {
      // Create connection
      const conn = {id: crypto.randomUUID(), sourceAssetId: connectFirst, targetAssetId: asset.id, type:'connection'};
      localConnections.push(conn);
      connectFirst = null;
      draw();
    }
    return;
  }
  if (asset) {
    selectedAssetId = asset.id;
    showDetailPanel(asset);
  } else {
    selectedAssetId = null;
    document.getElementById('detail-panel').classList.remove('open');
  }
  draw();
});

// Touch pan
let lastTouches = [];
wrap.addEventListener('touchstart', e => { lastTouches = [...e.touches]; }, { passive:true });
wrap.addEventListener('touchmove', e => {
  if (e.touches.length === 1) {
    const dx = e.touches[0].clientX - lastTouches[0].clientX;
    const dy = e.touches[0].clientY - lastTouches[0].clientY;
    vx += dx; vy += dy; draw();
  } else if (e.touches.length === 2) {
    // Pinch zoom
    const d0 = Math.hypot(lastTouches[0].clientX-lastTouches[1].clientX, lastTouches[0].clientY-lastTouches[1].clientY);
    const d1 = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
    const mx = (e.touches[0].clientX+e.touches[1].clientX)/2;
    const my = (e.touches[0].clientY+e.touches[1].clientY)/2;
    applyZoom(d1/d0, mx, my);
  }
  lastTouches = [...e.touches];
}, { passive:true });

wrap.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = wrap.getBoundingClientRect();
  const factor = e.deltaY < 0 ? 1.12 : 1/1.12;
  applyZoom(factor, e.clientX-rect.left, e.clientY-rect.top);
}, { passive:false });

function applyZoom(factor, sx, sy) {
  const newScale = Math.max(0.05, Math.min(8, scale*factor));
  const wx = (sx-vx)/scale, wy = (sy-vy)/scale;
  scale = newScale;
  vx = sx - wx*scale; vy = sy - wy*scale;
  document.getElementById('zoom-pct').textContent = Math.round(scale*100)+'%';
  draw();
}

document.getElementById('zoom-in').addEventListener('click', () => applyZoom(1.25, W/2, H/2));
document.getElementById('zoom-out').addEventListener('click', () => applyZoom(1/1.25, W/2, H/2));

// Keyboard navigation
wrap.addEventListener('keydown', e => {
  const step = 40;
  if (e.key === 'ArrowLeft') { vx += step; draw(); }
  else if (e.key === 'ArrowRight') { vx -= step; draw(); }
  else if (e.key === 'ArrowUp') { vy += step; draw(); }
  else if (e.key === 'ArrowDown') { vy -= step; draw(); }
  else if (e.key === '+' || e.key === '=') applyZoom(1.2, W/2, H/2);
  else if (e.key === '-') applyZoom(1/1.2, W/2, H/2);
  else if (e.key === 'Escape') {
    selectedAssetId = null;
    document.getElementById('detail-panel').classList.remove('open');
    if (connectMode) toggleConnectMode();
    draw();
  }
});

// ── Detail Panel ──────────────────────────────────────────────────────────────
function showDetailPanel(asset) {
  document.getElementById('dp-name').textContent = asset.name;
  const body = document.getElementById('dp-body');
  const rows = [
    ['Domain', asset.domain],
    ['Sub-domain', asset.subDomain],
    ['Quality Score', asset.qualityScore !== null ? renderQuality(asset.qualityScore) : null],
    ...Object.entries(asset.metadata || {}).slice(0,8).map(([k,v]) => [k, String(v)]),
  ].filter(([,v]) => v !== null && v !== undefined && v !== '');

  body.innerHTML = rows.map(([label, value]) => \`
    <div class="meta-row">
      <div class="meta-label">\${escHtml(String(label))}</div>
      <div class="meta-value">\${value}</div>
    </div>\`).join('');

  // Connections
  const related = localConnections.filter(c => c.sourceAssetId===asset.id || c.targetAssetId===asset.id);
  if (related.length > 0) {
    body.innerHTML += \`<div class="meta-row"><div class="meta-label">Connections (\${related.length})</div><div>\${
      related.map(c => {
        const otherId = c.sourceAssetId===asset.id ? c.targetAssetId : c.sourceAssetId;
        const other = assetIndex.get(otherId);
        return \`<div class="meta-value" style="margin-top:4px;font-size:12px">\${other ? escHtml(other.name) : otherId}</div>\`;
      }).join('')
    }</div></div>\`;
  }

  document.getElementById('detail-panel').classList.add('open');
}

function renderQuality(score) {
  const color = score>=70 ? '#22c55e' : score>=40 ? '#f97316' : '#ef4444';
  return \`\${score}/100 <div class="quality-bar"><div class="quality-fill" style="width:\${score}%;background:\${color}"></div></div>\`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('dp-close').addEventListener('click', () => {
  document.getElementById('detail-panel').classList.remove('open');
  selectedAssetId = null; draw();
});

// ── Toolbar ───────────────────────────────────────────────────────────────────
[1,2,3,4].forEach(n => {
  document.getElementById('dl-'+n).addEventListener('click', () => {
    detailLevel = n;
    document.querySelectorAll('.detail-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('dl-'+n).classList.add('active');
    draw();
  });
});

document.getElementById('btn-org').addEventListener('click', () => {
  showOrg = !showOrg;
  document.getElementById('btn-org').classList.toggle('active', showOrg);
  draw();
});
document.getElementById('btn-labels').addEventListener('click', () => {
  showLabels = !showLabels;
  document.getElementById('btn-labels').classList.toggle('active', showLabels);
  draw();
});
document.getElementById('btn-quality').addEventListener('click', () => {
  showQuality = !showQuality;
  document.getElementById('btn-quality').classList.toggle('active', showQuality);
  draw();
});

function toggleConnectMode() {
  connectMode = !connectMode;
  connectFirst = null;
  document.getElementById('connect-btn').classList.toggle('active', connectMode);
  wrap.classList.toggle('connecting', connectMode);
  document.getElementById('connect-hint').style.display = connectMode ? 'block' : 'none';
  draw();
}
document.getElementById('connect-btn').addEventListener('click', toggleConnectMode);

document.getElementById('theme-btn').addEventListener('click', () => {
  isDark = !isDark;
  document.body.classList.toggle('dark', isDark);
  document.getElementById('theme-btn').textContent = isDark ? '☀️' : '🌙';
  draw();
});

// ── Search ────────────────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  draw();
});

// ── Init ──────────────────────────────────────────────────────────────────────
resize();
fitToView();
document.getElementById('zoom-pct').textContent = Math.round(scale*100)+'%';
draw();

})();
</script>
</body>
</html>`;
}
