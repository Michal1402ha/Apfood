// screens/FoodDetailScreen.js
import React, { useMemo, useState, useEffect } from 'react';
import { View, Text, Image, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';

import { foods } from '../data/foods';
import ScreenBackground from '../components/ScreenBackground';
import { satietyV2 } from '../utils/satiety';
import { gramsForSingle, evaluateMealHit } from '../utils/mealMath';
import { upsertMealItemEx } from '../utils/mealPlanSession';
import { decomposeCombo } from '../utils/composition';

// 🔗 Datová vrstva pro EAN
import { upsertUserFoodByEAN, lookupFoodByEAN } from '../utils/foodDb';

// 🧺 Volné položky dne (target:'dayExtras' → CTA „Přidat do dne“)
import { addExtraToToday } from '../utils/myDayExtras';

/** ----- Badge zdroje (OFX / USER / APFOOD / SEED) ----- */
const SourceBadge = ({ source }) => {
  if (!source) return null;
  const map = {
    OFX:   { bg: '#0ea5e9', fg: '#fff' },
    USER:  { bg: '#22c55e', fg: '#fff' },
    APFOOD:{ bg: '#f59e0b', fg: '#111' },
    SEED:  { bg: '#9333ea', fg: '#fff' },
  };
  const s = map[source] || { bg: '#e5e7eb', fg: '#111' };
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Text style={[styles.badgeText, { color: s.fg }]}>{source}</Text>
    </View>
  );
};

/** Bezpečné přečtení per100g (fallback na starší shape) */
function per100FromFood(item) {
  const p = item?.per100g || {};
  return {
    kcal: Number(p?.kcal ?? item?.calories ?? 0) || 0,
    protein: Number(p?.protein ?? item?.protein ?? 0) || 0,
    carbs: Number(p?.carbs ?? item?.carbs ?? 0) || 0,
    fats: Number(p?.fats ?? item?.fats ?? 0) || 0,
  };
}

/** Rozdělení celkové gramáže mezi main/side podle ratio (default 60/40) */
function gramsForComp(totalG, comp) {
  const clamp = (g) => Math.max(0, Math.round(Number(g) || 0));
  const mr = comp?.main ? (Number(comp.main.ratio) || 0.6) : 0;
  let mainG = comp?.main ? clamp(totalG * mr) : 0;
  let sideG = comp?.side ? clamp(totalG - mainG) : 0;
  const diff = clamp(totalG) - (mainG + sideG);
  if (diff !== 0) {
    if (comp?.side) sideG += diff;
    else mainG += diff;
  }
  return { mainG, sideG };
}

/** Převod výsledku lookupu na interní item */
function itemFromLookup(food, ean) {
  if (!food) return null;
  const kcal    = food.kcal ?? food.calories ?? null;
  const protein = food.protein_g ?? food.protein ?? null;
  const carbs   = food.carbs_g ?? food.carbs ?? food.carbohydrates ?? null;
  const fats    = food.fat_g ?? food.fats ?? food.fat ?? null;
  return {
    id: food.id ?? (ean ? `ean:${ean}` : undefined),
    name: food.name || '—',
    brand: food.brand || undefined,
    imageUrl: food.imageUrl || food.image || null,
    calories: kcal,
    protein,
    carbs,
    fats,
    per100g: {
      kcal:    Number(kcal ?? 0)    || 0,
      protein: Number(protein ?? 0) || 0,
      carbs:   Number(carbs ?? 0)   || 0,
      fats:    Number(fats ?? 0)    || 0,
    },
    description: food.description || undefined,
  };
}

function formatAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const rounded = Math.round(n * 10) / 10;
  return Math.abs(rounded - Math.round(rounded)) < 1e-9
    ? String(Math.round(rounded))
    : String(rounded.toFixed(1));
}

/** Parse čísla: ''/null => undefined; validní číslo => Number; jinak undefined */
function n(v) {
  if (v === '' || v == null) return undefined;
  const x = Number(String(v).replace(',', '.').trim());
  return Number.isFinite(x) ? x : undefined;
}

