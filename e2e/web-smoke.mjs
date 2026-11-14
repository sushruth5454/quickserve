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
const categories = await rest('categories?select=slug,name&order=sort_order').catch(() => []);
for (const c of categories) {
  await step(`category-${c.slug}`, async () => {
    await go(`/category/${c.slug}?name=${encodeURIComponent(c.name)}`);
    await page.getByText(/verified pros? near/).first().waitFor();
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
  await page.getByText('Show results', { exact: true }).click();
  await page.getByText(/verified pros? near|No pros match/).first().waitFor();
});
await step('provider-detail', async () => {
  await go(`/provider/${RAVI}`);
  await visible('Ratings & reviews');
});
const raviServices = await rest(`provider_services?select=id&provider_id=eq.${RAVI}&active=eq.true&limit=1`).catch(() => []);
await step('book-screen', async () => {
  if (!raviServices[0]) throw new Error('no active service for Ravi');
  await go(`/book/${raviServices[0].id}`);
  await page.getByText(/& book$/).first().waitFor();
});
await step('bookings-active', async () => {
  await go('/bookings');
  await visible('My bookings');
});
await step('bookings-past', async () => {
  await page.getByText('Past', { exact: true }).first().click();
  await page.waitForTimeout(500);
});
for (const [n, label] of [
  [6, 'quote'],
  [9, 'end-otp'],
  [10, 'review-form'],
  [16, 'disputed'],
]) {
  await step(`booking-fc${n}-${label}`, async () => {
    await go(`/booking/${seeded('fc', n)}`);
    await page.getByText(/^Booking #/).first().waitFor();
  });
}
await step('booking-chat-send', async () => {
  await go(`/booking/${seeded('fc', 9)}`);
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

// ---------- Provider ----------
await step('switch-to-provider', async () => {
  await page.getByText('Switch to provider mode', { exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
  await page.getByText(/New requests|Active jobs|Waiting for requests|You're offline/).first().waitFor();
});
await step('earnings', async () => {
  await go('/earnings');
  await visible('Earnings');
});
await step('provider-booking-fb4', async () => {
  await go(`/booking/${seeded('fb', 4)}`);
  await page.getByText(/^Booking #/).first().waitFor();
});
await step('quote-editor-fb4', async () => {
  await go(`/quote/${seeded('fb', 4)}?changeOrder=0`);
  await page.getByText('Send to customer', { exact: true }).first().waitFor();
});
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
