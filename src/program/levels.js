// Builds the full space program of the building (pure data — no three.js).
// Every level is tiled by "spaces" (polygons in the local frame, metres).
// Parking stalls are overlay spaces drawn on top of the drive tiles.
import {
  LEVELS, BASEMENT, FOOTPRINT, PARCEL, BALCONY_LIMIT, BALCONY_DEPTH, CORE, HALL, RAMP, NORTH,
  isSharedEdge, sideOfEdge,
} from '../config/site.js';
import { area, centroid, clipConvex, clipHalfPlane, rect, contains, sharedSegment, dist, edges, pointSegDist } from '../geometry/polygon.js';
import { fanPartition, wedgePoly, FAR } from './fan.js';
import { typeOf } from './types.js';
import { furnish } from './interior.js';

const BIG = 80;
const STALL = { w: 2.5, l: 5.0 };

/* ---------------- helpers ---------------- */
function mk(levelId, code, type, polygon, extra = {}) {
  if (!polygon) return null;
  const t = typeOf(type);
  return {
    id: `${levelId}-${code}`,
    code,
    levelId,
    type,
    kind: extra.kind || t.kind,
    name: extra.name || t.label,
    polygon,
    area: area(polygon),
    doors: extra.doors || [],
    facade: extra.facade || t.facade,
    overlay: !!extra.overlay,
    meta: extra.meta || {},
  };
}
const clipTo = (outline) => (poly) => clipConvex(poly, outline);

function coreSpaces(L, clip, { passage = 'corridor', lobbyEnclosed = false } = {}) {
  const r = (a) => clip(rect(...a));
  return [
    mk(L, 'LIFT1', 'lift', r(CORE.lift1), { name: 'مصعد 1 (8 أشخاص)', doors: [{ at: [7.1, 6.0], w: 0.9 }] }),
    mk(L, 'LIFT2', 'lift', r(CORE.lift2), { name: 'مصعد 2 (8 أشخاص)', doors: [{ at: [10.5, 6.0], w: 0.9 }] }),
    mk(L, 'SHAFT', passage, r(CORE.passage), {
      name: passage === 'corridor' ? 'ممر الخدمات' : 'شفت خدمات (كهرباء/مياه/نفايات)',
    }),
    mk(L, 'STAIR', 'stair', r(CORE.stair), { name: 'الدرج الرئيسي', doors: [{ at: [12.8, 9.8], w: 1.0 }] }),
    mk(L, 'LOBBY', 'lobby', r(CORE.lobby), {
      name: 'ردهة المصاعد',
      kind: lobbyEnclosed ? 'common' : 'open',
      doors: lobbyEnclosed ? [{ at: [8.8, 9.8], w: 1.2 }] : [],
    }),
  ];
}

/* ---------------- parking levels ---------------- */
function stallFits(r, outline, obstacles) {
  const m = 0.06;
  const pts = [[r[0] + m, r[1] + m], [r[2] - m, r[1] + m], [r[2] - m, r[3] - m], [r[0] + m, r[3] - m]];
  if (!pts.every((p) => contains(outline, p))) return false;
  return !obstacles.some((o) => r[0] < o[2] - 0.01 && r[2] > o[0] + 0.01 && r[1] < o[3] - 0.01 && r[3] > o[1] + 0.01);
}
/** greedy row of stalls between v0..v1 (stalls perpendicular to the u axis) */
function stallRow(outline, v0, v1, uMin, uMax, obstacles) {
  const out = [];
  for (let u = uMin; u + STALL.w <= uMax + 1e-6; u += 0.05) {
    const r = [u, v0, u + STALL.w, v1];
    if (stallFits(r, outline, obstacles)) { out.push(r); obstacles.push(r); u += STALL.w - 0.05; }
  }
  return out;
}

