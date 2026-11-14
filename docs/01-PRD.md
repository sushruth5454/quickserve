# QuickServe — Product Requirements Document (PRD)

> Working name: **QuickServe**. Version 1.0 (MVP). Owner: founder. Status: Draft for build.
> Platforms: Android (Play Store) + iOS (App Store) from one codebase.

---

## 1. Problem

| Who | Pain |
|---|---|
| **Customer** (household in a city) | "My AC broke. Who fixes ACs near me? Are they any good? What will it cost?" Today: ask neighbours, WhatsApp groups, random JustDial calls, no price transparency, no accountability. |
| **Provider** (independent AC tech, electrician, plumber, cleaner, tank cleaner, mechanic) | Gets work only through word of mouth. Idle days = no income. No way to build a visible reputation. |

**Insight:** Both sides exist in every city but can't find or trust each other. A marketplace that does **discovery + trust (ratings) + safe payments** solves this for both.

## 2. Vision & positioning

"Trusted local service pros, booked in 60 seconds, with clear prices and a guarantee."

We are a **marketplace, not an employer**. Providers are independent; they register, list skills and rates, and accept jobs. We make money through a **commission on jobs paid in the app** (see `03-Pricing-Payments-Commission.md`).

Positioning vs Urban Company: UC hires, trains, and standardizes pros at fixed prices, with a high take rate (~20–30%) and only in metro cities. QuickServe is **open to independent pros**, uses **transparent itemized quotes**, has a **lower take rate (10–12%)**, and launches **city by city in Tier-2/3 cities** where UC isn't present.

## 3. Goals & success metrics (first 6 months, launch city)

| Goal | Metric | Target |
|---|---|---|
| Supply | Verified active providers | 300 |
| Demand | Monthly completed bookings | 2,000 |
| Liquidity | % booking requests accepted within 15 min | ≥ 80% |
| Quality | Avg rating of completed jobs | ≥ 4.3 |
| Trust | Disputes / completed jobs | < 3% |
| Monetization | % GMV paid in-app | ≥ 70% |
| Retention | Customer 60-day repeat rate | ≥ 25% |

**Not goals for the MVP:** multi-city ops tooling, a subscription product, a parts e-commerce store, or a web app for customers.

## 4. Personas

1. **Priya (customer, 32, working professional)** wants a reliable pro fast and hates haggling. Pays by UPI.
2. **Ravi (provider, 28, AC technician)** owns a basic Android phone, mostly speaks Hindi or Telugu, gets paid in cash today, and wants more jobs.
3. **Admin (founder/ops)** verifies providers, resolves disputes, handles payouts, and edits categories.

## 5. Scope — MVP features

Priorities: P0 = must ship, P1 = should ship in v1.x, P2 = later.

### 5.1 Accounts & onboarding
| ID | Requirement | Pri |
|---|---|---|
| A1 | Phone-number + OTP login (no passwords). Same account can be customer and/or provider. | P0 |
| A2 | Choose role on first launch: "I need a service" / "I provide services". Can add provider profile later. | P0 |
| A3 | Language: English + Hindi at launch (i18n framework from day 1). | P1 |
| A4 | Location permission → set home address (map pin + text). Multiple saved addresses. | P0 |

