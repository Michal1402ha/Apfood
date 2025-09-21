// utils/foodDb.js
// Lokální lightweight "databáze" potravin (OFX CZ/SK seed) + EAN lookup + USER upsert.
// Logy: [food:seed], [food:lookup], [food:user], [food:validate], [seed:load], [seed:lookup]

import AsyncStorage from '@react-native-async-storage/async-storage';
// --- SEED: statický import pack-1 (vždy v bundlu) ---
import seedPack1 from '../data/seed/pack-1.json';

let _ofxIndex = new Map();     // EAN(string) -> food object ({..., __source:'OFX'})
let _seedIndex = new Map();    // EAN(string) -> food object ({..., __source:'SEED'})
let _userIndex = new Map();    // EAN(string) -> food object ({..., __source:'USER'})
let _loaded = false;

const SOURCE_OFX = 'OFX';
const SOURCE_SEED = 'SEED';
const SOURCE_USER = 'USER';
const SOURCE_APFOOD = 'APFOOD'; // rezervováno

const USER_MAP_KEY = 'food:user:v1'; // 1 klíč = mapa { [ean]: Food }

// ---------- utils ----------
function cleanEan(ean) {
  const s = String(ean ?? '').replace(/\D+/g, '').trim();
  return s.length ? s : null; // zachová vedoucí nuly
}

function num(v, d = 0) {
  if (v === '' || v == null) return d;
  const x = Number(String(v).replace(',', '.'));
  return Number.isFinite(x) ? x : d;
}

function normalizeSeedRowOFX(row) {
  if (!row || !row.ean) return null;
  const ean = cleanEan(row.ean);
  if (!ean) return null;

  const nutr = row.nutriments || {};
  const food = {
    ean,
    name: String(row.product_name || '').trim() || 'Neznámý produkt',
    brand: (row.brands || '').split(',')[0]?.trim() || undefined,
    kcal: num(nutr['energy-kcal_100g']),
    protein: num(nutr['proteins_100g']),
    fat: num(nutr['fat_100g']),
    carbs: num(nutr['carbohydrates_100g']),
    sugars: (nutr['sugars_100g'] == null ? undefined : num(nutr['sugars_100g'])),
    salt: (nutr['salt_100g'] == null ? undefined : num(nutr['salt_100g'])),
  };
  return food;
}

// SEED pack (schemaVersion 1): { ean, name, brand?, per100g:{kcal,protein,carbs,fats}, source:'SEED' }
function normalizeSeedRowPACK(row) {
  if (!row || !row.ean) return null;
  const ean = cleanEan(row.ean);
  if (!ean) return null;

  const p = row.per100g || {};
  return {
    ean,
    name: String(row.name || '').trim() || 'Neznámý produkt',
    brand: row.brand != null ? String(row.brand).trim() : undefined,
    kcal: num(p.kcal),
    protein: num(p.protein),
    fat: num(p.fats ?? p.fat),
    carbs: num(p.carbs ?? p.carbohydrates),
    sugars: undefined,
    salt: undefined,
  };
}

// ---------- validátor maker (/100 g) ----------
export function isValidNutrients(n = {}) {
  // čísla ≥ 0; tvrdé stropy: kcal ≤ 900, protein_g ≤ 60, carbs_g ≤ 100, fat_g ≤ 100
  const fields = [
    ['kcal', 900],
    ['protein_g', 60],
    ['carbs_g', 100],   // ← upraveno z 95 na 100
    ['fat_g', 100],
  ];
  for (const [key, max] of fields) {
    if (n[key] == null) continue;
    if (typeof n[key] !== 'number' || !Number.isFinite(n[key])) {
      const reason = `not_number:${key}`;
      if (__DEV__) console.log('[food:validate]', 'ok=false', 'reason=' + reason);
      return { ok: false, reason };
    }
    if (n[key] < 0) {
      const reason = `negative:${key}`;
      if (__DEV__) console.log('[food:validate]', 'ok=false', 'reason=' + reason);
      return { ok: false, reason };
    }
    if (n[key] > max) {
      const reason = `limit:${key}>${max}`;
      if (__DEV__) console.log('[food:validate]', 'ok=false', 'reason=' + reason);
      return { ok: false, reason };
    }
  }
  return { ok: true };
}

