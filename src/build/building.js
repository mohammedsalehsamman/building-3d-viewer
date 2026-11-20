// Turns the space program into three.js geometry: one group per level.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { M, clipPlanes } from './materials.js';
import { Batch } from './batch.js';
import { SLAB, WALL, RAMP, CORE, PARCEL, BASEMENT } from '../config/site.js';
import { typeOf } from '../program/types.js';
import { edges, dist, pointSegDist, clipConvex, rect, signedArea, bbox, contains } from '../geometry/polygon.js';

const PH = 0.08;          // half partition thickness (each side draws its half)
const DOOR_H = 2.1;

/* ---------- geometry helpers ---------- */
export function shapeOf(poly) {
  const s = new THREE.Shape();
  poly.forEach(([u, v], i) => (i ? s.lineTo(u, -v) : s.moveTo(u, -v)));
  s.closePath();
  return s;
}
/** prism occupying y ∈ [y0, y0 + depth] */
export function extrudePoly(poly, depth, y0 = 0) {
  const g = new THREE.ExtrudeGeometry(shapeOf(poly), { depth, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  return g;
}
export function flatPoly(poly, y = 0) {
  const g = new THREE.ShapeGeometry(shapeOf(poly));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}
const ccw = (p) => (signedArea(p) < 0 ? p.slice().reverse() : p);
const proj = (a, b, p) => {
  const L = dist(a, b);
  return ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L;
};
const onSeg = (p, a, b, tol = 0.06) => pointSegDist(p, a, b) < tol;

/** a point well inside a polygon (for labels) */
export function labelPoint(poly) {
  const b = bbox(poly);
  let best = null, bd = -1;
  const n = 14;
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
    const p = [b.x0 + (b.w * i) / n, b.y0 + (b.h * j) / n];
    if (!contains(poly, p)) continue;
    const d = Math.min(...edges(poly).map(([a, c]) => pointSegDist(p, a, c)));
    if (d > bd) { bd = d; best = p; }
  }
  return best || poly[0];
}

/** clip the infinite line p + t·d against a convex polygon → [p0, p1] or null */
function clipLine(poly, p, d) {
  let t0 = -1e6, t1 = 1e6;
  const P = ccw(poly);
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const n = [-(b[1] - a[1]), b[0] - a[0]]; // inward
    const num = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
    const den = d[0] * n[0] + d[1] * n[1];
    if (Math.abs(den) < 1e-12) { if (num < 0) return null; continue; }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
  }
  return t1 > t0 ? [[p[0] + d[0] * t0, p[1] + d[1] * t0], [p[0] + d[0] * t1, p[1] + d[1] * t1]] : null;
}

/* ---------- facades ---------- */
function facadeStyle(level, sp, f) {
  if (f.shared) return 'solid';
  if (level.use === 'parking') return 'basement';
  if (level.use === 'roof') return { terrace: 'railing', tech: 'parapet', cafe: 'curtain', kitchen: 'small', wc: 'small' }[sp.type] || 'solid';
  return sp.facade || typeOf(sp.type).facade;
}

function buildFacades(level, batch, H, ctx) {
  const outline = ccw(level.outline);
  let signIdx = 0;
  for (const [a, b] of edges(outline)) {
    const L = dist(a, b);
    const segs = [];
    for (const sp of level.spaces) {
      if (sp.overlay) continue;
      for (const f of sp.facades || []) {
        if (!onSeg(f.a, a, b) || !onSeg(f.b, a, b)) continue;
        let t0 = proj(a, b, f.a), t1 = proj(a, b, f.b);
        if (t0 > t1) [t0, t1] = [t1, t0];
        segs.push({ t0: Math.max(0, t0), t1: Math.min(L, t1), sp, style: facadeStyle(level, sp, f) });
      }
    }
    segs.sort((x, y) => x.t0 - y.t0);
    // fill gaps with solid wall
    const all = [];
    let cur = 0;
    for (const s of segs) {
      if (s.t0 > cur + 0.02) all.push({ t0: cur, t1: s.t0, style: level.use === 'parking' ? 'basement' : 'solid' });
      all.push(s);
      cur = Math.max(cur, s.t1);
    }
    if (cur < L - 0.02) all.push({ t0: cur, t1: L, style: level.use === 'parking' ? 'basement' : 'solid' });
    for (const s of all) facadePiece(batch, a, b, s, H, level, ctx, s.style === 'storefront' ? signIdx++ : 0);
  }
}

