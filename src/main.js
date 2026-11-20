import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { buildProgram, summarize } from './program/levels.js';
import { typeOf, STATUS } from './program/types.js';
import { buildBuilding, labelPoint } from './build/building.js';
import { buildSite } from './build/site.js';
import { clipPlanes, setXray } from './build/materials.js';
import { CameraRig, v3 } from './interaction/cameraRig.js';
import { WalkMode } from './interaction/walkMode.js';
import { initUI } from './ui/ui.js';
import { NORTH, FOOTPRINT, PARCEL } from './config/site.js';
import { centroid, bbox, contains, edges, pointSegDist } from './geometry/polygon.js';

/* ---------------- renderer / scene ---------------- */
const host = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
host.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
// CSS2DRenderer positions labels from the left edge; in an RTL page they would anchor to the right
labelRenderer.domElement.dir = 'ltr';
host.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
};
function applyTheme() {
  const c = new THREE.Color(isDark() ? '#1b2129' : '#cfdce8');
  scene.background = c;
  scene.fog = new THREE.Fog(c, 160, 420);
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 4;
controls.maxDistance = 260;
const rig = new CameraRig(camera, controls);

const hemi = new THREE.HemisphereLight('#eaf2ff', '#8b7d6b', 0.9);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight('#fff4e0', 2.6);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
Object.assign(sunLight.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.03;
scene.add(sunLight, sunLight.target);

/* ---------------- model ---------------- */
const program = buildProgram();
const summary = summarize(program);
const site = buildSite();
scene.add(site.group);
const building = buildBuilding(program);
scene.add(building.root);

const FP_C = centroid(FOOTPRINT);
const LEVEL_IDX = Object.fromEntries(program.levels.map((l, i) => [l.id, i]));
const EXPLODE_GAP = 4.5;

/* ---------------- state ---------------- */
const STORE_KEY = 'mahdar-2310-4:units';
let unitStore = {};
try { unitStore = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { unitStore = {}; }
const listeners = {};
const emit = (ev, data) => (listeners[ev] || []).forEach((f) => f(data));

const state = {
  level: null, space: null, hover: null,
  exploded: false, xray: false,
  labels: true, furniture: true, neighbours: true, dims: true, colors: true,
  section: { on: false, axis: 'u', pos: 0.55 },
  sun: { hour: 15, month: 5 },
  walking: false,
};

const app = {
  program, summary, state,
  on(ev, fn) { (listeners[ev] ||= []).push(fn); },
  unitData(id) { return { status: 'available', price: null, ...(unitStore[id] || {}) }; },
  setUnitData(id, patch) {
    unitStore[id] = { ...app.unitData(id), ...patch };
    try { localStorage.setItem(STORE_KEY, JSON.stringify(unitStore)); } catch { /* storage unavailable: keep in memory */ }
    refreshFills();
  },
  selectLevel(id, { fly = true } = {}) {
    state.level = id || null;
    if (state.space && program.byId[state.space]?.levelId !== state.level) state.space = null;
    applyVisibility();
    if (fly) flyToLevel(state.level);
    emit('state');
  },
  selectSpace(id, { fly = false } = {}) {
    state.space = id || null;
    if (id) {
      const sp = program.byId[id];
      if (state.level !== sp.levelId) { state.level = sp.levelId; applyVisibility(); }
      if (fly) app.flyToSpace(id);
    }
    refreshFills();
    emit('state');
  },
  flyToSpace(id) {
    const sp = program.byId[id];
    if (!sp) return;
    const p = labelPoint(sp.polygon);
    const y = levelY(sp.levelId);
    const dir = new THREE.Vector2(p[0] - FP_C[0], p[1] - FP_C[1]);
    if (dir.length() < 0.5) dir.set(1, 1);
    dir.normalize();
    const r = Math.max(9, Math.sqrt(sp.area) * 2.2);
    rig.flyTo(v3(p[0] + dir.x * r, y + r * 1.25, p[1] + dir.y * r), v3(p[0], y + 0.5, p[1]));
  },
  toggle(name) {
    state[name] = !state[name];
    if (name === 'xray') setXray(state.xray);
    if (name === 'exploded' && !state.level) rig.flyTo(v3(52, 62, 70), v3(FP_C[0], state.exploded ? 22 : 10, FP_C[1]));
    applyVisibility();
    emit('state');
  },
  setLayer(name, on) {
    state[name] = on;
    applyVisibility();
    refreshFills();
    emit('state');
  },
  setSection(patch) { Object.assign(state.section, patch); applySection(); emit('state'); },
  setSun(patch) { Object.assign(state.sun, patch); applySun(); },
  resetView() { rig.flyTo(v3(48, 44, 62), v3(FP_C[0], 9, FP_C[1])); },
  screenshot() {
    renderer.render(scene, camera);
    const a = document.createElement('a');
    a.href = renderer.domElement.toDataURL('image/png');
    a.download = `mahdar-2310-4-${state.level || 'all'}.png`;
    a.click();
  },
  walk(spaceId) { startWalk(spaceId); },
  onThemeChange() { applyTheme(); },
};

/* ---------------- visibility, explode, colours ---------------- */
function levelY(id) {
  const L = program.levels[LEVEL_IDX[id]];
  return L.elev + (state.exploded ? LEVEL_IDX[id] * EXPLODE_GAP : 0);
}
function applyVisibility() {
  const sel = state.level ? LEVEL_IDX[state.level] : null;
  const walkLimit = state.walking && state.walkLevel != null ? LEVEL_IDX[state.walkLevel] + 1 : null;
  for (const [id, b] of building.levels) {
    const i = LEVEL_IDX[id];
    let vis = sel == null ? true : i <= sel;
    if (walkLimit != null) vis = i <= walkLimit;
    b.group.visible = vis;
    b.labels.visible = state.labels && !state.walking && state.level === id;
    b.furniture.visible = state.furniture;
  }
  const basement = state.level && program.levels[LEVEL_IDX[state.level]].use === 'parking';
  site.paving.visible = !basement || state.exploded;
  site.neighbours.visible = state.neighbours;
  site.neighbours.children.forEach((o) => { if (o.userData.nbLabel) o.visible = !state.level && !state.walking; });
  // site annotations (roads, survey points, dimensions, north) are noise while walking inside
  site.group.traverse((o) => { if (o.isCSS2DObject && !o.userData.nbLabel) o.visible = !state.walking; });
  site.dims.visible = state.dims && !state.walking;
  refreshFills();
}

const REAL = {
  studio: '#d8bf9c', shop: '#e6e0d6', office: '#cfd3d7', cafe: '#c9a27e', terrace: '#b7a58f', lobby: '#ece8e1',
  corridor: '#e2ded7', parking: '#8d939b', drive: '#7d838b', stair: '#c9c4bb', lift: '#9a9a9a',
};
function refreshFills() {
  for (const [, b] of building.levels) {
    for (const [id, mesh] of b.fills) {
      const sp = program.byId[id];
      const useColors = state.colors && !state.walking; // realistic finishes while walking
      const base = useColors ? mesh.material.userData.base : (REAL[sp.type] || '#d4d0c8');
      mesh.material.color.set(base);
      let em = '#000000';
      if (sp.kind === 'unit' && useColors) {
        const st = app.unitData(id).status;
        if (st === 'sold') mesh.material.color.lerp(new THREE.Color(STATUS.sold.color), 0.45);
        if (st === 'reserved') mesh.material.color.lerp(new THREE.Color(STATUS.reserved.color), 0.45);
      }
      if (state.hover === id) em = '#3a3a3a';
      if (state.space === id) em = '#b34700';
      mesh.material.emissive.set(em);
      mesh.material.emissiveIntensity = state.space === id ? 0.55 : 0.4;
    }
    b.labels.children.forEach((l) => l.element.classList.toggle('sel', l.userData.spaceId === state.space));
  }
}

/* ---------------- section ---------------- */
const FPB = bbox(PARCEL);
const sectionPlane = new THREE.Plane();
function applySection() {
  const s = state.section;
  clipPlanes.length = 0;
  if (!s.on) return;
  if (s.axis === 'u') {
    const c = THREE.MathUtils.lerp(FPB.y0 - 0.5, FPB.y1 + 0.5, s.pos);
    sectionPlane.set(new THREE.Vector3(0, 0, -1), c);
  } else {
    const c = THREE.MathUtils.lerp(FPB.x0 - 0.5, FPB.x1 + 0.5, s.pos);
    sectionPlane.set(new THREE.Vector3(-1, 0, 0), c);
  }
  clipPlanes.push(sectionPlane);
}

/* ---------------- sun ---------------- */
const LAT = THREE.MathUtils.degToRad(33.9);
const EAST = [-NORTH[1], NORTH[0]];
function applySun() {
  const { hour, month } = state.sun;
  const doy = [15, 46, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344][month];
  const decl = THREE.MathUtils.degToRad(23.44) * Math.sin(((2 * Math.PI) / 365) * (doy - 81));
  const H = THREE.MathUtils.degToRad(15 * (hour - 12.5)); // ~solar noon 12:30 local in Lebanon (UTC+2/+3)
  const sinAlt = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(H);
  const alt = Math.asin(sinAlt);
  const az = Math.atan2(-Math.cos(decl) * Math.sin(H), Math.sin(decl) * Math.cos(LAT) - Math.cos(decl) * Math.sin(LAT) * Math.cos(H));
  const ch = Math.cos(alt);
  const dx = ch * (Math.cos(az) * NORTH[0] + Math.sin(az) * EAST[0]);
  const dz = ch * (Math.cos(az) * NORTH[1] + Math.sin(az) * EAST[1]);
  const target = v3(FP_C[0], 6, FP_C[1]);
  sunLight.target.position.copy(target);
  sunLight.position.set(target.x + dx * 120, target.y + Math.max(sinAlt, 0.02) * 120, target.z + dz * 120);
  const day = THREE.MathUtils.clamp(sinAlt * 3, 0, 1);
  sunLight.intensity = 2.8 * day;
  sunLight.color.set(sinAlt < 0.25 ? '#ffc58a' : '#fff4e0');
  hemi.intensity = 0.35 + 0.65 * day;
}

/* ---------------- picking ---------------- */
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let lastMove = null, pending = false;
function pickTargets() {
  const out = [];
  for (const [id, b] of building.levels) {
    if (!b.group.visible) continue;
    if (state.level) { if (id === state.level) out.push(...b.fills.values()); }
    else b.group.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.userData.levelId && o.parent?.visible !== false && o.userData.part !== 'furniture') out.push(o); });
  }
  return out;
}
function pick(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(pickTargets(), false);
  for (const h of hits) {
    if (state.section.on && sectionPlane.distanceToPoint(h.point) < 0) continue;
    return h.object.userData;
  }
  return null;
}
function hoverHtml(hit) {
  if (!hit) return null;
  if (hit.spaceId) {
    const sp = program.byId[hit.spaceId];
    const st = sp.kind === 'unit' ? ` · ${STATUS[app.unitData(sp.id).status].label}` : '';
    return `<b>${sp.name}</b>${typeOf(sp.type).label} · ${sp.area.toFixed(1)} م²${sp.balcony ? ` + بلكون ${sp.balcony.area.toFixed(1)}` : ''}${st}`;
  }
  const L = program.levels[LEVEL_IDX[hit.levelId]];
  return `<b>${L.name}</b>انقر لفتح الطابق`;
}
renderer.domElement.addEventListener('pointermove', (e) => {
  lastMove = e;
  if (pending || state.walking) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const hit = pick(lastMove.clientX, lastMove.clientY);
    const hid = hit?.spaceId || null;
    if (hid !== state.hover) { state.hover = hid; refreshFills(); }
    renderer.domElement.style.cursor = hit ? 'pointer' : 'default';
    emit('hover', { x: lastMove.clientX, y: lastMove.clientY, html: hoverHtml(hit) });
  });
});
renderer.domElement.addEventListener('pointerleave', () => emit('hover', { html: null }));
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || state.walking) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 5) return;
  const hit = pick(e.clientX, e.clientY);
  if (!hit) { if (state.space) app.selectSpace(null); return; }
  if (hit.spaceId) app.selectSpace(hit.spaceId);
  else if (hit.levelId) app.selectLevel(hit.levelId);
});

