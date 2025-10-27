# Apfood — Feature Catalog

> Generováno `scripts/gen-feature-catalog.ts` z anotací a YAML registru.

| Klíč | Oblast | Stav | Od verze | Vlastník | Entrypoints |
|---|---|---|---|---|---|
| `Apfood.AutoBalance.Day` | Phase2/AutoBalance | in-progress | 4.1.0 | Thread-1 | utils/autobalance.ts<br>__tests__/autobalance.core.spec.ts |
| `Apfood.Crowdsourcing.UserItems` | Phase1/Crowd | in-progress | 3.9.0 | Thread-2 | screens/MyDayScreen.js<br>components/foods/ExtraEditor.tsx |
| `Apfood.Energy.Expenditure` | Phase4/Energy | in-progress | 4.0.0 | Thread-3 | utils/energy/core.ts<br>components/activities/EnergyGalaxyNative.tsx |
| `Apfood.Imports.Dedupe` | Phase1/Imports | in-progress | 3.8.0 | Thread-1 | scripts/retailer-metrics.ps1<br>utils/imports/dedupe.ts |
| `Apfood.MyDay.Activities.EnergyGalaxy` | Phase4/Energy | in-progress | 4.0.0 | Thread-2 | components/activities/EnergyGalaxyGateway.tsx<br>components/activities/EnergyGalaxyNative.tsx |
| `Apfood.MyDay.FoodsScreen` | MyDay | shipped | 3.9.0 | Thread-2 | screens/MyDayScreen.js |
| `Apfood.ScanFood` | Phase1/Reader | shipped | 3.2.0 | Thread-1 | screens/ScanFoodScreen.tsx<br>utils/ean/lookup.ts |

—

**Pozn.:** Úplné detaily (tests, DoD, notes) viz `docs/feature-registry/features.json` nebo `features.yaml`.