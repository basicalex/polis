// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The 21 counties, ready to inline. Built once per worker isolate from the
 * bundled ADM1 boundary file, so a request only reads an array.
 */

import adm1 from '../../data/geo/hr-adm1.json';
import {
  geometryRings,
  geometryToPath,
  ringsBBox,
  type BBox,
  type GeoJsonGeometry,
} from './shapes';

export interface County {
  slug: string;
  name: string;
  /** SVG path data in the 1000 × 980 viewBox, `M x y L x y … Z` only. */
  d: string;
  bbox: BBox;
}

export const counties: County[] = adm1.features
  .map((feature) => ({
    slug: feature.properties.slug,
    name: feature.properties.name,
    d: geometryToPath(feature.geometry as GeoJsonGeometry),
    bbox: ringsBBox(geometryRings(feature.geometry as GeoJsonGeometry)),
  }))
  .sort((left, right) => left.name.localeCompare(right.name, 'hr'));

const bySlug = new Map(counties.map((county) => [county.slug, county]));

export function findCounty(slug: string | null | undefined): County | undefined {
  return slug ? bySlug.get(slug) : undefined;
}

/** The whole country, and one county with a margin, as viewBox strings. */
export const COUNTRY_VIEW_BOX = '0 0 1000 980';

export function viewBoxFor(bbox: BBox, padding = 0.08): string {
  const width = bbox[2] - bbox[0];
  const height = bbox[3] - bbox[1];
  const pad = Math.max(width, height) * padding;
  return `${round(bbox[0] - pad)} ${round(bbox[1] - pad)} ${round(width + pad * 2)} ${round(height + pad * 2)}`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
