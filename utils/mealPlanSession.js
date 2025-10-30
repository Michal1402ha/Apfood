// utils/mealPlanSession.js  (FULLFILE/rozcestník)

const USE_V2 =
  (globalThis?.__APFOOD_FLAGS__ && globalThis.__APFOOD_FLAGS__.AUTO_BALANCE_V2) ||
  process?.env?.APFOOD_AUTOBALANCE_V2 === 'true';

const api = USE_V2
  ? require('./mealPlanSession.v2.js')
  : require('./mealPlanSession.legacy.js');

// Vytažení pojmenovaných exportů (kvůli jest importům)
const {
  loadMealPlanSession,
  initMealPlanSession,
  upsertMealItem,
  getPlanTotals,
  getPlanDelta,
  applyAutoBalance,
  applyBaselinePortions,
  DEFAULT_ANCHOR_SLOTS,
} = api;

// Pojmenované exporty (ESM styl)
exports.loadMealPlanSession = loadMealPlanSession;
exports.initMealPlanSession = initMealPlanSession;
exports.upsertMealItem = upsertMealItem;
exports.getPlanTotals = getPlanTotals;
exports.getPlanDelta = getPlanDelta;
exports.applyAutoBalance = applyAutoBalance;
exports.applyBaselinePortions = applyBaselinePortions;
exports.DEFAULT_ANCHOR_SLOTS = DEFAULT_ANCHOR_SLOTS;

// Default export (CJS/UMD shim)
module.exports = {
  loadMealPlanSession,
  initMealPlanSession,
  upsertMealItem,
  getPlanTotals,
  getPlanDelta,
  applyAutoBalance,
  applyBaselinePortions,
  DEFAULT_ANCHOR_SLOTS,
};
