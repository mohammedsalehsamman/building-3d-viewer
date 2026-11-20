import * as THREE from 'three';

/** Shared clipping planes for the section tool (building materials only). */
export const clipPlanes = [];
const registry = [];

export function mat(color, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0, ...opts });
  m.clippingPlanes = clipPlanes;
  m.clipShadows = true;
  registry.push(m);
  return m;
}
export const allMaterials = () => registry;

const glassOpts = { transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.2, depthWrite: false };

export const M = {
  slab: mat('#d8d4cc'),
  facade: mat('#efe9df'),
  facadeAccent: mat('#b9a58a'),
  basementWall: mat('#a29d95'),
  partition: mat('#f7f5f0'),
  bathWall: mat('#e3eef3'),
  glass: mat('#8ec5d6', glassOpts),
  railGlass: mat('#a8d8e6', { ...glassOpts, opacity: 0.25 }),
  frame: mat('#3a3f45', { roughness: 0.5, metalness: 0.4 }),
  door: mat('#9c7650'),
  steelDoor: mat('#8d949b', { roughness: 0.4, metalness: 0.6 }),
  balcony: mat('#cdc7bd'),
  canopy: mat('#2f3e46', { roughness: 0.6, metalness: 0.3 }),
  ramp: mat('#7b818a'),
  stair: mat('#cbc6bc'),
  roofCap: mat('#bcb6ac'),
  pergola: mat('#8d6e63'),
  stripe: mat('#f4f1de', { roughness: 0.6 }),
  furniture: mat('#ffffff', { roughness: 0.75 }),
  signs: ['#e76f51', '#2a9d8f', '#e9c46a', '#264653'].map((c) => mat(c, { roughness: 0.5, emissive: c, emissiveIntensity: 0.15 })),
};

/** Materials that the X-ray mode fades. */
export const XRAY = [M.facade, M.facadeAccent, M.basementWall, M.frame, M.canopy, M.roofCap, M.glass];
const xrayBackup = new Map();
export function setXray(on) {
  for (const m of XRAY) {
    if (!xrayBackup.has(m)) xrayBackup.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
    const b = xrayBackup.get(m);
    m.transparent = on ? true : b.transparent;
    m.opacity = on ? Math.min(b.opacity, 0.12) : b.opacity;
    m.depthWrite = on ? false : b.depthWrite;
    m.needsUpdate = true;
  }
}