/* ---------------- camera flights ---------------- */
function flyToLevel(id) {
  if (!id) { app.resetView(); return; }
  const y = levelY(id);
  const az = Math.atan2(camera.position.z - FP_C[1], camera.position.x - FP_C[0]);
  const r = 30;
  rig.flyTo(v3(FP_C[0] + Math.cos(az) * r, y + 32, FP_C[1] + Math.sin(az) * r), v3(FP_C[0], y, FP_C[1] + 1));
}

/* ---------------- walk ---------------- */
const saved = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
const walker = new WalkMode(camera, renderer.domElement, {
  onExit: () => {
    state.walking = false;
    controls.enabled = true;
    camera.fov = 42;
    camera.updateProjectionMatrix();
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    applyVisibility();
    emit('walk', false);
    emit('state');
  },
});
function openSpot(sp, facadeMid, door) {
  const b = bbox(sp.polygon);
  const items = (sp.interior?.items || []).filter((it) => it.z + it.h > 0.6);
  const rooms = sp.interior?.rooms || [];
  const inItem = (q) => items.some((it) => {
    const dx = q[0] - it.c[0], dy = q[1] - it.c[1];
    const c = Math.cos(-it.rot), s = Math.sin(-it.rot);
    return Math.abs(dx * c - dy * s) < it.w / 2 + 0.35 && Math.abs(dx * s + dy * c) < it.d / 2 + 0.35;
  });
  const cross = (p, q, a, c) => {
    const d = (x, y, z) => (y[0] - x[0]) * (z[1] - x[1]) - (y[1] - x[1]) * (z[0] - x[0]);
    return d(p, q, a) * d(p, q, c) < 0 && d(a, c, p) * d(a, c, q) < 0;
  };
  const tall = items.filter((it) => it.z + it.h > 1.5);
  const blocked = (q) => rooms.some((r) => edges(r.polygon).some(([a, c]) => cross(q, facadeMid, a, c)))
    || tall.some((it) => {
      const hw = it.w / 2, hd = it.d / 2, c = Math.cos(it.rot), s = Math.sin(it.rot);
      const cs = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [it.c[0] + x * c - y * s, it.c[1] + x * s + y * c]);
      return cs.some((a, i) => cross(q, facadeMid, a, cs[(i + 1) % 4]));
    });
  let best = null, bs = -Infinity;
  for (let x = b.x0; x <= b.x1; x += 0.2) for (let z = b.y0; z <= b.y1; z += 0.2) {
    const q = [x, z];
    if (!contains(sp.polygon, q) || inItem(q)) continue;
    const roomDist = rooms.length ? Math.min(...rooms.flatMap((r) => edges(r.polygon).map(([a, c]) => pointSegDist(q, a, c)))) : 9;
    if (rooms.some((r) => contains(r.polygon, q)) || roomDist < 0.5) continue;
    const clear = Math.min(...edges(sp.polygon).map(([a, c]) => pointSegDist(q, a, c)));
    if (clear < 0.6) continue;
    const seen = blocked(q) ? -5 : 0;
    const score = seen + Math.min(clear, 1.5) + Math.min(roomDist, 1.5) + Math.hypot(q[0] - facadeMid[0], q[1] - facadeMid[1]) * 0.5;
    if (score > bs) { bs = score; best = q; }
  }
  return best;
}
function startWalk(spaceId) {
  let sp = spaceId ? program.byId[spaceId] : null;
  if (!sp && state.level) {
    const L = program.levels[LEVEL_IDX[state.level]];
    sp = L.spaces.find((s) => ['corridor', 'lobby', 'terrace', 'drive'].includes(s.type) && s.area > 15) || L.spaces[0];
  }
  saved.pos.copy(camera.position);
  saved.target.copy(controls.target);
  rig.cancel();
  controls.enabled = false;
  state.walking = true;
  let pos, look;
  if (sp) {
    state.walkLevel = sp.levelId;
    const y = levelY(sp.levelId) + 1.6;
    const door = sp.doors?.[0]?.at;
    const p = labelPoint(sp.polygon);
    const facade = (sp.facades || []).filter((f) => !f.shared).sort((a, b) => b.length - a.length)[0];
    const f = facade ? [(facade.a[0] + facade.b[0]) / 2, (facade.a[1] + facade.b[1]) / 2] : p;
    // stand on an open spot (clear of walls, the bathroom and furniture), as far from the windows as possible
    const s = openSpot(sp, f, door) || p;
    pos = v3(s[0], y, s[1]);
    look = v3(f[0], y - 0.25, f[1]);
  } else {
    state.walkLevel = 'GF';
    const entry = program.byId['GF-ENTRY'];
    const p = labelPoint(entry.polygon);
    pos = v3(p[0] - 9, 1.6, p[1] - 2);
    look = v3(p[0], 1.6, p[1]);
  }
  camera.fov = 70;
  camera.updateProjectionMatrix();
  walker.enter(pos, look);
  applyVisibility();
  emit('walk', true);
  emit('hover', { html: null });
  emit('state');
}

