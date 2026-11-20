// 2D polygon helpers. A polygon is an array of [x, y] points (no repeated closing point).
import polygonClipping from 'polygon-clipping';

export function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const area = (poly) => Math.abs(signedArea(poly));
export const ensureCCW = (poly) => (signedArea(poly) < 0 ? poly.slice().reverse() : poly.slice());

export function centroid(poly) {
  let cx = 0, cy = 0, A = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const c = a[0] * b[1] - b[0] * a[1];
    A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
  }
  if (Math.abs(A) < 1e-9) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * A), cy / (3 * A)];
}

export function bbox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function lineIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

/**
 * Inset a convex polygon: edge i (poly[i] → poly[i+1]) moves inward by d[i].
 * Negative d moves outward.
 */
export function insetPolygon(poly, d) {
  const flipped = signedArea(poly) < 0;
  const P = flipped ? poly.slice().reverse() : poly.slice();
  const n = P.length;
  const dd = flipped ? reverseEdgeValues(d, n) : d;
  // exact for convex polygons: intersection of the shifted half-planes
  const b = bbox(P);
  const m = 50;
  let out = rect(b.x0 - m, b.y0 - m, b.x1 + m, b.y1 + m);
  for (let i = 0; i < n; i++) {
    const a = P[i], c = P[(i + 1) % n];
    const L = dist(a, c);
    if (L < 1e-6) continue;
    const nx = -(c[1] - a[1]) / L, ny = (c[0] - a[0]) / L; // left normal = inward for CCW
    const k = typeof dd === 'number' ? dd : dd[i];
    out = clipHalfPlane(out, [a[0] + nx * k, a[1] + ny * k], [nx, ny]);
    if (out.length < 3) return [];
  }
  return simplify(out, 0.01);
}

/** Sutherland–Hodgman: keep the part of poly where (p - o)·n >= 0 */
export function clipHalfPlane(poly, o, n) {
  const side = (p) => (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1];
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(a), sb = side(b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}
// when a polygon is reversed, edge i becomes edge n-2-i (mod n)
function reverseEdgeValues(d, n) {
  if (typeof d === 'number') return d;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[(n - 2 - i + n) % n] = d[i];
  return out;
}

export function simplify(poly, eps = 1e-4) {
  const out = [];
  for (const p of poly) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > eps) out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) < eps) out.pop();
  return out;
}

// ---- boolean ops (polygon-clipping works with [[ring]] geometries) ----
const toGeom = (p) => [[...p, p[0]]];
function fromResult(res) {
  // return the largest outer ring of a MultiPolygon result
  let best = null, bestA = 0;
  for (const poly of res) {
    const ring = poly[0].slice(0, -1);
    const a = area(ring);
    if (a > bestA) { bestA = a; best = ring; }
  }
  return best ? simplify(best) : null;
}
/** subject (may be concave) ∩ clip (must be convex) — exact Sutherland–Hodgman */
export function clipConvex(subject, clip) {
  const C = ensureCCW(clip);
  let out = subject.slice();
  for (let i = 0; i < C.length && out.length >= 3; i++) {
    const a = C[i], b = C[(i + 1) % C.length];
    const L = dist(a, b);
    if (L < 1e-9) continue;
    out = clipHalfPlane(out, a, [-(b[1] - a[1]) / L, (b[0] - a[0]) / L]);
  }
  out = simplify(out, 1e-3);
  return out.length >= 3 && area(out) > 1e-4 ? out : null;
}
export function intersect(a, ...others) {
  // try exact convex clipping first, fall back to the general boolean library
  if (others.length === 1 && isConvex(others[0])) return clipConvex(a, others[0]);
  if (others.length === 1 && isConvex(a)) return clipConvex(others[0], a);
  try { return fromResult(polygonClipping.intersection(toGeom(a), ...others.map(toGeom))); } catch { return null; }
}
export function isConvex(poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = poly[(i + 2) % poly.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-9) continue;
    if (sign === 0) sign = Math.sign(cr);
    else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}
export function difference(a, ...others) {
  try { return fromResult(polygonClipping.difference(toGeom(a), ...others.map(toGeom))); } catch { return a; }
}
export function differenceAll(a, ...others) {
  try {
    return polygonClipping.difference(toGeom(a), ...others.map(toGeom)).map((p) => simplify(p[0].slice(0, -1)));
  } catch { return [a]; }
}
export function union(...polys) {
  try { return fromResult(polygonClipping.union(...polys.map(toGeom))); } catch { return polys[0]; }
}

export const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Is the point inside the polygon? */
export function contains(poly, [x, y]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon edges as segments [[a,b], ...] */
export const edges = (poly) => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

/** Shared portion of a segment that lies on (is collinear with and overlaps) another segment */
export function sharedSegment([a, b], [c, d], tol = 0.05) {
  const L = dist(a, b);
  if (L < 1e-6) return null;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const off = (p) => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux);
  if (off(c) > tol || off(d) > tol) return null;
  const t = (p) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
  const t0 = Math.max(0, Math.min(t(c), t(d))), t1 = Math.min(L, Math.max(t(c), t(d)));
  if (t1 - t0 < 0.05) return null;
  return [[a[0] + ux * t0, a[1] + uy * t0], [a[0] + ux * t1, a[1] + uy * t1]];
}

/** Distance from a point to a segment */
export function pointSegDist(p, a, b) {
  const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  let t = L2 ? ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
}

/** Half-plane clip: keep the side of line a→b to the left (CCW interior side) – as a big polygon */
export function halfPlane(a, b, size = 500) {
  const L = dist(a, b);
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  const nx = -uy, ny = ux;
  const p0 = [a[0] - ux * size, a[1] - uy * size], p1 = [a[0] + ux * size, a[1] + uy * size];
  return [p0, p1, [p1[0] + nx * size, p1[1] + ny * size], [p0[0] + nx * size, p0[1] + ny * size]];
}
