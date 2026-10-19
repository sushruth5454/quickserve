# QuickServe — Store Deployment, Costs & Feasibility

## 1. Is it feasible for one person? **Yes.**
- One TypeScript codebase (Expo) builds both the Android and iOS apps. **EAS Build compiles in the cloud, so no Mac is needed** even for iOS.
- The backend is managed (Supabase), so there are no servers to run.
- The realistic timeline is **~8 weeks part-time to a closed alpha** (test payments) and **~14–18 weeks to a production pilot with live payments** (see PRD §9). For personal Play accounts, Google's 14-day closed test is part of that.
- The hard part of a startup like this isn't the code. It's **supply onboarding and trust in one city**. Plan field time for it.

## 2. What you must pay (all real, current as of Oct 2026; verify at signup)

| Item | Cost | Required? | When |
|---|---|---|---|
| Google Play Console developer account | **US$25 one-time** | Yes for Android | Before the first upload |
| Apple Developer Program | **US$99 / year** | Only for iOS | When you ship iOS (you can ship Android first) |
| Expo / EAS | **Free** tier is enough to start (limited builds/month, slower queue). Paid plans from ~US$19/mo if you need faster builds | No | Optional |
| Supabase | Free for development; **US$25/mo Pro** recommended at launch (free projects pause after inactivity, no backups) | Free → Pro at launch | Launch |
| Razorpay | **No setup / annual fee**; standard pricing ~**2% + GST per transaction across UPI/cards/net banking** (negotiable at volume); Route transfer fee may apply (verify at onboarding) | Yes for in-app payments | Beta |
| SMS OTP (India) | DLT entity + template registration (~₹5,900 one-time on most operators' DLT portals) + ~₹0.15–0.25/SMS via MSG91 | Yes for phone login | Beta |
| Domain + privacy policy/terms page | ~₹800–1,500/yr (host free on GitHub Pages/Netlify) | Yes (Play requires a privacy policy URL) | Before closed test |
| Company registration (recommended) | Sole proprietorship (Udyam MSME, free) **or** Pvt Ltd (~₹7k–15k via online CA services) + GST (free, mandatory once you collect commission at scale; e-commerce operators should register from day 1) | Needed for Razorpay live mode/Route + invoicing | Before live payments |
| D-U-N-S number | **Free** | Only if you open a Play/Apple **organization** account | Optional |

**Minimum spend to get on Play Store with test payments:** about **US$25 + a domain (~₹1,000)**.
**Realistic launch budget (first 3 months):** ~₹25k–40k (Supabase Pro, DLT, SMS, company + GST setup, Apple fee) before marketing.

### Do I owe Google a cut of payments? **No.**
Google Play Billing (15–30%) applies only to **digital goods** consumed in the app. Payments for **physical, real-world services** (AC repair, cleaning) are explicitly exempt, so you must use your own payment processor (Razorpay). Apple has the same rule (App Store Review Guideline 3.1.3(e)/3.1.5). So **you keep your commission and pay only Razorpay's fees** (~2% + GST per transaction, plus a Route transfer fee + GST if applicable; confirm at onboarding).

## 3. Personal vs organization Play account

| | Personal account | Organization account |
|---|---|---|
| Needs | Govt ID | Registered business + **D-U-N-S** (free, ~1–2 weeks) |
| **Closed test before production** | **Required: ≥ 12 testers opted in for 14 consecutive days**, then apply for production access (questionnaire) | **Not required** |
| Developer name shown | Your legal name | Company name (looks more trustworthy for a payments marketplace) |
| Recommendation | Fine to start **now** | Switch/use once the company is registered |

## 4. Step-by-step: Android (Google Play)

1. **Accounts**
   - Create an Expo account: `npm i -g eas-cli` → `eas login`.
   - Create a Play Console account at https://play.google.com/console (US$25, identity verification takes 1–3 days).
2. **Configure the app** (already set in `app/app.json`): `android.package = com.quickserve.app`. This can **never change** after the first upload, so pick the final brand domain first (e.g. `in.yourbrand.app`).
3. **First build (internal APK for your phone):**
   ```bash
   cd app
   eas build:configure
   eas build -p android --profile preview      # APK, install directly on your phone
   ```
4. **Production build (AAB):** `eas build -p android --profile production`. EAS creates and stores the upload keystore for you (keep the backup that EAS offers). Enable **Play App Signing** (the default).
5. **Create the app in Play Console** → fill in:
   - App access (give reviewers a **test phone number + fixed OTP**. Configure test OTPs in Supabase Auth → Phone → "Test OTP").
   - **Privacy policy URL**, **Data safety form** (you collect: phone, name, approximate/precise location, photos, payment info handled by Razorpay, app activity), **Account deletion** (Play requires an in-app path **and** a web URL for deletion requests), content rating questionnaire, target audience (18+), ads = No, category = *House & Home* or *Lifestyle*.
   - Store listing: icon 512×512, feature graphic 1024×500, ≥ 2 phone screenshots, short and full description.
6. **Internal testing track** → upload the AAB (or `eas submit -p android` with a Google service-account JSON) → add yourself.
7. **Closed testing track** (required for **personal accounts created after 13 Nov 2023**): **at least 12 testers must stay opted in continuously for the preceding 14 days** before you can apply for production. Recruit 15+ (friends, family, the providers you're onboarding) so a drop-out doesn't reset the clock. Do real testing and collect feedback, because Google's production-access questionnaire asks about it.
8. **Apply for production access** → answer the questionnaire about your test → Google reviews it (usually up to ~7 days).
9. **Production release** with a staged rollout (20% → 50% → 100%).
10. **Policy checks to remember:** target API level (**API 36 / Android 16 required for new apps and updates from 31 Aug 2026**; recent Expo SDKs already target it, so just stay on a current SDK), foreground location only (don't request background location in the MVP), and declare the camera/photo permissions with usage text.

## 5. Step-by-step: iOS (when ready)
1. Apple Developer Program (US$99/yr; individual or organization with D-U-N-S).
2. `eas build -p ios --profile production`. EAS manages certificates and provisioning; **no Mac required**.
3. `eas submit -p ios` → TestFlight (internal testers right away; external testers need a short beta review).
4. App Store Connect: privacy "nutrition labels", account deletion (required), a demo account for review, and screenshots for 6.7" and 6.5". Review usually takes 1–3 days. Common rejections: missing account deletion, no demo login, vague permission strings.

## 6. Payments go-live checklist (Razorpay)
1. Sign up and use **Test Mode** immediately (no KYC needed); all development uses test keys and test UPI IDs.
2. Live activation: business KYC (PAN, bank account, business proof, website/app link with policies: Terms, Privacy, **Refund & Cancellation**, Contact). Unregistered individuals have limited support; register at least a sole proprietorship (Udyam + GST).
3. Request **Route** enablement (marketplace) from Razorpay support/dashboard. Each provider becomes a Linked Account (KYC + bank).
4. Configure the webhook → `https://<project>.supabase.co/functions/v1/razorpay-webhook`, event `payment_link.paid`, with a secret.
5. **Tax gate (before live payments):** get a CA to produce the tax matrix in PRD PAY5: GST on commission/platform fee, possible ECO liability under GST s.9(5) for housekeeping-type services, GST TCS, and Income-tax s.194-O TDS on provider payouts. Expect ~₹5–15k one-time plus monthly filing fees.

## 7. Legal / startup basics
- **Terms of Service** must state that you're a marketplace, providers are independent contractors, and you're not liable beyond the guarantee terms. **Privacy Policy** must be DPDP Act 2023 compliant. **Refund policy.** Use a lawyer-reviewed template (~₹5–10k) before public launch.
- **Brand:** search the trademark registry (ipindia.gov.in) and the Play Store before finalizing; "QuickServe" is a placeholder.
- **Employment note:** if you're currently employed, check your employer's outside-employment / side-business and IP policy (and disclose if required) **before** registering a company or launching. Build it on personal devices, personal accounts, and personal time.

## 8. Your next 7 days (actionable)
| Day | Do |
|---|---|
| 1 | Create Supabase (free), Expo, and Razorpay (test mode) accounts. Follow `README.md` to run the app on your phone with Expo Go / a dev build. |
| 2 | Pay $25 → Play Console. Buy a domain; publish a privacy policy + terms page. |
| 3 | Decide the brand and package name; update `app.json`. |
| 4–5 | Walk the full flow on two phones (customer + provider) in test mode; fix issues. |
| 6 | Line up 15 closed testers, ideally 5–10 real providers in your launch city plus friends. |
| 7 | `eas build -p android --profile production` → upload to internal → closed testing. The 14-day clock starts. |
