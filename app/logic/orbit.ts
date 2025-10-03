// app/logic/orbit.ts
// -----------------------------------------------------------------------------
// Čistá, testovatelná logika pro orbit (bez UI závislostí).
// Konvence úhlů: RADIÁNY, 0 rad = NAHOŘE (vektor míří nahoru), směr roste PO SMĚRU HODIN.
// -----------------------------------------------------------------------------
// Vstupy/výstupy:
// - Všechny úhly v radiánech.
// - normAngle(rad) / wrapAngle(rad) vrací <0, 2π).
// - angleDiffRad(a,b) vrací nejkratší rozdíl v intervalu (-π, π] tak, že a + diff ≡ b (mod 2π).
// - pointToAngleRad(cx,cy,x,y): úhel bodu (x,y) vzhledem ke středu (cx,cy) v naší konvenci.
// - snapToNearest(currentRad, count, offsetRad): najde nejbližší „stanici“ (index) a vrátí zacvaknutý úhel.
// - activeIndexForAngle(hotspotsPx, cx, cy, angleRad): vybere index hotspotu nejblíže danému úhlu.
// - orbitPosition(cx, cy, R, angleRad): pozice bodu na kružnici při úhlu (0 nahoře, CW+).
// - depthOrder(angleRad): škálovaný „z-index“ v <0..1> (např. (1 - cos(angle))/2).
// - angleVelocityForPeriod(periodMs): rad/ms pro plný oběh za danou periodu.
// -----------------------------------------------------------------------------

export const twoPi = Math.PI * 2;

/** Normalizuje úhel do intervalu <0, 2π). */
export function normAngle(rad: number): number {
  let a = rad % twoPi;
  if (a < 0) a += twoPi;
  return a;
}

/** Alias pro normAngle – pohodlnější pojmenování pro animace. */
export const wrapAngle = normAngle;

/**
 * Nejkratší rozdíl úhlů (b - a) v intervalu (-π, π].
 * Přičti k 'a' → dostaneš úhel ekvivalentní 'b'.
 */
export function angleDiffRad(a: number, b: number): number {
  let d = normAngle(b) - normAngle(a);
  if (d > Math.PI) d -= twoPi;
  if (d <= -Math.PI) d += twoPi;
  return d;
}

/**
 * Úhel bodu (x,y) vůči středu (cx,cy) v naší konvenci:
 *  - 0 rad = nahoře
 *  - úhel roste po směru hodin (CW)
 *
 * Standardní atan2(y-cy, x-cx) má 0 na +X a roste CCW.
 * Pro „0 nahoře, CW+“: aStd = atan2(dy, dx); aTopCCW = aStd + π/2; aTopCW = -aTopCCW.
 */
export function pointToAngleRad(cx: number, cy: number, x: number, y: number): number {
  const dx = x - cx;
  const dy = y - cy;
  const aStd = Math.atan2(dy, dx);     // 0 na +X, CCW+
  const aTopCCW = aStd + Math.PI / 2;  // 0 na +Y (nahoře), CCW+
  const aTopCW = -aTopCCW;              // 0 na +Y, CW+
  return normAngle(aTopCW);
}

/** Krok mezi sousedními stanicemi při N pozicích. */
export function STEP(N: number): number {
  return twoPi / N;
}

/** Index pro daný úhel, s offsetem (offset říká, kde leží index 0). */
export function indexForAngle(angleRad: number, count: number, offsetRad = 0): number {
  const step = STEP(count);
  const a = normAngle(angleRad - offsetRad);
  return Math.round(a / step) % count;
}

/** Úhel pro daný index (kanonická pozice) s offsetem. */
export function angleForIndex(index: number, count: number, offsetRad = 0): number {
  return normAngle(offsetRad + index * STEP(count));
}

/** Zacvaknutí na nejbližší stanici (zachovává kompatibilitu – vrací i index). */
export function snapToNearest(
  currentRad: number,
  count: number,
  offsetRad = 0
): { snapped: number; index: number } {
  const idx = indexForAngle(currentRad, count, offsetRad);
  const snapped = angleForIndex(idx, count, offsetRad);
  return { snapped, index: idx };
}

/**
 * Vybere aktivní index z pole hotspotů (pixelové souřadnice) vůči úhlu „ručičky“.
 * Algoritmus: spočti úhel každého hotspotu, zvol ten s nejmenší |angleDiffRad(ručička, hotspotAngle)|.
 */
export function activeIndexForAngle(
  hotspotsPx: Array<{ x: number; y: number }>,
  cx: number,
  cy: number,
  angleRad: number
): number {
  if (!hotspotsPx || hotspotsPx.length === 0) return -1;
  let bestIdx = 0;
  let bestAbs = Number.POSITIVE_INFINITY;
  for (let i = 0; i < hotspotsPx.length; i++) {
    const a = pointToAngleRad(cx, cy, hotspotsPx[i].x, hotspotsPx[i].y);
    const d = Math.abs(angleDiffRad(angleRad, a));
    if (d < bestAbs) {
      bestAbs = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Rovnoměrné rozmístění N bodů na kružnici (debug/test).
 * startAngle výchozí -π/2 (nahoře v klasické param vlně).
 */
export function positionsOnCircle(
  N: number,
  center: { x: number; y: number },
  radius: number,
  startAngle = -Math.PI / 2
): Array<{ x: number; y: number; angle: number; index: number }> {
  const out = [];
  const step = STEP(N);
  for (let i = 0; i < N; i++) {
    const a = startAngle + i * step;
    out.push({
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
      angle: normAngle(a),
      index: i,
    });
  }
  return out;
}

/**
 * Pozice na kružnici pro animaci v naší konvenci (0 nahoře, CW+).
 * DŮLEŽITÉ: RN má osu Y směrem dolů, proto:
 *   x = cx + R * sin(angle)
 *   y = cy - R * cos(angle)
 */
export function orbitPosition(
  cx: number,
  cy: number,
  R: number,
  angleRad: number
): { x: number; y: number } {
  return {
    x: cx + R * Math.sin(angleRad),
    y: cy - R * Math.cos(angleRad),
  };
}

/**
 * Škálovaný „z-index“ v <0..1> pro vrstvení (např. pro třídění vrstev).
 * Doporučené mapování: (1 - cos(angle)) / 2
 * - 0 rad (nahoře) → z=0
 * - π rad (dole)   → z=1
 * Monotónně roste v intervalu <0,π>.
 */
export function depthOrder(angleRad: number): number {
  return (1 - Math.cos(normAngle(angleRad))) / 2;
}

/** Úhlová rychlost (rad/ms) pro plný oběh za dané periodMs. */
export function angleVelocityForPeriod(periodMs: number): number {
  if (!Number.isFinite(periodMs) || periodMs <= 0) return 0;
  return twoPi / periodMs;
}

// Default export pro pohodlný import v testech/UI.
export default {
  twoPi,
  normAngle,
  wrapAngle,
  angleDiffRad,
  pointToAngleRad,
  STEP,
  indexForAngle,
  angleForIndex,
  snapToNearest,
  activeIndexForAngle,
  positionsOnCircle,
  orbitPosition,
  depthOrder,
  angleVelocityForPeriod,
};


