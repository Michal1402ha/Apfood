// scripts/seed-off-presets.cjs
// OFF "presety" → stáhnout položky pro CZ řetězce a sloučit do data/seed/pack-2.json
// Spuštění: node scripts/seed-off-presets.cjs

const fs = require('fs');
const path = require('path');

// ---- Konfigurace ----
const CHAINS = [
  'Lidl',
  'Kaufland',
  'Albert',
  'Tesco',
  'Billa',
  'Penny',
  'Globus',
];

const OFF_BASE = 'https://world.openfoodfacts.org/cgi/search.pl';
const PAGE_SIZE = 2000;
const FIELDS = ['code', 'product_name', 'brands', 'nutriments'];
const COUNTRIES = 'Czech Republic';

// Limity (per 100 g)
const LIMITS = {
  kcal:   { min: 0, max: 900 },
  protein:{ min: 0, max: 60 },
  carbs:  { min: 0, max: 100 }, // dle posledního požadavku
  fats:   { min: 0, max: 100 },
};

// ---- Pomocné utilitky ----
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const _fetch = (typeof fetch !== 'undefined')
  ? fetch
  : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function cleanEAN(e) {
  const s = String(e || '').replace(/[^\d]/g, '');
  return s || null;
}

// EAN-13 checksum validace
function isValidEAN13(e) {
  const s = cleanEAN(e);
  if (!s || s.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * Number(s[i]);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(s[12]);
}

// UPC-A (12) → EAN-13 (prefix '0'), zvalidujeme a dopočítáme CD
function upcaToEan13Strict(upca12) {
  const s = cleanEAN(upca12);
  if (!s || s.length !== 12) return null;
  const first12 = '0' + s.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 ? 3 : 1) * Number(first12[i]);
  const check = (10 - (sum % 10)) % 10;
  const ean13 = first12 + String(check);
  return isValidEAN13(ean13) ? ean13 : null;
}

function firstBrand(brandsStr) {
  if (!brandsStr) return undefined;
  const parts = String(brandsStr).split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[0] : undefined;
}

// Mapování OFF nutriments → naše /100 g
function extractPer100g(nutri = {}) {
  // kcal
  const kcalDirect = toNum(nutri['energy-kcal_100g'])
                  ?? (String(nutri['energy-kcal_unit'] || '').toLowerCase() === 'kcal' ? toNum(nutri['energy-kcal_value']) : null);
  const kcalFromKJ = toNum(nutri['energy-kj_100g']);
  const kcalFromEnergy = toNum(nutri['energy_100g']); // často v kJ

  let kcal = kcalDirect;
  if (kcal == null && kcalFromKJ != null) kcal = kcalFromKJ / 4.184;
  if (kcal == null && kcalFromEnergy != null) {
    // heuristika: OFF 'energy_100g' bývá v kJ
    kcal = kcalFromEnergy / 4.184;
  }
  if (kcal != null) kcal = Math.round(kcal); // int

  // makra
  let protein = toNum(nutri['proteins_100g']) ?? toNum(nutri['proteins']);
  let carbs   = toNum(nutri['carbohydrates_100g']) ?? toNum(nutri['carbohydrates']);
  let fats    = toNum(nutri['fat_100g']) ?? toNum(nutri['fat']);

  if (protein == null) protein = 0;
  if (carbs   == null) carbs   = 0;
  if (fats    == null) fats    = 0;

  return {
    kcal,
    protein: Number(protein.toFixed(1)),
    carbs:   Number(carbs.toFixed(1)),
    fats:    Number(fats.toFixed(1)),
  };
}

function isWithinLimits(per100g) {
  const kcalOk   = per100g.kcal   != null && per100g.kcal   >= LIMITS.kcal.min   && per100g.kcal   <= LIMITS.kcal.max;
  const proteinOk= per100g.protein!= null && per100g.protein>= LIMITS.protein.min&& per100g.protein<= LIMITS.protein.max;
  const carbsOk  = per100g.carbs  != null && per100g.carbs  >= LIMITS.carbs.min  && per100g.carbs  <= LIMITS.carbs.max;
  const fatsOk   = per100g.fats   != null && per100g.fats   >= LIMITS.fats.min   && per100g.fats   <= LIMITS.fats.max;
  return kcalOk && proteinOk && carbsOk && fatsOk;
}

