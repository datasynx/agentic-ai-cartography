/**
 * Hex Grid Engine — flat-top axial coordinate system.
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

// ── Geometry ─────────────────────────────────────────────────────────────────

/**
 * Convert axial hex coordinates to pixel coordinates (flat-top).
 */
export function hexToPixel(q: number, r: number, size: number): PixelCoord {
  const x = size * (3 / 2 * q);
  const y = size * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);
  return { x, y };
}

/**
 * Convert pixel coordinates to nearest axial hex (flat-top).
 */
export function pixelToHex(x: number, y: number, size: number): AxialCoord {
  const q = (2 / 3 * x) / size;
  const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / size;
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
  // Normalize -0 to 0
  return { q: rq || 0, r: rr || 0 };
}

/**
 * Return the 6 pixel corners of a flat-top hexagon.
 */
export function hexCorners(cx: number, cy: number, size: number): PixelCoord[] {
  const corners: PixelCoord[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i); // flat-top: start at 0°
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
 * Generate all hex coordinates on a given ring around center.
 */
export function hexRing(center: AxialCoord, radius: number): AxialCoord[] {
  if (radius === 0) return [{ q: center.q, r: center.r }];
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
 * Generate a spiral sequence of hex positions (ring 0, ring 1, ring 2, …).
 * Returns exactly `count` positions.
 */
export function hexSpiral(center: AxialCoord, count: number): AxialCoord[] {
  const positions: AxialCoord[] = [];
  let ring = 0;
  while (positions.length < count) {
    const ringPositions = hexRing(center, ring);
    for (const pos of ringPositions) {
      if (positions.length >= count) break;
      positions.push(pos);
    }
    ring++;
  }
  return positions;
}
