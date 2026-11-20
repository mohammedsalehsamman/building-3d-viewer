import * as THREE from 'three';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Smooth camera flights for OrbitControls. */
export class CameraRig {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.anim = null;
  }
  flyTo(position, target, duration = 1.1) {
    this.anim = {
      p0: this.camera.position.clone(), p1: position.clone(),
      t0: this.controls.target.clone(), t1: target.clone(),
      time: 0, duration,
    };
  }
  get busy() { return !!this.anim; }
  update(dt) {
    const a = this.anim;
    if (!a) return;
    a.time += dt;
    const k = ease(Math.min(1, a.time / a.duration));
    this.camera.position.lerpVectors(a.p0, a.p1, k);
    this.controls.target.lerpVectors(a.t0, a.t1, k);
    if (a.time >= a.duration) this.anim = null;
  }
  cancel() { this.anim = null; }
}

export const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
