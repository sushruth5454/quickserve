// Web smoke test: logs in with the Supabase test OTP and visits every screen against the live dev project.
// Run by .github/workflows/e2e-web.yml. Env: BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SHOTS_DIR.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { runAllServiceScenarios } from './all-services.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8081';
const SHOTS = process.env.SHOTS_DIR ?? 'e2e-shots';
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const QA_MARKER = process.env.QA_MARKER ?? `QA-E2E manual-${Date.now()}`;
const PHONE = '9999999999';
const OTP = '123456';
const RAVI = '11111111-1111-1111-1111-111111111111';
// Fresh-provider onboarding user: test OTP number reset by e2e-web.yml before each run (no seed data).
const NEW_PRO_PHONE = process.env.NEW_PRO_PHONE ?? '9000000301';
const seeded = (prefix, n) => `${prefix}${String(n).padStart(6, '0')}-5eed-5eed-8000-000000000000`;

mkdirSync(SHOTS, { recursive: true });
const pageErrors = [];
const consoleErrors = [];
const failures = [];
let shot = 0;

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['iPhone 15'],
  geolocation: { latitude: 16.4995, longitude: 80.656 },
  permissions: ['geolocation'],
  // Customers are in India; slot windows are checked against providers' IST working hours.
  timezoneId: 'Asia/Kolkata',
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on('pageerror', (e) => pageErrors.push(`[${page.url()}] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`[${page.url()}] ${m.text()}`);
});

async function snap(name) {
  shot += 1;
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/${String(shot).padStart(2, '0')}-${name}.png` });
}

async function step(name, fn) {
  console.log(`> ${name}`);
  try {
    await fn();
    await snap(name);
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0];
    failures.push(`${name}: ${msg}`);
    console.log(`  FAILED: ${msg}`);
    await snap(`${name}-FAILED`).catch(() => undefined);
  }
}

const visible = (text) => page.getByText(text, { exact: true }).first().waitFor({ state: 'visible' });
const go = async (path) => {
  await page.goto(BASE + path);
  await page.waitForLoadState('networkidle').catch(() => undefined);
};
// Scrolls the screen's main scroll view (react-native-web renders it as an overflow div) and takes an extra shot.
async function snapScrolled(name, dy = 640) {
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(400);
  await snap(name);
}
const optional = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log(`  (optional ${name} skipped: ${String(e?.message ?? e).split('\n')[0]})`);
  }
};

