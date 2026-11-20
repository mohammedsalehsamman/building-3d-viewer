// Site context: ground, roads, neighbouring parcels (from the survey drawing),
// setback paving, parcel boundary with surveyed dimensions, trees, north arrow.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { PARCEL, POINTS, FOOTPRINT, RAMP, EDGE_LENGTHS, NORTH, PARCEL_AREA } from '../config/site.js';
import { differenceAll, dist, centroid, clipConvex, rect } from '../geometry/polygon.js';
import { shapeOf, extrudePoly, flatPoly } from './building.js';
import { Batch } from './batch.js';

/* ---- pixel coordinates digitised from the survey photo (x right, y down) ---- */
const PX = {
  parcel: { 2: [190, 690], 7: [275, 595], 6: [460, 650], 5: [416, 763], 4: [380, 855], 3: [345, 850] },
  neighbours: [
    { id: '2310/3', area: 257, h: 12, px: [[275, 595], [460, 650], [520, 515], [355, 470]] },
    { id: '2310/2', area: 252, h: 15, px: [[355, 470], [520, 515], [560, 410], [560, 378], [345, 380]] },
    { id: '2310/1', area: 533, h: 12, px: [[268, 372], [405, 372], [405, 130], [325, 130], [250, 215]] },
    { id: '2310/6', area: 288, h: 9, px: [[160, 195], [250, 215], [268, 372], [270, 488], [222, 490], [222, 330]] },
    { id: '2310/5', area: 250, h: 9, px: [[50, 495], [270, 488], [148, 615]] },
  ],
  internalRoad: [[148, 615], [270, 488], [268, 372], [343, 368], [355, 470], [275, 595], [190, 690]],
};

/** least-squares similarity transform pixel → local (complex form q = a·p + b) */
function fitTransform() {
  const keys = Object.keys(PX.parcel);
  const P = keys.map((k) => PX.parcel[k]), Q = keys.map((k) => POINTS[k]);
  const mp = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length], [0, 0]);
  const mq = Q.reduce((s, p) => [s[0] + p[0] / Q.length, s[1] + p[1] / Q.length], [0, 0]);
  let nr = 0, ni = 0, d = 0;
  P.forEach((p, i) => {
    const x = [p[0] - mp[0], p[1] - mp[1]], y = [Q[i][0] - mq[0], Q[i][1] - mq[1]];
    nr += y[0] * x[0] + y[1] * x[1];
    ni += y[1] * x[0] - y[0] * x[1];
    d += x[0] * x[0] + x[1] * x[1];
  });
  const a = [nr / d, ni / d];
  const f = ([x, y]) => {
    const px = x - mp[0], py = y - mp[1];
    return [a[0] * px - a[1] * py + mq[0], a[1] * px + a[0] * py + mq[1]];
  };
  const rms = Math.sqrt(P.reduce((s, p, i) => s + dist(f(p), Q[i]) ** 2, 0) / P.length);
  return { f, rms };
}

function label(html, cls, pos) {
  const div = document.createElement('div');
  div.className = cls;
  div.innerHTML = html;
  const o = new CSS2DObject(div);
  o.position.set(...pos);
  return o;
}

function roadBand(a, b, extend, near, far) {
  const L = dist(a, b);
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = [d[1], -d[0]]; // right normal = outward for the CCW parcel
  const A = [a[0] - d[0] * extend, a[1] - d[1] * extend], B = [b[0] + d[0] * extend, b[1] + d[1] * extend];
  return [
    [A[0] + n[0] * near, A[1] + n[1] * near], [B[0] + n[0] * near, B[1] + n[1] * near],
    [B[0] + n[0] * far, B[1] + n[1] * far], [A[0] + n[0] * far, A[1] + n[1] * far],
  ];
}

