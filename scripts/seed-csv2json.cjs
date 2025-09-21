// scripts/seed-csv2json.cjs
// Použití: node scripts/seed-csv2json.cjs input.csv data/seed/pack-2.json
const fs = require('fs');
const path = require('path');

function parseCSV(text) {
  // jednoduchý parser s podporou uvozovek; oddělovač ; nebo , auto-detekce z hlavičky
  const firstLine = text.split(/\r?\n/).find(Boolean) || '';
  const delim = firstLine.includes(';') ? ';' : ',';
  const rows = [];
  let i = 0, field = '', inQ = false, row = [];
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { if (row.length) rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i++];
    if (inQ) {
      if (ch === '"') {
        if (text[i] === '"') { field += '"'; i++; } else { inQ = false; }
      } else { field += ch; }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === '\n') { pushField(); pushRow(); }
      else if (ch === '\r') { /* ignore */ }
      else if (ch === delim) { pushField(); }
      else { field += ch; }
    }
  }
  pushField(); pushRow();
  // strip empty trailing row
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
  return rows;
}

function toNum(x) {
  if (x == null) return undefined;
  const n = Number(String(x).replace(',', '.').trim());
  return Number.isFinite(n) ? n : undefined;
}

function cleanEan(e) {
  const s = String(e || '').replace(/\D+/g, '').trim();
  return s.length ? s : null;
}

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('Usage: node scripts/seed-csv2json.cjs <input.csv> <output.json>');
  process.exit(1);
}

const raw = fs.readFileSync(path.resolve(inPath), 'utf8');
const rows = parseCSV(raw);
if (!rows.length) {
  console.error('Empty CSV/TSV.');
  process.exit(2);
}

const header = rows[0].map(h => h.trim().toLowerCase());
const idx = f => header.indexOf(f);
const req = ['ean','name','brand','kcal','protein','carbs','fats'];
for (const f of req) if (idx(f) < 0) {
  console.error('Missing column:', f);
  process.exit(3);
}

const out = [];
const seen = new Set();
for (let r = 1; r < rows.length; r++) {
  const row = rows[r];
  const ean = cleanEan(row[idx('ean')]);
  const name = String(row[idx('name')] || '').trim();
  const brand = String(row[idx('brand')] || '').trim() || undefined;
  const kcal = toNum(row[idx('kcal')]);
  const protein = toNum(row[idx('protein')]);
  const carbs = toNum(row[idx('carbs')]);
  const fats = toNum(row[idx('fats')]);

  if (!ean || !name || !Number.isFinite(kcal)) continue; // minimální požadavky
  if (kcal > 900 || protein > 60 || carbs > 95 || fats > 100) continue; // sanity

  if (seen.has(ean)) continue;
  seen.add(ean);

  out.push({
    ean, name, brand,
    per100g: { kcal, protein, carbs, fats },
    schemaVersion: 1
  });
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('[seed:csv2json]', { input: inPath, output: outPath, written: out.length });