function facadePiece(batch, a, b, s, H, level, ctx, signIdx) {
  const { t0, t1, style, sp } = s;
  const len = t1 - t0;
  const W = (s0, s1, y0, y1, m = M.facade, thick = WALL, off = WALL / 2) => batch.segment(m, a, b, y0, y1, thick, off, s0, s1);
  const G = (s0, s1, y0, y1) => batch.segment(M.glass, a, b, y0, y1, 0.03, WALL / 2, s0, s1);
  const Fr = (t, y0, y1, w = 0.06) => batch.segment(M.frame, a, b, y0, y1, 0.1, WALL / 2, t - w / 2, t + w / 2);
  const Hbar = (s0, s1, y, h = 0.06) => batch.segment(M.frame, a, b, y - h / 2, y + h / 2, 0.1, WALL / 2, s0, s1);
  const openingWall = (ops) => {
    ops.sort((x, y) => x.c - y.c);
    let c = t0;
    for (const op of ops) {
      const l = Math.max(t0, op.c - op.w / 2), r = Math.min(t1, op.c + op.w / 2);
      W(c, l, 0, H);
      if (op.sill > 0) W(l, r, 0, op.sill);
      W(l, r, op.head, H);
      if (op.kind === 'steel') batch.segment(M.steelDoor, a, b, 0, op.head, 0.06, WALL / 2, l + 0.03, r - 0.03);
      else {
        G(l, r, op.sill, op.head);
        Fr(l + 0.03, op.sill, op.head); Fr(r - 0.03, op.sill, op.head); Fr((l + r) / 2, op.sill, op.head, 0.04);
        Hbar(l, r, op.sill + 0.03); Hbar(l, r, op.head - 0.03);
      }
      c = r;
    }
    W(c, t1, 0, H);
  };

  switch (style) {
    case 'basement': W(t0, t1, 0, H, M.basementWall, 0.3, 0.15); break;
    case 'solid': W(t0, t1, 0, H); break;
    case 'parapet': W(t0, t1, 0, 1.2); break;
    case 'railing':
      W(t0, t1, 0, 0.18, M.facadeAccent, 0.3, 0.15);
      batch.segment(M.railGlass, a, b, 0.18, 1.1, 0.03, 0.15, t0, t1);
      batch.segment(M.frame, a, b, 1.08, 1.14, 0.08, 0.15, t0, t1);
      break;
    case 'opening':
      W(t0, t0 + 0.3, 0, H); W(t1 - 0.3, t1, 0, H); W(t0 + 0.3, t1 - 0.3, 2.9, H, M.facadeAccent);
      break;
    case 'door':
      if (len > 1.4) openingWall([{ c: (t0 + t1) / 2, w: 1.0, sill: 0, head: 2.2, kind: 'steel' }]); else W(t0, t1, 0, H);
      break;
    case 'small':
      if (len > 1.4) openingWall([{ c: (t0 + t1) / 2, w: Math.min(1.0, len - 0.6), sill: 1.5, head: 2.2 }]); else W(t0, t1, 0, H);
      break;
    case 'curtain': {
      G(t0, t1, 0, H);
      for (let t = t0; t <= t1 + 1e-6; t += Math.max(0.9, len / Math.max(1, Math.round(len / 1.25)))) Fr(Math.min(t, t1 - 0.03), 0, H);
      Hbar(t0, t1, 0.05, 0.1); Hbar(t0, t1, 2.5); Hbar(t0, t1, H - 0.05, 0.1);
      break;
    }
    case 'ribbon': {
      W(t0, t1, 0, 0.9); W(t0, t1, 3.0, H, M.facadeAccent);
      if (len > 0.8) {
        W(t0, t0 + 0.2, 0.9, 3.0); W(t1 - 0.2, t1, 0.9, 3.0);
        G(t0 + 0.2, t1 - 0.2, 0.9, 3.0);
        const n = Math.max(1, Math.round((len - 0.4) / 1.5));
        for (let i = 0; i <= n; i++) Fr(t0 + 0.2 + ((len - 0.4) * i) / n, 0.9, 3.0);
        Hbar(t0, t1, 0.92); Hbar(t0, t1, 2.98);
      }
      break;
    }
    case 'storefront': {
      const head = 3.4;
      if (len < 1.2) { W(t0, t1, 0, H); break; }
      W(t0, t0 + 0.25, 0, H, M.facadeAccent); W(t1 - 0.25, t1, 0, H, M.facadeAccent);
      G(t0 + 0.25, t1 - 0.25, 0, head);
      const n = Math.max(1, Math.round((len - 0.5) / 2.0));
      for (let i = 0; i <= n; i++) Fr(t0 + 0.25 + ((len - 0.5) * i) / n, 0, head);
      Hbar(t0 + 0.25, t1 - 0.25, head - 0.03, 0.08); Hbar(t0 + 0.25, t1 - 0.25, 2.5);
      const isShop = sp?.type === 'shop';
      batch.segment(isShop ? M.signs[signIdx % M.signs.length] : M.frame, a, b, head, Math.min(H, head + 0.6), 0.32, WALL / 2 - 0.05, t0 + 0.25, t1 - 0.25);
      if (H > head + 0.6) W(t0 + 0.25, t1 - 0.25, head + 0.6, H, M.facadeAccent);
      // canopy
      batch.segment(M.canopy, a, b, head + 0.62, head + 0.74, 1.5, -0.7, t0, t1);
      break;
    }
    case 'window':
    default: {
      const bal = sp?.balcony && onSeg(sp.balcony.a, a, b) && onSeg(sp.balcony.b, a, b) ? sp.balcony : null;
      const ops = [];
      if (bal) {
        const c0 = proj(a, b, bal.a), c1 = proj(a, b, bal.b);
        const c = (c0 + c1) / 2, w = Math.min(2.6, Math.abs(c1 - c0) - 0.4);
        ops.push({ c, w, sill: 0, head: 2.45 });
        const lft = c - w / 2 - t0, rgt = t1 - (c + w / 2);
        if (lft > 2.6) ops.push({ c: t0 + lft / 2, w: 1.3, sill: 0.9, head: 2.3 });
        if (rgt > 2.6) ops.push({ c: c + w / 2 + rgt / 2, w: 1.3, sill: 0.9, head: 2.3 });
      } else if (len >= 1.8) {
        const n = Math.max(1, Math.floor(len / 3.0));
        for (let i = 0; i < n; i++) ops.push({ c: t0 + (len * (i + 0.5)) / n, w: Math.min(1.6, len / n - 0.6), sill: 0.9, head: 2.4 });
      }
      if (ops.length) openingWall(ops); else W(t0, t1, 0, H);
      break;
    }
  }
}

