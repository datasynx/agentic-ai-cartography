import { describe, it, expect } from 'vitest';
import {
  hexToPixel, pixelToHex, hexRound, hexCorners,
  hexNeighbors, hexDistance, hexRing, hexDisk, hexSpiral,
  hexBoundingBox, pointInHex,
} from '../src/hex.js';

describe('hexToPixel / pixelToHex roundtrip', () => {
  it('origin maps to (0, 0)', () => {
    const { x, y } = hexToPixel(0, 0, 20);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(0);
  });

  it('roundtrip is identity', () => {
    for (const [q, r] of [[1, 0], [0, 1], [2, -1], [-3, 2]]) {
      const { x, y } = hexToPixel(q, r, 20);
      const back = pixelToHex(x, y, 20);
      // Use + 0 to coerce -0 → 0 for comparison
      expect(back.q + 0).toBe(q);
      expect(back.r + 0).toBe(r);
    }
  });
});

describe('hexRound', () => {
  it('rounds to nearest hex', () => {
    // q=0, r=0, s=0 is origin; nearest to (0.1, 0.1) is still origin
    expect(hexRound(0.1, 0.1)).toEqual({ q: 0, r: 0 });
    expect(hexRound(0.9, 0.1)).toEqual({ q: 1, r: 0 });
  });
});

describe('hexCorners', () => {
  it('returns 6 corners', () => {
    const corners = hexCorners(0, 0, 20);
    expect(corners).toHaveLength(6);
  });

  it('corners are on the circumradius', () => {
    const size = 20;
    const corners = hexCorners(0, 0, size);
    for (const { x, y } of corners) {
      expect(Math.sqrt(x * x + y * y)).toBeCloseTo(size, 5);
    }
  });
});

describe('hexNeighbors', () => {
  it('returns 6 neighbors', () => {
    expect(hexNeighbors(0, 0)).toHaveLength(6);
  });

  it('all neighbors are at distance 1', () => {
    const neighbors = hexNeighbors(2, -1);
    for (const n of neighbors) {
      expect(hexDistance({ q: 2, r: -1 }, n)).toBe(1);
    }
  });
});

describe('hexDistance', () => {
  it('distance to self is 0', () => {
    expect(hexDistance({ q: 3, r: -2 }, { q: 3, r: -2 })).toBe(0);
  });

  it('distance is symmetric', () => {
    const a = { q: 1, r: 2 };
    const b = { q: -2, r: 3 };
    expect(hexDistance(a, b)).toBe(hexDistance(b, a));
  });

  it('known distance', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3);
  });
});

describe('hexRing', () => {
  it('radius 0 returns only center', () => {
    expect(hexRing({ q: 0, r: 0 }, 0)).toHaveLength(1);
  });

  it('radius 1 returns 6 hexes', () => {
    expect(hexRing({ q: 0, r: 0 }, 1)).toHaveLength(6);
  });

  it('radius n returns 6n hexes', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(hexRing({ q: 0, r: 0 }, n)).toHaveLength(6 * n);
    }
  });

  it('all ring hexes are at exactly radius distance from center', () => {
    const center = { q: 1, r: -1 };
    const radius = 3;
    const ring = hexRing(center, radius);
    for (const h of ring) {
      expect(hexDistance(center, h)).toBe(radius);
    }
  });
});

describe('hexDisk', () => {
  it('disk of radius 0 has 1 hex', () => {
    expect(hexDisk({ q: 0, r: 0 }, 0)).toHaveLength(1);
  });

  it('disk of radius 1 has 7 hexes', () => {
    expect(hexDisk({ q: 0, r: 0 }, 1)).toHaveLength(7);
  });

  it('disk of radius 2 has 19 hexes', () => {
    expect(hexDisk({ q: 0, r: 0 }, 2)).toHaveLength(19);
  });
});

describe('hexSpiral', () => {
  it('returns exactly count positions', () => {
    expect(hexSpiral({ q: 0, r: 0 }, 1)).toHaveLength(1);
    expect(hexSpiral({ q: 0, r: 0 }, 7)).toHaveLength(7);
    expect(hexSpiral({ q: 0, r: 0 }, 15)).toHaveLength(15);
  });

  it('first position is center', () => {
    const result = hexSpiral({ q: 2, r: -1 }, 5);
    expect(result[0]).toEqual({ q: 2, r: -1 });
  });
});

describe('hexBoundingBox', () => {
  it('empty coords returns zeros', () => {
    const bb = hexBoundingBox([], 20);
    expect(bb.width).toBe(0);
    expect(bb.height).toBe(0);
  });

  it('single hex has positive dimensions', () => {
    const bb = hexBoundingBox([{ q: 0, r: 0 }], 20);
    expect(bb.width).toBeGreaterThan(0);
    expect(bb.height).toBeGreaterThan(0);
  });
});

describe('pointInHex', () => {
  it('center point is inside', () => {
    expect(pointInHex(0, 0, 0, 0, 20)).toBe(true);
  });

  it('far point is outside', () => {
    expect(pointInHex(100, 100, 0, 0, 20)).toBe(false);
  });
});