function parkingLevel(L) {
  const isB1 = L.id === 'B1';
  const clip = clipTo(BASEMENT);
  const s = [];
  s.push(mk(L.id, 'RAMP', 'ramp', clip(rect(-BIG, -BIG, BIG, RAMP.v1)), {
    name: isB1 ? 'رامب: الشارع ⇄ B1 ⇄ B2 (مكدّس)' : 'نهاية الرامب + مخازن تحت الرامب',
    doors: isB1 ? [{ at: [0.6, RAMP.v1], w: 3.2, h: 2.4 }, { at: [20.8, RAMP.v1], w: 2.6, h: 2.4 }] : [{ at: [20.8, RAMP.v1], w: 2.6, h: 2.4 }],
    meta: { note: 'رامب مستقيم بعرض 3.5 م وميل ≈ 16% بمحاذاة الحد المشترك مع المحضر 2310/3' },
  }));
  s.push(...coreSpaces(L.id, clip, { passage: 'shaft', lobbyEnclosed: true }));
  s.push(mk(L.id, 'DRV-L', 'drive', clip(rect(-BIG, CORE.v0, CORE.u0, CORE.v1)), { name: isB1 ? 'ممر الصعود إلى الرامب' : 'منطقة مواقف' }));
  s.push(mk(L.id, 'DRV-R', 'drive', clip(rect(CORE.u1, CORE.v0, BIG, CORE.v1)), { name: 'ممر نزول الرامب' }));
  s.push(mk(L.id, 'AISLE', 'drive', clip(rect(-BIG, CORE.v1, BIG, 15.8)), { name: 'ممر السيارات الرئيسي (6 م)' }));
  s.push(mk(L.id, 'ROW', 'drive', clip(rect(-BIG, 15.8, BIG, 20.8)), { name: 'صف المواقف' }));

  // stalls
  const obstacles = [];
  const stalls = [];
  stalls.push(...stallRow(BASEMENT, 15.8, 20.8, -BIG / 4, BIG / 2, obstacles));
  if (!isB1) stalls.push(...stallRow(BASEMENT, 4.8, 9.8, -10, CORE.u0, obstacles));
  // stalls at the two ends of the main aisle (parked along u)
  for (const r of [[-4.0, 10.3, 1.0, 12.8], [-0.2, 12.8, 4.8, 15.3], [16.4, 13.3, 21.4, 15.8]]) {
    if (stallFits(r, BASEMENT, obstacles)) { stalls.push(r); obstacles.push(r); }
  }
  stalls.forEach((r, i) => {
    const code = `P${String(i + 1).padStart(2, '0')}`;
    s.push(mk(L.id, code, 'parking', rect(...r), { name: `موقف ${L.id}-${code}`, overlay: true }));
  });

  // rooms in the sharp apex (not usable for parking): door placed in a gap between stalls
  const bottom = clip(rect(-BIG, 20.8, BIG, BIG));
  const left = clipConvex(rect(-BIG, 20.8, 15.5, BIG), bottom);
  const right = clipConvex(rect(15.5, 20.8, BIG, BIG), bottom);
  const doorOnTop = (poly) => {
    const xs = poly.filter((p) => Math.abs(p[1] - 20.8) < 0.01).map((p) => p[0]).sort((a, b) => a - b);
    const lo = xs[0], hi = xs[xs.length - 1];
    for (let u = hi - 0.8; u > lo + 0.6; u -= 0.1) {
      if (!stalls.some((r) => u > r[0] - 0.6 && u < r[2] + 0.6 && Math.abs(r[3] - 20.8) < 0.01)) return [{ at: [u, 20.8], w: 0.9 }];
    }
    return [{ at: [(lo + hi) / 2, 20.8], w: 0.9 }];
  };
  if (isB1) {
    s.push(mk(L.id, 'GEN', 'generator', left, { name: 'غرفة المولّد الكهربائي', doors: doorOnTop(left) }));
    s.push(mk(L.id, 'ELEC', 'electric', right, { name: 'غرفة الكهرباء والعدادات', doors: doorOnTop(right) }));
  } else {
    s.push(mk(L.id, 'STOR', 'storage', left, { name: 'مخازن للسكان', doors: doorOnTop(left) }));
    s.push(mk(L.id, 'TANK', 'tank', right, { name: 'خزان المياه الأرضي + المضخات', doors: doorOnTop(right) }));
  }
  return { outline: BASEMENT, spaces: s.filter(Boolean) };
}

