// "Fan" partition: split a convex region into n slices whose inner ends sit
// side by side along a base segment (a corridor wall), so every slice gets a
// piece of that wall for its door.  Rays may tilt past the base line
// (startPhi > π, endPhi < 0) so the end slices reach into the side wings.
import { area, clipConvex, lerp, clipHalfPlane } from '../geometry/polygon.js';

const R = 200;

function frame(region, a, b, inward = null) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  let nrm = [-t[1], t[0]];
  const c = region.reduce((s, p) => [s[0] + p[0] / region.length, s[1] + p[1] / region.length], [0, 0]);
  const mid = lerp(a, b, 0.5);
  const into = inward || [c[0] - mid[0], c[1] - mid[1]];
  if (into[0] * nrm[0] + into[1] * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
  const dir = (phi) => [Math.cos(phi) * t[0] + Math.sin(phi) * nrm[0], Math.cos(phi) * t[1] + Math.sin(phi) * nrm[1]];
  return { t, nrm, dir };
}

export const FAR = R;
/** unclipped wedge polygon: [p0, far(p0), mid, mid, far(p1), p1] */
export function wedgePoly(F, p0, phiA, p1, phiB) {
  const far = (p, phi) => { const d = F.dir(phi); return [p[0] + d[0] * R, p[1] + d[1] * R]; };
  const m = lerp(p0, p1, 0.5);
  return [p0, far(p0, phiA), far(m, (phiA * 2 + phiB) / 3), far(m, (phiA + phiB * 2) / 3), far(p1, phiB), p1];
}
function wedge(region, F, p0, phiA, p1, phiB) {
  return clipConvex(wedgePoly(F, p0, phiA, p1, phiB), region);
}

/**
 * The part of a side block lying outside the fan, cut by the ray from p at angle phi.
 * side = +1 for the ray at the start (a) end, −1 for the ray at the b end.
 */
export function outsideRay(block, region, a, b, p, phi, side, inward = null) {
  if (!block) return null;
  const F = frame(region, a, b, inward);
  const d = F.dir(phi);
  const n = [-d[1], d[0]];
  const probe = F.dir(phi + 0.3 * side); // a direction lying on the block's side
  const s = Math.sign(probe[0] * n[0] + probe[1] * n[1]) || 1;
  const out = clipHalfPlane(block, p, [n[0] * s, n[1] * s]);
  return out.length >= 3 ? out : null;
}

/**
 * @param region convex polygon
 * @param a,b    base segment (slices ordered from a to b)
 * @param n      number of slices
 * @param opts.startPhi / endPhi  ray angles at a and b (default π and 0)
 * @param opts.weights relative areas
 * @param opts.inward  direction pointing from the base into the fan
 */
export function fanPartition(region, a, b, n, { startPhi = Math.PI, endPhi = 0, weights = null, inward = null } = {}) {
  const F = frame(region, a, b, inward);
  const w = weights || Array(n).fill(1);
  const W = w.reduce((s, x) => s + x, 0);
  const anchors = Array.from({ length: n + 1 }, (_, k) => lerp(a, b, k / n));
  // total = sum of a fine sweep
  let total = 0;
  {
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const pa = lerp(a, b, i / steps), pb = lerp(a, b, (i + 1) / steps);
      const fa = startPhi + ((endPhi - startPhi) * i) / steps, fb = startPhi + ((endPhi - startPhi) * (i + 1)) / steps;
      const s = wedge(region, F, pa, fa, pb, fb);
      total += s ? area(s) : 0;
    }
  }
  const out = [];
  const phis = [startPhi];
  let prevPhi = startPhi;
  for (let k = 0; k < n; k++) {
    const p0 = anchors[k], p1 = anchors[k + 1];
    if (k === n - 1) { out.push(wedge(region, F, p0, prevPhi, p1, endPhi)); phis.push(endPhi); break; }
    const target = (total * w[k]) / W;
    let lo = endPhi, hi = prevPhi;
    for (let it = 0; it < 60; it++) {
      const mid = (lo + hi) / 2;
      const s = wedge(region, F, p0, prevPhi, p1, mid);
      const A = s ? area(s) : 0;
      if (A > target) lo = mid; else hi = mid;
    }
    const phi = (lo + hi) / 2;
    out.push(wedge(region, F, p0, prevPhi, p1, phi));
    phis.push(phi);
    prevPhi = phi;
  }
  return { slices: out, total, phis, anchors, F };
}

/** solve the tilt angle so that the side block keeps `target` m² */
export function solveTilt(blockFn, target, lo = 0, hi = 1.3) {
  // blockFn(beta) returns the remaining side block area, decreasing with beta
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (blockFn(mid) > target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