// ---------- USER storage helpers ----------
async function _readUserMap() {
  try {
    const raw = await AsyncStorage.getItem(USER_MAP_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

async function _writeUserMap(mapObj) {
  try {
    await AsyncStorage.setItem(USER_MAP_KEY, JSON.stringify(mapObj || {}));
  } catch {}
}

async function _readUserByEan(ean) {
  const key = cleanEan(ean);
  if (!key) return null;
  const map = await _readUserMap();
  return map[key] || null;
}

async function _writeUserByEan(ean, food) {
  const key = cleanEan(ean);
  if (!key) return false;
  const map = await _readUserMap();
  map[key] = food;
  await _writeUserMap(map);
  return true;
}

// ---------- SEED pack loader (statický import pack-1 + volitelně pack-2) ----------
function _loadSeedPacks() {
  _seedIndex.clear();

  const packs = [];
  // pack-1 (staticky v bundlu)
  if (Array.isArray(seedPack1)) packs.push(seedPack1);

  // pack-2 je volitelný: pokud je soubor přítomen v repo, includne se přes require s konstantní cestou
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pack2 = require('../data/seed/pack-2.json');
    if (Array.isArray(pack2)) packs.push(pack2);
  } catch (_) {
    // silent — pack-2.json zatím neexistuje
  }

  let rows = 0;
  for (const pack of packs) {
    for (const row of pack) {
      const norm = normalizeSeedRowPACK(row);
      if (norm && norm.ean) {
        _seedIndex.set(norm.ean, { ...norm, __source: SOURCE_SEED });
        rows++;
      }
    }
  }
  console.log('[seed:load]', { count: _seedIndex.size, rows });
}

// ---------- init + indexování ----------
export async function initFoodDb(seedPath = 'assets/data/ofx-czsk.json') {
  if (_loaded) return;

  // OFX seed (bundlovaný JSON)
  let seed = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    seed = require('../assets/data/ofx-czsk.json');
  } catch (e) {
    console.warn('[food:seed] require failed:', e?.message || e);
    seed = [];
  }
  if (!Array.isArray(seed)) {
    console.warn('[food:seed] seed is not an array');
    seed = [];
  }

  _ofxIndex.clear();
  for (const row of seed) {
    const norm = normalizeSeedRowOFX(row);
    if (norm && norm.ean) {
      _ofxIndex.set(norm.ean, { ...norm, __source: SOURCE_OFX });
    }
  }

  // USER overlay z AsyncStorage (přepisuje OFX)
  _userIndex.clear();
  const userMap = await _readUserMap();
  for (const [ean, f] of Object.entries(userMap)) {
    const e = cleanEan(ean);
    if (!e) continue;
    _userIndex.set(e, { ean: e, ...f, __source: SOURCE_USER });
  }

  // SEED packs (pack-1 + volitelně pack-2)
  _loadSeedPacks();

  _loaded = true;
  console.log('[food:seed]', {
    loaded_ofx: _ofxIndex.size,
    loaded_user: _userIndex.size,
    loaded_seed: _seedIndex.size,
    source: SOURCE_OFX,
  });
}

// ---------- lookup s prioritou: USER → SEED → OFX ----------
export async function lookupFoodByEAN(ean) {
  const key = cleanEan(ean);
  if (!_loaded) {
    await initFoodDb();
  }
  if (!key) {
    console.log('[food:lookup] ean=INVALID ok=false');
    return { ok: false, source: null, food: null };
  }

  // USER priorita
  const userHit = _userIndex.get(key);
  if (userHit) {
    const food = {
      ean: userHit.ean,
      name: userHit.name,
      brand: userHit.brand,
      kcal: userHit.kcal,
      protein: userHit.protein,
      fat: userHit.fat,
      carbs: userHit.carbs,
      sugars: userHit.sugars,
      salt: userHit.salt,
    };
    console.log('[food:lookup]', `ean=${key}`, 'ok=true', `source=${SOURCE_USER}`);
    return { ok: true, source: SOURCE_USER, food };
  }

  // SEED packs
  const seedHit = _seedIndex.get(key);
  console.log('[seed:lookup]', `ean=${key}`, `hit=${!!seedHit}`);
  if (seedHit) {
    const food = {
      ean: seedHit.ean,
      name: seedHit.name,
      brand: seedHit.brand,
      kcal: seedHit.kcal,
      protein: seedHit.protein,
      fat: seedHit.fat,
      carbs: seedHit.carbs,
      sugars: seedHit.sugars,
      salt: seedHit.salt,
    };
    console.log('[food:lookup]', `ean=${key}`, 'ok=true', `source=${SOURCE_SEED}`);
    return { ok: true, source: SOURCE_SEED, food };
  }

  // OFX fallback
  const ofxHit = _ofxIndex.get(key);
  if (ofxHit) {
    const food = {
      ean: ofxHit.ean,
      name: ofxHit.name,
      brand: ofxHit.brand,
      kcal: ofxHit.kcal,
      protein: ofxHit.protein,
      fat: ofxHit.fat,
      carbs: ofxHit.carbs,
      sugars: ofxHit.sugars,
      salt: ofxHit.salt,
    };
    console.log('[food:lookup]', `ean=${key}`, 'ok=true', `source=${SOURCE_OFX}`);
    return { ok: true, source: SOURCE_OFX, food };
  }

  console.log('[food:lookup]', `ean=${key}`, 'ok=false', 'source=null');
  return { ok: false, source: null, food: null };
}

// ---------- USER upsert ----------
export async function upsertUserFoodByEAN(
  ean,
  food /* { name:string; brand?:string; kcal?:number; protein_g?:number; carbs_g?:number; fat_g?:number; ... } */
) {
  const key = cleanEan(ean);
  if (!key) {
    console.log('[food:user]', 'upsert', 'ean=INVALID', 'ok=false');
    return { ok: false, reason: 'invalid_ean' };
  }
  const name = String(food?.name || '').trim();
  const brand = food?.brand != null ? String(food.brand).trim() : undefined;

  // validace maker
  const v = {
    kcal: food?.kcal,
    protein_g: food?.protein_g,
    carbs_g: food?.carbs_g,
    fat_g: food?.fat_g,
  };
  const val = isValidNutrients(v);
  if (!val.ok) {
    console.log('[food:user]', 'upsert', `ean=${key}`, 'ok=false', `reason=${val.reason}`);
    return { ok: false, reason: val.reason };
  }

  const entry = {
    ean: key,
    name: name || 'Uživatelská potravina',
    brand: brand || undefined,
    kcal: typeof v.kcal === 'number' ? v.kcal : undefined,
    protein: typeof v.protein_g === 'number' ? v.protein_g : undefined,
    carbs: typeof v.carbs_g === 'number' ? v.carbs_g : undefined,
    fat: typeof v.fat_g === 'number' ? v.fat_g : undefined,
  };

  await _writeUserByEan(key, entry);
  _userIndex.set(key, { ...entry, __source: SOURCE_USER });

  console.log('[food:user]', 'upsert', `ean=${key}`, 'ok=true');
  return { ok: true };
}

// Volitelný reset (pro testy/dev)
export function _resetFoodDb() {
  _ofxIndex.clear();
  _seedIndex.clear();
  _userIndex.clear();
  _loaded = false;
}