/** Mapování reason -> CZ hláška + pole s chybou */
function mapReason(reason) {
  if (!reason) return { message: 'Neznámá chyba.', field: null };
  if (reason === 'invalid_ean') return { message: 'Neplatný EAN.', field: null };

  const label = (key) => ({
    kcal: 'Kalorie',
    protein_g: 'Bílkoviny',
    carbs_g: 'Sacharidy',
    fat_g: 'Tuky',
    name: 'Název',
  }[key] || key);

  if (reason.startsWith('not_number:')) {
    const key = reason.split(':')[1];
    return { message: `Pole ${label(key)} musí být číslo.`, field: key };
  }
  if (reason.startsWith('negative:')) {
    const key = reason.split(':')[1];
    return { message: `Pole ${label(key)} nemůže být záporné.`, field: key };
  }
  if (reason.startsWith('limit:')) {
    const lim = reason.replace('limit:', '');
    if (lim.startsWith('kcal>'))      return { message: 'Kalorie musí být ≤ 900 /100 g.', field: 'kcal' };
    if (lim.startsWith('protein_g>')) return { message: 'Bílkoviny musí být ≤ 60 g /100 g.', field: 'protein_g' };
    if (lim.startsWith('carbs_g>'))   return { message: 'Sacharidy musí být ≤ 100 g /100 g.', field: 'carbs_g' }; // ← upraveno z 95 na 100
    if (lim.startsWith('fat_g>'))     return { message: 'Tuky musí být ≤ 100 g /100 g.', field: 'fat_g' };
  }
  return { message: 'Uložení se nezdařilo.', field: null };
}

