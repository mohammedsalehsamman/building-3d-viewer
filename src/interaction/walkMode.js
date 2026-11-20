// First-person walk: drag to look, WASD / arrows to move, Shift to run, Esc to leave.
// Uses plain pointer events (no pointer lock) so it also works inside iframes.
import * as THREE from 'three';

export class WalkMode {
  constructor(camera, dom, { onExit } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.onExit = onExit;
    this.active = false;
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0;
    this.drag = null;
    this._down = (e) => { if (this.active) this.drag = { x: e.clientX, y: e.clientY, yaw: this.yaw, pitch: this.pitch }; };
    this._move = (e) => {
      if (!this.active || !this.drag) return;
      this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.004;
      this.pitch = THREE.MathUtils.clamp(this.drag.pitch + (e.clientY - this.drag.y) * 0.003, -1.2, 1.2);
    };
    this._up = () => { this.drag = null; };
    this._kd = (e) => {
      if (!this.active) return;
      if (e.key === 'Escape') { this.exit(); return; }
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
    };
    this._ku = (e) => this.keys.delete(e.code);
    dom.addEventListener('pointerdown', this._down);
    window.addEventListener('pointermove', this._move);
    window.addEventListener('pointerup', this._up);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
  }
  /** start at plan point (u, v) on a floor at height y, looking at plan point look */
  enter(pos, look) {
    this.active = true;
    this.camera.position.copy(pos);
    const d = new THREE.Vector3().subVectors(look, pos);
    this.yaw = Math.atan2(d.x, -d.z);
    this.pitch = 0.05;
    this.apply();
  }
  exit() {
    if (!this.active) return;
    this.active = false;
    this.keys.clear();
    this.onExit?.();
  }
  apply() {
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.camera.lookAt(this.camera.position.clone().add(dir));
  }
  update(dt) {
    if (!this.active) return;
    const k = this.keys;
    const sp = (k.has('ShiftLeft') || k.has('ShiftRight') ? 5 : 1.8) * dt;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const turn = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
    this.yaw += turn * dt * 1.6;
    const fx = Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.camera.position.x += (fx * f - fz * s) * sp;
    this.camera.position.z += (fz * f + fx * s) * sp;
    this.apply();
  }
}