async function rest(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

/** Signs a second test user in through the Auth API (fixed test OTP) and returns their access token. */
async function signInAs(phone) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  let sent = await fetch(`${SUPABASE_URL}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ phone }) });
  if (sent.status === 429) {
    await new Promise((r) => setTimeout(r, 4500));
    sent = await fetch(`${SUPABASE_URL}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ phone }) });
  }
  if (!sent.ok) throw new Error(`otp ${sent.status}: ${await sent.text()}`);
  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers, body: JSON.stringify({ phone, token: OTP, type: 'sms' }) });
  if (!res.ok) throw new Error(`verify ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

// ---------- Auth (one OTP send per run: the test number is rate limited) ----------
await step('login', async () => {
  await go('/');
  await page.getByLabel('Mobile number, India plus 91').fill(PHONE);
  await page.getByText('Send OTP', { exact: true }).click();
  await visible('Verify your number');
});
await step('verify', async () => {
  await page.getByLabel('6-digit verification code').fill(OTP);
  await visible('Welcome to QuickServe');
});
await step('role-continue-customer', async () => {
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForURL((u) => !/\/(login|verify|role)$/.test(new URL(u).pathname));
  await visible('Bookings');
});

await runAllServiceScenarios({ page, go, step, visible, qaMarker: QA_MARKER });

// ---------- Customer ----------
await step('home', async () => {
  await go('/');
  await visible('AC Repair');
});
await optional('home-top-rated', async () => {
  await page.getByText('Top rated near you', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, 200);
  await snap('home-top-rated');
});
await step('top-rated-see-all', async () => {
  await page.getByText('See all', { exact: true }).first().click();
  await page.waitForURL(/\/top-rated$/);
  await page.getByText(/verified pros?$/).first().waitFor();
});

// ---------- Location picker ----------
// Demo-seed runs set EXPO_PUBLIC_DEMO_CITY, which becomes the app's launch city.
const CITY = (process.env.EXPO_PUBLIC_DEMO_CITY ?? '').trim() || 'Vijayawada';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const managedAreas = await rest('geo_areas?select=name,geo_cities(name)&active=eq.true&order=sort_order').catch(() => []);
const managedArea = managedAreas.find((area) => area.geo_cities?.name?.toLowerCase() === CITY.toLowerCase());
await step('location-picker', async () => {
  await go('/');
  await page.getByLabel(/^Service location:/).first().click();
  await page.waitForURL(/\/location$/);
  await visible('Select location');
  await visible('Saved addresses');
  await page.getByText(/^Flat 302, Sri Sai Residency/).first().waitFor();
});
await optional('location-search-managed-area', async () => {
  if (!managedArea) throw new Error(`No active managed areas are configured for ${CITY}`);
  await page.getByLabel('Search for an area or address').first().fill(managedArea.name.slice(0, 3));
  await visible(managedArea.name);
});
await optional('location-pick-managed-area', async () => {
  if (!managedArea) throw new Error(`No active managed areas are configured for ${CITY}`);
  await page.getByText(managedArea.name, { exact: true }).first().click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
  await page.getByText(new RegExp(`^${escapeRe(managedArea.name)}, ${escapeRe(CITY)}$`)).first().waitFor();
});
await step('location-search-providers', async () => {
  await go('/location');
  const home = CITY === 'Vijayawada' ? /^Flat 302, Sri Sai Residency/ : /^Flat 302, Sai Residency/;
  await page.getByText(home).first().click();
  await go('/category/ac-repair?name=AC%20Repair');
  await page.getByText(/verified pros? near Benz Circle/i).first().waitFor();
});
await step('location-add-address-sheet', async () => {
  await go('/location');
  await page.getByText('Add new address', { exact: true }).first().click();
  await visible('House / flat no., street, landmark');
});
await step('location-pick-saved-home', async () => {
  await go('/location');
  // Stay in the seeded city so the category checks below see the demo providers.
  const home = CITY === 'Vijayawada' ? /^Flat 302, Sri Sai Residency/ : /^Flat 302, Sai Residency/;
  await page.getByText(home).first().click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
  await page.getByText(new RegExp(`^Benz Circle, ${escapeRe(CITY)}$`)).first().waitFor();
});
const categories = await rest('categories?select=slug,name,archetype&order=sort_order').catch(() => []);
// Each archetype has its own landing screen: pro list (inspect_quote), packages (fixed), sessions
// (time_based) or creator list plus "Get proposals" (proposal).
const LANDING = {
  inspect_quote: /verified pros? near|pros nearby yet|No pros match/,
  fixed: /^Book package$|Request final quote|Get proposal|No packages live yet/,
  time_based: /^Choose session$|No sessions available yet/,
  proposal: /pros near you$|No pros listed nearby yet/,
};
for (const c of categories) {
  await step(`category-${c.slug}`, async () => {
    await go(`/category/${c.slug}?name=${encodeURIComponent(c.name)}`);
    await page.getByText(LANDING[c.archetype] ?? LANDING.inspect_quote).first().waitFor();
  });
}

// ---------- Creator proposal, end to end ----------
// A random event day, so a recent run's 30-minute payment hold on the test pro never blocks this one.
const proposalDay = 20 + Math.floor(Math.random() * 60);
// Customer browses a creator, sends a brief to that creator only, the creator replies with a fixed proposal
// (through the API as the +919000000101 test pro), and the customer compares, accepts and reaches checkout.
const PRO_ID = '11111111-1111-1111-1111-111111111111';
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString();
let proToken = null;
let proReelServiceId = null;
let briefRequestId = null;
let qaApprovalShopId = null;
let qaApprovalShopName = null;
let qaApprovalSkipReason = null;
async function asPro(path, body, method = 'POST') {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${proToken}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
await step('proposal-flow-pro-offers-reel-maker', async () => {
  proToken = await signInAs('+919000000101');
  const [reel] = await rest('categories?select=id&slug=eq.reel-maker');
  await asPro('/functions/v1/provider-service', {
    action: 'save_service', categoryId: reel.id, skillLevel: 'expert', visitFee: 0, labourRate: 100000, rateUnit: 'job',
    specialisations: [], brands: [], tools: [], attributes: { styles: ['cinematic', 'fast-cut'] },
    maxTravelKm: null, travelFeeMode: 'none', travelFeeFlat: 0, travelFeePerKm: 0,
  });
  const rows = await asPro(`/rest/v1/provider_services?select=id&provider_id=eq.${PRO_ID}&category_id=eq.${reel.id}`, null, 'GET');
  proReelServiceId = rows[0]?.id;
  if (!proReelServiceId) throw new Error('reel-maker service not saved');
});
await step('phase-7a-owner-submits-shop', async () => {
  const existingShop = await asPro('/rest/v1/rpc/get_my_shop', {});
  if (existingShop) {
    qaApprovalSkipReason = 'the existing test provider already owns a shop; refusing to overwrite unmarked data';
    console.log(`  SKIPPED: ${qaApprovalSkipReason}`);
    return;
  }
  qaApprovalShopName = `${QA_MARKER} approval shop`;
  qaApprovalShopId = await asPro('/rest/v1/rpc/save_shop', {
    p_name: qaApprovalShopName,
    p_description: `${QA_MARKER} synthetic owner submission and admin approval; no real sales.`,
    p_address_line: '88 QA Demo Market Road',
    p_city: 'Vijayawada Demo',
    p_area: 'Benz Circle',
    p_lat: 16.5000,
    p_lng: 80.6560,
    p_delivery_radius_km: 10,
    p_offers_delivery: false,
    p_offers_pickup: true,
    p_whatsapp_contact: false,
    p_gstin: null,
    p_category_slugs: ['sanitaryware'],
  });
  await asPro('/rest/v1/rpc/submit_shop', { p_shop_id: qaApprovalShopId });
  const submitted = await asPro('/rest/v1/rpc/get_my_shop', {});
  if (submitted?.id !== qaApprovalShopId || submitted.status !== 'submitted') {
    throw new Error(`owner submission did not persist submitted status (got ${submitted?.status ?? 'no shop'})`);
  }
});
await step('proposal-flow-customer-sends-brief', async () => {
  // The test pro works in Vijayawada; requests are routed only within the request's city.
  await go('/location');
  await page.getByText(/^Flat 302, Sri Sai Residency/).first().click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
  await go(`/provider/${PRO_ID}?category=reel-maker`);
  await page.getByText('Request proposal', { exact: true }).first().click();
  await page.waitForURL(/\/request\/new/);
  await page.getByText(/^Request a proposal from /).first().waitFor();
  await page.getByLabel('What do you need?').first().fill(`${QA_MARKER} 30-second launch reel for my cafe, vertical, 2 revisions`);
  await page.getByLabel('Event date', { exact: true }).first().fill(iso(proposalDay).slice(0, 10));
  await page.getByLabel('Venue / area').first().fill('Benz Circle cafe');
  await page.getByLabel('Approximate maximum (₹)').first().fill('15000');
  await page.getByText(/^Send to /).first().click();
  await page.waitForURL(/\/request\/[0-9a-f-]{36}$/);
  briefRequestId = new URL(page.url()).pathname.split('/').pop();
  await visible('Waiting for proposals');
});
await step('proposal-flow-pro-sends-proposal', async () => {
  const inbox = await asPro('/rest/v1/service_request_provider_view?select=id&id=eq.' + briefRequestId, null, 'GET');
  if (inbox.length !== 1) throw new Error('targeted creator did not receive the brief');
  await asPro('/rest/v1/rpc/send_proposal', {
    p_request_id: briefRequestId,
    p_items: [{ kind: 'package', title: '30-second launch reel', qty: 1, unit: 'job', unit_price: 1200000 }],
    p_schedule: [
      { label: 'Booking advance', amount: 400000, due_rule: 'at_booking' },
      { label: 'On delivery', amount: 800000, due_rule: 'on_delivery' },
    ],
    p_valid_until: iso(3),
    p_note: `${QA_MARKER} fixed proposal`,
    p_deliverables: [{ type: 'edited_reel', qty: 1, spec: '30s vertical 1080p with captions' }],
  });
});
await step('proposal-flow-customer-compares', async () => {
  await go(`/request/${briefRequestId}`);
  await page.getByText('₹12,000', { exact: true }).first().waitFor();
  await page.getByText('Compare proposal', { exact: true }).first().click();
  await page.waitForURL(/\/proposal\//);
  await visible('Payment milestones');
  await visible('Booking advance');
  await page.getByText(/30s vertical 1080p|edited_reel/i).first().waitFor();
});
await step('proposal-flow-accept-and-checkout', async () => {
  await page.getByText(/^Accept & reserve · ₹/).first().click();
  await visible('Secure checkout');
  await page.getByText(/^Pay ₹/).last().click();
  await page.waitForURL(/\/booking\/[0-9a-f-]{36}$/);
});
await optional('proposal-flow-cleanup', async () => {
  // Later steps browse the demo city, so switch back from the test pro's city.
  await go('/location');
  await page.getByText('Demo home', { exact: true }).first().click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
  // Keep the shared test pro to its seeded trades so it does not appear as a live creator.
  if (proReelServiceId) await asPro(`/rest/v1/provider_services?id=eq.${proReelServiceId}`, { active: false }, 'PATCH');
});
await step('category-sort-sheet', async () => {
  await go('/category/ac-repair?name=AC%20Repair');
  await page.getByLabel(/^Sort:/).first().click();
  await visible('Sort by');
});
await step('category-sort-top-rated', async () => {
  await page.getByText('Top rated', { exact: true }).click();
  await page.getByLabel('Sort: Top rated').first().waitFor();
});
await step('category-filter-sheet', async () => {
  await page.getByText('Filters', { exact: true }).first().click();
  await visible('Minimum rating');
});
await step('category-filter-applied', async () => {
  await page.getByText('Expert', { exact: true }).last().click();
  await page.getByText(/^(Show \d+ pros?|Show results|No matches)$/).first().click();
  await page.getByText(/verified pros? near|pros nearby yet|No pros match/).first().waitFor();
});
await step('provider-detail', async () => {
  await go(`/provider/${RAVI}`);
  await visible('Ratings & reviews');
});
await optional('provider-detail-scrolled', () => snapScrolled('provider-detail-scrolled', 900));
const raviServices = await rest(`provider_services?select=id&provider_id=eq.${RAVI}&active=eq.true&limit=1`).catch(() => []);
await step('book-screen', async () => {
  if (!raviServices[0]) throw new Error('no active service for Ravi');
  await go(`/book/${raviServices[0].id}`);
  await page.getByText(/& book$/).first().waitFor();
  await visible('Price details');
});
await step('book-screen-ready', async () => {
  await page.getByLabel('Describe the problem').first().fill('Split AC not cooling, only the fan runs');
  await page.getByText('Schedule', { exact: true }).first().click();
  await page.getByLabel(/^Tomorrow, /).first().click();
  await page.getByText('10 am–12 pm', { exact: true }).first().click();
  await page.getByText(/arrives .* between 10 am–12 pm/).first().waitFor();
});
await optional('book-screen-scrolled', () => snapScrolled('book-screen-scrolled', 800));

// ---------- QuickServe AI (live Gemini via the ai-assistant function; nothing is booked or paid) ----------
await step('assistant-open-from-home', async () => {
  await go('/');
  await page.getByLabel('Ask QuickServe AI').first().click();
  await page.waitForURL(/\/assistant$/);
  await visible('QuickServe AI');
  await page.getByLabel('Message QuickServe AI').first().waitFor();
  // A recent conversation is resumed automatically; start fresh so old cards can't satisfy the checks below.
  await page.waitForTimeout(2500);
  if (await page.getByText('Continuing your last chat').count()) {
    await page.getByLabel('New chat').first().click();
    await page.getByText('Continuing your last chat').first().waitFor({ state: 'detached' });
  }
});
await step('assistant-draft-card', async () => {
  await page.getByLabel('Message QuickServe AI').first().fill('AC not cooling, making noise, need tomorrow evening');
  await page.getByLabel('Send message').first().click();
  // Live progress from real server work (first stage is the model call), then the collapsed summary.
  await page.getByText(/Understanding your request|Switching to a backup AI model|Working on it/).first().waitFor({ timeout: 30000 });
  await page.getByText('Review & pay', { exact: true }).first().waitFor({ timeout: 120000 });
  await page.getByText('Booking draft', { exact: true }).first().waitFor();
  await page.getByText(/^Done in \d+\.\ds · \d+ steps?$/).first().waitFor();
  await page.getByText('Issue', { exact: true }).first().waitFor();
  await page.getByText('You reported', { exact: true }).first().waitFor();
});
await optional('assistant-draft-scrolled', () => snapScrolled('assistant-draft-scrolled', 600));
await step('assistant-review-prefills-book', async () => {
  await page.getByText('Review & pay', { exact: true }).first().click();
  await page.waitForURL(/\/book\//);
  await page.getByText(/^Pre-filled by QuickServe AI/).first().waitFor();
  const desc = await page.getByLabel('Describe the problem').first().inputValue();
  if (!/cool|AC/i.test(desc)) throw new Error(`description not pre-filled: "${desc}"`);
  // Job brief for the pro, not the customer's raw last message; time preferences live in the slot, not the text.
  if (!/^Issue: /m.test(desc) || !/Customer reported: "/.test(desc)) throw new Error(`description is not a job brief: "${desc}"`);
  if (/tomorrow evening/i.test(desc.split('\n').find((l) => l.startsWith('Issue:')) ?? '')) throw new Error(`issue line holds the time preference: "${desc}"`);
  await page.getByText(/arrives .* between 6–8 pm/).first().waitFor();
});
await step('bookings-active', async () => {
  await go('/bookings');
  await visible('My bookings');
});
await step('bookings-past', async () => {
  await page.getByText('Past', { exact: true }).first().click();
  await page.waitForTimeout(500);
});
for (const [n, label, scrolled] of [
  [1, 'pending-payment'],
  [3, 'start-code'],
  [6, 'quote', true],
  [7, 'awaiting-payment'],
  [8, 'change-order', true],
  [9, 'end-otp'],
  [10, 'review-form', true],
  [11, 'closed'],
  [16, 'disputed'],
]) {
  await step(`booking-fc${n}-${label}`, async () => {
    await go(`/booking/${seeded('fc', n)}`);
    await page.getByText(/^QS-[0-9A-F]{8} · /).first().waitFor();
  });
  if (scrolled) await optional(`booking-fc${n}-scrolled`, () => snapScrolled(`booking-fc${n}-${label}-scrolled`, 900));
}
await step('booking-chat-send', async () => {
  await go(`/chat/${seeded('fc', 9)}`);
  const box = page.getByLabel('Message', { exact: true }).first();
  await box.waitFor();
  await box.fill(`${QA_MARKER} web chat`);
  await page.getByLabel('Send message').first().click();
  await page.getByText(`${QA_MARKER} web chat`, { exact: true }).first().waitFor();
});
// ---------- Unread: the pro (Ravi, booking fc6) messages the signed-in customer through the API ----------
const FC6 = seeded('fc', 6);
const unreadBody = `${QA_MARKER} unread ${Date.now()}`;
await step('unread-badge-on-booking', async () => {
  const token = await signInAs('+919000000101');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/send_booking_message`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_booking_id: FC6, p_body: unreadBody }),
  });
  if (!res.ok) throw new Error(`send as pro: ${res.status} ${await res.text()}`);
  await go(`/booking/${FC6}`);
  await page.getByLabel(/^Chat with .*, \d+ unread$/).first().waitFor();
});
await step('unread-chat-divider', async () => {
  await go(`/chat/${FC6}`);
  await visible('New messages');
  await page.getByText(unreadBody).first().waitFor();
});
await step('unread-cleared-after-reading', async () => {
  await page.waitForTimeout(2000);
  await go(`/booking/${FC6}`);
  await page.getByLabel(/^Chat with [^,]+$/).first().waitFor();
});
await step('me-customer', async () => {
  await go('/account');
  await visible('Switch to provider mode');
});
await step('coins-wallet', async () => {
  await go('/account');
  await page.getByText('Seva Coins', { exact: true }).first().click();
  await page.waitForURL(/\/coins$/);
  await page.locator('text="Seva Coins" >> visible=true').last().waitFor();
  await page.locator('text=/^History$/i >> visible=true').first().waitFor();
});
await optional('me-customer-scrolled', () => snapScrolled('me-customer-scrolled', 900));
await step('info-safety', async () => {
  await go('/info/safety');
  await visible('Safety & guarantee');
});

