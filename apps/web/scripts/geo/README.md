# Croatia boundary pipeline

Four steps turn the geoBoundaries download into the files the entry map ships.
Licence and attribution are in `ATTRIBUTION.txt`; the map renders
`© OpenStreetMap contributors (ODbL) · geoBoundaries`.

Run the first three in a scratch working directory (they read and write files
next to themselves), the fourth from `apps/web`:

```sh
mkdir -p /tmp/hr-boundaries && cd /tmp/hr-boundaries

# 1. download the two source layers (URLs and commit are in ATTRIBUTION.txt)
curl -L -o src-adm1.geojson https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/HRV/ADM1/geoBoundaries-HRV-ADM1_simplified.geojson
curl -L -o src-adm2.geojson https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/HRV/ADM2/geoBoundaries-HRV-ADM2_simplified.geojson

cd /path/to/polis/apps/web

# 2. clean names, attach Croatian county names, assign parents and slugs
(cd /tmp/hr-boundaries && bun run /path/to/polis/apps/web/scripts/geo/prep.ts)

# 3. project WGS84 to EPSG:3765 metres
(cd /tmp/hr-boundaries && bun run /path/to/polis/apps/web/scripts/geo/project.ts)

# 4. fit to the 1000 × 980 viewBox and build index.json
(cd /tmp/hr-boundaries && bun run /path/to/polis/apps/web/scripts/geo/build.ts)

# 5. cut the shipped files into the app
bun run scripts/geo/split.ts /tmp/hr-boundaries
```

What `split.ts` writes:

| File | Size | How it loads |
| --- | --- | --- |
| `src/data/geo/hr-adm1.json` | ~32 KB | bundled; the 21 county outlines are inlined as SVG paths |
| `src/data/geo/hr-places.json` | ~58 KB | server side only, for the `?zupanija=` list and place lookup |
| `public/geo/hr-places.json` | ~58 KB | fetched on the first keystroke in the search box |
| `public/geo/hr/<county>.json` | 2–30 KB each | fetched when a county is chosen |

The intermediates (`src-*`, `work-*`, `proj-*`, `centroids-3765.json`,
`hr-adm1.json`, `hr-adm2.json`, `index.json`) stay in the working directory and
are not committed.

`project.ts` and the browser share one projection, `src/lib/geo/projection.ts`,
so "Moja lokacija" cannot land a point differently from the pipeline.

## Known gap

Fifteen island municipalities are missing from the ADM2 layer in counties other
than Istria. The gap is upstream; do not patch the data by hand.