/* ---------------- above-ground helpers ---------------- */
const leftBlock = (vEnd = HALL.v1) => [[-BIG, -BIG], [CORE.u0, -BIG], [CORE.u0, HALL.v0], [HALL.u0, HALL.v0], [HALL.u0, vEnd], [-BIG, vEnd]];
const rightBlock = () => [[CORE.u1, -BIG], [BIG, -BIG], [BIG, HALL.v1], [HALL.u1, HALL.v1], [HALL.u1, HALL.v0], [CORE.u1, HALL.v0]];
const bottomRegion = (clip) => clip(rect(-BIG, HALL.v1, BIG, BIG));
const BASE_A = [HALL.u0, HALL.v1], BASE_B = [HALL.u1, HALL.v1];
const DOWN = [0, 1]; // from the corridor wall towards the apex
const fan = (clip, n, opts) => fanPartition(bottomRegion(clip), BASE_A, BASE_B, n, { inward: DOWN, ...opts }).slices;

/**
 * Balanced partition into equal-area units.  The side blocks (left / right of
 * the core) are cut horizontally at vCut; their lower "wing" joins the first /
 * last fan slice.  A short private entry "neck" (width = neck) keeps each side
 * unit connected to the corridor.  Units: [left?, ...n fan slices, right?].
 */
