// Web smoke test: logs in with the Supabase test OTP and visits every screen against the live dev project.
// Run by .github/workflows/e2e-web.yml. Env: BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SHOTS_DIR.
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:8081';
const SHOTS = process.env.SHOTS_DIR ?? 'e2e-shots';
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const PHONE = '9999999999';
const OTP = '123456';
const RAVI = '11111111-1111-1111-1111-111111111111';
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
await step('location-picker', async () => {
  await go('/');
  await page.getByLabel(/^Service location:/).first().click();
  await page.waitForURL(/\/location$/);
  await visible('Select location');
  await visible('Popular areas in Vijayawada');
  await page.getByText(/^Flat 302, Sri Sai Residency/).first().waitFor();
});
await step('location-search-fallback', async () => {
  await page.getByLabel('Search for an area or address').first().fill('Pata');
  await visible('Patamata');
});
await step('location-pick-area', async () => {
  await page.getByText('Patamata', { exact: true }).first().click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
  await page.getByText(/^Patamata, Vijayawada$/).first().waitFor();
});
await step('location-search-providers', async () => {
  await go('/category/ac-repair?name=AC%20Repair');
  await page.getByText(/verified pros? near Patamata/).first().waitFor();
});
await step('location-add-address-sheet', async () => {
  await go('/location');
  await page.getByText('Add new address', { exact: true }).first().click();
  await visible('House / flat no., street, landmark');
});
await step('location-pick-saved-home', async () => {
  await go('/location');
  await page.getByText(/^Flat 302, Sri Sai Residency/).first().click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
  await page.getByText(/^Benz Circle, Vijayawada$/).first().waitFor();
});
const categories = await rest('categories?select=slug,name&order=sort_order').catch(() => []);
for (const c of categories) {
  await step(`category-${c.slug}`, async () => {
    await go(`/category/${c.slug}?name=${encodeURIComponent(c.name)}`);
    await page.getByText(/verified pros? near|pros nearby yet|No pros match/).first().waitFor();
  });
}
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
  await box.fill('QA-E2E web chat');
  await page.getByLabel('Send message').first().click();
  await page.getByText('QA-E2E web chat').first().waitFor();
});
await step('me-customer', async () => {
  await go('/account');
  await visible('Switch to provider mode');
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
  ['dark-location-picker', '/location', 'Popular areas in Vijayawada'],
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
  await page.getByText(/^\d+% commission$/).first().waitFor();
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
await step('onboarding', async () => {
  await go('/onboarding');
  await visible('Provider profile');
});
await step('me-provider', async () => {
  await go('/pro-account');
  await visible('Switch to customer mode');
  await visible('My services');
  await page.getByLabel(/^Edit (AC Repair|Electrician)$/).first().waitFor();
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

await browser.close();

writeFileSync(`${SHOTS}/report.json`, JSON.stringify({ failures, pageErrors, consoleErrors }, null, 2));
console.log(`\nScreens: ${shot}, failed steps: ${failures.length}, page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}`);
for (const f of failures) console.log(`FAIL ${f}`);
for (const e of pageErrors) console.log(`PAGEERROR ${e}`);
for (const e of consoleErrors) console.log(`CONSOLE ${e}`);
process.exit(failures.length || pageErrors.length ? 1 : 0);
