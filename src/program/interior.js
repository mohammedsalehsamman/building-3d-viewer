// Furniture + inner rooms (bathrooms) for every space, as pure data.
// Placement engine: items are oriented boxes (OBB) placed against walls or
// free-standing, inside the room polygon, without overlapping each other or
// the clearance zones in front of doors.
import { edges, dist, contains, pointSegDist, centroid, area, bbox, signedArea } from '../geometry/polygon.js';

const C = {
  wood: '#b08968', woodDark: '#7f5539', oak: '#d4a373', white: '#f4f4f2', offwhite: '#e9e4da',
  fabric: '#6c757d', fabric2: '#457b9d', fabric3: '#9c6644', linen: '#e8dcc8', dark: '#343a40',
  steel: '#adb5bd', green: '#588157', greenDark: '#3a5a40', ceramic: '#fdfdfd', glass: '#a8dadc',
  counter: '#495057', red: '#bc4749', yellow: '#e9c46a', blue: '#2a9d8f', black: '#212529',
};
export const PALETTE = C;

/* ---------- OBB helpers ---------- */
const rotp = (x, y, r) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
function corners(o) {
  const hw = o.w / 2, hd = o.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => {
    const p = rotp(x, y, o.rot);
    return [o.c[0] + p[0], o.c[1] + p[1]];
  });
}
function obbOverlap(a, b) {
  const ca = corners(a), cb = corners(b);
  const axes = [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2].map((r) => [Math.cos(r), Math.sin(r)]);
  for (const ax of axes) {
    const pa = ca.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    const pb = cb.map((p) => p[0] * ax[0] + p[1] * ax[1]);
    if (Math.max(...pa) <= Math.min(...pb) + 0.01 || Math.max(...pb) <= Math.min(...pa) + 0.01) return false;
  }
  return true;
}