// ---------- Customer, dark mode ----------
await page.emulateMedia({ colorScheme: 'dark' });
for (const [name, path, wait] of [
  ['dark-home', '/', 'AC Repair'],
  ['dark-category', '/category/ac-repair?name=AC%20Repair', null],
  ['dark-provider-detail', `/provider/${RAVI}`, 'Ratings & reviews'],
  ['dark-booking-quote', `/booking/${seeded('fc', 6)}`, null],
  ['dark-bookings', '/bookings', 'My bookings'],
  ['dark-location-picker', '/location', 'Saved addresses'],
  ['dark-me-customer', '/account', 'Switch to provider mode'],
]) {
  await step(name, async () => {
    await go(path);
    if (wait) await visible(wait);
    else await page.getByText(/^QS-[0-9A-F]{8} · |verified pros? near|pros nearby yet/).first().waitFor();
  });
}
await optional('dark-home-top-rated', async () => {
  await go('/');
  await page.getByText('Top rated near you', { exact: true }).first().scrollIntoViewIfNeeded();
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, 200);
  await snap('dark-home-top-rated');
});
await step('dark-top-rated-see-all', async () => {
  await go('/top-rated');
  await page.getByText(/verified pros?$/).first().waitFor();
});await page.emulateMedia({ colorScheme: 'light' });
await step('me-customer-again', async () => {
  await go('/account');
  await visible('Switch to provider mode');
});

