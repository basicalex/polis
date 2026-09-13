// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The boundary shapes ship once, as SVG path data. These helpers turn GeoJSON
 * into that path data (build side) and read it back into rings (browser side),
 * so a county outline is never carried twice in the same payload.
 *
 * The generated `d` uses only `M x y L x y … Z`, one subpath per ring, with
 * space separators and two decimals. `parsePathRings` assumes exactly that.
 */

export type Point = [number, number];
export type Ring = Point[];
export type BBox = [number, number, number, number];

export type GeoJsonGeometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** Every ring of a Polygon or MultiPolygon, outer and inner alike. */
export function geometryRings(geometry: GeoJsonGeometry): Ring[] {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const rings: Ring[] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) rings.push(ring.map((point) => [point[0], point[1]] as Point));
  }
  return rings;
}

/** SVG path data for a geometry, in the restricted `M/L/Z` form above. */
export function geometryToPath(geometry: GeoJsonGeometry, decimals = 2): string {
  const round = (value: number) => {
    const factor = 10 ** decimals;
    const rounded = Math.round(value * factor) / factor;
    return String(rounded);
  };
  const parts: string[] = [];
  for (const ring of geometryRings(geometry)) {
    if (ring.length === 0) continue;
    const points = ring.map(([x, y]) => `${round(x)} ${round(y)}`);
    // A closed GeoJSON ring repeats its first point; `Z` already closes it.
    if (points.length > 1 && points[0] === points[points.length - 1]) points.pop();
    parts.push(`M${points.join('L')}Z`);
  }
  return parts.join('');
}

/** Read `M x y L x y … Z` back into rings. Inverse of `geometryToPath`. */
export function parsePathRings(d: string): Ring[] {
  const rings: Ring[] = [];
  for (const chunk of d.split('M')) {
    if (!chunk) continue;
    const ring: Ring = [];
    for (const pair of chunk.replace(/Z/g, '').split('L')) {
      const [x, y] = pair.trim().split(/\s+/);
      const px = Number(x);
      const py = Number(y);
      if (Number.isFinite(px) && Number.isFinite(py)) ring.push([px, py]);
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Bounding box of a set of rings: [minX, minY, maxX, maxY]. */
export function ringsBBox(rings: Ring[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Ray casting against one ring. */
export function pointInRing(point: Point, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Ray casting against a whole shape. Rings are tested with the even-odd rule,
 * which is what the browser paints too, so a hole reads as outside.
 */
export function pointInRings(point: Point, rings: Ring[]): boolean {
  let crossings = 0;
  for (const ring of rings) if (pointInRing(point, ring)) crossings += 1;
  return crossings % 2 === 1;
}