/* ---------- room context ---------- */
class Room {
  constructor(space) {
    this.space = space;
    this.poly = signedArea(space.polygon) < 0 ? space.polygon.slice().reverse() : space.polygon;
    this.facadeKeys = (space.facades || []).filter((f) => !f.shared);
    this.items = [];     // output primitives
    this.obstacles = []; // OBBs
    this.rooms = [];     // inner rooms (bathrooms)
    this.edgeInfo = edges(this.poly).map(([a, b]) => {
      const facade = this.facadeKeys.some((f) => pointSegDist(f.a, a, b) < 0.05 && pointSegDist(f.b, a, b) < 0.05);
      return { a, b, facade, margin: facade ? 0.3 : 0.1 };
    });
    for (const d of space.doors || []) {
      const e = this.edgeAt(d.at);
      if (!e) continue;
      const { t, n } = this.frameOf(e);
      this.obstacles.push({ c: [d.at[0] + n[0] * 0.6, d.at[1] + n[1] * 0.6], w: d.w + 0.3, d: 1.2, rot: Math.atan2(t[1], t[0]) });
    }
    this.door = space.doors?.[0]?.at || null;
  }
  edgeAt(p) {
    let best = null, bd = 0.08;
    for (const e of this.edgeInfo) { const d = pointSegDist(p, e.a, e.b); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  frameOf(e) {
    const L = dist(e.a, e.b);
    const t = [(e.b[0] - e.a[0]) / L, (e.b[1] - e.a[1]) / L];
    return { t, n: [-t[1], t[0]], L }; // n = inward for CCW
  }
  fits(o) {
    for (const p of corners(o)) {
      if (!contains(this.poly, p)) return false;
      for (const e of this.edgeInfo) if (pointSegDist(p, e.a, e.b) < e.margin - 0.005) return false;
    }
    return !this.obstacles.some((b) => obbOverlap(o, b));
  }
  /** candidate positions with the item's back against a wall */
  wallCandidates(w, d, { avoidFacade = false, onlyFacade = false, step = 0.2 } = {}) {
    const out = [];
    for (const e of this.edgeInfo) {
      if (avoidFacade && e.facade) continue;
      if (onlyFacade && !e.facade) continue;
      const { t, n, L } = this.frameOf(e);
      const off = e.margin + 0.02 + d / 2;
      for (let s = w / 2 + 0.05; s <= L - w / 2 - 0.05; s += step) {
        out.push({ c: [e.a[0] + t[0] * s + n[0] * off, e.a[1] + t[1] * s + n[1] * off], w, d, rot: Math.atan2(t[1], t[0]), wall: e });
      }
    }
    return out;
  }
  gridCandidates(w, d, step = 0.3, rot = 0) {
    const b = bbox(this.poly);
    const out = [];
    for (let x = b.x0 + w / 2; x <= b.x1; x += step) for (let y = b.y0 + d / 2; y <= b.y1; y += step) out.push({ c: [x, y], w, d, rot });
    return out;
  }
  place(cands, score, pad = 0) {
    const sorted = cands.map((c) => ({ c, s: score(c) })).sort((a, b) => a.s - b.s);
    for (const { c } of sorted) {
      let test = c;
      if (pad && c.wall) {
        // wall-mounted: keep the back against the wall, pad sides and front
        const f = rotp(0, pad / 2, c.rot);
        test = { ...c, c: [c.c[0] + f[0], c.c[1] + f[1]], w: c.w + pad * 2, d: c.d + pad };
      } else if (pad) test = { ...c, w: c.w + pad * 2, d: c.d + pad * 2 };
      if (this.fits(test)) { this.obstacles.push(test); return c; }
    }
    return null;
  }
  /** add primitives given in item-local coordinates: [x, y, z, w, d, h, color, shape] */
  add(o, parts) {
    for (const [x, y, z, w, d, h, color, shape = 'box', extraRot = 0] of parts) {
      const p = rotp(x, y, o.rot);
      // a cylinder with an extra rotation is a wheel lying on its side (axis = item's local x)
      const s = shape === 'cyl' && extraRot ? 'wheel' : shape;
      this.items.push({ shape: s, c: [o.c[0] + p[0], o.c[1] + p[1]], z, w, d, h, rot: o.rot, color });
    }
  }
  distFacade(p) {
    if (!this.facadeKeys.length) return 0;
    return Math.min(...this.facadeKeys.map((f) => pointSegDist(p, f.a, f.b)));
  }
}

/* ---------- furniture pieces (local coords: x along wall, y into the room, back at -d/2) ---------- */
const P = {
  bed: (fab = C.linen) => [
    [0, 0, 0, 1.6, 2.05, 0.3, C.woodDark], [0, 0.05, 0.3, 1.55, 1.95, 0.22, C.white],
    [0, -0.98, 0, 1.7, 0.08, 1.05, C.woodDark], [0, 0.45, 0.52, 1.56, 1.0, 0.04, fab],
    [-0.4, -0.75, 0.52, 0.6, 0.35, 0.12, C.offwhite], [0.4, -0.75, 0.52, 0.6, 0.35, 0.12, C.offwhite],
  ],
  nightstand: () => [[0, 0, 0, 0.45, 0.4, 0.5, C.oak]],
  wardrobe: (w = 1.6) => [[0, 0, 0, w, 0.6, 2.2, C.offwhite], [0, 0.31, 0.1, 0.02, 0.02, 2.0, C.steel]],
  sofa: (col = C.fabric) => [
    [0, 0, 0, 2.0, 0.9, 0.42, col], [0, -0.35, 0.42, 2.0, 0.2, 0.42, col],
    [-0.92, 0.05, 0.42, 0.16, 0.8, 0.2, col], [0.92, 0.05, 0.42, 0.16, 0.8, 0.2, col],
  ],
  coffee: () => [[0, 0, 0, 1.0, 0.55, 0.4, C.oak]],
  tv: () => [[0, 0, 0, 1.6, 0.4, 0.5, C.woodDark], [0, -0.05, 0.85, 1.2, 0.05, 0.7, C.black]],
  kitchen: (w) => [
    [0, 0, 0, w, 0.62, 0.88, C.offwhite], [0, 0, 0.88, w, 0.64, 0.04, C.counter],
    [0, -0.14, 1.5, w, 0.35, 0.7, C.offwhite], [w / 2 - 0.4, 0.05, 0.92, 0.5, 0.4, 0.02, C.steel],
  ],
  fridge: () => [[0, 0, 0, 0.68, 0.68, 1.85, C.steel]],
  table2: () => [[0, 0, 0, 0.8, 0.8, 0.75, C.oak], [0, -0.6, 0, 0.42, 0.42, 0.45, C.woodDark], [0, 0.6, 0, 0.42, 0.42, 0.45, C.woodDark]],
  roundTable: (chairs = 4, col = C.oak) => {
    const parts = [[0, 0, 0, 0.8, 0.8, 0.74, col, 'cyl']];
    for (let i = 0; i < chairs; i++) {
      const a = (i / chairs) * Math.PI * 2 + Math.PI / 4;
      parts.push([Math.cos(a) * 0.68, Math.sin(a) * 0.68, 0, 0.42, 0.42, 0.46, C.dark]);
    }
    return parts;
  },
  desk: () => [[0, 0, 0.72, 1.4, 0.7, 0.04, C.white], [-0.66, 0, 0, 0.05, 0.66, 0.72, C.steel], [0.66, 0, 0, 0.05, 0.66, 0.72, C.steel],
    [0, -0.2, 0.76, 0.55, 0.05, 0.38, C.black], [0, 0.65, 0, 0.5, 0.5, 0.48, C.dark]],
  meeting: () => {
    const p = [[0, 0, 0, 2.4, 1.1, 0.74, C.woodDark]];
    for (const x of [-0.8, 0, 0.8]) { p.push([x, -0.85, 0, 0.45, 0.45, 0.46, C.dark]); p.push([x, 0.85, 0, 0.45, 0.45, 0.46, C.dark]); }
    return p;
  },
  shelf: () => [[0, 0, 0, 1.2, 0.45, 2.1, C.oak], [0, 0.05, 0.6, 1.1, 0.36, 0.03, C.white], [0, 0.05, 1.2, 1.1, 0.36, 0.03, C.white]],
  display: () => [[0, 0, 0, 1.4, 0.8, 0.9, C.white], [0, 0, 0.9, 1.3, 0.7, 0.25, C.glass]],
  counter: (w = 2.0) => [[0, 0, 0, w, 0.65, 1.05, C.woodDark], [0, 0, 1.05, w + 0.1, 0.7, 0.05, C.counter]],
  bar: (w) => {
    const n = Math.max(2, Math.floor(w / 0.8));
    return [[0, 0, 0, w, 0.7, 1.1, C.woodDark], [0, 0, 1.1, w + 0.1, 0.75, 0.05, C.counter],
      ...Array.from({ length: n }, (_, i) => [-w / 2 + (i + 0.5) * (w / n), 0.75, 0, 0.36, 0.36, 0.75, C.dark, 'cyl'])];
  },
  plant: () => [[0, 0, 0, 0.45, 0.45, 0.45, C.counter, 'cyl'], [0, 0, 0.45, 0.6, 0.6, 0.9, C.green, 'cyl']],
  reception: () => [[0, 0, 0, 2.2, 0.7, 1.1, C.oak], [0, 0, 1.1, 2.3, 0.75, 0.04, C.white], [0, -0.75, 0, 0.5, 0.5, 0.48, C.dark]],
  cabinet: () => [[0, 0, 0, 0.8, 0.4, 2.0, C.steel]],
  genset: () => [[0, 0, 0, 3.2, 1.3, 1.8, C.yellow], [-1.2, 0, 1.8, 0.3, 0.3, 0.8, C.dark, 'cyl']],
  tank: (w) => [[0, 0, 0, w, 1.6, 2.2, C.blue]],
  pump: () => [[0, 0, 0, 0.8, 0.6, 0.7, C.red]],
  cage: () => [[0, 0, 0, 1.8, 1.6, 2.2, C.steel]],
  wcStall: () => [[0, 0.1, 0, 0.4, 0.65, 0.42, C.ceramic], [0, -0.35, 0.4, 0.38, 0.18, 0.4, C.ceramic]],
  sink: () => [[0, 0, 0.8, 0.55, 0.45, 0.12, C.ceramic], [0, 0, 0, 0.3, 0.3, 0.8, C.ceramic]],
  roofTank: () => [[0, 0, 0, 1.3, 1.3, 1.9, C.steel, 'cyl'], [0, 0, 1.9, 0.6, 0.6, 0.15, C.steel, 'cyl']],
  solar: () => [[0, 0, 0.4, 2.0, 1.0, 0.05, '#1d3557', 'box', 0]],
  umbrella: () => [[0, 0, 0, 0.06, 0.06, 2.3, C.white, 'cyl'], [0, 0, 2.2, 2.4, 2.4, 0.12, C.offwhite, 'cyl']],
  lounge: () => [[0, 0, 0, 1.8, 0.8, 0.4, C.linen], [0, -0.32, 0.4, 1.8, 0.16, 0.35, C.linen]],
  planter: (w) => [[0, 0, 0, w, 0.5, 0.55, C.counter], [0, 0, 0.55, w - 0.1, 0.4, 0.5, C.greenDark]],
  car: (col) => [
    [0, 0, 0.22, 1.8, 4.4, 0.65, col], [0, 0.2, 0.87, 1.6, 2.2, 0.55, col], [0, 0.2, 0.9, 1.62, 2.0, 0.45, '#1b263b'],
    [-0.85, 1.35, 0, 0.25, 0.65, 0.65, C.black, 'cyl', Math.PI / 2], [0.85, 1.35, 0, 0.25, 0.65, 0.65, C.black, 'cyl', Math.PI / 2],
    [-0.85, -1.35, 0, 0.25, 0.65, 0.65, C.black, 'cyl', Math.PI / 2], [0.85, -1.35, 0, 0.25, 0.65, 0.65, C.black, 'cyl', Math.PI / 2],
  ],
};
const CAR_COLORS = ['#e9ecef', '#212529', '#6c757d', '#9d0208', '#1d3557', '#adb5bd', '#f8f9fa', '#3a5a40'];

/* ---------- bathroom (inner room) ---------- */
function bathroom(r) {
  const W = 2.2, D = 1.9;
  const doorP = r.door;
  const cands = r.wallCandidates(W, D, { avoidFacade: true });
  const o = r.place(cands, (c) => (doorP ? dist(c.c, doorP) : 0), 0);
  if (!o) return null;
  // inner room polygon + door on the front face (towards the room)
  const cs = corners(o);
  const front = rotp(0, D / 2, o.rot);
  const doorAt = rotp(-W / 2 + 0.6, D / 2, o.rot);
  r.rooms.push({
    type: 'bath', name: 'حمام', polygon: cs,
    door: { at: [o.c[0] + doorAt[0], o.c[1] + doorAt[1]], w: 0.75 },
    back: [cs[0], cs[1]],
  });
  // keep the door swing free
  r.obstacles.push({ c: [o.c[0] + doorAt[0] + front[0] * 0.0 + rotp(0, 0.45, o.rot)[0], o.c[1] + doorAt[1] + rotp(0, 0.45, o.rot)[1]], w: 0.9, d: 0.9, rot: o.rot });
  r.add(o, [
    [W / 2 - 0.5, -D / 2 + 0.5, 0, 0.9, 0.9, 0.06, C.ceramic], [W / 2 - 0.5, -D / 2 + 0.5, 0.06, 0.88, 0.02, 2.0, C.glass],
    [-W / 2 + 0.35, -D / 2 + 0.38, 0, 0.4, 0.62, 0.42, C.ceramic], [-W / 2 + 0.35, -D / 2 + 0.1, 0.42, 0.38, 0.16, 0.38, C.ceramic],
    [0.05, -D / 2 + 0.25, 0.8, 0.55, 0.42, 0.12, C.ceramic], [0.05, -D / 2 + 0.25, 0, 0.3, 0.3, 0.8, C.ceramic],
  ]);
  return o;
}

/* ---------- per-type furnishing ---------- */
function studio(r) {
  bathroom(r);
  const k = r.place(r.wallCandidates(2.4, 0.64, { avoidFacade: true }), (c) => (r.door ? dist(c.c, r.door) : 0));
  if (k) {
    r.add(k, P.kitchen(2.4));
    const f = r.place(r.wallCandidates(0.68, 0.68), (c) => dist(c.c, k.c));
    if (f) r.add(f, P.fridge());
  }
  const bed = r.place(r.wallCandidates(1.75, 2.1, { avoidFacade: true }), (c) => r.distFacade(c.c) * 0.6 + (r.door ? -dist(c.c, r.door) * 0.4 : 0), 0.15);
  if (bed) {
    r.add(bed, P.bed(C.fabric2));
    const ns = r.place([{ ...bed, c: [bed.c[0] + rotp(1.1, -0.8, bed.rot)[0], bed.c[1] + rotp(1.1, -0.8, bed.rot)[1]], w: 0.45, d: 0.4 }], () => 0);
    if (ns) r.add(ns, P.nightstand());
  }
  const ward = r.place(r.wallCandidates(1.6, 0.6, { avoidFacade: true }), (c) => (bed ? dist(c.c, bed.c) : 0) + (r.door ? dist(c.c, r.door) * 0.3 : 0));
  if (ward) r.add(ward, P.wardrobe());
  const sofa = r.place(r.wallCandidates(2.0, 0.9), (c) => Math.abs(r.distFacade(c.c) - 1.8) + (bed ? Math.max(0, 2.6 - dist(c.c, bed.c)) * 2 : 0), 0.1);
  if (sofa) {
    r.add(sofa, P.sofa(C.fabric));
    const front = rotp(0, 1.05, sofa.rot);
    const ct = { c: [sofa.c[0] + front[0], sofa.c[1] + front[1]], w: 1.0, d: 0.55, rot: sofa.rot };
    if (r.fits(ct)) { r.obstacles.push(ct); r.add(ct, P.coffee()); }
    const tv = r.place(r.wallCandidates(1.6, 0.4), (c) => Math.abs(dist(c.c, sofa.c) - 2.6) + Math.abs(Math.cos(c.rot - sofa.rot) + 1) * 2);
    if (tv) r.add(tv, P.tv());
  }
  const t = r.place(r.gridCandidates(0.8, 2.0, 0.25), (c) => (k ? dist(c.c, k.c) : 0));
  if (t) r.add(t, P.table2());
  const pl = r.place(r.wallCandidates(0.6, 0.6, { onlyFacade: true }), (c) => (sofa ? dist(c.c, sofa.c) : 0));
  if (pl) r.add(pl, P.plant());
}

function office(r) {
  const n = Math.max(2, Math.floor(r.space.area / 8.5));
  const meet = r.space.area > 45 ? r.place(r.gridCandidates(2.4, 2.9, 0.3), (c) => -r.distFacade(c.c)) : null;
  if (meet) r.add(meet, P.meeting());
  for (let i = 0; i < n; i++) {
    const d = r.place(r.wallCandidates(1.4, 1.5, { step: 0.3 }), (c) => r.distFacade(c.c) + i * 0.0);
    if (!d) break;
    r.add({ ...d, c: [d.c[0] - rotp(0, 0.4, d.rot)[0], d.c[1] - rotp(0, 0.4, d.rot)[1]] }, P.desk());
  }
  for (let i = 0; i < 2; i++) {
    const c = r.place(r.wallCandidates(0.8, 0.4, { avoidFacade: true }), () => 0);
    if (c) r.add(c, P.cabinet());
  }
  const pl = r.place(r.wallCandidates(0.6, 0.6), (c) => -r.distFacade(c.c));
  if (pl) r.add(pl, P.plant());
}

function shop(r) {
  const cnt = r.place(r.wallCandidates(2.0, 1.6, { avoidFacade: true }), (c) => -r.distFacade(c.c), 0);
  if (cnt) r.add({ ...cnt, c: [cnt.c[0] + rotp(0, 0.45, cnt.rot)[0], cnt.c[1] + rotp(0, 0.45, cnt.rot)[1]] }, P.counter(2.0));
  for (let i = 0; i < 14; i++) {
    const s = r.place(r.wallCandidates(1.2, 0.45, { avoidFacade: true, step: 0.3 }), (c) => -r.distFacade(c.c));
    if (!s) break;
    r.add(s, P.shelf());
  }
  for (let i = 0; i < 3; i++) {
    const d = r.place(r.gridCandidates(1.4, 0.8, 0.3, (r.edgeInfo.find((e) => e.facade) ? Math.atan2(r.edgeInfo.find((e) => e.facade).b[1] - r.edgeInfo.find((e) => e.facade).a[1], r.edgeInfo.find((e) => e.facade).b[0] - r.edgeInfo.find((e) => e.facade).a[0]) : 0)), (c) => r.distFacade(c.c), 0.9);
    if (!d) break;
    r.add(d, P.display());
  }
}

function lobby(r) {
  const rec = r.place(r.wallCandidates(2.2, 1.5, { avoidFacade: true }), (c) => (r.door ? dist(c.c, r.door) : 0));
  if (rec) r.add({ ...rec, c: [rec.c[0] + rotp(0, 0.4, rec.rot)[0], rec.c[1] + rotp(0, 0.4, rec.rot)[1]] }, P.reception());
  const sofa = r.place(r.wallCandidates(2.0, 0.9), (c) => -r.distFacade(c.c) * 0.1, 0.2);
  if (sofa) r.add(sofa, P.sofa(C.fabric3));
  for (let i = 0; i < 3; i++) {
    const p = r.place(r.wallCandidates(0.6, 0.6, { step: 0.5 }), (c) => r.distFacade(c.c) + i);
    if (p) r.add(p, P.plant());
  }
}

function tables(r, { spacing = 2.3, umbrella = 0, chairs = 4, rotJitter = 0 } = {}) {
  const b = bbox(r.poly);
  let n = 0;
  for (let x = b.x0 + 1; x <= b.x1 - 0.5; x += spacing) {
    for (let y = b.y0 + 1; y <= b.y1 - 0.5; y += spacing) {
      const o = { c: [x, y], w: 1.9, d: 1.9, rot: rotJitter };
      if (r.fits(o)) {
        r.obstacles.push(o);
        r.add(o, P.roundTable(chairs, n % 3 === 0 ? C.white : C.oak));
        if (umbrella && n % umbrella === 0) r.add(o, P.umbrella());
        n++;
      }
    }
  }
}

function cafe(r) {
  const bar = r.place(r.wallCandidates(4.0, 1.6, { avoidFacade: true }), (c) => Math.abs(c.c[1]) * 0.5 + (r.door ? dist(c.c, r.door) * 0.2 : 0), 0);
  if (bar) r.add({ ...bar, c: [bar.c[0] - rotp(0, 0.3, bar.rot)[0], bar.c[1] - rotp(0, 0.3, bar.rot)[1]] }, P.bar(4.0));
  for (let i = 0; i < 2; i++) {
    const s = r.place(r.wallCandidates(2.0, 0.9, { onlyFacade: true }), (c) => (bar ? -dist(c.c, bar.c) : 0), 0.3);
    if (s) r.add(s, P.sofa(C.fabric3));
  }
  tables(r, { spacing: 2.25 });
  for (let i = 0; i < 3; i++) {
    const p = r.place(r.wallCandidates(0.6, 0.6, { step: 0.6 }), () => i);
    if (p) r.add(p, P.plant());
  }
}

function terrace(r) {
  for (let i = 0; i < 10; i++) {
    const p = r.place(r.wallCandidates(2.0, 0.5, { onlyFacade: true, step: 0.4 }), (c) => i * 0.0 + c.c[0] * 0.01);
    if (!p) break;
    r.add(p, P.planter(2.0));
  }
  for (let i = 0; i < 3; i++) {
    const l = r.place(r.wallCandidates(1.8, 0.8, { onlyFacade: true }), (c) => -r.distFacade(c.c), 0.3);
    if (l) r.add(l, P.lounge());
  }
  tables(r, { spacing: 2.6, umbrella: 2 });
}

function parking(r) {
  const [x0, y0, x1, y1] = (() => { const b = bbox(r.poly); return [b.x0, b.y0, b.x1, b.y1]; })();
  const along = x1 - x0 > y1 - y0 ? 0 : Math.PI / 2;
  const h = [...r.space.id].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  if (h % 10 < 7) {
    r.add({ c: [(x0 + x1) / 2, (y0 + y1) / 2], rot: along === 0 ? Math.PI / 2 : 0 }, P.car(CAR_COLORS[h % CAR_COLORS.length]));
  }
}

function wc(r) {
  for (let i = 0; i < 4; i++) {
    const s = r.place(r.wallCandidates(0.9, 1.2, { avoidFacade: true, step: 0.3 }), (c) => (r.door ? -dist(c.c, r.door) : 0));
    if (!s) break;
    r.add(s, P.wcStall());
  }
  for (let i = 0; i < 2; i++) {
    const s = r.place(r.wallCandidates(0.6, 0.5), (c) => (r.door ? dist(c.c, r.door) : 0));
    if (s) r.add(s, P.sink());
  }
  if (r.space.name.includes('مطبخ')) {
    const k = r.place(r.wallCandidates(2.0, 0.64), () => 0);
    if (k) r.add(k, P.kitchen(2.0));
  }
}

function kitchen(r) {
  for (let i = 0; i < 4; i++) {
    const k = r.place(r.wallCandidates(2.0, 0.64, { step: 0.3 }), () => i);
    if (!k) break;
    r.add(k, P.kitchen(2.0));
  }
  const f = r.place(r.wallCandidates(0.68, 0.68), () => 0);
  if (f) r.add(f, P.fridge());
  const t = r.place(r.gridCandidates(1.6, 0.8, 0.3), () => 0, 0.6);
  if (t) r.add(t, [[0, 0, 0, 1.6, 0.8, 0.9, C.steel]]);
}

function tech(r) {
  for (let i = 0; i < 4; i++) {
    const t = r.place(r.wallCandidates(1.4, 1.4, { step: 0.3 }), (c) => c.c[1], 0.15);
    if (!t) break;
    r.add(t, P.roofTank());
  }
  const b = bbox(r.poly);
  for (let y = b.y0 + 0.8; y < b.y1; y += 1.6) for (let x = b.x0 + 1.1; x < b.x1; x += 2.1) {
    const o = { c: [x, y], w: 2.0, d: 1.1, rot: 0 };
    if (r.fits(o)) { r.obstacles.push(o); r.add(o, [[0, 0, 0.0, 0.1, 0.1, 0.5, C.steel], [0, 0, 0.55, 2.0, 1.0, 0.05, '#1d3557', 'box', 0]]); }
  }
}

function service(r, kind) {
  if (kind === 'generator') {
    const g = r.place(r.gridCandidates(3.2, 1.3, 0.3), (c) => -area(r.poly) * 0 + dist(c.c, centroid(r.poly)), 0.6);
    if (g) r.add(g, P.genset());
  }
  if (kind === 'tank') {
    const t = r.place(r.wallCandidates(3.0, 1.6), () => 0, 0.2);
    if (t) r.add(t, P.tank(3.0));
    const p = r.place(r.wallCandidates(0.8, 0.6), () => 0, 0.2);
    if (p) r.add(p, P.pump());
  }
  if (kind === 'storage') {
    for (let i = 0; i < 6; i++) {
      const c = r.place(r.wallCandidates(1.8, 1.6, { step: 0.3 }), () => i, 0.05);
      if (!c) break;
      r.add(c, P.cage());
    }
  }
  if (['electric', 'service'].includes(kind)) {
    for (let i = 0; i < 5; i++) {
      const c = r.place(r.wallCandidates(0.8, 0.4, { step: 0.3 }), () => i);
      if (!c) break;
      r.add(c, P.cabinet());
    }
  }
}

export function furnish(space) {
  const r = new Room(space);
  switch (space.type) {
    case 'studio': studio(r); break;
    case 'office': office(r); break;
    case 'shop': shop(r); break;
    case 'lobby': if (space.code === 'ENTRY') lobby(r); break;
    case 'cafe': cafe(r); break;
    case 'terrace': terrace(r); break;
    case 'parking': parking(r); break;
    case 'wc': wc(r); break;
    case 'kitchen': kitchen(r); break;
    case 'tech': tech(r); break;
    case 'generator': case 'tank': case 'storage': case 'electric': case 'service': service(r, space.type); break;
    default: break;
  }
  return { items: r.items, rooms: r.rooms };
}