function balancedPartition(n, { left = null, right = null, neck = 1.2 } = {}) {
  const FP = FOOTPRINT;
  const clip = clipTo(FP);
  const pool = area(bottomRegion(clip)) + (left ? area(clip(left)) : 0) + (right ? area(clip(right)) : 0);
  const T = pool / (n + (left ? 1 : 0) + (right ? 1 : 0));
  const R = FAR;
  // side units = block above vCut + a neck (private entry) down to the corridor
  const uL = CORE.u0 - neck, uR = CORE.u1 + neck;
  const leftUnit = (vc) => clip([[-BIG, -BIG], [CORE.u0, -BIG], [CORE.u0, HALL.v0], [uL, HALL.v0], [uL, vc], [-BIG, vc]]);
  const rightUnit = (vc) => clip(
    right.length === 6 // the standard right block; otherwise (ground floor shop) a plain horizontal cut
      ? [[CORE.u1, -BIG], [BIG, -BIG], [BIG, vc], [uR, vc], [uR, HALL.v0], [CORE.u1, HALL.v0]]
      : clipHalfPlane(right, [0, vc], [0, -1]),
  );
  const solve = (fn) => {
    let lo = 0.5, hi = HALL.v0 - 0.05;
    for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; const a = fn(m) ? area(fn(m)) : 0; if (a < T) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const vL = left ? solve(leftUnit) : null;
  const vR = right ? solve(rightUnit) : null;
  const wL = left ? area(clip(left)) - area(leftUnit(vL)) : 0;
  const wR = right ? area(clip(right)) - area(rightUnit(vR)) : 0;
  const weights = Array(n).fill(T);
  weights[0] -= wL; weights[n - 1] -= wR;
  const fp = fanPartition(bottomRegion(clip), BASE_A, BASE_B, n, { inward: DOWN, weights });
  const slices = fp.slices.slice();
  const { anchors, phis, F } = fp;
  if (left) {
    const w = wedgePoly(F, anchors[0], phis[0], anchors[1], phis[1]); // w[1] = (u0 - R, v1)
    const path = [BASE_A, [HALL.u0, HALL.v0], [uL, HALL.v0], [uL, vL], [HALL.u0 - R, vL]];
    slices[0] = clip([...path, ...w.slice(1)]);
  }
  if (right) {
    const w = wedgePoly(F, anchors[n - 1], phis[n - 1], anchors[n], phis[n]); // w[4] = (u1 + R, v1), w[5] = BASE_B
    const path = right.length === 6
      ? [[HALL.u1 + R, vR], [uR, vR], [uR, HALL.v0], [HALL.u1, HALL.v0]]
      : [[HALL.u1 + R, vR], [CORE.u1, vR], [CORE.u1, HALL.v0], [HALL.u1, HALL.v0]];
    slices[n - 1] = clip([...w.slice(0, 5), ...path, w[5]]);
  }
  return { left: left ? leftUnit(vL) : null, right: right ? rightUnit(vR) : null, slices, target: T };
}

function groundLevel(L) {
  const clip = clipTo(FOOTPRINT);
  const s = [];
  s.push(mk(L.id, 'RAMP', 'ramp', clip(rect(-BIG, -BIG, 16, RAMP.v1)), { name: 'نفق مدخل الباركينغ', meta: { note: 'مدخل السيارات من الطريق الداخلي بعرض 10 م' } }));
  s.push(...coreSpaces(L.id, clip, { passage: 'shaft' }));
  s.push(mk(L.id, 'GARB', 'garbage', clip(rect(-BIG, RAMP.v1, 3.0, 6.3)), { name: 'غرفة النفايات (باب خارجي)' }));
  s.push(mk(L.id, 'ENTRY', 'lobby', clip([[-BIG, 6.3], [3.0, 6.3], [3.0, CORE.v0], [CORE.u0, CORE.v0], [CORE.u0, HALL.v0], [HALL.u1, HALL.v0], [HALL.u1, HALL.v1], [-BIG, HALL.v1]]), {
    name: 'مدخل السكن واللوبي',
    meta: { note: 'مدخل مستقل للسكان والمكاتب والمقهى من جهة الطريق الداخلي، مع مكتب حارس' },
  }));
  const shop1 = [[16, -BIG], [BIG, -BIG], [BIG, HALL.v1], [HALL.u1, HALL.v1], [HALL.u1, HALL.v0], [CORE.u1, HALL.v0], [CORE.u1, RAMP.v1], [16, RAMP.v1]];
  const bal = balancedPartition(3, { right: shop1, neck: 0 });
  const shops = [bal.right, ...bal.slices];
  // order: right shop first, then bottom from internal-road side to the corner
  const names = ['محل 1', 'محل 2', 'محل 3', 'محل 4 — محل الزاوية'];
  shops.forEach((p, i) => s.push(mk(L.id, `SH${i + 1}`, 'shop', p, {
    name: names[i],
    meta: { mezzanine: true, note: 'واجهة زجاجية كاملة، ارتفاع 4.5 م يسمح بإضافة ميزانين' },
  })));
  return { outline: FOOTPRINT, spaces: s.filter(Boolean) };
}

function standardFloor(L, kind) {
  const clip = clipTo(FOOTPRINT);
  const s = [];
  const strip = clip(rect(CORE.u0, -BIG, CORE.u1, CORE.v0));
  if (kind === 'offices') s.push(mk(L.id, 'WC', 'wc', strip, { name: 'حمامات + مطبخ مشترك', doors: [{ at: [8.8, CORE.v0], w: 0.9 }] }));
  else s.push(mk(L.id, 'SRV', 'service', strip, { name: 'غرفة خدمات الطابق (عدادات + نفايات + تخزين)', doors: [{ at: [8.8, CORE.v0], w: 0.9 }] }));
  s.push(...coreSpaces(L.id, clip));
  s.push(mk(L.id, 'HALL', 'corridor', clip(rect(HALL.u0, HALL.v0, HALL.u1, HALL.v1)), { name: 'ممر توزيع الشقق' }));

  if (kind === 'offices') {
    const A = clip(leftBlock());
    const B = clip(rightBlock());
    const [c, d] = fan(clip, 2);
    [A, B, c, d].forEach((p, i) => s.push(mk(L.id, `OF${'ABCD'[i]}`, 'office', p, { name: `مكتب ${'ABCD'[i]}` })));
  } else {
    const bal = balancedPartition(4, { left: leftBlock(), right: rightBlock() });
    const studios = [bal.left, ...bal.slices, bal.right];
    studios.forEach((p, i) => {
      const code = `S${String(i + 1).padStart(2, '0')}`;
      s.push(mk(L.id, code, 'studio', p, { name: `استوديو ${L.id}-${code}` }));
    });
  }
  return { outline: FOOTPRINT, spaces: s.filter(Boolean) };
}

function roofLevel(L) {
  const clip = clipTo(FOOTPRINT);
  const s = [];
  s.push(mk(L.id, 'KIT', 'kitchen', clip(rect(CORE.u0, -BIG, CORE.u1, CORE.v0)), { name: 'مطبخ المقهى', doors: [{ at: [8.8, CORE.v0], w: 0.9 }] }));
  s.push(...coreSpaces(L.id, clip));
  s.push(mk(L.id, 'CAFE', 'cafe', clip([[-BIG, -BIG], [CORE.u0, -BIG], [CORE.u0, HALL.v0], [HALL.u1, HALL.v0], [HALL.u1, HALL.v1], [-BIG, HALL.v1]]), {
    name: 'صالة المقهى الداخلية',
    meta: { note: 'واجهات زجاجية بالكامل مع بار وطاولات، تتصل مباشرة بالتراس' },
  }));
  s.push(mk(L.id, 'WC', 'wc', clip([[CORE.u1, 6.5], [BIG, 6.5], [BIG, HALL.v1], [HALL.u1, HALL.v1], [HALL.u1, HALL.v0], [CORE.u1, HALL.v0]]), {
    name: 'حمامات المقهى', doors: [{ at: [HALL.u1, (HALL.v0 + HALL.v1) / 2], w: 0.9 }],
  }));
  s.push(mk(L.id, 'TECH', 'tech', clip(rect(CORE.u1, -BIG, BIG, 6.5)), { name: 'منطقة تقنية: خزانات مياه + طاقة شمسية' }));
  s.push(mk(L.id, 'TERR', 'terrace', bottomRegion(clip), { name: 'تراس المقهى المفتوح', meta: { note: 'جلسات خارجية مع برغولا وإطلالة على تقاطع الطريقين' } }));
  return { outline: FOOTPRINT, spaces: s.filter(Boolean) };
}

/* ---------------- doors, facades, orientation ---------------- */
const WINDS = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
const EAST = [-NORTH[1], NORTH[0]];
export function bearingOf(n) {
  const b = (Math.atan2(n[0] * EAST[0] + n[1] * EAST[1], n[0] * NORTH[0] + n[1] * NORTH[1]) * 180) / Math.PI;
  return (b + 360) % 360;
}
export const windName = (deg) => WINDS[Math.round(deg / 45) % 8];

const SIDE_NAMES = {
  internalRoad: 'الطريق الداخلي (ضلع 13.54 م)',
  roadA: 'الطريق (ضلع 26.24 م)',
  roadB: 'الطريق (ضلع 23.99 م)',
  corner: 'زاوية التقاطع',
  shared: 'الحد المشترك مع 2310/3',
};
/** which parcel side does an outline edge face? */
function sideFacing(a, b) {
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let best = null, bd = Infinity;
  PARCEL.forEach((p, i) => {
    const q = PARCEL[(i + 1) % PARCEL.length];
    const d = pointSegDist(m, p, q);
    if (d < bd) { bd = d; best = sideOfEdge(i); }
  });
  return best;
}

/** segments of a space lying on the level outline */
function facadeSegments(space, outline) {
  const out = [];
  for (const e of edges(space.polygon)) {
    for (const f of edges(outline)) {
      const s = sharedSegment(f, e);
      if (s) {
        const shared = isSharedEdge(f[0], f[1]);
        const L = dist(f[0], f[1]);
        const n = [(f[1][1] - f[0][1]) / L, -(f[1][0] - f[0][0]) / L]; // outward for CCW outline
        out.push({ a: s[0], b: s[1], length: dist(s[0], s[1]), shared, normal: n, side: shared ? 'shared' : sideFacing(f[0], f[1]) });
      }
    }
  }
  return out;
}

/** door from a unit to the adjacent circulation space */
function autoDoor(space, access, w = 0.9) {
  let best = null;
  for (const e of edges(space.polygon)) for (const f of edges(access.polygon)) {
    const s = sharedSegment(e, f);
    if (s && (!best || dist(s[0], s[1]) > dist(best[0], best[1]))) best = s;
  }
  if (!best || dist(best[0], best[1]) < w + 0.2) return null;
  // keep the door near the end of the shared wall closest to the access-space centre
  const c = centroid(access.polygon);
  const [p, q] = dist(best[0], c) < dist(best[1], c) ? best : [best[1], best[0]];
  const L = dist(p, q);
  const t = Math.min(0.5, (w / 2 + 0.25) / L);
  return { at: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], w };
}

