// scripts/seed-prune.cjs
// Rychlé odebrání konkrétních EANů z data/seed/pack-2.json
// Použití: node scripts/seed-prune.cjs <EAN> [<EAN> ...]
// Příklad: node scripts/seed-prune.cjs 4335619057876
const fs = require('fs');
const path = require('path');

(function main(){
  const root = process.cwd();
  const file = path.join(root, 'data', 'seed', 'pack-2.json');
  const toDrop = new Set(process.argv.slice(2).map(s => String(s).replace(/\D+/g, '')));
  if (!toDrop.size) {
    console.log('Usage: node scripts/seed-prune.cjs <EAN> [<EAN> ...]');
    process.exit(1);
  }

  const raw = fs.readFileSync(file, 'utf8');
  const arr = JSON.parse(raw);
  const before = arr.length;
  const out = arr.filter(x => !toDrop.has(String(x.ean).replace(/\D+/g,'')));

  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('[seed:prune]', {
    removed: before - out.length,
    before,
    after: out.length,
    dropped: Array.from(toDrop)
  });
})();
