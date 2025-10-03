// app/logic/__tests__/orbit.animated.test.ts
// Jednotkové testy pro animovací pomocníky (čisté TS, žádné UI).

import {
  twoPi,
  normAngle,
  wrapAngle,
  orbitPosition,
  depthOrder,
  angleVelocityForPeriod,
} from '../orbit';

describe('orbitPosition — 0 nahoře, CW+', () => {
  const cx = 100, cy = 100, R = 50;

  test('angle = 0 → nahoře', () => {
    const p = orbitPosition(cx, cy, R, 0);
    expect(p.x).toBeCloseTo(cx, 6);
    expect(p.y).toBeCloseTo(cy - R, 6);
  });

  test('angle = π/2 → vpravo', () => {
    const p = orbitPosition(cx, cy, R, Math.PI / 2);
    expect(p.x).toBeCloseTo(cx + R, 6);
    expect(p.y).toBeCloseTo(cy, 6);
  });

  test('angle = π → dole', () => {
    const p = orbitPosition(cx, cy, R, Math.PI);
    expect(p.x).toBeCloseTo(cx, 6);
    expect(p.y).toBeCloseTo(cy + R, 6);
  });

  test('angle = 3π/2 → vlevo', () => {
    const p = orbitPosition(cx, cy, R, 3 * Math.PI / 2);
    expect(p.x).toBeCloseTo(cx - R, 6);
    expect(p.y).toBeCloseTo(cy, 6);
  });
});

describe('depthOrder — škálovaný z-index', () => {
  test('rozsah v <0..1>', () => {
    for (const a of [0, Math.PI/4, Math.PI/2, 3*Math.PI/4, Math.PI, 2*Math.PI]) {
      const z = depthOrder(a);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(1);
    }
  });

  test('monotónně roste na <0,π>', () => {
    const samples = 16;
    let prev = depthOrder(0);
    for (let i=1;i<=samples;i++){
      const a = (Math.PI * i) / samples;
      const z = depthOrder(a);
      expect(z).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = z;
    }
  });

  test('0 → 0, π → 1 (pro mapování (1 - cos)/2)', () => {
    expect(depthOrder(0)).toBeCloseTo(0, 6);
    expect(depthOrder(Math.PI)).toBeCloseTo(1, 6);
  });
});

describe('angleVelocityForPeriod', () => {
  test('2π za periodu', () => {
    const T = 2000; // ms
    const w = angleVelocityForPeriod(T); // rad/ms
    expect(w * T).toBeCloseTo(twoPi, 8);
  });

  test('neplatná perioda → 0', () => {
    expect(angleVelocityForPeriod(0)).toBe(0);
    expect(angleVelocityForPeriod(-100)).toBe(0);
    // NaN/Infinity
    expect(angleVelocityForPeriod(Number.NaN)).toBe(0);
    expect(angleVelocityForPeriod(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('wrapAngle / normAngle', () => {
  test('aliasy dávají stejné výsledky', () => {
    const xs = [-1, 0, twoPi, 7*Math.PI, -5.7];
    for (const x of xs) {
      expect(wrapAngle(x)).toBeCloseTo(normAngle(x), 12);
    }
  });
});
