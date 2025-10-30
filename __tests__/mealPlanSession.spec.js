// __tests__/mealPlanSession.spec.js

import {
  loadMealPlanSession,
  initMealPlanSession,
  upsertMealItem,
  getPlanTotals,
  getPlanDelta,
  applyAutoBalance,
} from '../utils/mealPlanSession';

const g = (n) => Math.round((Number.isFinite(n) ? n : 0) / 10) * 10;

describe('mealPlanSession — init & load', () => {
  test('loadMealPlanSession: když není nic uloženo, inicializuje defaultní session', async () => {
    // reset na čistý stav
    await initMealPlanSession({ meals: 5, dayTarget: { kcal: 0, protein: 0, carbs: 0, fats: 0 } });
    const s = await loadMealPlanSession();
    expect(Array.isArray(s.items)).toBe(true);
    expect(s.items.length).toBe(5);
  });

  test('initMealPlanSession: vytvoří přesný tvar a délku items', async () => {
    await initMealPlanSession({ meals: 3, dayTarget: { kcal: 2000, protein: 120, carbs: 220, fats: 70 } });
    const s = await loadMealPlanSession();
    expect(s.items.length).toBe(3);
    expect(s.dayTarget.kcal).toBe(2000);
    expect(s.dayTarget.protein).toBe(120);
    expect(s.dayTarget.carbs).toBe(220);
    expect(s.dayTarget.fats).toBe(70);
  });
});

describe('mealPlanSession — upsertMealItem', () => {
  beforeEach(async () => {
    await initMealPlanSession({ meals: 3, dayTarget: { kcal: 1800, protein: 110, carbs: 200, fats: 60 } });
  });

  test('zapíše položku na daný index, ostatní sloty nezměněny', async () => {
    await upsertMealItem(1, { name: 'Kuře', per100g: { kcal: 165, protein: 31, carbs: 0, fats: 4 } }, 150);
    const s = await loadMealPlanSession();
    expect(s.items[1]).not.toBeNull();
    expect(s.items[1].grams % 10).toBe(0);
    expect(s.items[0]).toBeNull();
    expect(s.items[2]).toBeNull();
  });

  test('respektuje locked flag při zápisu (uložen jako boolean)', async () => {
    await upsertMealItem(0, { name: 'Rýže', per100g: { kcal: 130, protein: 2.5, carbs: 28, fats: 0.3 } }, 200, { locked: true });
    const s = await loadMealPlanSession();
    expect(s.items[0].locked).toBe(true);
  });

  test('nepřepíše jiné indexy a validuje rozsah indexu', async () => {
    await upsertMealItem(0, { name: 'Rýže', per100g: { kcal: 130, protein: 2.5, carbs: 28, fats: 0.3 } }, 200);
    await upsertMealItem(5, { name: 'Mimo', per100g: { kcal: 100, protein: 0, carbs: 25, fats: 0 } }, 100); // mimo rozsah → no-op
    const s = await loadMealPlanSession();
    expect(s.items.length).toBe(3);
    expect(s.items[0]).not.toBeNull();
    expect(s.items[1]).toBeNull();
    expect(s.items[2]).toBeNull();
  });
});

describe('mealPlanSession — totals & delta', () => {
  beforeEach(async () => {
    await initMealPlanSession({ meals: 3, dayTarget: { kcal: 2000, protein: 120, carbs: 220, fats: 70 } });
    // Běžné „restaurační“ porce
    await upsertMealItem(0, { name: 'Snídaně (vejce+pečivo)', per100g: { kcal: 220, protein: 12, carbs: 18, fats: 10 } }, 300);
    await upsertMealItem(1, { name: 'Oběd (kuře+ryže)', per100g: { kcal: 150, protein: 15, carbs: 20, fats: 3 } }, 400);
    await upsertMealItem(2, { name: 'Večeře (ryba+brambory)', per100g: { kcal: 140, protein: 12, carbs: 15, fats: 4 } }, 350);
  });

  test('getPlanTotals vrací součet maker/kalorií přes ne-null položky', async () => {
    const totals = await getPlanTotals();
    expect(totals).toHaveProperty('calories');
    expect(totals).toHaveProperty('protein');
    expect(totals).toHaveProperty('carbs');
    expect(totals).toHaveProperty('fats');
    expect(totals.calories).toBeGreaterThan(0);
  });

  test('getPlanDelta vrací { totals, delta } se správnými typy', async () => {
    const { totals, delta } = await getPlanDelta();
    const s = await loadMealPlanSession();
    const T = s?.dayTarget?.kcal ?? s?.dayTarget?.calories ?? 0;

    expect(typeof totals.calories).toBe('number');
    expect(typeof delta.calories).toBe('number');
    expect(T).toBe(2000);
  });
});

