import * as fs from "fs";

const HR_NAMES: Record<string,string> = {
  "HR-01":"Zagrebačka županija","HR-02":"Krapinsko-zagorska županija","HR-03":"Sisačko-moslavačka županija",
  "HR-04":"Karlovačka županija","HR-05":"Varaždinska županija","HR-06":"Koprivničko-križevačka županija",
  "HR-07":"Bjelovarsko-bilogorska županija","HR-08":"Primorsko-goranska županija","HR-09":"Ličko-senjska županija",
  "HR-10":"Virovitičko-podravska županija","HR-11":"Požeško-slavonska županija","HR-12":"Brodsko-posavska županija",
  "HR-13":"Zadarska županija","HR-14":"Osječko-baranjska županija","HR-15":"Šibensko-kninska županija",
  "HR-16":"Vukovarsko-srijemska županija","HR-17":"Splitsko-dalmatinska županija","HR-18":"Istarska županija",
  "HR-19":"Dubrovačko-neretvanska županija","HR-20":"Međimurska županija","HR-21":"Grad Zagreb",
};

export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g,"")
    .replace(/đ/g,"d").replace(/Đ/g,"D")
    .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"");
}

type Pos = [number,number];
const rings = (g:any):Pos[][][] => g.type === "Polygon" ? [g.coordinates] : g.coordinates;

function ringArea(r:Pos[]){let s=0;for(let i=0;i<r.length-1;i++)s+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];return s/2}
function inRing(p:Pos,r:Pos[]){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const xi=r[i][0],yi=r[i][1],xj=r[j][0],yj=r[j][1];if(((yi>p[1])!==(yj>p[1]))&&(p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi))c=!c}return c}
function inPoly(p:Pos,poly:Pos[][]){if(!inRing(p,poly[0]))return false;for(let i=1;i<poly.length;i++)if(inRing(p,poly[i]))return false;return true}
function inGeom(p:Pos,g:any){for(const poly of rings(g))if(inPoly(p,poly))return true;return false}
function bboxOf(g:any):[number,number,number,number]{let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;const w=(c:any)=>{if(typeof c[0]==="number"){if(c[0]<x0)x0=c[0];if(c[0]>x1)x1=c[0];if(c[1]<y0)y0=c[1];if(c[1]>y1)y1=c[1]}else c.forEach(w)};w(g.coordinates);return[x0,y0,x1,y1]}

// representative interior point: centroid of largest ring, else grid sample inside it
function repPoint(g:any):Pos{
  let best:Pos[][]|null=null,bestA=-1;
  for(const poly of rings(g)){const a=Math.abs(ringArea(poly[0]));if(a>bestA){bestA=a;best=poly}}
  const poly=best!;const r=poly[0];
  let cx=0,cy=0,A=0;
  for(let i=0;i<r.length-1;i++){const f=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1];A+=f;cx+=(r[i][0]+r[i+1][0])*f;cy+=(r[i][1]+r[i+1][1])*f}
  A=A/2; let c:Pos = A!==0 ? [cx/(6*A),cy/(6*A)] : [r[0][0],r[0][1]];
  if(inPoly(c,poly)) return c;
  const [x0,y0,x1,y1]=bboxOf({type:"Polygon",coordinates:poly});
  for(let n=6;n<=40;n*=2){
    for(let i=1;i<n;i++)for(let j=1;j<n;j++){
      const p:Pos=[x0+(x1-x0)*i/n,y0+(y1-y0)*j/n];
      if(inPoly(p,poly))return p;
    }
  }
  return c;
}

const adm1 = JSON.parse(fs.readFileSync("src-adm1.geojson","utf8"));
const adm2 = JSON.parse(fs.readFileSync("src-adm2.geojson","utf8"));

// ---- ADM1 ----
for(const f of adm1.features){
  const iso = f.properties.shapeISO;
  const hr = HR_NAMES[iso];
  if(!hr) throw new Error("no HR name for "+iso);
  f.properties = { shapeName: f.properties.shapeName, shapeISO: iso, name: hr, slug: slugify(hr.replace(/ županija$/,"")) };
}

// ---- ADM2 name cleanup ----
const FIX: Record<string,string> = {
  "Opicina Muter-Kornati":"Općina Murter-Kornati",
  "Opicina Pirovac":"Općina Pirovac",
  "Općina Veliki Pisanica":"Općina Velika Pisanica",
  "Otok Losinj":"Otok Lošinj",
  "Otok Zut":"Otok Žut",
  "Otok Piskera":"Otok Piškera",
  "Otok Zeca":"Otok Zeča",
  "Otok Leveraka":"Otok Levrnaka",
  "Otok Lavsa":"Otok Lavsa",
};
const adm1Pts = adm1.features.map((f:any)=>({f, c: repPoint(f.geometry)}));
const stats = { fixed:0, byCentroid:0, byNearest:0 };

for(const f of adm2.features){
  let nm: string = FIX[f.properties.shapeName] ?? f.properties.shapeName;
  if(nm !== f.properties.shapeName) stats.fixed++;
  nm = nm.replace(/\s*-\s*/g," - ").replace(/\s+/g," ").trim();
  let kind = "other", bare = nm;
  const m = nm.match(/^(Općina|Grad|Otok)\s+(.+)$/);
  if(m){ kind = m[1]==="Općina"?"opcina":m[1]==="Grad"?"grad":"otok"; bare = m[2]; }
  const p = repPoint(f.geometry);
  let parent = adm1.features.find((a:any)=>inGeom(p,a.geometry));
  if(parent) stats.byCentroid++;
  else {
    let bd=Infinity;
    for(const {f:af,c} of adm1Pts){
      const d=(c[0]-p[0])**2+(c[1]-p[1])**2;
      // distance to polygon vertices is better than to centroid
      let dv=Infinity;
      const w=(cc:any)=>{if(typeof cc[0]==="number"){const t=(cc[0]-p[0])**2+(cc[1]-p[1])**2;if(t<dv)dv=t}else cc.forEach(w)};
      w(af.geometry.coordinates);
      if(dv<bd){bd=dv;parent=af}
    }
    stats.byNearest++;
  }
  f.properties = {
    shapeName: nm, name: bare, kind,
    parent: parent.properties.slug, parentISO: parent.properties.shapeISO,
    _cx: p[0], _cy: p[1],
  };
}

// unique slugs
const base = new Map<string,any[]>();
for(const f of adm2.features){ const s=slugify(f.properties.name); (base.get(s) ?? base.set(s,[]).get(s)!).push(f) }
for(const [s,list] of base){
  if(list.length===1) list[0].properties.slug = s;
  else list.forEach((f:any)=>{ f.properties.slug = s+"-"+f.properties.parent });
}
const seen=new Set<string>();
for(const f of adm2.features){ if(seen.has(f.properties.slug)) throw new Error("dup slug "+f.properties.slug); seen.add(f.properties.slug) }

fs.writeFileSync("work-adm1.geojson", JSON.stringify(adm1));
fs.writeFileSync("work-adm2.geojson", JSON.stringify(adm2));
console.log(JSON.stringify(stats));
const byParent: Record<string,number> = {};
for(const f of adm2.features) byParent[f.properties.parent]=(byParent[f.properties.parent]||0)+1;
console.log("units per county:"); for(const a of adm1.features) console.log("  ",a.properties.slug.padEnd(28), byParent[a.properties.slug]||0);
const v = adm2.features.find((f:any)=>f.properties.name==="Vrsar");
console.log("VRSAR:", JSON.stringify(v.properties));
