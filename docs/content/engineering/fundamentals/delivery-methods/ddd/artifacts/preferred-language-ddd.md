# Preferred Language Foundation — DDD

## Domain framing

The bounded feature is a user's display-language preference, gated by an application rollout flag. It changes presentation only; it does not translate domain data or alter booking, location, or billing behavior.

## Ubiquitous language

| Term | Meaning |
|---|---|
| Language preference | The user's selected supported locale: `en` or `te`. |
| Effective language | The locale used for rendering: selected preference when enabled, otherwise `en`. |
| English catalog | Complete source dictionary and fallback for every translation key. |
| Telugu catalog | Partial translation dictionary; missing keys fall back to English. |
| Language rollout flag | `feature_flags.telugu_language`; disabled by default and controls picker visibility. |

## Bounded contexts and ownership

| Context | Owns | Boundary / integration |
|---|---|---|
| Client localization | Effective language, translation lookup, interpolation, and `quickserve.lang.v1` device preference. | `LanguageProvider` wraps the app inside `AuthProvider`; screens consume `useT()`. Reads `get_app_features`; sends signed-in changes to the profile RPC. |
| Profile preference | `profiles.preferred_language`, default `en`; authenticated user's own preference. | `set_preferred_language(p_language)` derives identity from the authenticated session; callers cannot supply another profile ID. |
| Feature configuration | Whether Telugu UI may be selected. | Existing feature registry row; `get_app_features()` is read-only to the client and admin-controlled through existing configuration paths. |

## Tactical model and invariants

- **Value object:** `Language = 'en' | 'te'`; validate at the RPC boundary and in local-storage reads.
- **Aggregate:** `UserProfile`, keyed by authenticated user ID, owns `preferred_language`. The RPC updates only the row matching `auth.uid()` and fails if that profile is absent.
- **Feature flag record:** `telugu_language` is inserted with `enabled = false`; it gates the picker and effective locale, not the profile's stored preference.
- **Translation service:** `t(key, vars)` selects Telugu only when enabled, falls back to `en[key]`, then interpolates supplied placeholders.
- **Consistency:** local selection is persisted immediately; signed-in changes are synchronized through the RPC. If there is no local choice, an enabled session can restore a valid profile choice.
- **Safety:** flag lookup failures fail closed to English. Telugu entries remain marked for native review; production enablement is a manual readiness decision.

## Decisions and open risks

- Add no package and no new service; use AsyncStorage, the existing Supabase client, and the feature registry.
- No ADR is identified: this slice preserves the existing client/profile/feature-configuration ownership boundaries. Revisit ADR needs if language ownership or synchronization boundaries change.
- Only login, account, and location copy in the bounded files is covered. Nested components, other routes, and dynamic error text remain outside this context slice.
- Phase 4 §4.1 lists migration `0046`; this task reserves `0045_preferred_language.sql`. The plan numbering remains to be reconciled.
- Telugu drafts require native-speaker review before enabling the flag.
