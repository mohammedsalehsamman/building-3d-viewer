// Writes an HTML sheet with an SVG plan of every level (for checking layouts).
// Usage: node scripts/plan-preview.mjs <out.html>
import { writeFileSync } from 'node:fs';
import { buildProgram } from '../src/program/levels.js';
import { typeOf } from '../src/program/types.js';
import { centroid } from '../src/geometry/polygon.js';
import { PARCEL } from '../src/config/site.js';

const out = process.argv[2] || 'plans.html';
const prog = buildProgram();
const S = 14, OX = 8, OY = 2;
const pt = ([u, v]) => `${((u + OX) * S).toFixed(1)},${((v + OY) * S).toFixed(1)}`;
const poly = (p, fill, stroke = '#333', sw = 1, op = 1) => `<polygon points="${p.map(pt).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" fill-opacity="${op}"/>`;
function obb(it) {
  const hw = it.w / 2, hd = it.d / 2, c = Math.cos(it.rot), s = Math.sin(it.rot);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => [it.c[0] + x * c - y * s, it.c[1] + x * s + y * c]);
}
let html = '<html><body style="margin:0;background:#fff;font-family:sans-serif"><div style="display:flex;flex-wrap:wrap">';
for (const L of prog.levels.filter((l) => ['B2', 'B1', 'GF', 'F1', 'F2', 'ROOF'].includes(l.id))) {
  let svg = `<svg width="${36 * S}" height="${30 * S}" style="border:1px solid #ccc;margin:2px">`;
  svg += poly(PARCEL, 'none', '#d00', 1.5);
  for (const sp of L.spaces) {
    svg += poly(sp.polygon, typeOf(sp.type).color, '#222', sp.overlay ? 0.5 : 1, sp.overlay ? 0.7 : 0.85);
    if (sp.balcony) svg += poly(sp.balcony.polygon, '#9ad', '#246', 0.8);
    for (const r of sp.interior?.rooms || []) svg += poly(r.polygon, '#cfe8ff', '#036', 1);
    for (const it of sp.interior?.items || []) if (it.z < 0.5) svg += poly(obb(it), it.color, '#0004', 0.3, 0.9);
    for (const d of sp.doors) svg += `<circle cx="${(d.at[0] + OX) * S}" cy="${(d.at[1] + OY) * S}" r="4" fill="#e00"/>`;
    if (sp.area > 6) {
      const [cx, cy] = centroid(sp.polygon);
      svg += `<text x="${(cx + OX) * S}" y="${(cy + OY) * S}" font-size="10" text-anchor="middle">${sp.code} ${sp.area.toFixed(0)}</text>`;
    }
  }
  svg += `<text x="6" y="16" font-size="14" font-weight="bold">${L.id}</text></svg>`;
  html += svg;
}
html += '</div></body></html>';
writeFileSync(out, html);
console.log('wrote', out);
