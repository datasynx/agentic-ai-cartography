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
    body { background: #0a0e14; color: #e6edf3; font-family: 'SF Mono','Fira Code','Cascadia Code',monospace; display: flex; overflow: hidden; }
    #graph { flex: 1; height: 100vh; position: relative; }
    svg { width: 100%; height: 100%; }
    .hull { opacity: 0.12; stroke-width: 1.5; stroke-opacity: 0.25; }
    .hull-label { font-size: 13px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; fill-opacity: 0.5; pointer-events: none; }
    .link { stroke-opacity: 0.4; }
    .link-label { font-size: 8px; fill: #6e7681; pointer-events: none; opacity: 0; }
    .node-hex { stroke-width: 1.8; cursor: pointer; transition: opacity 0.15s; }
    .node-hex:hover { filter: brightness(1.3); stroke-width: 3; }
    .node-label { font-size: 10px; fill: #c9d1d9; pointer-events: none; opacity: 0; }
    /* Sidebar */
    #sidebar {
      width: 320px; min-width: 320px; height: 100vh; overflow-y: auto;
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
    .hint { color: #3d434b; font-size: 11px; margin-top: 8px; }
    /* HUD */
    #hud { position: absolute; top: 10px; left: 10px; background: rgba(10,14,20,0.88);
           padding: 10px 14px; border-radius: 8px; font-size: 12px; border: 1px solid #1b2028; pointer-events: none; }
    #hud strong { color: #58a6ff; }
    #hud .stats { color: #6e7681; }
    #hud .zoom-level { color: #3d434b; font-size: 10px; margin-top: 2px; }
    /* Layer filter */
    #filters { position: absolute; top: 10px; right: 330px; display: flex; flex-wrap: wrap; gap: 4px; pointer-events: auto; }
    .filter-btn {
      background: rgba(10,14,20,0.85); border: 1px solid #1b2028; border-radius: 6px;
      color: #c9d1d9; padding: 4px 10px; font-size: 11px; cursor: pointer;
      font-family: inherit; display: flex; align-items: center; gap: 5px;
    }
    .filter-btn:hover { border-color: #30363d; }
    .filter-btn.off { opacity: 0.35; }
    .filter-dot { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  </style>
</head>
<body>
<div id="graph">
  <div id="hud">
    <strong>Cartography</strong> &nbsp;
    <span class="stats">${nodes.length} nodes · ${edges.length} edges</span><br>
    <span class="zoom-level">Scroll = zoom · Drag = pan · Click = details</span>
  </div>
  <div id="filters"></div>
  <svg></svg>
</div>
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

// ── Color per layer (for hull backgrounds) ────────────────────────────────
const LAYER_COLORS = {
  saas: '#c084fc', web: '#6bcb77', data: '#ff6b6b',
  messaging: '#c77dff', infra: '#4a9eff', config: '#adb5bd', other: '#6c757d',
};
const LAYER_NAMES = {
  saas: 'SaaS Tools', web: 'Web / API', data: 'Data Layer',
  messaging: 'Messaging', infra: 'Infrastructure', config: 'Config', other: 'Other',
};

// ── Hexagon path generator ────────────────────────────────────────────────
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

// ── Sidebar detail view ──────────────────────────────────────────────────
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
  \`;
}

// ── SVG setup ─────────────────────────────────────────────────────────────
const svgEl = d3.select('svg');
const graphDiv = document.getElementById('graph');
const W = () => graphDiv.clientWidth;
const H = () => graphDiv.clientHeight;
const g = svgEl.append('g');

// Arrow marker for directed edges
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

const filtersDiv = document.getElementById('filters');
layers.forEach(layer => {
  const btn = document.createElement('button');
  btn.className = 'filter-btn';
  btn.innerHTML = \`<span class="filter-dot" style="background:\${LAYER_COLORS[layer]||'#666'}"></span>\${LAYER_NAMES[layer]||layer}\`;
  btn.onclick = () => {
    layerVisible[layer] = !layerVisible[layer];
    btn.classList.toggle('off', !layerVisible[layer]);
    updateVisibility();
  };
  filtersDiv.appendChild(btn);
});

// ── Cluster force: attract same-layer nodes toward group centroid ─────────
function clusterForce(alpha) {
  const centroids = {};
  const counts = {};
  data.nodes.forEach(d => {
    if (!centroids[d.layer]) { centroids[d.layer] = { x: 0, y: 0 }; counts[d.layer] = 0; }
    centroids[d.layer].x += d.x || 0;
    centroids[d.layer].y += d.y || 0;
    counts[d.layer]++;
  });
  for (const l in centroids) {
    centroids[l].x /= counts[l];
    centroids[l].y /= counts[l];
  }
  const strength = alpha * 0.15;
  data.nodes.forEach(d => {
    const c = centroids[d.layer];
    if (c) {
      d.vx += (c.x - d.x) * strength;
      d.vy += (c.y - d.y) * strength;
    }
  });
}

// ── Force simulation ──────────────────────────────────────────────────────
const sim = d3.forceSimulation(data.nodes)
  .force('link', d3.forceLink(data.links).id(d => d.id).distance(d => d.relationship === 'contains' ? 50 : 100).strength(0.4))
  .force('charge', d3.forceManyBody().strength(-280))
  .force('center', d3.forceCenter(W() / 2, H() / 2))
  .force('collision', d3.forceCollide().radius(d => hexSize(d) + 10))
  .force('cluster', clusterForce);

// ── Draw: hull backgrounds per layer ──────────────────────────────────────
const hullGroup = g.append('g').attr('class', 'hulls');
const hullPaths = {};
const hullLabels = {};

layers.forEach(layer => {
  hullPaths[layer] = hullGroup.append('path')
    .attr('class', 'hull')
    .attr('fill', LAYER_COLORS[layer] || '#666')
    .attr('stroke', LAYER_COLORS[layer] || '#666');
  hullLabels[layer] = hullGroup.append('text')
    .attr('class', 'hull-label')
    .attr('fill', LAYER_COLORS[layer] || '#666')
    .text(LAYER_NAMES[layer] || layer);
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
    // Pad the hull outward for organic island feel
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

// ── Draw: edges ───────────────────────────────────────────────────────────
const linkGroup = g.append('g');
const link = linkGroup.selectAll('line').data(data.links).join('line')
  .attr('class', 'link')
  .attr('stroke', d => d.confidence < 0.6 ? '#2a2e35' : '#3d434b')
  .attr('stroke-dasharray', d => d.confidence < 0.6 ? '4 3' : null)
  .attr('stroke-width', d => d.confidence < 0.6 ? 0.8 : 1.2)
  .attr('marker-end', 'url(#arrow)');

link.append('title').text(d => \`\${d.relationship} (\${Math.round(d.confidence*100)}%)\n\${d.evidence||''}\`);

// Edge labels
const linkLabel = linkGroup.selectAll('text').data(data.links).join('text')
  .attr('class', 'link-label')
  .text(d => d.relationship);

// ── Draw: nodes (hexagons) ────────────────────────────────────────────────
const nodeGroup = g.append('g');
const node = nodeGroup.selectAll('g').data(data.nodes).join('g')
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; })
  )
  .on('click', (e, d) => { e.stopPropagation(); showNode(d); });

node.append('path')
  .attr('class', 'node-hex')
  .attr('d', d => hexPath(hexSize(d)))
  .attr('fill', d => TYPE_COLORS[d.type] || '#aaa')
  .attr('stroke', d => {
    const c = d3.color(TYPE_COLORS[d.type] || '#aaa');
    return c ? c.brighter(0.8).formatHex() : '#ccc';
  })
  .attr('fill-opacity', d => 0.6 + d.confidence * 0.4);

node.append('title').text(d => \`\${d.name} (\${d.type})\nconf: \${Math.round(d.confidence*100)}%\`);

// Node labels
const nodeLabel = node.append('text')
  .attr('class', 'node-label')
  .attr('dy', d => hexSize(d) + 13)
  .attr('text-anchor', 'middle')
  .text(d => d.name.length > 20 ? d.name.substring(0, 18) + '…' : d.name);

// ── Level-of-detail: show/hide based on zoom ──────────────────────────────
function updateLOD(k) {
  nodeLabel.style('opacity', k > 0.5 ? Math.min(1, (k - 0.5) * 2) : 0);
  linkLabel.style('opacity', k > 1.2 ? Math.min(1, (k - 1.2) * 3) : 0);
  d3.selectAll('.hull-label').style('font-size', k < 0.4 ? '18px' : '13px');
}

// ── Visibility filter ─────────────────────────────────────────────────────
function updateVisibility() {
  node.style('display', d => layerVisible[d.layer] ? null : 'none');
  link.style('display', d => {
    const sNode = data.nodes.find(n => n.id === (d.source.id || d.source));
    const tNode = data.nodes.find(n => n.id === (d.target.id || d.target));
    return (sNode && layerVisible[sNode.layer]) && (tNode && layerVisible[tNode.layer]) ? null : 'none';
  });
  linkLabel.style('display', d => {
    const sNode = data.nodes.find(n => n.id === (d.source.id || d.source));
    const tNode = data.nodes.find(n => n.id === (d.target.id || d.target));
    return (sNode && layerVisible[sNode.layer]) && (tNode && layerVisible[tNode.layer]) ? null : 'none';
  });
}

// ── Tick ──────────────────────────────────────────────────────────────────
sim.on('tick', () => {
  updateHulls();
  link
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  linkLabel
    .attr('x', d => (d.source.x + d.target.x) / 2)
    .attr('y', d => (d.source.y + d.target.y) / 2 - 4);
  node.attr('transform', d => \`translate(\${d.x},\${d.y})\`);
});

// Click empty space to deselect
svgEl.on('click', () => {
  sidebar.innerHTML = '<h2>Infrastructure Map</h2><p class="hint">Click a node to view details.</p>';
});

// Initial LOD
updateLOD(1);
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
  <div class="subtitle">Datasynx Cartography — Standard Operating Procedures</div>
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
  listDiv.innerHTML = '<div class="empty">No SOPs found. Start the shadow daemon and observe workflows.</div>';
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
