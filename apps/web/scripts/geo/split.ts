// SPDX-FileCopyrightText: 2026 Intrface j.d.o.o.
// SPDX-License-Identifier: AGPL-3.0-or-later

/*
 * Pipeline step 4: cut the finished boundary set into what the entry map ships.
 *
 *   bun run scripts/geo/split.ts <work-dir>
 *
 * <work-dir> is the directory holding `hr-adm1.json`, `hr-adm2.json` and
 * `index.json` produced by `build.ts`. Writes, relative to apps/web:
 *
 *   src/data/geo/hr-adm1.json      21 counties, bundled into the page
 *   src/data/geo/hr-places.json    every city and municipality, no geometry
 *   public/geo/hr-places.json      the same list, fetched by the search box
 *   public/geo/hr/<county>.json    one county's units, fetched when chosen
 *
 * Island fillers (`kind: "otok"`) stay in the county files, flagged, so the
 * coast still draws as land; they are left out of the selectable place list.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { geometryToPath, geometryRings, ringsBBox } from '../../src/lib/geo/shapes.ts';

const workDir = process.argv[2];
if (!workDir) throw new Error('usage: bun run scripts/geo/split.ts <work-dir>');

const appRoot = path.resolve(import.meta.dir, '../..');
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(workDir, name), 'utf8'));

const adm1 = read('hr-adm1.json');
const adm2 = read('hr-adm2.json');
const index = read('index.json');

const dataDir = path.join(appRoot, 'src/data/geo');
const publicDir = path.join(appRoot, 'public/geo');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.join(publicDir, 'hr'), { recursive: true });

// ---- counties, bundled ----
fs.writeFileSync(path.join(dataDir, 'hr-adm1.json'), JSON.stringify(adm1));

// ---- places, no geometry ----
const byCounty = new Map<string, any[]>();
const places: any[] = [];
for (const feature of adm2.features) {
  const p = feature.properties;
  const rings = geometryRings(feature.geometry);
  const record = {
    slug: p.slug,
    name: p.name,
    kind: p.kind,
    parent: p.parent,
    centroid: index.adm2.find((row: any) => row.slug === p.slug)?.centroid ?? [0, 0],
    bbox: ringsBBox(rings).map((value) => Math.round(value * 100) / 100),
    d: geometryToPath(feature.geometry),
  };
  if (record.kind !== 'otok') {
    places.push({
      slug: record.slug,
      name: record.name,
      kind: record.kind,
      parent: record.parent,
      centroid: record.centroid,
    });
  }
  const list = byCounty.get(p.parent) ?? [];
  list.push(record);
  byCounty.set(p.parent, list);
}
places.sort((left, right) => left.name.localeCompare(right.name, 'hr'));
const placesJson = JSON.stringify(places);
fs.writeFileSync(path.join(dataDir, 'hr-places.json'), placesJson);
fs.writeFileSync(path.join(publicDir, 'hr-places.json'), placesJson);

// ---- one file per county ----
let countyBytes = 0;
for (const county of index.adm1) {
  const units = (byCounty.get(county.slug) ?? []).sort((left, right) =>
    left.name.localeCompare(right.name, 'hr'),
  );
  const file = JSON.stringify({
    county: county.slug,
    name: county.name,
    bbox: county.bbox,
    attribution: '© OpenStreetMap contributors (ODbL) · geoBoundaries',
    places: units,
  });
  countyBytes += file.length;
  fs.writeFileSync(path.join(publicDir, 'hr', `${county.slug}.json`), file);
}

console.log(
  `counties ${index.adm1.length}, selectable places ${places.length}, ` +
    `county files ${Math.round(countyBytes / 1024)} KB total, ` +
    `places list ${Math.round(placesJson.length / 1024)} KB`,
);