/* ---------- partitions, doors, inner rooms ---------- */
function onOutline(p, outline) {
  for (const [a, b] of edges(outline)) if (pointSegDist(p, a, b) < 0.05) return true;
  return false;
}

function wallWithDoors(batch, a, b, H, doors, material, thick, off) {
  const L = dist(a, b);
  const ops = doors
    .filter((d) => onSeg(d.at, a, b, 0.08))
    .map((d) => ({ c: proj(a, b, d.at), w: d.w, h: d.h || DOOR_H, lift: d.lift }))
    .sort((x, y) => x.c - y.c);
  let c = 0;
  for (const op of ops) {
    const l = Math.max(0, op.c - op.w / 2), r = Math.min(L, op.c + op.w / 2);
    batch.segment(material, a, b, 0, H, thick, off, c, l);
    batch.segment(material, a, b, op.h, H, thick, off, l, r);
    const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
    if (op.lift) {
      batch.segment(M.steelDoor, a, b, 0, op.h, 0.05, off, l, r);
    } else if (op.w <= 1.3) {
      // open door leaf, hinged at the left jamb, swung into the room (left normal)
      const hx = a[0] + dx * l - dy * (off + thick / 2), hy = a[1] + dy * l + dx * (off + thick / 2);
      const nx = -dy, ny = dx;
      const w = op.w - 0.05;
      batch.box(M.door, hx + nx * (w / 2), hy + ny * (w / 2), 0, w, 2.04, 0.04, Math.atan2(ny, nx));
    }
    c = r;
  }
  batch.segment(material, a, b, 0, H, thick, off, c, L);
}

function buildPartitions(level, batch, H) {
  const outline = level.outline;
  for (const sp of level.spaces) {
    if (sp.overlay || sp.kind === 'open') continue;
    const poly = ccw(sp.polygon);
    const doors = sp.doors.map((d) => ({ ...d, lift: sp.type === 'lift' }));
    for (const [a, b] of edges(poly)) {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (onOutline(a, outline) && onOutline(b, outline) && onOutline(m, outline)) continue;
      if (dist(a, b) < 0.05) continue;
      wallWithDoors(batch, a, b, H, doors, sp.type === 'lift' || sp.type === 'stair' ? M.facade : M.partition, PH, PH / 2);
    }
    // doors of open spaces' neighbours are drawn by the enclosed side
    for (const room of sp.interior?.rooms || []) {
      const rp = ccw(room.polygon);
      for (const [a, b] of edges(rp)) {
        if (room.back && ((dist(a, room.back[0]) < 0.01 && dist(b, room.back[1]) < 0.01) || (dist(a, room.back[1]) < 0.01 && dist(b, room.back[0]) < 0.01))) continue;
        wallWithDoors(batch, a, b, H, [room.door], M.bathWall, 0.1, -0.05);
      }
    }
  }
}

