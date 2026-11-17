# Preferred Language Foundation — BDD

**Status:** Bounded first slice; acceptance scenarios for English/Telugu preference.

## Discovery and scope

- **Actor:** A QuickServe app user; the Account screen exposes the choice only when the `telugu_language` feature is enabled.
- **Goal:** Use English or Telugu on the localized login, account, and location screens, retaining the choice locally and on the signed-in profile.
- **Rules:** English is the complete source catalog; missing Telugu entries use English. Unsupported profile values are rejected. A native Telugu speaker must review draft translations before rollout enables the flag.
- **Boundary:** This does not localize every screen. Other routes, nested components, and dynamic service errors may remain English.
- **Migration numbering:** This implementation uses the task-reserved `0045_preferred_language.sql`; Phase 4 §4.1 currently labels the migration `0046`. Reconcile that plan number separately.

## Scenarios

### BDD-PL-01 — English is the initial preference

```gherkin
Given the user has no saved language choice
And their profile preference is the default "en"
When the app opens with Telugu language enabled
Then the localized screens use English
And the profile preference remains "en"
```

**Pass signal:** effective locale is `en`; the English catalog supplies displayed copy.

### BDD-PL-02 — Disabled feature forces English

```gherkin
Given the device or profile has a Telugu preference
When `telugu_language` is false or unavailable
Then localized screens use English
And the Account screen does not show the language picker
```

**Pass signal:** flag lookup fails closed; the effective locale is `en` and the picker is absent.

### BDD-PL-03 — Enabled feature saves the selected language

```gherkin
Given a signed-in user and `telugu_language` enabled
When the user selects English or Telugu in Account
Then the app stores the selection under `quickserve.lang.v1`
And the app updates that user's profile through `set_preferred_language`
```

**Pass signal:** the selected locale is active; local storage and the caller's profile contain the selected code.

### BDD-PL-04 — Existing profile choice restores when local choice is absent

```gherkin
Given a signed-in user with no local choice and a valid profile preference
And `telugu_language` is enabled
When the app initializes localization
Then it applies the profile preference
And stores that preference locally
```

**Pass signal:** the effective locale matches the profile value.

### BDD-PL-05 — Missing Telugu entries fall back with interpolation

```gherkin
Given Telugu is selected and a key has no Telugu translation
When the app translates that key with placeholder values
Then it displays the English source string
And substitutes the provided values
```

**Pass signal:** no missing-key blank or crash; English copy and `{name}`-style values render.

### BDD-PL-06 — Profile RPC enforces language and ownership

```gherkin
Given a non-admin authenticated user
When they submit an unsupported language
Then the RPC rejects the request
When they submit a supported language
Then only their own profile preference changes
```

**Pass signal:** invalid values fail; another user's profile remains unchanged; anonymous execution is denied.

### BDD-PL-07 — Review precedes rollout

```gherkin
Given Telugu catalog entries are marked as draft
When rollout readiness is assessed
Then `telugu_language` remains disabled until a native Telugu speaker reviews the entries
```

**Pass signal:** documented reviewer approval precedes enabling the production flag; this is a manual release gate.

## Acceptance criteria

1. New profile preferences default to `en`; the feature flag is inserted disabled.
2. With the flag off, English is forced and the picker is hidden.
3. With the flag on, Account selection persists locally and synchronizes through the self-scoped RPC.
4. Missing Telugu keys fall back to English and interpolate variables.
5. Invalid RPC values and cross-user writes are rejected or impossible.
6. Native-speaker review is complete before enabling Telugu in production.
