// ---------------------------------------------------------------
//  Editable project settings — change values here and the whole
//  model (footprint, layouts, areas, 3D) regenerates.
// ---------------------------------------------------------------
import parcelData from './parcel.js';
import { insetPolygon, area, centroid, clipHalfPlane, dist, intersect } from '../geometry/polygon.js';

/* -------- Orientation --------
 * The model is built in a local frame aligned with the shared boundary 7→6
 * (u axis = along 7→6, v axis = into the parcel).  North is given as a
 * direction in the survey drawing frame (x right, y up on the photo).
 * Estimate: the sheet is photographed rotated 90°, sheet-up ⇒ photo-left.
 * Change NORTH_IN_DRAWING if the real north differs. */
export const NORTH_IN_DRAWING = [-1, 0];

/* -------- Setbacks (m) per parcel side -------- */
export const SETBACKS = {
  internalRoad: 2.5, // side 2–7  (10 m internal road)
  shared: 0.0,       // side 7–6  (blind wall with 2310/3)
  roadB: 3.0,        // side 6–5–4
  corner: 3.0,       // fillet 4–3
  roadA: 3.0,        // side 3–2
};
export const BALCONY_DEPTH = 1.2; // may project into the setback

/* -------- Levels -------- */
export const LEVELS = [
  { id: 'B2',   name: 'الطابق السفلي الثاني', short: 'B2',   use: 'parking',     elev: -6.2, height: 3.1 },
  { id: 'B1',   name: 'الطابق السفلي الأول',  short: 'B1',   use: 'parking',     elev: -3.1, height: 3.1 },
  { id: 'GF',   name: 'الطابق الأرضي — سوق تجاري', short: 'أرضي', use: 'commercial', elev: 0.0, height: 4.5 },
  { id: 'F1',   name: 'الطابق الأول — مكاتب', short: 'ط1',   use: 'offices',     elev: 4.5, height: 3.5 },
  { id: 'F2',   name: 'الطابق الثاني — سكني', short: 'ط2',   use: 'residential', elev: 8.0, height: 3.1 },
  { id: 'F3',   name: 'الطابق الثالث — سكني', short: 'ط3',   use: 'residential', elev: 11.1, height: 3.1 },
  { id: 'F4',   name: 'الطابق الرابع — سكني', short: 'ط4',   use: 'residential', elev: 14.2, height: 3.1 },
  { id: 'F5',   name: 'الطابق الخامس — سكني', short: 'ط5',   use: 'residential', elev: 17.3, height: 3.1 },
  { id: 'F6',   name: 'الطابق السادس — سكني', short: 'ط6',   use: 'residential', elev: 20.4, height: 3.1 },
  { id: 'ROOF', name: 'السطح — مقهى روف توب', short: 'السطح', use: 'roof',     elev: 23.5, height: 3.4 },
];
export const SLAB = 0.25;     // slab thickness
export const WALL = 0.25;     // exterior wall thickness
export const PART = 0.12;     // partition thickness

/* -------- Local frame -------- */
const P = parcelData.points;
const o = P['7'];
const du = [P['6'][0] - o[0], P['6'][1] - o[1]];
const Lu = Math.hypot(du[0], du[1]);
const eu = [du[0] / Lu, du[1] / Lu];
let ev = [-eu[1], eu[0]];
{
  // make v point into the parcel
  const c = [0, 0]; // parcel centroid is at the origin of the drawing frame
  if ((c[0] - o[0]) * ev[0] + (c[1] - o[1]) * ev[1] < 0) ev = [-ev[0], -ev[1]];
}
export const toLocal = ([x, y]) => {
  const d = [x - o[0], y - o[1]];
  return [d[0] * eu[0] + d[1] * eu[1], d[0] * ev[0] + d[1] * ev[1]];
};
export const dirToLocal = ([x, y]) => [x * eu[0] + y * eu[1], x * ev[0] + y * ev[1]];

