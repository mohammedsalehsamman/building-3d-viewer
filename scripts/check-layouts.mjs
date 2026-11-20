// Validates the space program: tiling, overlaps, areas, doors.  Run: npm run check
import { buildProgram, summarize } from '../src/program/levels.js';
import { area, intersect } from '../src/geometry/polygon.js';
import { PARCEL_AREA, EDGE_LENGTHS } from '../src/config/site.js';

const t0 = Date.now();
const prog = buildProgram();
const ms = Date.now() - t0;
let problems = 0;
const warn = (m) => { problems++; console.log('  ⚠ ' + m); };

console.log(`Parcel area ${PARCEL_AREA.toFixed(1)} m²   (program built in ${ms} ms)`);
console.log('Survey edges:', Object.entries(EDGE_LENGTHS).map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  '));

for (const L of prog.levels) {
  const tiles = L.spaces.filter((s) => !s.overlay);
  const sum = tiles.reduce((a, s) => a + s.area, 0);
  const gross = area(L.outline);
  console.log(`\n${L.id.padEnd(5)} ${L.name}  gross ${gross.toFixed(1)}  tiles ${sum.toFixed(1)}`);
  if (Math.abs(sum - gross) > 0.5) warn(`${L.id}: tiles do not cover the outline (${(sum - gross).toFixed(2)} m²)`);
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    const x = intersect(tiles[i].polygon, tiles[j].polygon);
    if (x && area(x) > 0.05) warn(`${tiles[i].id} overlaps ${tiles[j].id} by ${area(x).toFixed(2)} m²`);
  }
  for (const s of L.spaces) {
    const extra = [];
    if (s.balcony) extra.push(`balcony ${s.balcony.area.toFixed(1)}`);
    if (s.meta.orientation) extra.push(s.meta.orientation);
    if (s.interior) extra.push(`${s.interior.items.length} prims${s.interior.rooms.length ? ', bath' : ''}`);
    if (s.kind === 'unit' || s.area > 8) console.log(`   ${s.code.padEnd(7)} ${s.type.padEnd(9)} ${s.area.toFixed(1).padStart(6)} m²  ${extra.join(' | ')}`);
    if (['studio', 'office'].includes(s.type) && !s.doors.length) warn(`${s.id} has no door`);
    if (s.type === 'studio' && !s.interior.rooms.length) warn(`${s.id} has no bathroom`);
  }
}

const S = summarize(prog);
console.log('\nSUMMARY');
console.log(`  studios ${S.studios.length}  (${S.studioArea.toFixed(0)} m² + balconies ${S.balconyArea.toFixed(0)} m²)  range ${Math.min(...S.studios.map((s) => s.area)).toFixed(1)}–${Math.max(...S.studios.map((s) => s.area)).toFixed(1)}`);
console.log(`  shops ${S.shops.length} (${S.shopArea.toFixed(0)} m²)   offices ${S.offices.length} (${S.officeArea.toFixed(0)} m²)   parking ${S.parking.length}`);
console.log(`  gross total ${S.grossTotal.toFixed(0)} m², above ground ${S.grossAbove.toFixed(0)} m²`);
if (S.studios.length !== 30) warn(`expected 30 studios, got ${S.studios.length}`);
console.log(problems ? `\n${problems} problem(s)` : '\nAll checks passed');
process.exit(problems ? 1 : 0);
