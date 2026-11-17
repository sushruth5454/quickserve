# Preferred Language Foundation — Traceability

| BDD scenario | DDD owner | TDD evidence | Implementation files | ADR |
|---|---|---|---|---|
| BDD-PL-01 English initial preference | Client localization; `UserProfile` | `preferred_language.test.mjs` confirms the second pre-migration profile remains `en` after the first is changed; no app startup/UI assertion. Not run locally. | `app/app/_layout.tsx`, `app/src/i18n/index.tsx`, `app/src/i18n/en.ts`, `app/app/(auth)/login.tsx`, `app/app/location.tsx`, `0045_preferred_language.sql` | N/A — no new strategic boundary |
| BDD-PL-02 Flag-off English and hidden picker | Client localization; feature configuration | SQL test asserts the flag defaults off; no UI behavior test. Not run locally. | `app/app/_layout.tsx`, `app/src/i18n/index.tsx`, `app/src/components/AccountScreen.tsx`, `0045_preferred_language.sql` | N/A |
| BDD-PL-03 Selection and profile persistence | Client localization; `UserProfile` | SQL test covers self-update and unchanged other profile; local AsyncStorage/UI path is not automated. Not run locally. | `app/src/i18n/index.tsx`, `app/src/components/AccountScreen.tsx`, `0045_preferred_language.sql` | N/A |
| BDD-PL-04 Restore profile choice | Client localization; `UserProfile` | No test for profile-to-device restoration. Not run locally. | `app/src/i18n/index.tsx`, `0045_preferred_language.sql` | N/A |
| BDD-PL-05 English fallback and interpolation | Client localization; translation service | No automated translator test; static key-coverage check passed. Not run locally. | `app/src/i18n/index.tsx`, `app/src/i18n/en.ts`, `app/src/i18n/te.ts`, `app/src/components/AccountScreen.tsx`, `app/app/(auth)/login.tsx`, `app/app/location.tsx` | N/A |
| BDD-PL-06 Invalid value and ownership | Profile preference; `UserProfile` | `supabase/tests/preferred_language.test.mjs` asserts invalid-language rejection, anonymous denial, non-admin self-update, and another profile unchanged. Authored, not run locally. | `supabase/migrations/0045_preferred_language.sql`, `supabase/tests/preferred_language.test.mjs` | N/A |
| BDD-PL-07 Native review before enablement | Feature configuration; release readiness | Manual reviewer sign-off; no automated approval check. Not run locally. | `app/src/i18n/te.ts`, `0045_preferred_language.sql` | N/A |

## Implementation inventory

| Reported file | Role |
|---|---|
| `app/src/i18n/en.ts` | Complete English source keys. |
| `app/src/i18n/te.ts` | Partial Telugu drafts, marked for native review. |
| `app/src/i18n/index.tsx` | Provider, interpolation/fallback, feature gate, AsyncStorage, profile sync. |
| `app/app/_layout.tsx` | Mounts the language provider inside authentication. |
| `app/src/components/AccountScreen.tsx` | Feature-gated language picker. |
| `app/app/(auth)/login.tsx` | Localized login slice. |
| `app/app/location.tsx` | Localized location-picker slice. |
| `supabase/migrations/0045_preferred_language.sql` | Profile preference, feature flag, and authenticated RPC. |
| `supabase/tests/preferred_language.test.mjs` | Isolated SQL coverage for flag default, RPC validation, and ownership. |

## Delivery quality gate

- **BDD → DDD:** every scenario has an owning context in `preferred-language-ddd.md`.
- **DDD → implementation:** ownership and integration boundaries map to the files listed above.
- **TDD evidence:** the isolated SQL test exists, but local execution was explicitly out of scope; the parent must register and run it in shared CI. Client localization behaviors do not yet have automated tests.
- **ADR:** no new boundary or ownership decision was made; no ADR is linked.

## Residual risks

1. Keep `telugu_language` disabled until a native Telugu speaker reviews the draft catalog.
2. Phase 4 §4.1 currently names migration `0046`; this implementation uses the reserved `0045` name.
3. This is a bounded slice, not whole-app localization; nested components and dynamic service errors may remain English.