function mapOFFRow(row) {
  // EAN / UPC normalizace
  let ean = cleanEAN(row.code);
  if (!ean) return null;

  // vynecháme 12-místné kódy (UPC-A) pokud je nedokážeme převést
  if (ean.length === 12) {
    const asEan13 = upcaToEan13Strict(ean);
    if (!asEan13) return null;
    ean = asEan13;
  }

  if (ean.length !== 13 && ean.length !== 8) return null;

  const name = String(row.product_name || '').trim();
  if (!name) return null;

  const brand = firstBrand(row.brands);
  const per100g = extractPer100g(row.nutriments || {});
  if (per100g.kcal == null) return null;         // musi mit kcal
  if (!isWithinLimits(per100g)) return null;     // limity

  return {
    ean,
    name,
    brand,
    per100g: {
      kcal: per100g.kcal,
      protein: per100g.protein,
      carbs: per100g.carbs,
      fats: per100g.fats,
    },
    schemaVersion: 1,
  };
}

// ---- OFF fetch s retry/backoff ----
async function fetchOFF(params, retries = 3) {
  const url = new URL(OFF_BASE);
  const sp = url.searchParams;
  sp.set('search_simple', '1');
  sp.set('action', 'process');
  sp.set('json', '1');
  sp.set('page_size', String(PAGE_SIZE));
  sp.set('fields', FIELDS.join(','));

  // tagové filtry (OFF styl)
  if (params.brands || params.stores) {
    sp.set('tagtype_0', params.brands ? 'brands' : 'stores');
    sp.set('tag_contains_0', 'contains');
    sp.set('tag_0', params.brands || params.stores);
  }
  sp.set('tagtype_1', 'countries');
  sp.set('tag_contains_1', 'contains');
  sp.set('tag_1', COUNTRIES);

  let attempt = 0;
  while (true) {
    try {
      const res = await _fetch(url.toString());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const products = Array.isArray(json.products) ? json.products : [];
      return products;
    } catch (err) {
      attempt++;
      console.log('[off2pack:fetch]', {
        where: params.brands ? `brands=${params.brands}` : `stores=${params.stores}`,
        attempt,
        error: (err && err.message) || String(err),
      });
      if (attempt >= retries) return [];
      const backoff = 500 * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }
  }
}

// ---- Merge do pack-2.json ----
function readExistingPack2(root) {
  const file = path.join(root, 'data', 'seed', 'pack-2.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return { file, list: [], map: new Map() };
    const map = new Map();
    for (const it of arr) {
      const e = cleanEAN(it.ean);
      if (e) map.set(e, it);
    }
    return { file, list: arr, map };
  } catch {
    return { file, list: [], map: new Map() };
  }
}

function writePack2(file, map) {
  const list = Array.from(map.values());
  // stabilní sort (podle ean)
  list.sort((a, b) => String(a.ean).localeCompare(String(b.ean)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf8');
}

// ---- Hlavní běh ----
(async function main() {
  const root = process.cwd();
  const { file, map: existingMap } = readExistingPack2(root);

  let fetchedTotal = 0;
  let considered = 0;
  let added = 0;
  let skippedInvalid = 0;
  let dupSeen = 0;

  for (const chain of CHAINS) {
    // 1) brand
    const byBrand = await fetchOFF({ brands: chain });
    fetchedTotal += byBrand.length;
    console.log('[off2pack:fetch]', { type: 'brand', chain, count: byBrand.length });

    for (const row of byBrand) {
      considered++;
      const norm = mapOFFRow(row);
      if (!norm) { skippedInvalid++; continue; }
      if (existingMap.has(norm.ean)) { dupSeen++; continue; }
      existingMap.set(norm.ean, { ...norm, source: 'SEED' });
      added++;
    }

    // 2) store
    const byStore = await fetchOFF({ stores: chain });
    fetchedTotal += byStore.length;
    console.log('[off2pack:fetch]', { type: 'store', chain, count: byStore.length });

    for (const row of byStore) {
      considered++;
      const norm = mapOFFRow(row);
      if (!norm) { skippedInvalid++; continue; }
      if (existingMap.has(norm.ean)) { dupSeen++; continue; }
      existingMap.set(norm.ean, { ...norm, source: 'SEED' });
      added++;
    }
  }

  writePack2(file, existingMap);

  console.log('[off2pack:merge]', {
    fetchedTotal,
    considered,
    added,
    skippedInvalid,
    duplicates: dupSeen,
    output: path.relative(process.cwd(), file),
    finalCount: existingMap.size,
  });
})();

