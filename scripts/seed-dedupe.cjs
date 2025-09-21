// scripts/seed-dedupe.cjs
// Odstraní z pack-2 záznamy, které už existují v pack-1
const fs = require('fs');
const path = require('path');

const pack1Path = path.join(process.cwd(), 'data', 'seed', 'pack-1.json');
const pack2Path = path.join(process.cwd(), 'data', 'seed', 'pack-2.json');

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}
function cleanEan(e) { return String(e || '').replace(/\D+/g, ''); }

const p1 = readJSON(pack1Path);
const p2 = readJSON(pack2Path);

const existing = new Set(p1.map(r => cleanEan(r.ean)).filter(Boolean));
const seen2 = new Set();
const filtered = [];

for (const r of p2) {
  const e = cleanEan(r.ean);
  if (!e) continue;            // špatný EAN → přeskoč
  if (existing.has(e)) continue; // už je v pack-1 → přeskoč
  if (seen2.has(e)) continue;    // duplicitní v rámci pack-2 → přeskoč
  seen2.add(e);
  filtered.push(r);
}

fs.writeFileSync(pack2Path, JSON.stringify(filtered, null, 2));
console.log('[seed:dedupe]', {
  pack1: p1.length,
  pack2_in: p2.length,
  pack2_out: filtered.length,
  removed: p2.length - filtered.length
});