export const POINTS = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, toLocal(v)]));
export const PARCEL = parcelData.outline.map(toLocal);
export const PARCEL_AREA = area(PARCEL);
export const PARCEL_CENTROID = centroid(PARCEL);
export const EDGE_LENGTHS = parcelData.edges;
export const NORTH = (() => {
  const n = dirToLocal(NORTH_IN_DRAWING);
  const L = Math.hypot(n[0], n[1]);
  return [n[0] / L, n[1] / L];
})();

/* outline index → which side the edge belongs to */
const idx = parcelData.outlineIndex;
export function sideOfEdge(i) {
  if (i === idx['2']) return 'internalRoad';
  if (i === idx['7']) return 'shared';
  if (i === idx['6'] || i === idx['5']) return 'roadB';
  if (i === idx['3']) return 'roadA';
  return 'corner';
}
const setbackList = (extra = 0, override = {}) =>
  PARCEL.map((_, i) => {
    const s = sideOfEdge(i);
    const v = override[s] ?? SETBACKS[s];
    return s === 'shared' ? v : v + extra;
  });

/** Basement footprint: whole parcel less the retaining wall line (0.3 m) */
export const BASEMENT = insetPolygon(PARCEL, PARCEL.map(() => 0.3));

/* The sharp apex left after the setbacks is cut by a chamfer facade (corner studio / corner shop). */
export const CHAMFER_WIDTH = 4.0;
function chamferApex(poly, width) {
  const n = poly.length;
  let best = -1, bestAng = Infinity, bestBis = null;
  for (let i = 0; i < n; i++) {
    const p = poly[i], a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const ua = [(a[0] - p[0]) / dist(a, p), (a[1] - p[1]) / dist(a, p)];
    const ub = [(b[0] - p[0]) / dist(b, p), (b[1] - p[1]) / dist(b, p)];
    const ang = Math.acos(Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1])));
    if (ang < bestAng) {
      bestAng = ang; best = i;
      const bx = ua[0] + ub[0], by = ua[1] + ub[1], L = Math.hypot(bx, by);
      bestBis = [bx / L, by / L];
    }
  }
  const h = width / 2 / Math.tan(bestAng / 2);
  const E = poly[best];
  return { poly: clipHalfPlane(poly, [E[0] + bestBis[0] * h, E[1] + bestBis[1] * h], bestBis), apex: E, bis: bestBis, h };
}
const _fp = chamferApex(insetPolygon(PARCEL, setbackList()), CHAMFER_WIDTH);
/** Building footprint above ground (exterior face of the walls) */
export const FOOTPRINT = _fp.poly;
/** true when edge a→b of a polygon lies on the blind shared wall (v = 0) */
export const isSharedEdge = (a, b) => Math.abs(a[1]) < 0.05 && Math.abs(b[1]) < 0.05;
/** Outer limit for balconies / canopies */
export const BALCONY_LIMIT = intersect(
  insetPolygon(FOOTPRINT, FOOTPRINT.map((p, i) => (isSharedEdge(p, FOOTPRINT[(i + 1) % FOOTPRINT.length]) ? 0 : -BALCONY_DEPTH))),
  PARCEL,
);
/** Roof-terrace edge (same as footprint) */
export const ROOF = FOOTPRINT;

/* -------- Core & circulation grid (local frame, metres) --------
 * The ramp strip runs along the blind wall (v 0.3 → 3.8); the core sits just inboard of it. */
export const RAMP = { v0: 0.3, v1: 3.8, uStart: 0.0, uEnd: 19.5, landingEnd: 22.2 };
export const CORE = {
  u0: 6.0, u1: 14.0, v0: 3.8, v1: 9.8,
  lift1: [6.0, 3.8, 8.2, 6.0],
  passage: [8.2, 3.8, 9.4, 6.0],
  lift2: [9.4, 3.8, 11.6, 6.0],
  stair: [11.6, 3.8, 14.0, 9.8],
  lobby: [6.0, 6.0, 11.6, 9.8],
};
export const HALL = { u0: 4.0, u1: 16.0, v0: 9.8, v1: 11.4 };

export const PROJECT = {
  title: 'مشروع المحضر 2310/4',
  parcel: '2310 / 4',
  parcelArea: 529,
};
