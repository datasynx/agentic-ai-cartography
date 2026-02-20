# Data Cartography Map — Implementation Roadmap

## Architecture Decision

Extend the existing self-contained HTML export pattern (`topology.html` → `hexmap.html`).
Canvas-based rendering for performance (1000+ hexagons). No React/Vite — vanilla TS compiled
into the HTML string by the exporter, same pattern as the existing D3 topology export.

New source files:
- `src/hex.ts` — Hex grid math (axial coords, geometry, layout)
- `src/cluster.ts` — Domain-based clustering + color assignment
- `src/exporter.ts` — New `exportHexMap()` function (extends existing)

Modified files:
- `src/types.ts` — Extended data model
- `src/db.ts` — Schema migration + new methods
- `src/tools.ts` — Updated save_node tool schema
- `src/cli.ts` — New `map` command + updated export

---

## Phase 1: Data Model Extension
**Files:** `src/types.ts`, `src/db.ts`, `test/types.test.ts`, `test/db.test.ts`

- [ ] 1.1  Add `domain`, `subDomain`, `qualityScore` to NodeSchema
- [ ] 1.2  Add `connections` table (user-created, separate from discovery edges)
- [ ] 1.3  Schema migration (ALTER TABLE nodes ADD COLUMN)
- [ ] 1.4  DB methods: `upsertConnection()`, `getConnections()`, `deleteConnection()`
- [ ] 1.5  Update `save_node` tool to accept domain/subDomain/qualityScore
- [ ] 1.6  Tests for new schema fields + connection CRUD

## Phase 2: Hex Grid Engine
**Files:** `src/hex.ts`, `test/hex.test.ts`

- [ ] 2.1  Axial coordinate system (q, r) with pointy-top hexagons
- [ ] 2.2  Hex geometry: `hexToPixel()`, `pixelToHex()`, `hexCorners()`
- [ ] 2.3  Neighbor calculation, distance, ring generation
- [ ] 2.4  Bounding box computation for viewport culling
- [ ] 2.5  Tests for coordinate math

## Phase 3: Clustering Algorithm
**Files:** `src/cluster.ts`, `test/cluster.test.ts`

- [ ] 3.1  Group assets by `domain` field
- [ ] 3.2  Organic cluster shape generation (spiral hex fill per domain)
- [ ] 3.3  Inter-cluster spacing (gap hexes between domains)
- [ ] 3.4  Color palette: blue-to-teal spectrum mapped to domains
- [ ] 3.5  Shade variation within clusters for depth/texture
- [ ] 3.6  Centroid computation for label placement
- [ ] 3.7  Sub-cluster grouping by `subDomain`
- [ ] 3.8  Tests for clustering + color assignment

## Phase 4: Hex Map HTML Export (Core Rendering)
**Files:** `src/exporter.ts`

- [ ] 4.1  `exportHexMap()` → self-contained HTML + Canvas
- [ ] 4.2  Hex rendering: fill, stroke, hover highlight
- [ ] 4.3  Cluster coloring with shade variations
- [ ] 4.4  Cluster labels (pill badges, white bg + shadow)
- [ ] 4.5  Sub-domain labels at higher zoom
- [ ] 4.6  Connection lines between linked assets
- [ ] 4.7  Responsive Canvas (fills parent container)

## Phase 5: Viewport & Navigation
**Files:** `src/exporter.ts` (within hexmap HTML)

- [ ] 5.1  Pan (click-drag + touch-drag)
- [ ] 5.2  Zoom (scroll wheel + pinch gesture)
- [ ] 5.3  Zoom buttons (`+` / `−`) bottom-right
- [ ] 5.4  Zoom percentage indicator
- [ ] 5.5  Detail level selector (1–4) with vertical buttons
- [ ] 5.6  LOD rendering: hide/show labels + hexagons by zoom level
- [ ] 5.7  Smooth zoom animation

## Phase 6: Interactivity
**Files:** `src/exporter.ts` (within hexmap HTML)

- [ ] 6.1  Hover: highlight hexagon + tooltip (name, domain, metadata)
- [ ] 6.2  Click: select asset → detail panel (right sidebar)
- [ ] 6.3  Detail panel: metadata, lineage edges, quality score
- [ ] 6.4  Multi-select (Shift+click) for connection creation
- [ ] 6.5  Search input: filter + highlight matching clusters, dim others
- [ ] 6.6  Connection tool (link icon in toolbar): click two assets to link

## Phase 7: Layers & Themes
**Files:** `src/exporter.ts` (within hexmap HTML)

- [ ] 7.1  Layer toggle buttons (bottom-left): org, labels, quality
- [ ] 7.2  Organization layer: recolor clusters by org structure
- [ ] 7.3  Label layer: toggle domain/sub-domain labels
- [ ] 7.4  Quality layer: overlay indicators (red/orange tint for low scores)
- [ ] 7.5  Dark mode: dark background + glowing accents
- [ ] 7.6  Light mode: white background + solid fills (default)
- [ ] 7.7  Theme toggle button

## Phase 8: CLI Integration
**Files:** `src/cli.ts`

- [ ] 8.1  `datasynx-cartography map [session-id]` command → opens hexmap.html
- [ ] 8.2  Update `export` command: add `hexmap` format option
- [ ] 8.3  Update `seed` command: accept domain/subDomain/qualityScore
- [ ] 8.4  Update `discover` output to include hexmap link
- [ ] 8.5  Update `docs` command with hex map documentation

## Phase 9: Edge Cases & Polish
**Files:** various

- [ ] 9.1  Empty map state ("No data assets available")
- [ ] 9.2  Loading state (skeleton hexagons)
- [ ] 9.3  Single asset (centered hexagon)
- [ ] 9.4  Large dataset (1000+): progressive rendering + viewport culling
- [ ] 9.5  Keyboard navigation (arrow keys between clusters/assets)
- [ ] 9.6  ARIA labels on hexagons
- [ ] 9.7  High-contrast mode for color-coded clusters
- [ ] 9.8  Screen reader: cluster summaries per zoom level

---

## Execution Order

```
Phase 1 (Data Model)     ████░░░░░░  — Foundation
Phase 2 (Hex Engine)     ████░░░░░░  — Math
Phase 3 (Clustering)     ████░░░░░░  — Layout
Phase 4 (HTML Rendering) ████████░░  — Core visual
Phase 5 (Viewport)       ████████░░  — Navigation
Phase 6 (Interactivity)  ████████░░  — UX
Phase 7 (Layers/Themes)  ██████░░░░  — Polish
Phase 8 (CLI)            ████░░░░░░  — Integration
Phase 9 (Edge Cases)     ██████░░░░  — Hardening
```

Phases 1–3 are sequential (each depends on the previous).
Phases 4–7 build incrementally on the same HTML output.
Phase 8 can run partially in parallel with 4–7.
Phase 9 is final polish.
