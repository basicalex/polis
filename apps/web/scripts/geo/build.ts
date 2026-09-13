import * as fs from "fs";

const BB = [264000, 4698000, 732000, 5156640];   // EPSG:3765 metres
const W = 1000, H = 980;
const s = W / (BB[2] - BB[0]);                    // 0.0021367521367521 view units per metre
const tx = (x:number) => Math.round(((x - BB[0]) * s) * 100) / 100;
const ty = (y:number) => Math.round(((BB[3] - y) * s) * 100) / 100;

function mapCoords(c:any):any {
  return typeof c[0] === "number" ? [tx(c[0]), ty(c[1])] : c.map(mapCoords);
}
function bboxOf(g:any){let x0=1e15,y0=1e15,x1=-1e15,y1=-1e15;const w=(c:any)=>{if(typeof c[0]==="number"){if(c[0]<x0)x0=c[0];if(c[0]>x1)x1=c[0];if(c[1]<y0)y0=c[1];if(c[1]>y1)y1=c[1]}else c.forEach(w)};w(g.coordinates);return[x0,y0,x1,y1].map(v=>Math.round(v*100)/100)}

const adm1 = JSON.parse(fs.readFileSync("proj-adm1.json","utf8"));
const adm2 = JSON.parse(fs.readFileSync("proj-adm2.json","utf8"));
for (const f of [...adm1.features, ...adm2.features]) f.geometry.coordinates = mapCoords(f.geometry.coordinates);

const meta = {
  crs: "EPSG:3765 (HTRS96 / Croatia TM), then linear fit to the SVG viewBox",
  viewBox: `0 0 ${W} ${H}`,
  note: "Coordinates are SVG user units, y down, directly plottable. No projection library needed.",
  toMetres: { bbox3765: BB, unitsPerMetre: s, x: "x_m = bbox3765[0] + x/unitsPerMetre", y: "y_m = bbox3765[3] - y/unitsPerMetre" },
};
for (const [j, name] of [[adm1,"hr-adm1.json"],[adm2,"hr-adm2.json"]] as const) {
  (j as any).crs = undefined; delete (j as any).crs;
  (j as any).properties = meta;
  fs.writeFileSync(name, JSON.stringify(j));
}

// ---- index.json ----
const src2 = JSON.parse(fs.readFileSync("work-adm2.geojson","utf8")); // carries _cx/_cy in WGS84
const cent = new Map<string,[number,number]>();
for (const f of src2.features) cent.set(f.properties.slug, [f.properties._cx, f.properties._cy]);

const adm2Idx = adm2.features.map((f:any) => {
  const p = f.properties, b = bboxOf(f.geometry);
  const ll = cent.get(p.slug)!;
  return {
    slug: p.slug, name: p.name, shapeName: p.shapeName, kind: p.kind,
    parent: p.parent, parentISO: p.parentISO,
    centroid: [Math.round((b[0]+b[2])/2*100)/100, Math.round((b[1]+b[3])/2*100)/100],
    centroidLonLat: [Math.round(ll[0]*1e5)/1e5, Math.round(ll[1]*1e5)/1e5],
    bbox: b,
  };
});
// use true interior point (reprojected) rather than bbox centre
const projSrc = JSON.parse(fs.readFileSync("centroids-3765.json","utf8")); // [slug,[x,y]] in metres
const pm = new Map<string,[number,number]>(projSrc);
for (const r of adm2Idx) { const m = pm.get(r.slug); if (m) r.centroid = [tx(m[0]), ty(m[1])]; }

const adm1Idx = adm1.features.map((f:any) => ({
  slug: f.properties.slug, name: f.properties.name,
  shapeName: f.properties.shapeName, shapeISO: f.properties.shapeISO,
  bbox: bboxOf(f.geometry),
  children: adm2Idx.filter(r => r.parent === f.properties.slug).map(r => r.slug).sort(),
}));

fs.writeFileSync("index.json", JSON.stringify({
  source: {
    dataset: "geoBoundaries gbOpen, Croatia (HRV)",
    adm1: { boundaryID:"HRV-ADM1-27960609", year:"2017", url:"https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/HRV/ADM1/geoBoundaries-HRV-ADM1_simplified.geojson", license:"Open Data Commons Open Database License 1.0 (ODbL)", licenseSource:"https://www.openstreetmap.org/copyright", boundarySource:"OpenStreetMap, Wambacher" },
    adm2: { boundaryID:"HRV-ADM2-41942358", year:"2021", url:"https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/HRV/ADM2/geoBoundaries-HRV-ADM2_simplified.geojson", license:"Creative Commons Attribution-ShareAlike 2.0 (CC BY-SA 2.0)", licenseSource:"https://www.openstreetmap.org/copyright", boundarySource:"OpenStreetMap, geoBoundaries" },
    attribution: "Boundaries: geoBoundaries (Runfola et al. 2020), derived from OpenStreetMap — © OpenStreetMap contributors, ODbL. ADM2 released under CC BY-SA 2.0.",
  },
  projection: meta,
  counts: { adm1: adm1Idx.length, adm2: adm2Idx.length, opcina: adm2Idx.filter(r=>r.kind==="opcina").length, grad: adm2Idx.filter(r=>r.kind==="grad").length, otok: adm2Idx.filter(r=>r.kind==="otok").length },
  adm1: adm1Idx, adm2: adm2Idx,
}, null, 1));

const v = adm2Idx.find(r => r.slug === "vrsar");
console.log("VRSAR", JSON.stringify(v));
console.log("counts", adm1Idx.length, adm2Idx.length);