function balconyFor(space, segs) {
  const cand = segs.filter((s) => !s.shared).sort((a, b) => b.length - a.length)[0];
  if (!cand || cand.length < 2.4) return null;
  const len = Math.min(cand.length - 0.8, 5.2);
  const t0 = (cand.length - len) / 2;
  const u = [(cand.b[0] - cand.a[0]) / cand.length, (cand.b[1] - cand.a[1]) / cand.length];
  const p0 = [cand.a[0] + u[0] * t0, cand.a[1] + u[1] * t0];
  const p1 = [p0[0] + u[0] * len, p0[1] + u[1] * len];
  const n = cand.normal;
  const d = BALCONY_DEPTH;
  const poly = clipConvex([p0, p1, [p1[0] + n[0] * d, p1[1] + n[1] * d], [p0[0] + n[0] * d, p0[1] + n[1] * d]], BALCONY_LIMIT);
  if (!poly) return null;
  return { polygon: poly, area: area(poly), a: p0, b: p1, normal: n };
}

function enrich(level, data) {
  const access = data.spaces.filter((s) => ['corridor', 'lobby'].includes(s.type) && !s.overlay && s.kind === 'open');
  const cafeHall = data.spaces.find((s) => s.type === 'cafe');
  for (const sp of data.spaces) {
    if (sp.overlay) continue;
    sp.facades = facadeSegments(sp, data.outline);
    // doors for units opening on a corridor / lobby
    if (sp.doors.length === 0 && ['studio', 'office'].includes(sp.type)) {
      for (const a of access) {
        const d = autoDoor(sp, a, sp.type === 'office' ? 1.0 : 0.9);
        if (d) { sp.doors.push(d); break; }
      }
    }
    if (sp.type === 'lobby' && sp.code === 'LOBBY' && cafeHall) sp.kind = 'open';
    const open = sp.facades.filter((f) => !f.shared).sort((a, b) => b.length - a.length);
    if (open.length) {
      const deg = bearingOf(open[0].normal);
      sp.meta.orientation = windName(deg);
      sp.meta.bearing = Math.round(deg);
      sp.meta.views = [...new Set(open.map((f) => SIDE_NAMES[f.side]).filter(Boolean))];
      sp.meta.frontage = +open.reduce((s, f) => s + f.length, 0).toFixed(2);
    }
    if (sp.type === 'studio') {
      sp.balcony = balconyFor(sp, sp.facades);
      sp.meta.corner = sp.facades.some((f) => f.side === 'corner');
    }
    if (sp.type === 'shop') sp.meta.corner = sp.facades.some((f) => f.side === 'corner');
  }
}

