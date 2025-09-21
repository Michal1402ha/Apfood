// scripts/seed-lint.js
// Validační skript pro data/seed/pack-1.json (+ volitelně pack-2.json)
// Spusť: node scripts/seed-lint.js

const path = require('path');
const fs = require('fs');

function loadPack(p) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (e) {
    return [];
  }
}

function isNumber(x) {
  return typeof x === 'number' && Number.isFinite(x);
}

function cleanEan(e) {
  const s = String(e || '').replace(/\D+/g, '');
  return s.length ? s : null;
}

function validateRow(r) {
  const errors = [];
  const ean = cleanEan(r.ean);
  if (!ean) errors.push('bad_ean');

  const name = String(r.name || '').trim();
  if (!name) errors.push('bad_name');

  const p = r.per100g || {};
  const fields = ['kcal', 'protein', 'carbs', 'fats'];
  for (const f of fields) {
    if (p[f] == null) {
      if (f === 'kcal') errors.push('missing_kcal');
      continue;
    }
    if (!isNumber(p[f]) || p[f] < 0) errors.push(`bad_${f}`);
  }
  if (isNumber(p.kcal) && p.kcal > 900) errors.push('kcal_gt_900');
  if (isNumber(p.protein) && p.protein > 60) errors.push('protein_gt_60');
  if (isNumber(p.carbs) && p.carbs > 100) errors.push('carbs_gt_100');
  if (isNumber(p.fats) && p.fats > 100) errors.push('fats_gt_100');

  return { ok: errors.length === 0, errors, ean };
}

(function main() {
  const root = process.cwd();
  const pack1 = path.join(root, 'data', 'seed', 'pack-1.json');
  const pack2 = path.join(root, 'data', 'seed', 'pack-2.json');

  const a = loadPack(pack1);
  const b = loadPack(pack2);
  const all = [...a, ...b];

  const seen = new Set();
  const dups = new Set();
  const bad = [];

  for (const r of all) {
    const v = validateRow(r);
    if (!v.ok) bad.push({ ean: v.ean || r.ean, errors: v.errors, name: r.name });
    if (v.ean) {
      if (seen.has(v.ean)) dups.add(v.ean);
      seen.add(v.ean);
    }
  }

  console.log('[seed:lint]', {
    packs: { pack1: a.length, pack2: b.length },
    total: all.length,
    unique: seen.size,
    duplicates: dups.size,
    badRecords: bad.length,
  });

  if (dups.size) {
    console.log('Duplicates:', Array.from(dups).slice(0, 20));
  }
  if (bad.length) {
    console.log('Bad sample:', bad.slice(0, 5));
  }

  // Tip: náhodných 5 k rychlému ověření v app
  const sample = Array.from(seen).slice(0, 5);
  console.log('Sample EANs for manual test:', sample);
})();

