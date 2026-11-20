// Collects thousands of boxes / cylinders and turns them into a few InstancedMeshes.
// Plan coordinates (u, v) map to three.js (x = u, z = v); y is up.
import * as THREE from 'three';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 18);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class Batch {
  constructor() { this.buckets = new Map(); }
  bucket(geom, material) {
    const key = geom.uuid + material.uuid;
    if (!this.buckets.has(key)) this.buckets.set(key, { geom, material, mats: [], cols: [] });
    return this.buckets.get(key);
  }
  /** box with its base at height y0 */
  box(material, u, v, y0, w, h, d, rot = 0, color = null) {
    if (w <= 1e-4 || h <= 1e-4 || d <= 1e-4) return;
    const b = this.bucket(BOX, material);
    _e.set(0, -rot, 0);
    b.mats.push(_m.compose(_p.set(u, y0 + h / 2, v), _q.setFromEuler(_e), _s.set(w, h, d)).clone());
    b.cols.push(color);
  }
  cyl(material, u, v, y0, w, h, d, rot = 0, color = null) {
    const b = this.bucket(CYL, material);
    _e.set(0, -rot, 0);
    b.mats.push(_m.compose(_p.set(u, y0 + h / 2, v), _q.setFromEuler(_e), _s.set(w, h, d)).clone());
    b.cols.push(color);
  }
  /** cylinder lying on its side, axis along the item's local x (wheels) */
  wheel(material, u, v, y0, width, diam, rot = 0, color = null) {
    const b = this.bucket(CYL, material);
    _e.set(0, -rot, Math.PI / 2, 'YXZ');
    b.mats.push(_m.compose(_p.set(u, y0 + diam / 2, v), _q.setFromEuler(_e), _s.set(diam, width, diam)).clone());
    b.cols.push(color);
  }
  /** wall-like box between plan points a and b, offset sideways by `off` along the left normal */
  segment(material, a, b, y0, y1, thick, off = 0, t0 = null, t1 = null) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-4) return;
    const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
    const s0 = t0 ?? 0, s1 = t1 ?? L;
    if (s1 - s0 < 0.01) return;
    const m = (s0 + s1) / 2;
    const nx = -dy, ny = dx;
    this.box(material, a[0] + dx * m + nx * off, a[1] + dy * m + ny * off, y0, s1 - s0, y1 - y0, thick, Math.atan2(dy, dx));
  }
  build({ castShadow = true, receiveShadow = true, userData = {} } = {}) {
    const group = new THREE.Group();
    for (const { geom, material, mats, cols } of this.buckets.values()) {
      if (!mats.length) continue;
      const mesh = new THREE.InstancedMesh(geom, material, mats.length);
      mats.forEach((m, i) => mesh.setMatrixAt(i, m));
      if (cols.some(Boolean)) cols.forEach((c, i) => mesh.setColorAt(i, _c.set(c || '#ffffff')));
      mesh.castShadow = castShadow && !material.transparent;
      mesh.receiveShadow = receiveShadow;
      mesh.userData = { ...userData };
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    return group;
  }
}