/* ---------------- assemble ---------------- */
let cache = null;
export function buildProgram() {
  if (cache) return cache;
  const levels = [];
  let residentialTemplate = null;
  for (const L of LEVELS) {
    let data;
    if (L.use === 'parking') data = parkingLevel(L);
    else if (L.use === 'commercial') data = groundLevel(L);
    else if (L.use === 'offices') data = standardFloor(L, 'offices');
    else if (L.use === 'residential') data = standardFloor(L, 'residential');
    else data = roofLevel(L);
    enrich(L, data);
    // furniture & inner rooms (identical residential floors share one computation)
    if (L.use === 'residential' && residentialTemplate) {
      data.spaces.forEach((sp, i) => { sp.interior = residentialTemplate[i]; });
    } else {
      data.spaces.forEach((sp) => { sp.interior = furnish(sp, data); });
      if (L.use === 'residential') residentialTemplate = data.spaces.map((sp) => sp.interior);
    }
    levels.push({ ...L, ...data });
  }
  const spaces = levels.flatMap((l) => l.spaces);
  cache = { levels, spaces, byId: Object.fromEntries(spaces.map((s) => [s.id, s])) };
  return cache;
}

/** summary numbers for the schedule */
export function summarize(program) {
  const units = program.spaces.filter((s) => s.kind === 'unit');
  const by = (t) => units.filter((s) => s.type === t);
  const sum = (arr, f = (s) => s.area) => arr.reduce((a, s) => a + f(s), 0);
  const gross = program.levels.map((l) => ({ id: l.id, name: l.name, gross: area(l.outline) }));
  return {
    studios: by('studio'), shops: by('shop'), offices: by('office'), parking: by('parking'),
    studioArea: sum(by('studio')), balconyArea: sum(by('studio'), (s) => s.balcony?.area || 0),
    shopArea: sum(by('shop')), officeArea: sum(by('office')),
    gross, grossTotal: gross.reduce((a, g) => a + g.gross, 0),
    grossAbove: gross.filter((g) => !g.id.startsWith('B')).reduce((a, g) => a + g.gross, 0),
  };
}