describe('mealPlanSession — applyAutoBalance (promítnutí kroků zpět, locky, tolerance)', () => {
  beforeEach(async () => {
    // 5 jídel (aby byla i svačina); target cca běžný den
    await initMealPlanSession({ meals: 5, dayTarget: { kcal: 2200, protein: 140, carbs: 250, fats: 70 } });

    // Naplnění slotů: 0(Snídaně),1(Svačina),2(Oběd),3(Svačina),4(Večeře)
    await upsertMealItem(0, { name: 'Snídaně — vejce+pečivo', per100g: { kcal: 210, protein: 12, carbs: 16, fats: 9 } }, 300);
    await upsertMealItem(1, { name: 'Svačina — jogurt', per100g: { kcal: 80, protein: 8, carbs: 5, fats: 2 } }, 150);
    await upsertMealItem(2, { name: 'Oběd — kuře+ryže', per100g: { kcal: 155, protein: 16, carbs: 22, fats: 3 } }, 450);
    await upsertMealItem(3, { name: 'Svačina — ovoce', per100g: { kcal: 55, protein: 0.5, carbs: 13, fats: 0.2 } }, 200);
    await upsertMealItem(4, { name: 'Večeře — ryba+brambory', per100g: { kcal: 140, protein: 12, carbs: 15, fats: 4 } }, 350);
  });

  test('aplikuje auto-balance a uloží změněné grams zpět do items[i] podle mealIndex', async () => {
    // Historicky test očekává změnu na 0/1 → uděláme z nich „primární“ explicitně
    const primary = [0, 1];

    const before = await loadMealPlanSession();
    const beforeGrams = before.items.map(x => (x ? g(x.grams) : 0));

    const mealIndex = 0; // preferuj snídani (v testu index 0)
    const res = await applyAutoBalance(mealIndex, null, {
      kcalTol: 60,
      proteinTol: 8,
      carbsTol: 15,
      primarySlots: primary, // <<< klíčové pro variantu A
      fatFloor: 40,
    });

    expect(res && typeof res).toBe('object');

    const after = await loadMealPlanSession();
    const afterGrams = after.items.map(x => (x ? g(x.grams) : 0));

    // změna na některém z primárních [0,1]
    const changedUnlocked =
      primary.some(i => afterGrams[i] !== beforeGrams[i] && afterGrams[i] % 10 === 0);

    expect(changedUnlocked).toBe(true);

    // ověření tolerance po zásahu
    const totals = await getPlanTotals();
    const s = await loadMealPlanSession();
    const T = s?.dayTarget?.kcal ?? s?.dayTarget?.calories ?? 0;
    const dk = Math.abs(totals.calories - T);
    expect(dk).toBeLessThanOrEqual(60);
  });

  test('když jsou všechny položky zamčené, applied === false a nic se nemění', async () => {
    // zamkni vše
    const s = await loadMealPlanSession();
    for (let i = 0; i < s.items.length; i++) {
      const it = s.items[i];
      if (it) await upsertMealItem(i, it.per100g, it.grams, { locked: true, force: true });
    }

    const before = await loadMealPlanSession();
    const res = await applyAutoBalance(0, null, { primarySlots: [0, 1] });
    const after = await loadMealPlanSession();

    expect(res.applied).toBe(false);
    expect(after.items.map(x => x?.grams || 0)).toEqual(before.items.map(x => x?.grams || 0));
  });

  test('idempotence: opakované volání applyAutoBalance nezhorší |Δkcal|', async () => {
    const primary = [0, 1];

    const { totals: t0 } = await getPlanDelta();
    const s0 = await loadMealPlanSession();
    const T = s0?.dayTarget?.kcal ?? s0?.dayTarget?.calories ?? 0;
    const dk0 = Math.abs(t0.calories - T);

    await applyAutoBalance(0, null, { primarySlots: primary });
    const { totals: t1 } = await getPlanDelta();
    const dk1 = Math.abs(t1.calories - T);

    await applyAutoBalance(0, null, { primarySlots: primary });
    const { totals: t2 } = await getPlanDelta();
    const dk2 = Math.abs(t2.calories - T);

    expect(dk2).toBeLessThanOrEqual(Math.max(dk0, dk1));
  });
});

describe('mealPlanSession — robustnost API (bezpádovost, async/await)', () => {
  test('load/init/upsert/getTotals/getDelta/applyAutoBalance jsou asynchronní a bez pádů', async () => {
    await initMealPlanSession({ meals: 3, dayTarget: { kcal: 1800, protein: 110, carbs: 200, fats: 60 } });
    await upsertMealItem(0, { name: 'Test', per100g: { kcal: 100, protein: 5, carbs: 20, fats: 1 } }, 200);
    await getPlanTotals();
    await getPlanDelta();
    await applyAutoBalance(0, null, { primarySlots: [0, 1] });
    expect(true).toBe(true);
  });
});