### 5.2 Provider registration & profile
| ID | Requirement | Pri |
|---|---|---|
| P1 | Profile: name, photo, city, service radius (km), languages, years of experience, short bio. | P0 |
| P2 | Skills: pick 1..n **service categories** (AC repair, electrician, plumber, house cleaning, water-tank cleaning, car/bike mechanic, appliance repair, pest control, carpenter, painter). For each skill: **skill level** (Beginner / Skilled / Expert / Certified), **visit/inspection fee**, **hourly or base labour rate**, and an optional rate card of common jobs ("Gas refill — ₹2,500"). | P0 |
| P3 | KYC: identity and payout KYC are done **through the payment partner's linked-account onboarding** (Razorpay Route). QuickServe stores only `kyc_status (pending/verified/rejected)`, the vendor reference, the verification timestamp, and the rejection reason. **We never store Aadhaar numbers or ID images.** Unverified providers are **not shown** in search. | P0 |
| P4 | Payout details: UPI ID or bank account (via the payment gateway's linked-account onboarding). | P0 |
| P5 | Availability toggle (Online / Offline) + weekly working hours. | P0 |
| P6 | Portfolio photos (before/after). | P1 |
| P7 | Skill certificates upload → "Certified" badge after admin check. | P1 |

### 5.3 Discovery & search (customer)
| ID | Requirement | Pri |
|---|---|---|
| S1 | Home: category grid + search bar + "Top rated near you". | P0 |
| S2 | Category list → providers within radius, filtered to verified + offering that skill. | P0 |
| S3 | Sort: **Recommended (default)**, Rating, Price (visit fee), Distance, Experience. | P0 |
| S4 | Filters: min rating, skill level, max visit fee, available now, language. | P0 |
| S5 | Provider card: photo, name, ★ rating (count), skill level badge, visit fee, distance, jobs completed, "Verified" badge. | P0 |
| S6 | Provider detail: full profile, rate card, reviews (sorted newest / most helpful), portfolio. | P0 |

**Recommended score (default sort)** — a Bayesian rating so a single 5★ review doesn't beat 200 4.8★ reviews:
```
bayes_rating = (C*m + sum_ratings) / (C + n)      C = 10 (prior weight), m = city avg rating
score = 0.60*norm(bayes_rating) + 0.15*norm(completion_rate)
      + 0.15*(1 - norm(distance_km)) + 0.10*norm(response_speed)
```

### 5.4 Booking & job lifecycle
| ID | Requirement | Pri |
|---|---|---|
| B1 | Book a specific provider: choose service, describe the problem (text + up to 4 photos), address, time slot ("ASAP" or date/time). | P0 |
| B2 | Customer pays the **visit/inspection fee** upfront to confirm the booking. The payment is captured by the payment aggregator and isn't transferred to the provider until the release condition is met. | P0 |
| B3 | Provider receives a push notification; must **Accept/Decline within 15 min**, otherwise the request expires and the customer is refunded and offered alternatives. | P0 |
| B4 | Job states (**canonical enum and transitions: doc 04 §3**): `pending_payment → requested → accepted → en_route → inspecting (start OTP) → quote_sent → awaiting_payment → in_progress → completion_requested → completed (end OTP or 24 h auto-confirm) → closed (after payout)`; side states: `declined, expired, cancelled, closed_no_work, disputed, refunded`. | P0 |
| B5 | **Start OTP**: customer shares a 4-digit code so the provider can mark "arrived". This prevents fake visits. OTPs are readable only by the customer, verified server-side, and lock after 5 wrong attempts. | P0 |
| B6 | **On-site itemized quote**: provider adds line items (labour / parts / other) with qty and price, and a photo of the parts bill when needed. Customer approves or rejects in the app. If the customer rejects the **initial** quote, the job closes (`closed_no_work`) and the provider receives the visit fee minus commission, GST on commission, and statutory deductions. | P0 |
| B7 | **Change orders**: provider can send a revised quote mid-job; the job stays `in_progress`. If the customer approves, they **pay the increase** before the extra work. If they reject, the original approved scope and amount stand. | P0 |
| B8 | **Pay before work**: on quote approval the customer pays the approved balance (quote total + platform fee − visit fee) **before work starts**. Funds stay with the payment aggregator. Completion: provider requests completion → customer sees the end OTP and shares it (or auto-confirm 24 h after the request) → a 24 h dispute window opens → the provider payout is released. The provider is never left unpaid for finished work. | P0 |
| B9 | In-app chat (text + images) between customer and provider per booking; **phone numbers masked** (call through a masked number in P1). | P0 chat / P1 masking |
| B10 | Cancellation / no-show policy: see §5.10 (binding table). | P0 |
| B11 | Rebook the same provider from history. | P1 |
| B12 | "Broadcast request": post a job to all nearby providers in a category; first to accept wins. | P1 |

### 5.5 Payments (detail in doc 03)
| ID | Requirement | Pri |
|---|---|---|
| PAY1 | Payment gateway with **marketplace split settlement** (Razorpay Route in India; Stripe Connect elsewhere). | P0 |
| PAY2 | Methods: UPI, cards, net banking, wallets. | P0 |
| PAY3 | Escrow-style flow: the payment aggregator holds the captured funds; a Route transfer to the provider (minus commission + GST on commission + statutory TDS/TCS) is created **after completion + a 24 h dispute window**. An open dispute freezes the payout. | P0 |
| PAY4 | Cash jobs (provider-at-risk, no guarantee): commission accrued as provider debt, deducted from the next payout; a debt over ₹1,000 blocks new jobs. | P1 |
| PAY5 | Generate **legally separate tax documents** according to a **CA-approved tax matrix** (service category × provider GST status, incl. GST s.9(5) for housekeeping-type services, GST TCS, Income-tax s.194-O TDS). Don't combine the provider's supply and QuickServe's platform charges into one tax invoice unless that's legally supported. **This is a gate before live payments.** | P0 |
| PAY6 | Provider earnings screen: today / week / pending payout / paid. | P0 |

### 5.6 Ratings & reviews
| ID | Requirement | Pri |
|---|---|---|
| R1 | Only customers with a **completed + paid in-app** booking can review that booking (one review per booking). | P0 |
| R2 | 1–5 stars overall + optional sub-ratings (punctuality, quality, behaviour, pricing fairness) + text + photos. | P0 |
| R3 | Providers rate customers too (private, used to flag abusive customers). | P1 |
| R4 | Provider can publicly reply to a review once. | P1 |
| R5 | Report review → admin moderation. | P1 |
| R6 | Provider rating < 3.5 over the last 20 jobs → warning; < 3.0 → hidden from search pending review. | P1 |

### 5.7 Notifications
Push notifications (Expo/FCM/APNs) for every state change, plus SMS fallback for OTP and job requests to providers.

### 5.8 Admin console (web, internal)
Read-only views (KYC status, categories, payouts report) can use Supabase Studio. **Every money-moving or state-changing admin action (refund, payout hold/release, dispute resolution, ban) must go through constrained, idempotent, audit-logged admin RPCs** behind an `is_admin` check. Never edit rows by hand in Studio. P0: a minimal admin screen for disputes; full admin web app is P1.

### 5.9 Trust & safety
- Launch claim: **"identity-verified pros"**, not "background-checked". **Police/background verification is required before any provider can accept a job that involves entering a customer's home**, which covers every launch category (AC repair, electrical, plumbing, cleaning, water-tank cleaning, pest control, appliance repair, carpentry, painting). Vehicle mechanics working at a roadside or garage are exempt. Until a provider is verified, they can only join the closed beta.
- SOS button during an active job: shares location with a verified emergency contact **and** creates an incident ticket for QuickServe's on-call owner (founder). Immediate provider suspension on any safety report pending review.
- **QuickServe Guarantee (single definition): within 7 days of completion, for in-app-paid jobs, free rework by the same or another provider; if rework isn't possible, a refund of labour up to ₹2,000.** Funded from the platform fee. No "insurance" claims until a real insurance product is contracted.
- Chat logs and quote/bill photos are kept as dispute evidence (retention per the privacy policy).

### 5.10 Cancellation, no-show & dispute policy (binding)
| Situation | Customer refund | Provider gets | Platform fee | Provider penalty |
|---|---|---|---|---|
| Provider declines / 15-min expiry | 100% visit fee | 0 | n/a (not yet charged) | none (expiry counts toward response rate) |
| Customer cancels before `en_route` | 100% visit fee | 0 | n/a | — |
| Customer cancels after `en_route` (GPS-verified trip start) | 0 | visit fee − commission | n/a | — |
| Provider cancels after accepting / no-show (not arrived within slot + 30 min) | 100% visit fee + ₹50 credit | 0 | n/a | strike; 3 strikes in 30 days → suspension |
| Customer not home (provider waited 15 min at the geofenced address and called via the app) | 0 | visit fee − commission | n/a | — |
| Quote rejected after inspection | 0 | visit fee − commission | not charged | — |
| Partial work (customer disputes some lines) | refund of disputed approved lines after review | undisputed lines | kept | per dispute outcome |
| Gateway fees on refunds | absorbed by QuickServe (Razorpay doesn't return fees on refunds) | — | — | — |

**Dispute flow:** `opened (≤ 24 h after completion; reasons: not done / poor quality / overcharge / damage / safety) → provider_response_due (24 h) → under_review (admin SLA 48 h) → resolved_rework | resolved_partial_refund | resolved_full_refund | denied → closed`. Opening a dispute freezes the payout. Evidence: photos, chat, quote versions, bills. In the table above, "visit fee − commission" always means visit fee − commission − GST on commission − applicable statutory deductions.

**Chargebacks** can arrive after the payout has been released, so they get their own flow (M2): `chargeback_opened → chargeback_won | chargeback_lost`. On loss, attempt a Route transfer reversal; if the funds are already settled, record a provider debt recovered from future payouts. QuickServe absorbs losses under ₹500.

## 6. Non-functional requirements
| Area | Requirement |
|---|---|
| Performance | Search results in < 1.5 s on 4G; app cold start < 3 s on a ₹10k Android phone. |
| Offline | Show cached bookings; queue chat messages. |
| Security | Row Level Security on every table; no client trust for prices/state transitions (server-side functions); payment webhooks signature-verified; PII encrypted at rest. |
| Privacy/Compliance | India DPDP Act 2023 consent and data deletion; Play Store Data Safety form; RBI rules: **never store card data** (the gateway handles it). |
| Availability | 99.5% (managed backend). |
| Accessibility | Large tap targets (≥ 48 dp), works with system font scaling, color contrast AA. |
| Analytics | Funnel events: search → view → book → accept → complete → pay → review. |

## 7. Out of scope (MVP)
Subscriptions/memberships, product marketplace, loyalty points, video consults, B2B/society contracts, AI diagnosis, multiple cities in parallel.

## 8. Risks & mitigations
| Risk | Mitigation |
|---|---|
| **Disintermediation** (customer and provider go offline after the first job) | Guarantee only for in-app payments, one-tap rebooking of the same provider, digital invoices, lower commission than competitors, provider loyalty tiers (12% → 10% after 50 → 8% after 200 in-app jobs; doc 03 §4 is canonical), and ratings only from in-app jobs. Masked calling is P1; we accept that masking can't stop direct contact after a home visit. |
| Cold start (no supply / no demand) | Supply first: onboard 100 providers in one city manually (field team, local associations, hardware shops), with 0% commission for the first 30 days. Then demand through society WhatsApp groups and referral codes. |
| Price disputes on variable jobs | Itemized quotes, customer approval, parts bill photo, and a "fair price" range per category shown to the customer. |
| Fake reviews | Reviews only on paid bookings; anomaly checks. |
| Regulatory (payment aggregator rules) | Use a licensed PA (Razorpay) with Route; do not hold funds ourselves. |

## 9. Release plan
| Phase | Content | Duration |
|---|---|---|
| M0 | Docs, design, backend schema; **CA tax matrix + Razorpay Route enablement started in parallel** | 1–2 wks |
| M1 – Closed alpha | Auth, provider registration, search, booking, quote flow, chat; payments in **test mode** (internal testers) | 6–8 wks |
| M2 – Pilot beta | Live payments (after the tax/KYC gate), disputes + admin RPCs, reviews, push, automated state-machine tests; Play **closed testing** (personal accounts: ≥ 12 testers opted in continuously for 14 days) | 4–6 wks |
| M3 – Launch | Play production (Android first), **one city, 1–3 categories** | 2 wks |
| M4 | iOS, P1 features: masking, broadcast requests, Hindi, cash-commission ledger | ongoing |

Realistic part-time total to a **production pilot: ~14–18 weeks**. A clickable closed alpha is possible in ~8 weeks.

## 10. Open questions
1. Launch city? (Affects GST registration state and the field-onboarding plan.)
2. Company entity: sole proprietorship vs Pvt Ltd (Razorpay live mode needs business KYC; see doc 05).
3. Final brand name and trademark check ("QuickServe" is a placeholder and likely taken).

## 11. Product roadmap — PM review (Nov 2026)

Each item is tagged with the goal it serves: **A** = adoption (getting users), **U** = usage and retention, **R** = revenue, **T** = trust.
Priority: **Now** = before public launch, **Next** = first 3 months after launch, **Later** = after that.

### 11.1 Get customers in (adoption)
| Feature | Why | Goal | Priority |
|---|---|---|---|
| **Browse before login**: show categories, pros, prices and reviews; ask for the phone number only at Book | Removes the biggest drop-off point | A | Now |
| **WhatsApp booking and updates** (WhatsApp Business API): status updates, quote approval links and reminders on WhatsApp | Most Indian households live on WhatsApp; push notifications get ignored or switched off | A U | Now |
| **Hindi + Telugu UI**, plus an English/Hindi/Telugu toggle in Me | Tier-2/3 cities, and providers' first language | A | Now |
| **Referral**: give ₹100 / get ₹100 in wallet credit, for both customers and providers | Cheapest way to acquire users; works through apartment WhatsApp groups | A | Now |
| **First-booking offer**: ₹0 visit fee on the first booking (platform-funded, max ₹199) | Lowers the risk of trying the app | A | Now |
| **Apartment/society partnerships**: a society code gives a discount and a "Trusted in Sai Residency" badge on pros | Dense demand and word of mouth | A T | Next |

### 11.2 Easier to book, more reasons to come back (UX and retention)
| Feature | Why | Goal | Priority |
|---|---|---|---|
| **Instant booking ("Find me a pro")**: broadcast to the top 5 nearby pros; the first to accept wins (PRD B12, moved up from P1) | Customers want a fix, not to compare profiles; also fixes cases where a single pro doesn't respond | U | Now |
| **Fixed-price packages** for standard jobs (AC jet service ₹599, tank cleaning per 1,000 L, 2BHK deep clean), alongside visit-fee + quote | Price certainty converts better; no quote step needed | U R | Now |
| **Push notifications + in-app notification centre** | Every booking state change needs to reach the user | U | Now |
| **Live pro tracking** while on the way (ETA on a map) | Reduces "where is he?" calls and cancellations | U T | Next |
| **Reschedule** (customer or pro proposes a new slot, the other accepts) instead of cancel and rebook | Fewer lost bookings | U | Next |
| **Favourite pros + "Book again"** with the same pro (1 tap from Home) | Repeat jobs are the core retention loop | U | Now |
| **Smart reminders**: AC service every 6 months, water tank every 3 months, RO filter every 6 months, pest control yearly | Brings users back without paid marketing | U R | Next |
| **Wallet** (refunds, referral credit and cashback land here; can be used at checkout) | Faster refunds and money stays on the platform | U R | Next |
| **Photo-based quote estimate**: upload a photo and get a likely issue and price range before booking (ties into the AI assistant) | Confidence before paying the visit fee | U | Next |
| **AI booking assistant** (chat/voice: describe the issue → suggested pros → pre-filled booking) | Lowest-effort booking path; Gemini, English/Hindi/Telugu, see README "AI assistant" | A U | Built (v1) |

### 11.3 Revenue streams (beyond the 12% commission and ₹29 platform fee)
| Stream | How it works | Goal | Priority |
|---|---|---|---|
| **QuickServe Plus membership** (₹149/quarter or ₹499/year): no platform fee, 15% off visit fees, extended 30-day warranty, priority pros | Recurring revenue and retention; pays for itself after about 5 bookings | R U | Next |
| **AMC / maintenance plans**: e.g. AC (2 services + priority repairs per year), water tank (4 cleans/year), RO purifier | Predictable recurring revenue and steady work for pros | R | Next |
| **Pro Boost (featured listing)**: a pro pays to appear in "Featured" slots, clearly labelled; ranking stays merit-based | Ad revenue from the supply side | R | Later |
| **Pro subscription** (₹299/month for 8% commission + more leads + instant payouts) | Revenue from high-volume pros; reduces leakage | R | Later |
| **Instant payout fee** (1%, or free for Pro subscribers) instead of waiting 24 h | Small fee; providers value cash flow | R | Next |
| **Parts margin**: partner with local wholesalers; pros buy parts through the app at a discount, and the platform keeps a small margin | Revenue and genuine-parts trust | R T | Later |
| **B2B / bulk**: offices, PGs/hostels, property managers, gated societies (monthly invoice, SLAs) | Larger repeat orders | R | Later |
| **Extended warranty / damage protection add-on** at checkout (₹29–₹49, via an insurer partner) | Attach revenue and trust | R T | Later |
| **EMI / pay later** for jobs over ₹3,000 (Razorpay EMI/BNPL) | Unlocks painting and appliance jobs | R | Later |

### 11.4 Supply side (providers)
| Feature | Why | Goal | Priority |
|---|---|---|---|
| **Availability calendar + working hours** (PRD P5) | Fewer declines and expiries | U | Now |
| **Demand heatmap + "busy hours" tips** | More jobs for pros, faster acceptance for customers | U | Next |
| **Skill certification courses** (paid, brand partnerships) → "Certified" badge | Quality, and a revenue line | T R | Later |
| **Provider referral bonus** | Supply growth in each new area | A | Now |
| **Tools and parts discounts, accident insurance** for active pros | Loyalty, so pros stay on the platform | U T | Later |

### 11.5 Trust and operations
| Feature | Why | Goal | Priority |
|---|---|---|---|
| **Police/background verification** for in-home categories (PRD 5.9) | Required before a public launch | T | Now |
| **Admin console** (KYC review, disputes, refunds, payouts, bans, category pricing) | Ops can't run from SQL | T | Now |
| **Photo reviews + review tags** ("On time", "Clean work") | Richer trust signals | T | Next |
| **Masked calling** (Exotel/Knowlarity) | Privacy, plus less leakage | T R | Next |
| **Funnel analytics** (PostHog: search → view → book → pay → review) and a cohort dashboard | Decide what to build next with data | — | Now |

### 11.6 Suggested build order
1. **Launch blockers:** browse before login, push + notification centre, background verification flow, admin console, analytics, Hindi/Telugu.
2. **Growth:** WhatsApp updates, referral + first-booking offer, instant booking, fixed-price packages, favourites/book again.
3. **Monetise and retain:** Plus membership, AMC plans, wallet, reminders, instant payout fee.
4. **Scale:** live tracking, reschedule, Pro Boost, Pro subscription, B2B, parts, EMI, AI assistant (whenever the founder says go).

### 11.7 Scope expansion: all local services
QuickServe is expanding from home repairs to **all common local services**: beauty, events and weddings, photography, catering, learning, care, auto, pets and moving. Each category maps to a fulfilment archetype (fixed package, inspect→quote, proposal + milestones, time-based) through configuration. The design, phased task list, rules and open decisions are in `07-Multi-Category-Expansion-Plan.md`.