/* ---------------- compass ---------------- */
let lastCompass = null;
function updateCompass() {
  const f = new THREE.Vector3();
  camera.getWorldDirection(f);
  const fx = f.x, fz = f.z, L = Math.hypot(fx, fz) || 1;
  const up = [fx / L, fz / L], right = [-fz / L, fx / L];
  const deg = (Math.atan2(NORTH[0] * right[0] + NORTH[1] * right[1], NORTH[0] * up[0] + NORTH[1] * up[1]) * 180) / Math.PI;
  if (lastCompass == null || Math.abs(deg - lastCompass) > 0.5) { lastCompass = deg; emit('compass', deg); }
}

/* ---------------- loop ---------------- */
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  for (const [id, b] of building.levels) {
    const target = levelY(id);
    b.group.position.y += (target - b.group.position.y) * Math.min(1, dt * 6);
  }
  if (state.walking) walker.update(dt);
  else { rig.update(dt); controls.update(); }
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  updateCompass();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !state.walking) {
    if (state.space) app.selectSpace(null);
    else if (state.level) app.selectLevel(null);
  }
});

/* ---------------- start ---------------- */
camera.position.set(48, 44, 62);
controls.target.set(FP_C[0], 9, FP_C[1]);
applySun();
applySection();
applyVisibility();
refreshFills();
initUI(app);
document.getElementById('loading').remove();

// deep links: ?level=F3  ?space=F3-S06  &explode=1 &xray=1 &section=0.5 &hour=8 &theme=light &schedule=1 &walk=1
{
  const q = new URLSearchParams(location.search);
  if (q.get('theme')) { document.documentElement.setAttribute('data-theme', q.get('theme')); applyTheme(); }
  if (q.get('explode') === '1') app.toggle('exploded');
  if (q.get('xray') === '1') app.toggle('xray');
  if (q.get('hour')) app.setSun({ hour: Number(q.get('hour')) });
  if (q.get('section')) app.setSection({ on: true, pos: Number(q.get('section')), axis: q.get('axis') || 'u' });
  const sp = q.get('space');
  if (sp && program.byId[sp]) app.selectSpace(sp, { fly: true });
  else if (q.get('level') && LEVEL_IDX[q.get('level')] != null) app.selectLevel(q.get('level'));
  if (q.get('instant') === '1' && rig.anim) { rig.anim.duration = 0.001; }
  if (q.get('walk') === '1') app.walk(sp || undefined);
  if (q.get('schedule') === '1') document.querySelector('.tbtn[data-id=table]')?.click();
}
frame();
window.__app = app; // handy for debugging from the console