/* ---------- stairs ---------- */
function buildStair(level, sp, batch, rise) {
  const b = bbox(sp.polygon);
  const u0 = b.x0 + PH, u1 = b.x1 - PH, v0 = b.y0 + PH, v1 = b.y1 - PH;
  const um = (u0 + u1) / 2;
  const land = 1.25;
  const run = v1 - v0 - 2 * land;
  const n = Math.max(2, Math.round(rise / 0.175));
  const n1 = Math.ceil(n / 2), n2 = n - n1;
  const r = rise / n;
  const g1 = run / n1, g2 = run / n2;
  // flight 1: left half, going towards v0
  for (let i = 1; i <= n1; i++) {
    const top = i * r;
    const vs = v1 - land - i * g1;
    batch.box(M.stair, (u0 + um - 0.05) / 2, vs + g1 / 2, Math.max(0, top - 0.3), um - 0.05 - u0, Math.min(0.3, top), g1 + 0.02);
  }
  // mid landing
  batch.box(M.stair, (u0 + u1) / 2, v0 + land / 2, n1 * r - 0.25, u1 - u0, 0.25, land);
  // flight 2: right half, going towards v1
  for (let j = 1; j <= n2; j++) {
    const top = n1 * r + j * r;
    const vs = v0 + land + (j - 1) * g2;
    batch.box(M.stair, (um + 0.05 + u1) / 2, vs + g2 / 2, top - 0.3, u1 - um - 0.05, 0.3, g2 + 0.02);
  }
  // spine wall between the two flights
  batch.box(M.partition, um, (v0 + land + v1 - land) / 2, 0, 0.1, rise, run);
}

/* ---------- ramps (sloped slabs) ---------- */
function rampMesh(poly, yAt) {
  const pieces = [[-80, 0], [0, RAMP.uEnd], [RAMP.uEnd, 80]]
    .map(([x0, x1]) => clipConvex(rect(x0, -80, x1, 80), poly))
    .filter(Boolean);
  const geoms = pieces.map((p) => {
    const g = extrudePoly(p, 0.25, -0.25);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + yAt(pos.getX(i)));
    g.computeVertexNormals();
    return g;
  });
  const mesh = new THREE.Mesh(mergeGeometries(geoms), M.ramp);
  mesh.receiveShadow = true; mesh.castShadow = true;
  return mesh;
}
function rampHeight(u, drop) {
  if (u <= RAMP.uStart) return drop;
  if (u >= RAMP.uEnd) return 0;
  return drop * (1 - (u - RAMP.uStart) / (RAMP.uEnd - RAMP.uStart));
}

/* ---------- labels ---------- */
function makeLabel(sp) {
  const div = document.createElement('div');
  div.className = `lbl lbl-${sp.kind} lbl-t-${sp.type}`;
  const name = sp.type === 'parking' ? sp.code : sp.type === 'studio' ? sp.code : sp.name;
  div.innerHTML = `<b>${name}</b>${sp.kind === 'unit' || sp.area > 12 ? `<span>${sp.area.toFixed(1)} م²</span>` : ''}`;
  div.dataset.spaceId = sp.id;
  const obj = new CSS2DObject(div);
  const p = labelPoint(sp.polygon);
  obj.position.set(p[0], sp.type === 'parking' ? 0.3 : 1.3, p[1]);
  obj.userData.spaceId = sp.id;
  return obj;
}

/* ---------- level ---------- */
export function fillColor(sp) {
  return typeOf(sp.type).color;
}

