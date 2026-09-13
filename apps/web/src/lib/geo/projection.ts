// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Croatia's boundary map in one pure module: WGS84 longitude/latitude to the
 * SVG user units the boundary files are already drawn in.
 *
 * Two steps, no library and no network:
 *   1. EPSG:3765 (HTRS96 / Croatia TM) — a transverse Mercator on GRS80 with
 *      central meridian 16.5°E, scale 0.9999, false easting 500 000 m.
 *   2. The linear fit recorded in the boundary pipeline's `index.json`: the
 *      3765 bounding box below maps onto the 1000 × 980 viewBox, y down.
 *
 * The same code runs in the build pipeline (`scripts/geo/project.ts`) and in
 * the browser for "Moja lokacija", so a point can never land differently in
 * the two places.
 */

const A = 6378137; // GRS80 semi-major axis, metres
const F = 1 / 298.257222101; // GRS80 flattening
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9999;
const LON0 = (16.5 * Math.PI) / 180;
const FALSE_EASTING = 500000;
const FALSE_NORTHING = 0;

/** The 3765 bounding box the SVG viewBox was fitted to: [minX, minY, maxX, maxY]. */
export const BBOX_3765 = [264000, 4698000, 732000, 5156640] as const;
export const VIEW_WIDTH = 1000;
export const VIEW_HEIGHT = 980;
const UNITS_PER_METRE = VIEW_WIDTH / (BBOX_3765[2] - BBOX_3765[0]);

export type Point = [number, number];

/** Forward transverse Mercator, WGS84 degrees to EPSG:3765 metres. */
export function lonLatTo3765(lon: number, lat: number): Point {
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const n = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const t = Math.tan(phi) ** 2;
  const c = EP2 * cosPhi * cosPhi;
  const a = (lam - LON0) * cosPhi;
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const m =
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi));
  const x =
    FALSE_EASTING +
    K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
  const y =
    FALSE_NORTHING +
    K0 *
      (m +
        n *
          Math.tan(phi) *
          ((a * a) / 2 +
            ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
            ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
  return [x, y];
}

/** EPSG:3765 metres to SVG user units of the 1000 × 980 viewBox, y down. */
export function metresToView(x: number, y: number): Point {
  return [(x - BBOX_3765[0]) * UNITS_PER_METRE, (BBOX_3765[3] - y) * UNITS_PER_METRE];
}

/** WGS84 degrees straight to SVG user units. */
export function lonLatToView(lon: number, lat: number): Point {
  const [x, y] = lonLatTo3765(lon, lat);
  return metresToView(x, y);
}
