// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Pipeline step 2: WGS84 to EPSG:3765 metres.
 *
 * Reads the cleaned work files from `prep.ts`, projects every coordinate with
 * the same transverse Mercator the browser uses, and drops the interior points
 * into `centroids-3765.json` for `build.ts`. Run from the working directory:
 *
 *   bun run scripts/geo/project.ts
 */

import * as fs from 'node:fs';
import { lonLatTo3765 } from '../../src/lib/geo/projection.ts';

function mapCoords(coordinates: any): any {
  return typeof coordinates[0] === 'number'
    ? lonLatTo3765(coordinates[0], coordinates[1])
    : coordinates.map(mapCoords);
}

const adm1 = JSON.parse(fs.readFileSync('work-adm1.geojson', 'utf8'));
const adm2 = JSON.parse(fs.readFileSync('work-adm2.geojson', 'utf8'));

for (const feature of [...adm1.features, ...adm2.features]) {
  feature.geometry.coordinates = mapCoords(feature.geometry.coordinates);
}

// The interior point prep.ts found stays in lon/lat on the work file; build.ts
// wants it in metres, keyed by slug.
const centroids: [string, [number, number]][] = adm2.features.map((feature: any) => [
  feature.properties.slug,
  lonLatTo3765(feature.properties._cx, feature.properties._cy),
]);
for (const feature of adm2.features) {
  delete feature.properties._cx;
  delete feature.properties._cy;
}

fs.writeFileSync('proj-adm1.json', JSON.stringify(adm1));
fs.writeFileSync('proj-adm2.json', JSON.stringify(adm2));
fs.writeFileSync('centroids-3765.json', JSON.stringify(centroids));
console.log('projected', adm1.features.length, 'counties and', adm2.features.length, 'units');