/** ---------- Komponenta ---------- */
export default function FoodDetailScreen() {
  const route = useRoute();
  const navigation = useNavigation();

  // Z routeru (ScanFood → detail)
  const {
    itemId,
    item: passedItem,
    mealTarget,
    mealIndex,
    mealSlot,
    ean,
    result,       // { ok, source, food }
    target,       // 🆕 'dayExtras' → CTA „Přidat do dne“
  } = route.params || {};

  // Střídání zdrojů výsledku: po uložení nastavujeme latestResult
  const [latestResult, setLatestResult] = useState(result || null);
  const effectiveResult = latestResult || result || null; // 🔑 jednotný zdroj pravdy
  const effectiveSource = effectiveResult?.source || null;
  const lookupFoodEff = effectiveResult?.food || null;

  // Pokud přichází výsledek z EAN lookupu, normalizuj a použij přednostně
  const scanItem = useMemo(() => {
    if (lookupFoodEff) return itemFromLookup(lookupFoodEff, ean);
    return null;
  }, [lookupFoodEff, ean]);

  const item = useMemo(() => {
    if (scanItem) return scanItem;
    if (passedItem) return passedItem;
    if (itemId == null) return null;
    const found = Array.isArray(foods) ? foods.find(f => String(f.id) === String(itemId)) : null;
    return found || null;
  }, [scanItem, itemId, passedItem]);

  // Detekce „chybí makra“
  const lookupOk = !!(effectiveResult && effectiveResult.ok);
  const macrosMissing = !!(lookupFoodEff && (
    (lookupFoodEff.kcal == null) ||
    (lookupFoodEff.protein_g == null && lookupFoodEff.protein == null) ||
    (lookupFoodEff.carbs_g == null && lookupFoodEff.carbs == null && lookupFoodEff.carbohydrates == null) ||
    (lookupFoodEff.fat_g == null && lookupFoodEff.fats == null && lookupFoodEff.fat == null)
  ));

  // Editační mód: když lookup selhal nebo chybí makra
  const shouldEditInitial = (!!ean && (!lookupOk || macrosMissing));
  const [editing, setEditing] = useState(shouldEditInitial);
  const [savedNotice, setSavedNotice] = useState('');

  // Log: otevření editačního režimu (jednou)
  useEffect(() => {
    if (editing) console.log('[fooddetail:edit] open ean=', ean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  // ---------- Stav formuláře (prefill z effectiveResult, pokud existuje) ----------
  const [name, setName] = useState(lookupFoodEff?.name ? String(lookupFoodEff.name) : '');
  const [brand, setBrand] = useState(lookupFoodEff?.brand ? String(lookupFoodEff.brand) : '');
  const [kcal, setKcal] = useState(lookupFoodEff?.kcal != null ? String(lookupFoodEff.kcal) : '');
  const [protein, setProtein] = useState(
    lookupFoodEff?.protein_g != null
      ? String(lookupFoodEff.protein_g)
      : (lookupFoodEff?.protein != null ? String(lookupFoodEff.protein) : '')
  );
  const [carbs, setCarbs] = useState(
    lookupFoodEff?.carbs_g != null
      ? String(lookupFoodEff.carbs_g)
      : (lookupFoodEff?.carbs != null
          ? String(lookupFoodEff.carbs)
          : (lookupFoodEff?.carbohydrates != null ? String(lookupFoodEff.carbohydrates) : ''))
  );
  const [fat, setFat] = useState(
    lookupFoodEff?.fat_g != null
      ? String(lookupFoodEff.fat_g)
      : (lookupFoodEff?.fats != null ? String(lookupFoodEff.fats) : (lookupFoodEff?.fat != null ? String(lookupFoodEff.fat) : ''))
  );
  const [loadingSave, setLoadingSave] = useState(false);
  const [errField, setErrField] = useState(null);
  const [errText, setErrText] = useState('');

  // 🔁 Resync formuláře při změně výsledku/eanu (např. po úspěšném upsertu → nový lookup)
  useEffect(() => {
    if (!editing) return; // resync dává smysl jen v editačním režimu
    const lf = lookupFoodEff || {};
    setName(lf.name ? String(lf.name) : '');
    setBrand(lf.brand ? String(lf.brand) : '');
    setKcal(lf.kcal != null ? String(lf.kcal) : '');
    setProtein(
      lf.protein_g != null
        ? String(lf.protein_g)
        : (lf.protein != null ? String(lf.protein) : '')
    );
    setCarbs(
      lf.carbs_g != null
        ? String(lf.carbs_g)
        : (lf.carbs != null
            ? String(lf.carbs)
            : (lf.carbohydrates != null ? String(lf.carbohydrates) : ''))
    );
    setFat(
      lf.fat_g != null
        ? String(lf.fat_g)
        : (lf.fats != null ? String(lf.fats) : (lf.fat != null ? String(lf.fat) : ''))
    );
  }, [
    editing,
    ean,
    lookupFoodEff?.name,
    lookupFoodEff?.brand,
    lookupFoodEff?.kcal,
    lookupFoodEff?.protein_g, lookupFoodEff?.protein,
    lookupFoodEff?.carbs_g, lookupFoodEff?.carbs, lookupFoodEff?.carbohydrates,
    lookupFoodEff?.fat_g, lookupFoodEff?.fats, lookupFoodEff?.fat
  ]);

  // Hide notice after a while (read-only větev)
  useEffect(() => {
    if (!savedNotice) return;
    const t = setTimeout(() => setSavedNotice(''), 2500);
    return () => clearTimeout(t);
  }, [savedNotice]);

  // ---------- Recept – hooky na top-level ----------
  const recipe = useMemo(() => {
    const r = (item || {})?.recipe || {};
    const baseServ = Number(r?.servings ?? (item || {})?.servings ?? 1) || 1;
    const ingredients = Array.isArray(r?.ingredients) ? r.ingredients
                      : Array.isArray((item || {})?.ingredients) ? (item || {})?.ingredients
                      : [];
    const instructions = Array.isArray(r?.instructions) ? r.instructions
                      : Array.isArray((item || {})?.instructions) ? (item || {})?.instructions
                      : [];
    return {
      servings: baseServ,
      ingredients,
      instructions,
      prepTime: r?.prepTime || (item || {})?.prepTime || null,
      cookTime: r?.cookTime || (item || {})?.cookTime || null,
    };
  }, [item]);
  const hasRecipe = (recipe?.ingredients?.length > 0) || (recipe?.instructions?.length > 0);
  const [servings, setServings] = useState(Number(recipe.servings) || 1);
  useEffect(() => {
    setServings(Number(recipe.servings) || 1);
  }, [recipe.servings]);
  const decServ = () => setServings(s => Math.max(1, Math.round((s - 1) || 1)));
  const incServ = () => setServings(s => Math.max(1, Math.round((s + 1) || 2)));
  const scaledIngredients = useMemo(() => {
    if (!hasRecipe) return [];
    const base = Number(recipe.servings) || 1;
    const factor = base > 0 ? (Number(servings) || 1) / base : 1;
    return recipe.ingredients.map(ing => {
      const amt = Number(ing.amount);
      const scaled = Number.isFinite(amt) ? amt * factor : null;
      return { ...ing, _scaledAmount: scaled };
    });
  }, [hasRecipe, recipe.ingredients, recipe.servings, servings]);

  // READ-ONLY: bezpečné minimum
  if (!item && !editing) {
    return (
      <ScreenBackground overlayOpacity={0.28}>
        <ScrollView contentContainerStyle={styles.container}>
          <Text style={styles.name}>Jídlo nenalezeno.</Text>
        </ScrollView>
      </ScreenBackground>
    );
  }

  const imgSrc = item?.imageUrl || item?.image || null;
  const per100Sat = per100FromFood(item || {});
  const sat = satietyV2(per100Sat);
  const satLabel = sat?.label || '—';

  const portion = useMemo(() => {
    if (!item || !mealTarget) return null;
    try {
      const per100g = per100FromFood(item);
      const augmented = { ...item, per100g, servingHints: item.servingHints };
      const out = gramsForSingle(augmented, mealTarget);
      return out && typeof out === 'object' ? out : null;
    } catch {
      return null;
    }
  }, [item, mealTarget]);

  const hitEval = useMemo(() => {
    if (!portion?.hit || !mealTarget) return null;
    return evaluateMealHit(portion.hit, mealTarget);
  }, [portion, mealTarget]);

  const p = Number.isFinite(item?.protein) ? Math.round(item.protein) : null;
  const c = Number.isFinite(item?.carbs) ? Math.round(item.carbs) : null;
  const f = Number.isFinite(item?.fats) ? Math.round(item.fats) : null;
  const kcalVal = Number.isFinite(item?.calories) ? Math.round(item.calories) : null;

  // Uložení USER záznamu (formulář)
  const onSaveUserFood = async () => {
    setErrText('');
    setErrField(null);

    // Název je povinný
    if (!String(name).trim()) {
      setErrField('name');
      setErrText('Název je povinný.');
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      return;
    }

    setLoadingSave(true);
    try {
      const payload = {
        name: String(name).trim(),
        brand: String(brand || '').trim() || undefined,
        kcal: n(kcal),
        protein_g: n(protein),
        carbs_g: n(carbs),
        fat_g: n(fat),
      };

      const res = await upsertUserFoodByEAN(ean, payload);
      console.log('[fooddetail:save] ean=', ean, 'ok=', !!res?.ok, 'reason=', res?.reason || null);

      if (!res?.ok) {
        const mapped = mapReason(res?.reason);
        setErrText(mapped.message);
        setErrField(mapped.field);
        try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
        return;
      }

      // Úspěch → re-lookup a překreslit detail jako USER
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
      const fresh = await lookupFoodByEAN(ean);
      setLatestResult(fresh || null);

      // Přepnout z editačního režimu na read-only, včetně badge USER
      setEditing(false);
      setSavedNotice(`Položka uložena pro EAN ${ean}.`);
    } catch (e) {
      setErrText('Uložení se nezdařilo. Zkus to prosím znovu.');
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
    } finally {
      setLoadingSave(false);
    }
  };

  // ---------- CTA: Přidat do dne (target === 'dayExtras') ----------
  const [gramsForDay, setGramsForDay] = useState('100');
  const handleAddToDay = async () => {
    try {
      const per100g = per100FromFood(item || {});
      const grams = Math.max(1, Math.round(Number(gramsForDay) || 100));
      const payload = {
        name: item?.name || 'Položka',
        ean: ean || undefined,
        source: effectiveSource || undefined,
        grams,
        per100g: {
          kcal: Number(per100g.kcal) || 0,
          protein: Number(per100g.protein) || 0,
          carbs: Number(per100g.carbs) || 0,
          fats: Number(per100g.fats) || 0,
        },
      };
      const res = await addExtraToToday(payload);
      if (res?.ok) {
        try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
        navigation.goBack(); // zpět na „Můj den“
      } else {
        try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
        Alert.alert('Chyba', 'Nepodařilo se přidat položku do dne.');
      }
    } catch {
      try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
      Alert.alert('Chyba', 'Nepodařilo se přidat položku do dne.');
    }
  };

  // ------- UI: EDIT / CREATE FORM -------
  if (editing) {
    return (
      <ScreenBackground overlayOpacity={0.28}>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={ui.cardTranslucent}>
            <View style={styles.headerRow}>
              <Text style={styles.name}>Nová / Upravit položku</Text>
              <SourceBadge source={effectiveSource || 'USER'} />
            </View>
            <Text style={styles.brand}>EAN: {ean || '—'}</Text>

            <Text style={[ui.textDark, { marginTop: 8, marginBottom: 6 }]}>
              Hodnoty uváděj na 100 g.
            </Text>

            {/* Název */}
            <Text style={styles.label}>Název *</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Např. Tvaroh polotučný"
              style={[styles.inp, errField === 'name' && styles.inpErr]}
              maxLength={64}
              autoCapitalize="sentences"
            />

            {/* Značka */}
            <Text style={styles.label}>Značka</Text>
            <TextInput
              value={brand}
              onChangeText={setBrand}
              placeholder="Např. Madeta"
              style={styles.inp}
              maxLength={48}
              autoCapitalize="words"
            />

            {/* Makra /100 g */}
            <View style={styles.formRow}>
              <View style={styles.formCol}>
                <Text style={styles.label}>kcal</Text>
                <TextInput
                  value={kcal}
                  onChangeText={setKcal}
                  placeholder="kcal/100g"
                  keyboardType="numeric"
                  style={[styles.inp, errField === 'kcal' && styles.inpErr]}
                  maxLength={6}
                />
              </View>
              <View style={styles.formCol}>
                <Text style={styles.label}>Bílkoviny (g)</Text>
                <TextInput
                  value={protein}
                  onChangeText={setProtein}
                  placeholder="g/100g"
                  keyboardType="numeric"
                  style={[styles.inp, errField === 'protein_g' && styles.inpErr]}
                  maxLength={6}
                />
              </View>
            </View>

            <View style={styles.formRow}>
              <View style={styles.formCol}>
                <Text style={styles.label}>Sacharidy (g)</Text>
                <TextInput
                  value={carbs}
                  onChangeText={setCarbs}
                  placeholder="g/100g"
                  keyboardType="numeric"
                  style={[styles.inp, errField === 'carbs_g' && styles.inpErr]}
                  maxLength={6}
                />
              </View>
              <View style={styles.formCol}>
                <Text style={styles.label}>Tuky (g)</Text>
                <TextInput
                  value={fat}
                  onChangeText={setFat}
                  placeholder="g/100g"
                  keyboardType="numeric"
                  style={[styles.inp, errField === 'fat_g' && styles.inpErr]}
                  maxLength={6}
                />
              </View>
            </View>

            {!!errText && (
              <View style={[styles.notice, { backgroundColor: '#fff5f5', borderColor: '#fecaca', marginTop: 10 }]}>
                <Text style={[ui.textDark, { color: '#7f1d1d' }]}>{errText}</Text>
              </View>
            )}

            <TouchableOpacity
              onPress={onSaveUserFood}
              style={[styles.cta, loadingSave && { opacity: 0.6 }]}
              activeOpacity={0.9}
              disabled={loadingSave}
            >
              {loadingSave ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <ActivityIndicator color="#fff" />
                  <Text style={styles.ctaText}>Ukládám…</Text>
                </View>
              ) : (
                <Text style={styles.ctaText}>Uložit</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ScreenBackground>
    );
  }

  // ------- UI: READ-ONLY DETAIL -------
  return (
    <ScreenBackground overlayOpacity={0.28}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator>
        {imgSrc ? (
          <Image source={{ uri: imgSrc }} style={styles.image} />
        ) : (
          <View style={[styles.image, { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)' }]}>
            <Text style={{ color: '#fff' }}>Bez obrázku</Text>
          </View>
        )}

        {/* Notice po úspěšném uložení */}
        {!!savedNotice && (
          <View style={[ui.cardTranslucent, { backgroundColor: 'rgba(240,253,244,0.95)', borderColor: '#86efac' }]}>
            <Text style={[ui.textDark, { color: '#166534' }]}>{savedNotice}</Text>
          </View>
        )}

        {/* Titulek + zdroj + (volitelně brand a EAN) */}
        <View style={styles.headerRow}>
          <Text style={styles.name}>{item?.name || '—'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <SourceBadge source={effectiveSource} />
            {/* Manuální přepnutí do editace */}
            <TouchableOpacity
              onPress={() => {
                console.log('[fooddetail:edit] manual ean=', ean || '(no-ean)');
                setEditing(true);
              }}
              style={styles.btnEdit}
              activeOpacity={0.8}
            >
              <Text style={styles.btnEditText}>Upravit</Text>
            </TouchableOpacity>
          </View>
        </View>
        {item?.brand ? <Text style={styles.brand}>{item.brand}</Text> : null}
        {ean ? <Text style={styles.brand}>EAN: {ean}</Text> : null}

        <View style={ui.cardTranslucent}>
          <Text style={ui.cardTitleDark}>Makroživiny</Text>
          <Text style={ui.textDark}>Kalorie: {kcalVal ?? '—'} kcal</Text>
          <Text style={ui.textDark}>Bílkoviny: {p ?? '—'} g</Text>
          <Text style={ui.textDark}>Sacharidy: {c ?? '—'} g</Text>
          <Text style={ui.textDark}>Tuky: {f ?? '—'} g</Text>
        </View>

        {/* Info, pokud původní EAN lookup nenašel záznam */}
        {effectiveResult && !lookupOk ? (
          <View style={[ui.cardTranslucent, { backgroundColor: 'rgba(255,245,245,0.95)', borderColor: '#fecaca' }]}>
            <Text style={[ui.textDark, { color: '#7f1d1d' }]}>
              Původně nebyl nalezen žádný záznam. Nyní zobrazuji přidaný/opravený.
            </Text>
          </View>
        ) : null}

        {/* Doporučená porce vs. cíle */}
        {portion && portion.grams > 0 && (
          <View style={ui.cardTranslucent}>
            <Text style={ui.cardTitleDark}>Doporučená porce</Text>
            <Text style={[ui.textDark, { fontSize: 22, fontWeight: '800' }]}>{Math.round(portion.grams)} g</Text>
            {!!portion.hit && (
              <Text style={[ui.textDark, { opacity: 0.9 }]}>
                ≈ {Math.round(portion.hit.calories || 0)} kcal · P {Math.round(portion.hit.protein || 0)} g · C {Math.round(portion.hit.carbs || 0)} g · F {Math.round(portion.hit.fats || 0)} g
              </Text>
            )}
            {hitEval && (
              <Text style={[ui.textDark, { marginTop: 6, color: hitEval.ok ? '#2e7d32' : '#c62828' }]}>
                {hitEval.ok ? '✅ V toleranci cíle pro toto jídlo.' : '⚠️ Mimo toleranci cíle pro toto jídlo.'}
              </Text>
            )}
          </View>
        )}

        <View style={ui.cardTranslucent}>
          <Text style={ui.cardTitleDark}>Sytivost</Text>
          <Text style={ui.satLine}>
            <Text style={ui.satDots}>●</Text>
            <Text style={ui.satDots}>●</Text>
            <Text style={ui.satDots}>●</Text>{' '}
            <Text style={ui.satLabel}>{
              sat?.label || '—'
            }</Text>
          </Text>
        </View>

        {!!item?.description && (
          <View style={ui.cardTranslucent}>
            <Text style={ui.cardTitleDark}>Popis</Text>
            <Text style={ui.descDark}>{item.description}</Text>
          </View>
        )}

        <View style={{ height: 12 }} />

        {/* CTA bloky */}
        {target === 'dayExtras' ? (
          // ➕ Přidat do dne (s gramáží)
          <View style={[ui.cardTranslucent, { marginBottom: 24 }]}>
            <Text style={ui.cardTitleDark}>Přidat do dne</Text>
            <Text style={ui.textDark}>Gramáž (g)</Text>
            <TextInput
              value={String(gramsForDay)}
              onChangeText={(t) => setGramsForDay(String(t).replace(/[^\d]/g, '').slice(0, 5))}
              keyboardType="numeric"
              style={[styles.inp, { marginTop: 6, marginBottom: 12 }]}
              placeholder="100"
              maxLength={5}
            />
            <TouchableOpacity
              onPress={handleAddToDay}
              style={styles.cta}
              activeOpacity={0.9}
            >
              <Text style={styles.ctaText}>➕ Přidat do dne</Text>
            </TouchableOpacity>
          </View>
        ) : (
          // Původní flow: uložit do jídla dle mealIndex (s dekompozicí main/side)
          <TouchableOpacity
            onPress={() => {
              (async () => {
                try {
                  if (!portion?.grams || !item) {
                    Alert.alert('Chyba', 'Chybí doporučená porce.');
                    return;
                  }
                  const comp = decomposeCombo({ ...item });
                  const { mainG, sideG } = gramsForComp(Math.round(portion.grams), comp);
                  if (comp?.main) {
                    await upsertMealItemEx(
                      Number.isFinite(mealIndex) ? mealIndex : 0,
                      'main',
                      comp.main.food,
                      mainG,
                      { locked: !!comp?.hints?.lockProtein || !!comp?.main?.lockProtein }
                    );
                  } else {
                    await upsertMealItemEx(
                      Number.isFinite(mealIndex) ? mealIndex : 0,
                      'main',
                      { name: '', per100g: { kcal: 0, protein: 0, carbs: 0, fats: 0 } },
                      0
                    );
                  }
                  if (comp?.side) {
                    await upsertMealItemEx(
                      Number.isFinite(mealIndex) ? mealIndex : 0,
                      'side',
                      comp.side.food,
                      sideG,
                      { locked: false }
                    );
                  } else {
                    await upsertMealItemEx(
                      Number.isFinite(mealIndex) ? mealIndex : 0,
                      'side',
                      { name: '', per100g: { kcal: 0, protein: 0, carbs: 0, fats: 0 } },
                      0
                    );
                  }
                  try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
                  if (target === 'dayExtras') { navigation.navigate('MyDay'); } else { navigation.goBack(); }
                } catch {
                  try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); } catch {}
                  Alert.alert('Chyba', 'Nepodařilo se uložit položku.');
                }
              })();
            }}
            style={styles.cta}
            activeOpacity={0.9}
          >
            <Text style={styles.ctaText}>{`Použít do ${mealSlot || 'tohoto jídla'}`}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: 'transparent' },
  image: { width: '100%', height: 220, borderRadius: 12, marginBottom: 12, backgroundColor: 'rgba(0,0,0,0.2)' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 22, fontWeight: '800', marginBottom: 4, color: '#fff', flex: 1, paddingRight: 12 },
  brand: { fontSize: 14, color: 'rgba(255,255,255,0.9)', marginBottom: 12 },
  cta: { backgroundColor: '#EC6408', borderRadius: 12, paddingVertical: 14 },
  ctaText: { color: '#fff', textAlign: 'center', fontWeight: '700' },

  // Badge
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 9999 },
  badgeText: { fontSize: 12, fontWeight: '700' },

  // Edit tlačítko
  btnEdit: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', marginLeft: 8 },
  btnEditText: { color: '#fff', fontWeight: '700' },

  // Form
  label: { fontSize: 13, color: '#222', marginTop: 10, marginBottom: 4 },
  inp: {
    borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: '#111', backgroundColor: '#fff'
  },
  inpErr: { borderColor: '#ef4444' },
  formRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  formCol: { flex: 1 },

  recipeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  servingsBox: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  servBtn: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(0,0,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  servBtnText: { fontSize: 20, fontWeight: '700', color: '#222' },
  servingsText: { fontSize: 15, fontWeight: '600', color: '#222' },

  notice: { padding: 12, borderRadius: 12, borderWidth: 1 },
});

const ui = StyleSheet.create({
  cardTranslucent: {
    marginBottom: 12, padding: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.92)',
  },
  cardTitleDark: { fontSize: 18, fontWeight: '600', marginBottom: 6, color: '#222' },
  textDark: { fontSize: 16, color: '#222', marginBottom: 4 },
  satLine: { fontSize: 16, color: '#222' },
  satDots: { fontSize: 18 },
  satLabel: { color: '#EC6408' },
  descDark: { fontSize: 15, color: '#333' },
});

