export function buildSite() {
  const group = new THREE.Group();
  group.name = 'site';
  const ctx = { group, paving: null, neighbours: new THREE.Group(), dims: new THREE.Group(), trees: null };
  const { f: px2l, rms } = fitTransform();
  console.info(`[site] drawing → model fit RMS ${rms.toFixed(2)} m`);

  const M = {
    ground: new THREE.MeshStandardMaterial({ color: '#d8cfbd', roughness: 1 }),
    asphalt: new THREE.MeshStandardMaterial({ color: '#4a4e55', roughness: 0.95 }),
    asphalt2: new THREE.MeshStandardMaterial({ color: '#555960', roughness: 0.95 }),
    walk: new THREE.MeshStandardMaterial({ color: '#c9c3b8', roughness: 0.9 }),
    paving: new THREE.MeshStandardMaterial({ color: '#e4ddd0', roughness: 0.9 }),
    mark: new THREE.MeshStandardMaterial({ color: '#f1f1e8', roughness: 0.6 }),
    neighbour: new THREE.MeshStandardMaterial({ color: '#f3f1ec', roughness: 0.9, transparent: true, opacity: 0.55 }),
    boundary: new THREE.MeshBasicMaterial({ color: '#e63946' }),
    trunk: new THREE.MeshStandardMaterial({ color: '#6d4c41' }),
    leaves: new THREE.MeshStandardMaterial({ color: '#6a994e', roughness: 0.9 }),
    grass: new THREE.MeshStandardMaterial({ color: '#90a955', roughness: 1 }),
  };

  // ground with a hole for the parcel (basements stay visible from above)
  const gshape = new THREE.Shape([[-200, -200], [200, -200], [200, 200], [-200, 200]].map(([x, y]) => new THREE.Vector2(x, y)));
  gshape.holes.push(new THREE.Path(PARCEL.slice().reverse().map(([u, v]) => new THREE.Vector2(u, -v))));
  const gGeom = new THREE.ShapeGeometry(gshape);
  gGeom.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(gGeom, M.ground);
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  group.add(ground);

  // roads
  const P = POINTS;
  const roads = [
    { a: P['3'], b: P['2'], width: 12, mat: M.asphalt, y: 0.004, name: 'طريق (ضلع 26.24 م)' },
    { a: P['6'], b: P['4'], width: 10, mat: M.asphalt2, y: 0.007, name: 'طريق (ضلع 23.99 م)' },
  ];
  const marks = new Batch();
  for (const r of roads) {
    const walkIn = roadBand(r.a, r.b, 40, 0, 2);
    const asphalt = roadBand(r.a, r.b, 40, 2, 2 + r.width);
    const walkOut = roadBand(r.a, r.b, 40, 2 + r.width, 4 + r.width);
    const am = new THREE.Mesh(flatPoly(asphalt, r.y), r.mat);
    am.receiveShadow = true;
    group.add(am);
    for (const w of [walkIn, walkOut]) {
      const m = new THREE.Mesh(extrudePoly(w, 0.15, -0.02), M.walk);
      m.receiveShadow = true;
      group.add(m);
    }
    // dashed centre line
    const L = dist(r.a, r.b);
    const d = [(r.b[0] - r.a[0]) / L, (r.b[1] - r.a[1]) / L], n = [d[1], -d[0]];
    const off = 2 + r.width / 2;
    for (let t = -38; t < L + 38; t += 4) {
      const c = [r.a[0] + d[0] * t + n[0] * off, r.a[1] + d[1] * t + n[1] * off];
      marks.box(M.mark, c[0], c[1], r.y + 0.003, 2, 0.005, 0.15, Math.atan2(d[1], d[0]));
    }
    const mid = [r.a[0] + d[0] * L * 0.5 + n[0] * off, r.a[1] + d[1] * L * 0.5 + n[1] * off];
    group.add(label(r.name, 'road-lbl', [mid[0], 0.3, mid[1]]));
  }
  const internal = PX.internalRoad.map(px2l);
  const im = new THREE.Mesh(flatPoly(internal, 0.01), M.asphalt);
  im.receiveShadow = true;
  group.add(im);
  {
    const c = centroid(internal);
    group.add(label('طريق داخلي — عرض 10 م', 'road-lbl', [c[0], 0.3, c[1]]));
  }
  group.add(marks.build({ castShadow: false }));

  // neighbouring parcels (heights are indicative only)
  for (const nb of PX.neighbours) {
    const poly = nb.px.map(px2l);
    const m = new THREE.Mesh(extrudePoly(poly, nb.h, 0), M.neighbour);
    m.castShadow = true; m.receiveShadow = true;
    const edgesL = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: '#9a958c' }));
    ctx.neighbours.add(m, edgesL);
    const c = centroid(poly);
    const nl = label(`المحضر ${nb.id}<span>${nb.area} م² · كتلة تقديرية</span>`, 'nb-lbl', [c[0], nb.h + 0.8, c[1]]);
    nl.userData.nbLabel = true;
    ctx.neighbours.add(nl);
  }
  group.add(ctx.neighbours);

  // setback paving (parcel minus footprint minus the open ramp)
  const fp = FOOTPRINT.map(([u, v]) => [u, v < 0.05 ? -0.3 : v]);
  const rampOpen = clipConvex(rect(-60, RAMP.v0, 6, RAMP.v1), PARCEL);
  const pav = differenceAll(PARCEL, fp, rampOpen ? rampOpen.map(([u, v]) => [Math.min(u, 4), v]) : []);
  const pavGroup = new THREE.Group();
  for (const p of pav) {
    if (!p || p.length < 3) continue;
    const m = new THREE.Mesh(extrudePoly(p, 0.05, -0.05), M.paving);
    m.receiveShadow = true;
    pavGroup.add(m);
  }
  ctx.paving = pavGroup;
  group.add(pavGroup);

  // parcel boundary + survey points + dimensions
  const bnd = new Batch();
  PARCEL.forEach((a, i) => {
    const b = PARCEL[(i + 1) % PARCEL.length];
    bnd.segment(M.boundary, a, b, 0.06, 0.12, 0.14);
  });
  for (const [k, p] of Object.entries(POINTS)) {
    bnd.cyl(M.boundary, p[0], p[1], 0, 0.25, 0.9, 0.25);
    ctx.dims.add(label(k, 'pt-lbl', [p[0], 1.3, p[1]]));
  }
  group.add(bnd.build({ castShadow: false }));
  const dimsOf = [['2', '7', EDGE_LENGTHS['2-7']], ['7', '6', EDGE_LENGTHS['7-6']], ['6', '5', EDGE_LENGTHS['6-5']], ['5', '4', EDGE_LENGTHS['5-4']], ['3', '2', EDGE_LENGTHS['3-2']]];
  const pc = centroid(PARCEL);
  for (const [a, b, L] of dimsOf) {
    const m = [(P[a][0] + P[b][0]) / 2, (P[a][1] + P[b][1]) / 2];
    const out = [m[0] - pc[0], m[1] - pc[1]];
    const ol = Math.hypot(...out);
    ctx.dims.add(label(`${L.toFixed(2)} م`, 'dim-lbl', [m[0] + (out[0] / ol) * 1.6, 0.4, m[1] + (out[1] / ol) * 1.6]));
  }
  ctx.dims.add(label(`المحضر 2310/4 · ${PARCEL_AREA.toFixed(0)} م²`, 'parcel-lbl', [P['3'][0] + 2, 0.5, P['3'][1] + 3.5]));
  group.add(ctx.dims);

  // trees on the outer sidewalks
  const treePts = [];
  for (const r of roads) {
    const L = dist(r.a, r.b);
    const d = [(r.b[0] - r.a[0]) / L, (r.b[1] - r.a[1]) / L], n = [d[1], -d[0]];
    for (let t = -30; t < L + 30; t += 9) {
      treePts.push([r.a[0] + d[0] * t + n[0] * (3 + r.width), r.a[1] + d[1] * t + n[1] * (3 + r.width)]);
    }
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.18, 2.6, 8), M.trunk, treePts.length);
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 1), M.leaves, treePts.length);
  const mtx = new THREE.Matrix4();
  treePts.forEach(([u, v], i) => {
    const s = 0.85 + ((i * 37) % 10) / 25;
    trunks.setMatrixAt(i, mtx.makeTranslation(u, 1.3, v));
    crowns.setMatrixAt(i, mtx.compose(new THREE.Vector3(u, 3.4 * s, v), new THREE.Quaternion(), new THREE.Vector3(s, s * 1.1, s)));
  });
  trunks.castShadow = crowns.castShadow = true;
  ctx.trees = new THREE.Group();
  ctx.trees.add(trunks, crowns);
  group.add(ctx.trees);

  // north arrow on the ground
  const arrow = new THREE.Shape([[0, 2.2], [0.9, -1.2], [0, -0.5], [-0.9, -1.2]].map(([x, y]) => new THREE.Vector2(x, y)));
  const ag = new THREE.ShapeGeometry(arrow);
  ag.rotateX(-Math.PI / 2);
  const am = new THREE.Mesh(ag, new THREE.MeshBasicMaterial({ color: '#1d3557' }));
  const pos = [-14, 0.06, 26];
  am.position.set(...pos);
  am.rotation.y = Math.atan2(-NORTH[0], -NORTH[1]);
  group.add(am);
  group.add(label('N · شمال', 'north-lbl', [pos[0] + NORTH[0] * 3.2, 0.3, pos[2] + NORTH[1] * 3.2]));

  return ctx;
}
