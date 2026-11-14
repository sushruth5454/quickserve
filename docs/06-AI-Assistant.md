# QuickServe AI — booking assistant: architecture, policies, operations and production readiness

Status: v1 built. This document is the operations reference for the `ai-assistant` Edge Function, its versioned
policies ("skills") and the app screen. The [README](../README.md#ai-assistant) has the short version.

## 1. What it does (and never does)

A signed-in customer describes a problem by text or voice (English, Hindi, Telugu, Hinglish/Tenglish). The assistant
replies in the customer's language with a short answer, plus cards that the **server** builds from real data:

| Card | Source of truth |
|---|---|
| `safety` | Deterministic hazard detection (`policies/safety.ts`) and/or the model; always first when a hazard is detected |
| `diagnosis` | Model, with a mandatory `confidence` (low/medium/high, defaults to low) |
| `estimate` | SQL `ai_price_estimate(slug, since)`: active, verified pros' visit fees + completed/approved job totals inside the lookback window. Below `AI_MIN_PRICE_SAMPLES` it says "not enough data" — the model never invents rupee amounts |
| `providers` | `search_providers` RPC called with the **user's JWT** (RLS) at the customer's location, ranked by `rankProviders` |
| `draft` | `draft_booking` re-validates the provider service (active, verified, not suspended, right category) and normalises the slot to the Book screen's 2-hour windows |

The draft's "Review & pay" button opens the normal Book screen, pre-filled. **The assistant never creates, confirms or
pays a booking.** There is no write tool for bookings or payments. The customer reviews and pays in the normal checkout,
which runs every server-side check again (`create_booking`, payment link). If the model claims something was booked,
`composeReply` replaces that text (`claimsBooking` guardrail).

## 2. Architecture

```
app/app/assistant.tsx ─ src/lib/assistant/client.ts ──POST /functions/v1/ai-assistant (Bearer user JWT)──┐
                                                                                                          │
supabase/functions/ai-assistant/                                                                          ▼
  index.ts      handler: config → CORS → kill switch → auth → input checks → rate limits → load context
                (RLS: history, saved addresses, categories) → agent loop with model fallback → composeReply
                guardrails → persist (ai_conversations/ai_messages) → JSON log → response
  config.ts     every tunable from env, clamped, with production-safe defaults (section 6)
  gemini.ts     generateContent client (timeout, status-only error text, fallback classification)
  logic.ts      pure: MarketClock, slot normalisation, PII redaction, provider validation/ranking,
                estimate cards, composeReply guardrails, history → Gemini contents
  policies/     versioned skills consumed by the system instruction (section 3)
  *_test.ts     deterministic Deno tests (run in CI before every deploy)
supabase/migrations/0004_ai_assistant.sql, 0005_ai_price_lookback.sql
```

Agent loop: Gemini function calling with `functionCallingConfig.mode = ANY`. The read-only tools are `list_categories`,
`search_providers`, `get_my_history`, `get_price_estimate` and `draft_booking`; the model ends by calling `respond`.
Each step is capped (`AI_MAX_STEPS`), and per-tool call budgets live in `policies/tools.ts`. Every tool argument is
validated and clamped on the server: slugs must exist in the live catalog, UUIDs must be well-formed, and coordinates
are clamped.

## 3. Policies ("skills") — `supabase/functions/ai-assistant/policies/`

| File | Section(s) | Deterministic code |
|---|---|---|
| `version.ts` | `POLICY_VERSION` + changelog | — |
| `role.ts` | ROLE AND BOUNDARIES, India home-services context | — |
| `intake.ts` | INTAKE steps, CLARIFY (max 2 questions, structured quick replies) | — |
| `safety.ts` | SAFETY escalation (gas, sparks, burning smell, flooding near power) | `detectHazard`, `DEFAULT_SAFETY` (en/hi/te); emergency numbers (112/101/1906 LPG) are server constants in `logic.ts` `EMERGENCY_NUMBERS`, never model text |
| `diagnosis.ts` | DIAGNOSIS with confidence + uncertainty wording | `CONFIDENCE_LEVELS` |
| `language.ts` | LANGUAGE (reply in user's language/script; draft in English + original) | `detectLanguage` |
| `booking.ts` | BOOKING DRAFT schema and rules, no auto-book/pay | `claimsBooking`, `DRAFT_READY_TEXT` |
| `conduct.ts` | RANKING fairness, PRIVACY, SCOPE/refusals, GROUNDING | — |
| `tools.ts` | TOOL permissions and budgets, malformed-result handling | `toolCallAllowed` |
| `security.ts` | Prompt-injection resistance | `looksLikeInjection`, `INJECTION_REMINDER`, `sanitizeReply` |
| `output.ts` | OUTPUT schema for `respond` | `functionDeclarations` |
| `index.ts` | Fixed section order, context rendering | `systemPrompt`, `renderPolicies`, `renderContext` |

Rules are short, numbered and imperative so small models (flash-lite) follow them literally. Anything safety-critical
is **also** enforced in code (`composeReply`): a default safety card when a hazard is detected, booking-claim text
replaced, sanitised reply text, language fallback, low confidence by default, and an honest message when no pros are
found. A prompt regression therefore cannot remove those protections.

### How to change a policy

1. Edit the rule in the relevant `policies/*.ts` file. Keep it one line and imperative, and give an example when the
   wording is subtle.
2. Bump `POLICY_VERSION` in `version.ts` (`YYYY.MM.DD-n`) and add a changelog line saying what changed and why.
3. If the change adds deterministic behaviour (patterns, guardrails), add or adjust cases in `policies_test.ts` /
   `logic_test.ts`.
4. Run the tests locally: `deno test supabase/functions/ai-assistant` and `deno check supabase/functions/ai-assistant/index.ts`.
5. Push. `deploy-backend.yml` runs the same `deno test` and `deno check` and deploys only if they pass.
6. Verify live: send the scenario set in section 8 and check `policy_version` in the responses and in
   `ai_messages.payload.policy_version`.
7. Roll back by reverting the commit; every stored reply records the version that produced it.

## 4. Data sent to Gemini (minimised)

| Sent | Not sent |
|---|---|
| Live category list (slug, name) | Phone numbers, emails, user ids of anyone |
| Selected location as area + city (lat/lng only to our own RPC, not to the model) | House/flat numbers, `line1`, landmarks |
| Saved-address **labels + area** | Other customers' data, reviews text |
| Own booking history: date, category, pro display name, `provider_service_id`, status, rating given (last `AI_HISTORY_ROWS`) | Payment, quote, OTP/start-code data |
| Public pro listing fields returned by tools (name, rating, jobs, distance, visit fee, online) | Provider phone/KYC/bank data |
| The user's message after `redactPII` (emails, UPI ids and any 9+ digit run — phones, Aadhaar, card numbers — masked) | Secrets/keys (API key goes only in the `x-goog-api-key` header) |
| Voice: the raw audio clip | — |

**Audio cannot be redacted before sending.** If the customer speaks a phone number, Gemini receives it, but the
transcript is redacted before it is stored or shown again. Treat this as a disclosure item in the privacy policy.

## 5. Abuse controls, auth and failure behaviour

| Control | Behaviour |
|---|---|
| JWT | `verify_jwt = true` at the gateway (`config.toml`, deployed without `--no-verify-jwt`), plus `auth.getUser` in code. Anon key / no token → 401 |
| Kill switch | `AI_ASSISTANT_ENABLED=false` → 503 `ai_disabled`. The app hides entry points with `EXPO_PUBLIC_AI_ASSISTANT=false` |
| Voice switch | `AI_VOICE_ENABLED=false` → 403 `voice_disabled` |
| Daily limits | `AI_DAILY_MESSAGE_LIMIT` / `AI_DAILY_VOICE_LIMIT` per user per market day → 429 `rate_limited` / `voice_limited` (checked before any model call) |
| Burst | `AI_PER_MINUTE_LIMIT` → 429 `slow_down` |
| Input size | Text > `AI_MAX_TEXT_CHARS` → 400 `too_long`; audio > `AI_MAX_AUDIO_BASE64_CHARS` → 400 `audio_too_long`; bad/too-short/unreadable audio → 400 `bad_audio`; body > limit → 413 `too_large` |
| CORS | `AI_ALLOWED_ORIGINS` (comma list). Empty → `*` (safe: bearer auth, no cookies). Disallowed browser origin → 403 |
| Model unavailable | Primary → fallback (+ retries with backoff) → 503 `ai_unavailable` with a "book from the service list" message; whole-request budget overrun → 504 `timeout` |
| Primary overloaded | After a primary failure (not a 400), the primary is skipped for `AI_PRIMARY_COOLDOWN_MS` on that instance |
| Bad/missing key | 401/403 from Gemini → no fallback, logged as `model_unavailable`; missing secret → 503 `not_configured` |
| Malformed model output | No `respond` within steps → next attempt; invalid fields are dropped or defaulted by `composeReply`; unknown slugs, UUIDs and pros are rejected by the tools |
| Prompt injection | `looksLikeInjection` adds a reminder and sets `injection_flag` in logs/payload; tool permissions are enforced in code, not by the prompt |
| App offline/network | `mapAssistantError` → offline/retry/limited/disabled/auth/input states with actions (Try again, Browse services, Sign in again) and the request ref |

## 6. Configuration (function secrets / env)

Set with `npx supabase secrets set NAME=value` (CI sets `GEMINI_API_KEY` from the GitHub secret). All values are clamped.

| Variable | Default | Notes |
|---|---|---|
| `GEMINI_API_KEY` | — (required) | Function secret only; never shipped to the app |
| `GEMINI_API_BASE` | `https://generativelanguage.googleapis.com/v1beta` | |
| `AI_ASSISTANT_ENABLED` / `AI_VOICE_ENABLED` | `true` / `true` | Kill switches |
| `AI_PRIMARY_MODEL` / `AI_FALLBACK_MODEL` | `gemini-3.8-flash` / `gemini-3.5-flash-lite` | `AI_FALLBACK_MODEL=none` disables fallback |
| `AI_FALLBACK_RETRIES` | 1 | 0–3 |
| `AI_PRIMARY_CALL_TIMEOUT_MS` / `AI_CALL_TIMEOUT_MS` | 12000 / 15000 | Per model call |
| `AI_REQUEST_BUDGET_MS` | 50000 | Whole request |
| `AI_PRIMARY_COOLDOWN_MS` | 300000 | |
| `AI_MAX_STEPS` / `AI_MAX_OUTPUT_TOKENS` / `AI_THINKING_LEVEL` | 6 / 2048 / `low` | Gemini 3 ignores temperature |
| `AI_DAILY_MESSAGE_LIMIT` / `AI_DAILY_VOICE_LIMIT` / `AI_PER_MINUTE_LIMIT` | 30 / 10 / 6 | |
| `AI_MAX_TEXT_CHARS` / `AI_MAX_AUDIO_BASE64_CHARS` | 1000 / 2100000 | ~60 s AAC |
| `AI_HISTORY_ROWS` | 10 | Past bookings shared with the model |
| `APP_TZ_OFFSET_MINUTES` / `APP_TZ_LABEL` | 330 / `IST` | Market day, slots, daily limits |
| `AI_PRICE_LOOKBACK_DAYS` / `AI_MIN_PRICE_SAMPLES` | 180 / 3 | Stale prices drop out |
| `AI_ALLOWED_ORIGINS` | empty (`*`) | Set to the production web origin(s) |
| App: `EXPO_PUBLIC_AI_ASSISTANT` | on | `false` hides Home card / category button / route |

There is no city default: the location is the one the customer selected, or their default saved address; otherwise the
assistant asks them to set a location and does not search or draft.

## 7. Observability and audit

- **Logs** (Supabase → Edge Functions → `ai-assistant` → Logs): one JSON line per request, with no message content.
  `event: "reply"` carries `request_id`, `user`, `model`, `attempts[] {model, ms, error}`, `calls`, `tokens_in`,
  `tokens_out`, `cards`, `tools` (`name!` = failed), `voice`, `has_location`, `policy_version`, `guardrails`,
  `injection_flag` and `ms`. Errors: `model_unavailable`, `audio_rejected`, `tool_failed`, `misconfigured`, `internal`.
- **Database audit**: every turn is stored in `ai_messages`. User rows hold the redacted text and input kind.
  Assistant rows hold `payload.{request_id, policy_version, guardrails, injection_flag, cards, tools, attempts}`, the
  model and the tokens. `role='error'` rows record failed attempts. Customers can read only their own rows (RLS); writes
  come only from the function.
- **Support**: the app shows `Ref: <request_id>` on errors. Search the logs or `ai_messages.payload->>'request_id'`.
- Useful SQL:
  ```sql
  -- fallback rate, latency and tokens per model, last 24 h
  select model, count(*), avg(input_tokens), avg(output_tokens),
         avg(jsonb_array_length(payload->'attempts')) attempts
    from ai_messages where role='assistant' and created_at > now()-interval '1 day' group by model;
  -- guardrail and injection hits
  select payload->'guardrails', payload->>'injection_flag', count(*) from ai_messages
   where role='assistant' and created_at > now()-interval '7 days' group by 1,2;
  ```
- **Retention**: no automatic purge yet (see blockers). Deleting a profile cascades to its AI rows.

## 8. Verification

| Layer | Command / location | Result at v1 |
|---|---|---|
| Policies + logic (Deno) | `deno test supabase/functions/ai-assistant` (CI gate in `deploy-backend.yml`) | 26/26 pass |
| Type-check | `deno check supabase/functions/ai-assistant/index.ts` | clean |
| App (Jest) | `src/lib/__tests__/assistant.test.ts`: response parsing/validation, error mapping, Book prefill, slot mapping | 70/70 (whole app suite) |
| Web E2E | `e2e-web.yml` → `e2e/web-smoke.mjs`: Home → assistant → English AC scenario → draft → Review & pay → Book screen pre-filled | see run in final report |
| Live scenarios (seeded dev data) | English AC/tomorrow evening; Hindi tap leak; Telugu sparks; "same AC guy"; voice WAV | all pass (section 9) |
| Live production-shaped | brand-new user (no history, no address); zero matches (other city); history request with no history; out of scope; prompt injection; malformed audio; no JWT; anon key as JWT; oversized text; daily limit | all pass (section 9) |

Deterministic Deno cases cover malformed model output (missing/invalid fields, unknown slugs, bogus UUIDs, invalid
slots), inactive/suspended/wrong-category providers, stale price windows, multilingual hazard and language detection,
injection detection, booking-claim replacement, ranking tie-breaks and config clamping.

## 9. Production-readiness acceptance checklist

| # | Criterion | Status |
|---|---|---|
| 1 | No hard-coded test phones, provider ids, seeded ids or city in production paths; demo only behind demo mode | Done |
| 2 | User data read with the user's JWT (RLS); admin client only for `ai_*` tables and the aggregate price function | Done |
| 3 | Empty/sparse data: no history, no location, zero pros, < min price samples | Done (verified live) |
| 4 | All models, limits, timeouts, CORS, flags configurable via env with clamped defaults | Done |
| 5 | No key/secret in client or responses; minimal PII to Gemini (section 4) | Done (audio exception documented) |
| 6 | Drafts only; explicit review/confirm/pay in checkout; booking-claim guardrail | Done |
| 7 | JWT verified at gateway and in code; rate/burst/size limits; kill switches | Done |
| 8 | Model overload/timeouts/bad key/malformed output handled with friendly errors and request ids | Done |
| 9 | Offline/network errors in the app with retry and fallback actions | Done |
| 10 | Versioned policies, deterministic tests gating deploys, audit of policy version per reply | Done |
| 11 | Live checks on seeded data and on production-shaped cases | Done |
| 12 | Production `GEMINI_API_KEY` on a paid tier with quota sized to traffic | **Blocker (owner)** |
| 13 | `AI_ALLOWED_ORIGINS` set to the production web origin | **Config at launch** |
| 14 | Privacy policy / DPDP notice covering AI processing, voice audio and the processor (Google) | **Blocker (legal)** |
| 15 | AI data retention job (e.g. purge `ai_messages` after N days) | Open |
| 16 | Mic permission and recording tested on a native dev/production build (not only Expo Go) | Open |
| 17 | Alerting on `model_unavailable` rate and fallback rate | Open (needs a log drain/alerting tool) |

## 10. Known limitations and blockers

- **Primary model capacity**: in testing, `gemini-3.8-flash` timed out or returned 503 ("high demand"), so replies
  came from `gemini-3.5-flash-lite` through the fallback. The fallback also occasionally returns 503. The user then
  sees "busy, try again". This needs a paid tier/quota or a different primary model (set via env, no code change).
- **Latency**: about 5–25 s per message (2–4 model calls). There is no streaming.
- **Voice on web**: the mic is hidden on web (`Composer.web.tsx`), so voice is not covered by web E2E. The voice
  request path was verified live with a WAV sample.
- **Audio PII**: see section 4.
- **Live dependencies outside this function**: real SMS OTP provider and Razorpay live keys are needed for production
  checkout. The assistant itself does not depend on them, and none of its functionality relies on test OTPs or
  `EXPO_PUBLIC_FORCE_TEST_LOCATION`.
- **Per-instance cooldown**: the primary-model cooldown is held in memory per function instance, not globally.