function buildLevel(level, levels, idx) {
  const group = new THREE.Group();
  group.name = level.id;
  group.userData = { levelId: level.id, baseY: level.elev };
  group.position.y = level.elev;
  const next = levels[idx + 1];
  const rise = next ? next.elev - level.elev : level.height;
  const H = rise - SLAB;
  const isRoof = level.use === 'roof';
  const wallH = isRoof ? level.height - SLAB : H;

  const shell = new Batch();     // facades + slabs edges + structure (pick → level)
  const inner = new Batch();     // partitions, doors, stairs
  const furn = new Batch();      // furniture (instance colours)

  // slabs
  const slabGeoms = [];
  for (const sp of level.spaces) {
    if (sp.overlay) continue;
    if (sp.type === 'ramp' && level.id !== 'B2') continue;
    if ((sp.type === 'lift' || (sp.type === 'shaft' && sp.code === 'SHAFT')) && level.id !== 'B2') continue;
    let poly = sp.polygon;
    if (sp.type === 'stair' && level.id !== 'B2') {
      const b = bbox(poly);
      poly = clipConvex(rect(b.x0, b.y1 - 1.25, b.x1, b.y1), poly) || poly;
    }
    slabGeoms.push(extrudePoly(poly, level.id === 'B2' ? 0.5 : SLAB, level.id === 'B2' ? -0.5 : -SLAB));
  }
  for (const sp of level.spaces) if (sp.balcony) slabGeoms.push(extrudePoly(sp.balcony.polygon, 0.2, -0.2));
  const slab = new THREE.Mesh(mergeGeometries(slabGeoms), M.slab);
  slab.receiveShadow = true; slab.castShadow = true;
  slab.userData = { levelId: level.id, part: 'slab' };
  group.add(slab);

  // floor fills (pickable, coloured by use)
  const fills = new Map();
  const fillGroup = new THREE.Group();
  for (const sp of level.spaces) {
    if (sp.type === 'ramp' && level.id !== 'B2') continue;
    const m = new THREE.MeshStandardMaterial({ color: fillColor(sp), roughness: 0.9, transparent: false, polygonOffset: true, polygonOffsetFactor: -1 });
    m.userData.base = fillColor(sp);
    m.clippingPlanes = clipPlanes;
    const mesh = new THREE.Mesh(flatPoly(sp.polygon, sp.overlay ? 0.025 : 0.012), m);
    mesh.receiveShadow = true;
    mesh.userData = { spaceId: sp.id, levelId: level.id };
    fills.set(sp.id, mesh);
    fillGroup.add(mesh);
    if (sp.type === 'parking') {
      const b = bbox(sp.polygon);
      const long = b.w > b.h ? 'u' : 'v';
      const y = 0.03, t = 0.1;
      if (long === 'v') {
        shell.box(M.stripe, b.x0 + t / 2, (b.y0 + b.y1) / 2, y, t, 0.01, b.h);
        shell.box(M.stripe, b.x1 - t / 2, (b.y0 + b.y1) / 2, y, t, 0.01, b.h);
      } else {
        shell.box(M.stripe, (b.x0 + b.x1) / 2, b.y0 + t / 2, y, b.w, 0.01, t);
        shell.box(M.stripe, (b.x0 + b.x1) / 2, b.y1 - t / 2, y, b.w, 0.01, t);
      }
    }
  }
  group.add(fillGroup);

  buildFacades(level, shell, wallH, {});
  buildPartitions(level, inner, wallH);

  // balconies: railings on the outer edges
  for (const sp of level.spaces) {
    if (!sp.balcony) continue;
    const bp = ccw(sp.balcony.polygon);
    for (const [a, b] of edges(bp)) {
      if (onSeg(a, sp.balcony.a, sp.balcony.b, 0.05) && onSeg(b, sp.balcony.a, sp.balcony.b, 0.05)) continue;
      shell.segment(M.railGlass, a, b, 0.05, 1.1, 0.03, 0.05);
      shell.segment(M.frame, a, b, 1.08, 1.14, 0.06, 0.05);
    }
  }

  // stairs, lift cars, special parts
  for (const sp of level.spaces) {
    if (sp.type === 'stair' && !isRoof) buildStair(level, sp, inner, rise);
    if (sp.type === 'lift' && ((sp.code === 'LIFT1' && level.id === 'GF') || (sp.code === 'LIFT2' && level.id === 'F4'))) {
      const b = bbox(sp.polygon);
      inner.box(M.steelDoor, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0.05, b.w - 0.5, 2.3, b.h - 0.5);
    }
  }

  // furniture & fixtures
  for (const sp of level.spaces) {
    for (const it of sp.interior?.items || []) {
      if (it.shape === 'cyl') furn.cyl(M.furniture, it.c[0], it.c[1], it.z, it.w, it.h, it.d, it.rot, it.color);
      else if (it.shape === 'wheel') furn.wheel(M.furniture, it.c[0], it.c[1], it.z, it.w, it.h, it.rot, it.color);
      else furn.box(M.furniture, it.c[0], it.c[1], it.z, it.w, it.h, it.d, it.rot, it.color);
    }
  }

  // ramps
  if (level.id === 'B1') {
    const poly = clipConvex(rect(-60, RAMP.v0, BASEMENT_RIGHT(), RAMP.v1), PARCEL);
    group.add(tagged(rampMesh(poly, (u) => rampHeight(u, 3.1)), level.id));
  }
  if (level.id === 'B2') {
    const poly = clipConvex(rect(-60, RAMP.v0, BASEMENT_RIGHT(), RAMP.v1), BASEMENT);
    group.add(tagged(rampMesh(poly, (u) => rampHeight(u, 3.1)), level.id));
  }
  if (level.id === 'GF') {
    // parapets beside the open-air part of the ramp
    const out = clipConvex(rect(-60, RAMP.v0, 3, RAMP.v1), PARCEL);
    if (out) {
      const b = bbox(out);
      shell.box(M.facadeAccent, (b.x0 + b.x1) / 2 + 0.5, RAMP.v1 - 0.1, -0.8, b.w + 1, 1.9, 0.2);
    }
  }

  // roof: caps over the enclosed café parts, lift overrun, pergola
  if (isRoof) {
    const caps = level.spaces.filter((s) => ['cafe', 'kitchen', 'wc', 'lift', 'stair', 'shaft', 'lobby'].includes(s.type));
    const capMesh = new THREE.Mesh(mergeGeometries(caps.map((s) => extrudePoly(s.polygon, SLAB + 0.15, level.height - SLAB))), M.roofCap);
    capMesh.castShadow = capMesh.receiveShadow = true;
    capMesh.userData = { levelId: level.id, part: 'cap' };
    group.add(capMesh);
    shell.box(M.facade, (CORE.u0 + 11.6) / 2, (CORE.v0 + 6.0) / 2, level.height, 11.6 - CORE.u0, 1.5, 6.0 - CORE.v0);
    const terr = level.spaces.find((s) => s.type === 'terrace');
    if (terr) {
      const zone = clipConvex(rect(-80, terr.polygon.reduce((m, p) => Math.min(m, p[1]), 99), 80, 15.8), terr.polygon);
      if (zone) {
        const b = bbox(zone);
        for (let u = b.x0 + 0.4; u < b.x1; u += 3.0) {
          const seg = clipLine(zone, [u, 0], [0, 1]);
          if (!seg) continue;
          const [p0, p1] = seg;
          if (dist(p0, p1) < 1) continue;
          shell.segment(M.pergola, p0, p1, 2.8, 3.05, 0.16);
          shell.box(M.pergola, p1[0], p1[1] - 0.15, 0, 0.16, 2.8, 0.16);
        }
        for (let v = b.y0 + 0.3; v < b.y1; v += 0.5) {
          const seg = clipLine(zone, [0, v], [1, 0]);
          if (seg && dist(seg[0], seg[1]) > 0.5) shell.segment(M.pergola, seg[0], seg[1], 3.05, 3.2, 0.06);
        }
      }
    }
  }

  const shellGroup = shell.build({ userData: { levelId: level.id, part: 'shell' } });
  const innerGroup = inner.build({ userData: { levelId: level.id, part: 'inner' } });
  const furnGroup = furn.build({ userData: { levelId: level.id, part: 'furniture' } });
  furnGroup.name = 'furniture';
  group.add(shellGroup, innerGroup, furnGroup);

  // labels
  const labels = new THREE.Group();
  labels.name = 'labels';
  for (const sp of level.spaces) {
    if (sp.type === 'drive' && sp.area < 100) continue;
    if (sp.kind === 'unit' || sp.area > 9) labels.add(makeLabel(sp));
  }
  labels.visible = false;
  group.add(labels);

  return { group, fills, labels, furniture: furnGroup, level };
}
const BASEMENT_RIGHT = () => Math.max(...BASEMENT.map((p) => p[0])) - 0.1;
function tagged(mesh, levelId) { mesh.userData = { levelId, part: 'ramp' }; return mesh; }

export function buildBuilding(program) {
  const root = new THREE.Group();
  root.name = 'building';
  const levels = new Map();
  program.levels.forEach((L, i) => {
    const built = buildLevel(L, program.levels, i);
    levels.set(L.id, built);
    root.add(built.group);
  });
  return { root, levels };
}