// ---------- Provider ----------
await step('switch-to-provider', async () => {
  await page.getByText('Switch to provider mode', { exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.getByText(/New requests|Active jobs|Waiting for requests|You're offline/).first().waitFor();
});
await step('dashboard-next-job', async () => {
  await visible('Next job');
  await page.getByText(/^You're (online|offline)$/).first().waitFor();
});
await optional('dashboard-scrolled', () => snapScrolled('dashboard-scrolled', 700));
await step('earnings', async () => {
  await go('/earnings');
  await visible('Earnings');
  await page.getByText(/\d+% commission/).last().waitFor({ state: 'visible' });
});
await optional('earnings-scrolled', () => snapScrolled('earnings-scrolled', 700));
for (const [n, label] of [
  [1, 'request'],
  [3, 'accepted'],
  [6, 'completion-code'],
]) {
  await step(`provider-booking-fb${n}-${label}`, async () => {
    await go(`/booking/${seeded('fb', n)}`);
    await page.getByText(/^QS-[0-9A-F]{8} · /).first().waitFor();
  });
}
await step('provider-booking-fb4', async () => {
  await go(`/booking/${seeded('fb', 4)}`);
  await page.getByText(/^QS-[0-9A-F]{8} · /).first().waitFor();
});
await step('quote-editor-fb4', async () => {
  await go(`/quote/${seeded('fb', 4)}?changeOrder=0`);
  await page.getByText('Send to customer', { exact: true }).first().waitFor();
  await visible('Add from my rate card');
});
await step('quote-editor-rate-card-pick', async () => {
  await page.getByLabel(/^Add MCB replacement, /).first().click();
  await page.getByLabel('Line 1 description').first().waitFor();
  const values = await page.getByLabel(/^Line \d+ description$/).evaluateAll((els) => els.map((e) => e.value));
  if (!values.includes('MCB replacement')) throw new Error(`rate card item not added: ${values.join(', ')}`);
  await visible('You receive');
});
await optional('quote-editor-scrolled', () => snapScrolled('quote-editor-scrolled', 900));
await step('job-history', async () => {
  await go('/jobs');
  await visible('Job history');
});
// Provider onboarding v2 (docs/08): an already-submitted provider resumes at the review step; sections are editable.
await step('onboarding-resume-review', async () => {
  await go('/onboarding');
  await visible('Your profile');
  await page.getByText(/^Profile \d+% complete$/).first().waitFor();
});
await step('provider-profile-hub', async () => {
  await go('/provider-profile');
  await visible('Profile strength');
  await visible('Holiday mode');
});
for (const [section, title] of [
  ['basics', 'Tell customers about you'],
  ['services', 'Services & skills'],
  ['area', 'Where do you work?'],
  ['hours', 'When can you work?'],
  ['portfolio', 'Your work, links & credentials'],
  ['payouts', 'Payouts & verification'],
]) {
  await step(`provider-profile-${section}`, async () => {
    await go(`/provider-profile/${section}`);
    await page.getByText(title, { exact: true }).first().waitFor();
  });
}
await step('provider-profile-preview', async () => {
  await go('/provider-profile');
  await page.getByText('Preview', { exact: true }).first().click();
  await page.getByText(/^This is how customers (will )?see your profile/).first().waitFor();
});
await step('me-provider', async () => {
  await go('/pro-account');
  await visible('Switch to customer mode');
  await visible('My services');
  await page.getByLabel(/^Edit (AC Repair|Electrician)$/).first().waitFor();
});
await step('provider-profile-editor-back-to-hub', async () => {
  await page.getByText('Provider profile', { exact: true }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/provider-profile');
  await page.getByText('Service area', { exact: true }).click();
  await visible('Where do you work?');
  await page.getByLabel('Go back').last().click();
  await page.waitForURL((u) => new URL(u).pathname === '/provider-profile');
  await visible('Profile strength');
  await page.getByLabel('Go back').last().click();
  await page.waitForURL((u) => new URL(u).pathname === '/pro-account');
  await visible('My services');
});
await optional('me-provider-scrolled', () => snapScrolled('me-provider-scrolled', 800));

// ---------- Provider, dark mode ----------
await page.emulateMedia({ colorScheme: 'dark' });
for (const [name, path, wait] of [
  ['dark-dashboard', '/dashboard', null],
  ['dark-earnings', '/earnings', 'Earnings'],
  ['dark-quote-editor-fb4', `/quote/${seeded('fb', 4)}?changeOrder=0`, 'Send to customer'],
  ['dark-me-provider', '/pro-account', 'Switch to customer mode'],
  ['dark-provider-booking-fb4', `/booking/${seeded('fb', 4)}`, null],
]) {
  await step(name, async () => {
    await go(path);
    if (wait) await visible(wait);
    else await page.getByText(/^QS-[0-9A-F]{8} · |New requests|Active jobs/).first().waitFor();
  });
}
await page.emulateMedia({ colorScheme: 'light' });
await step('me-provider-light', async () => {
  await go('/pro-account');
  await visible('Switch to customer mode');
});

// ---------- Logout from the provider side ----------
await step('logout-confirm', async () => {
  await page.getByText('Log out', { exact: true }).first().click();
  await visible('Log out?');
});
await step('logout-login-screen', async () => {
  await page.getByText('Log out', { exact: true }).last().click();
  await page.getByLabel('Mobile number, India plus 91').waitFor();
  const path = new URL(page.url()).pathname;
  if (!/\/login$/.test(path)) throw new Error(`expected /login, got ${path}`);
});
await step('after-logout-deep-link', async () => {
  await go('/dashboard');
  await page.getByLabel('Mobile number, India plus 91').waitFor();
});

// ---------- Brand-new provider: signup -> 7-step onboarding -> submit (docs/08) ----------
// A 1x1 PNG is enough: the app resizes it client-side before uploading to the public avatars/portfolio buckets.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function chooseImage(trigger) {
  const chooser = page.waitForEvent('filechooser');
  await trigger();
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
}
await step('new-pro-login', async () => {
  await go('/');
  await page.getByLabel('Mobile number, India plus 91').fill(NEW_PRO_PHONE);
  await page.getByText('Send OTP', { exact: true }).click();
  await visible('Verify your number');
  await page.getByLabel('6-digit verification code').fill(OTP);
  await visible('Welcome to QuickServe');
});
await step('new-pro-role', async () => {
  await optional('name', () => page.getByLabel('Your name').first().fill('Kiran Test Pro', { timeout: 3000 }));
  await page.getByLabel(/^I provide services\./).first().click();
  await page.getByText('Continue', { exact: true }).click();
  await visible('Tell customers about you');
});
await step('new-pro-basics', async () => {
  await chooseImage(async () => {
    await page.getByLabel('Change profile photo').first().click();
    await page.getByText('Choose from gallery', { exact: true }).first().click();
  });
  const name = page.getByLabel('Full name').first();
  if (!(await name.inputValue())) await name.fill('Kiran Test Pro');
  await page.getByText('Telugu', { exact: true }).first().click();
  await page.getByLabel('Short bio').first().fill('AC technician for 6 years. Split and window AC service, gas refills and installations.');
  await page.getByText('Save & continue', { exact: true }).first().click();
  await visible('Services & skills');
});
await step('new-pro-services', async () => {
  // Six-step guided service editor: category → expertise → details → pricing → coverage → review.
  await page.getByRole('radio', { name: /^AC Repair/ }).first().click();
  await page.getByText('Next', { exact: true }).click();
  await page.getByText('Step 2 of 6').waitFor();
  await optional('specialisation', () => page.getByText('Select all', { exact: true }).first().click({ timeout: 3000 }));
  await page.getByText('Next', { exact: true }).click();
  await page.getByText('Step 3 of 6').waitFor();
  await page.getByText('Next', { exact: true }).click();
  await page.getByText('Step 4 of 6').waitFor();
  await page.getByLabel('Visit fee in rupees').first().fill('199');
  await page.getByLabel('Labour rate per job in rupees').first().fill('499');
  await page.getByText('Next', { exact: true }).click();
  await page.getByText('Step 5 of 6').waitFor();
  await page.getByText('Next', { exact: true }).click();
  await page.getByText('Step 6 of 6').waitFor();
  await page.getByText(/^Save (service|changes)$/).first().click();
  await page.getByText(/^Visit ₹199 · Labour ₹499\/job$/).first().waitFor();
  await page.getByText('Continue', { exact: true }).first().click();
  await visible('Where do you work?');
});
await step('new-pro-area', async () => {
  await page.getByText('Use my current location', { exact: true }).first().click();
  await page.getByText(/^Covers about /).first().waitFor();
  const city = page.getByLabel('City').first();
  if (!(await city.inputValue())) await city.fill('Vijayawada');
  await page.getByText('8 km', { exact: true }).first().click();
  await page.getByText('Save & continue', { exact: true }).first().click();
  await visible('When can you work?');
});
await step('new-pro-hours', async () => {
  await page.getByText('Mon–Sat, 9 am–7 pm', { exact: true }).first().click();
  await page.getByText('9 am–7 pm', { exact: true }).first().waitFor();
  await page.getByText('Save & continue', { exact: true }).first().click();
  await visible('Your work, links & credentials');
});
await step('new-pro-portfolio', async () => {
  await chooseImage(async () => {
    await page.getByText('Add work photo', { exact: true }).first().click();
    await page.getByText('Choose from gallery', { exact: true }).first().click();
  });
  await page.getByText('Work photos (1/12)', { exact: true }).first().waitFor();
  await page.getByText('Continue', { exact: true }).first().click();
  await visible('Payouts & verification');
});
await step('new-pro-payouts', async () => {
  // Razorpay Route / RazorpayX are not enabled on the test account yet: the function must answer with the
  // "temporarily unavailable" state instead of failing, and onboarding continues.
  await page.getByLabel('Name as on PAN / bank account', { exact: true }).first().fill('KIRAN TEST PRO');
  await page.getByLabel('PAN', { exact: true }).first().fill('ABCPK1234F');
  await page.getByLabel('Email', { exact: true }).first().fill('kiran.e2e@example.com');
  await page.getByLabel('Bank account number', { exact: true }).first().fill('123456789012');
  await page.getByLabel('Re-enter account number', { exact: true }).first().fill('123456789012');
  await page.getByLabel('IFSC', { exact: true }).first().fill('HDFC0000001');
  await page.getByText('Verify & save', { exact: true }).first().click();
  await page.getByText(/temporarily unavailable|Verifying|Verified/).first().waitFor({ timeout: 45000 });
  await page.getByText('Continue', { exact: true }).first().click();
  await visible('Review & submit');
});
await step('new-pro-submit', async () => {
  await page.getByRole('checkbox').first().click();
  await page.getByText('Submit profile', { exact: true }).first().click();
  await page.waitForURL((u) => new URL(u).pathname === '/dashboard');
});
await step('new-pro-dashboard-status', async () => {
  await go('/dashboard');
  await page.getByText(/^(Under review|Action needed|You are live)$/).first().waitFor();
});
await step('new-pro-hub', async () => {
  await go('/provider-profile');
  await visible('Profile strength');
});

// ---------- Admin: feature switches are rendered from registry metadata ----------
await step('admin-feature-registry', async () => {
  await go('/pro-account');
  await page.getByText('Log out', { exact: true }).first().click();
  await visible('Log out?');
  await page.getByText('Log out', { exact: true }).last().click();
  await page.getByLabel('Mobile number, India plus 91').waitFor();
  await page.getByLabel('Mobile number, India plus 91').fill('8888888888');
  await page.getByText('Send OTP', { exact: true }).click();
  await visible('Verify your number');
  await page.getByLabel('6-digit verification code').fill(OTP);
  await visible('Welcome to QuickServe');
  await optional('admin display name', () => page.getByLabel('Your name').fill('QuickServe Admin', { timeout: 3000 }));
  await page.getByText('Continue', { exact: true }).click();
  await page.waitForURL((u) => !/\/(login|verify|role)$/.test(new URL(u).pathname));
  await go('/account');
  await page.getByText('Admin portal', { exact: true }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/admin');
  await page.getByLabel('Go back').last().click();
  await page.waitForURL((u) => new URL(u).pathname === '/account');
  await page.getByRole('button', { name: /Admin portal/ }).last().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Admin portal/ }).last().click();
  await page.waitForURL((u) => new URL(u).pathname === '/admin');

  await step('phase-7a-admin-approves-submitted-shop', async () => {
    if (!qaApprovalShopId) {
      console.log(`  SKIPPED: ${qaApprovalSkipReason ?? 'owner submission did not create a safe QA shop'}`);
      return;
    }
    await go('/admin/shops');
    await page.locator('text="Shop management" >> visible=true').last().waitFor();
    await page.getByText(qaApprovalShopName, { exact: true }).waitFor();
    const shopCard = page.getByText(qaApprovalShopName, { exact: true })
      .locator('xpath=ancestor::*[.//*[@role="button"]][1]');
    await shopCard.getByRole('button', { name: 'Verify', exact: true }).click();
    await page.locator('text="verified" >> visible=true').first().click();
    await page.getByText(qaApprovalShopName, { exact: true }).waitFor();
    await go('/admin');
  });

  const rows = [
    { key: 'ai_assistant', enabled: true, label: 'AI assistant', description: 'AI tools.', group_name: 'AI', sort_order: 10, updated_at: new Date().toISOString() },
    { key: 'urgent_requests', enabled: true, label: 'Urgent creator requests', description: 'Urgent requests.', group_name: 'Bookings', sort_order: 20, updated_at: new Date().toISOString() },
    { key: 'fixed_asap', enabled: true, label: 'ASAP for fixed-price services', description: 'ASAP bookings.', group_name: 'Bookings', sort_order: 30, updated_at: new Date().toISOString() },
    { key: 'e2e_registry_probe', enabled: false, label: 'E2E registry probe', description: 'Proves admin switches are data-driven.', group_name: 'E2E', sort_order: 999, updated_at: new Date().toISOString() },
  ];
  let probeEnabled = false;
  await page.route('**/rest/v1/rpc/admin_list_features', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }),
  );
  await page.route('**/rest/v1/rpc/admin_set_feature', async (route) => {
    const body = route.request().postDataJSON();
    if (body.p_key === 'e2e_registry_probe') probeEnabled = body.p_enabled;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ai_assistant: true,
        urgent_requests: true,
        fixed_asap: true,
        e2e_registry_probe: probeEnabled,
        archetypes: { inspect_quote: true, fixed: true, time_based: true, proposal: true },
      }),
    });
  });
  await page.getByText('Features', { exact: true }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/admin/features');
  await visible('E2E registry probe');
  const switches = page.getByRole('switch');
  if (await switches.count() !== 8) throw new Error(`expected 4 registry + 4 archetype switches, got ${await switches.count()}`);
  await switches.nth(3).click();
  if (!probeEnabled) throw new Error('admin UI did not send the dynamic registry key to admin_set_feature');
});

await browser.close();

writeFileSync(`${SHOTS}/report.json`, JSON.stringify({ failures, pageErrors, consoleErrors }, null, 2));
console.log(`\nScreens: ${shot}, failed steps: ${failures.length}, page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}`);
for (const f of failures) console.log(`FAIL ${f}`);
for (const e of pageErrors) console.log(`PAGEERROR ${e}`);
for (const e of consoleErrors) console.log(`CONSOLE ${e}`);
process.exit(failures.length || pageErrors.length ? 1 : 0);
