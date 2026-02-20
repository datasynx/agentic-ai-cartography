/**
 * Hex Grid Engine — pointy-top axial coordinate system.
 * Reference: https://www.redblobgames.com/grids/hexagons/
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface AxialCoord {
  q: number;
  r: number;
}

export interface PixelCoord {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Convert axial hex coordinates to pixel coordinates (pointy-top).
 * @param q  - column axis
 * @param r  - row axis
 * @param size - hex circumradius (center to corner)
 */
export function hexToPixel(q: number, r: number, size: number): PixelCoord {
  const x = size * (Math.sqrt(3) * q + Math.sqrt(3) / 2 * r);
  const y = size * (3 / 2 * r);
  return { x, y };
}

/**
 * Convert pixel coordinates to nearest axial hex (pointy-top).
 */
export function pixelToHex(x: number, y: number, size: number): AxialCoord {
  const q = (Math.sqrt(3) / 3 * x - 1 / 3 * y) / size;
  const r = (2 / 3 * y) / size;
  return hexRound(q, r);
}

/**
 * Round floating-point axial coordinates to the nearest hex.
 */
export function hexRound(q: number, r: number): AxialCoord {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  return { q: rq, r: rr };
}

/**
 * Return the 6 pixel corners of a pointy-top hexagon.
 */
export function hexCorners(cx: number, cy: number, size: number): PixelCoord[] {
  const corners: PixelCoord[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30); // pointy-top: start at -30°
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    });
  }
  return corners;
}

// ── Neighbors & Distance ─────────────────────────────────────────────────────

const HEX_DIRECTIONS: AxialCoord[] = [
  { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
  { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
];

export function hexNeighbors(q: number, r: number): AxialCoord[] {
  return HEX_DIRECTIONS.map(d => ({ q: q + d.q, r: r + d.r }));
}

export function hexDistance(a: AxialCoord, b: AxialCoord): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

/**
 * Generate all hex coordinates within a given ring radius around the origin.
 */
export function hexRing(center: AxialCoord, radius: number): AxialCoord[] {
  if (radius === 0) return [{ ...center }];
  const results: AxialCoord[] = [];
  let hex = {
    q: center.q + HEX_DIRECTIONS[4].q * radius,
    r: center.r + HEX_DIRECTIONS[4].r * radius,
  };
  for (let side = 0; side < 6; side++) {
    for (let step = 0; step < radius; step++) {
      results.push({ q: hex.q, r: hex.r });
      hex = {
        q: hex.q + HEX_DIRECTIONS[side].q,
        r: hex.r + HEX_DIRECTIONS[side].r,
      };
    }
  }
  return results;
}

/**
 * Generate all hexes within `radius` rings (filled disk).
 */
export function hexDisk(center: AxialCoord, radius: number): AxialCoord[] {
  const results: AxialCoord[] = [];
  for (let r = 0; r <= radius; r++) {
    results.push(...hexRing(center, r));
  }
  return results;
}

/**
 * Generate a spiral sequence of hex positions (ring 0, ring 1, ring 2, …).
 * Useful for packing N assets into an organic cluster shape.
 */
export function hexSpiral(center: AxialCoord, count: number): AxialCoord[] {
  const positions: AxialCoord[] = [];
  let ring = 0;
  while (positions.length < count) {
    const ring_positions = hexRing(center, ring);
    for (const pos of ring_positions) {
      if (positions.length >= count) break;
      positions.push(pos);
    }
    ring++;
  }
  return positions;
}

// ── Bounding Box ─────────────────────────────────────────────────────────────

/**
 * Compute the pixel bounding box for a set of hex positions.
 */
export function hexBoundingBox(coords: AxialCoord[], size: number): BoundingBox {
  if (coords.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { q, r } of coords) {
    const { x, y } = hexToPixel(q, r, size);
    const halfW = Math.sqrt(3) / 2 * size;
    const halfH = size;
    if (x - halfW < minX) minX = x - halfW;
    if (y - halfH < minY) minY = y - halfH;
    if (x + halfW > maxX) maxX = x + halfW;
    if (y + halfH > maxY) maxY = y + halfH;
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Check if a pixel point is inside a hex (pointy-top) at the given center.
 */
export function pointInHex(px: number, py: number, cx: number, cy: number, size: number): boolean {
  const dx = Math.abs(px - cx);
  const dy = Math.abs(py - cy);
  const w = Math.sqrt(3) / 2 * size;
  if (dx > w || dy > size) return false;
  return w * size - size * dx - (w / 2) * dy >= 0;
}
