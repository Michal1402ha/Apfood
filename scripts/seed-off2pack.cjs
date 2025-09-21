// scripts/seed-off2pack.cjs
// Stáhne OFF JSON (URL), převede na náš pack schema a
// KUMULATIVNĚ sloučí do data/seed/pack-2.json (append + dedupe by EAN).
// Použití:
//   node scripts/seed-off2pack.cjs "<OFF URL>" data/seed/pack-2.json

const fs = require('fs');
const path = require('path');

function cleanEan(e) {
  const s = String(e || '').replace(/\D+/g, '');
  return s.length ? s : null;
}
function num(v) {
  if (v === '' || v == null) return undefined;
  const x = Number(String(v).replace(',', '.'));
  return Number.isFinite(x) ? x : undefined;
}
function normalizeOffRow(row) {
  const ean = cleanEan(row.code);
  if (!ean) return null;
  const name = String(row.product_name || '').trim();
  if (!name) return null;

  const n = row.nutriments || {};
  // bereme energy-kcal_100g; pokud není, zkusíme energy-kj_100g → kcal ~ kj/4.184
  let kcal = num(n['energy-kcal_100g']);
  if (kcal == null && n['energy_100g'] != null && String(n['energy_100g_unit']).toLowerCase() === 'kj') {
    const kj = num(n['energy_100g']);
    if (kj != null) kcal = Math.round((kj / 4.184) * 10) / 10;
  }
  if (kcal == null) return null; // bez kcal nechceme
  const protein = num(n['proteins_100g']);
  const carbs   = num(n['carbohydrates_100g']);
  const fats    = num(n['fat_100g']);

  return {
    ean,
    name,
    brand: (row.brands || '').split(',')[0]?.trim() || undefined,
    per100g: {
      kcal,
      protein,
      carbs,
      fats,
    },
    schemaVersion: 1,
  };
}

async function main() {
  const [,, url, outFile] = process.argv;
  if (!url || !outFile) {
    console.error('Usage: node scripts/seed-off2pack.cjs "<OFF URL>" data/seed/pack-2.json');
    process.exit(1);
  }

  // 1) fetch
  let json;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'apfood-seed/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) {
    console.error('ERROR: fetch failed', e?.message || e);
    process.exit(2);
  }

  const products = Array.isArray(json?.products) ? json.products : [];
  const inCount = products.length;

  // 2) načti existující pack-2 (pokud existuje)
  let existing = [];
  try {
    if (fs.existsSync(outFile)) {
      const raw = fs.readFileSync(outFile, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) existing = arr;
    }
  } catch {}

  // 3) build mapa existujících EAN
  const map = new Map();
  for (const r of existing) {
    const e = cleanEan(r?.ean);
    if (e) map.set(e, r);
  }

  // 4) normalizuj nové řádky a merge
  let written = 0, skippedNoEAN = 0, skippedNoName = 0, skippedNoKcal = 0, duplicated = 0;
  for (const row of products) {
    const norm = normalizeOffRow(row);
    if (!norm) {
      const e = cleanEan(row?.code);
      if (!e) skippedNoEAN++; else if (!row?.product_name) skippedNoName++; else skippedNoKcal++;
      continue;
    }
    if (map.has(norm.ean)) {
      duplicated++;
      // preferuj existující (už jsi ho třeba ručně upravil)
      continue;
    }
    map.set(norm.ean, norm);
    written++;
  }

  // 5) výstup: seřadit (stabilně podle EAN) a zapsat
  const outArr = Array.from(map.values()).sort((a, b) => String(a.ean).localeCompare(String(b.ean)));
  const outDir = path.dirname(outFile);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(outArr, null, 2), 'utf8');

  console.log('[off2pack]', {
    input: url,
    output: outFile,
    inCount,
    written,
    skippedNoEAN,
    skippedNoName,
    skippedNoKcal,
    duplicated,
    kept: outArr.length,
    prev: existing.length,
    addedOrKept: outArr.length - existing.length, // čistý přírůstek
  });

  console.log('Next steps:\n  node scripts/seed-lint.cjs\n  node scripts/seed-dedupe.cjs');
}

main().catch((e) => {
  console.error('Unexpected error', e);
  process.exit(3);
});

