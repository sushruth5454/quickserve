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
  const sent = await fetch(`${SUPABASE_URL}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ phone }) });
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
  await box.fill('QA-E2E web chat');
  await page.getByLabel('Send message').first().click();
  await page.getByText('QA-E2E web chat').first().waitFor();
});
// ---------- Unread: the pro (Ravi, booking fc6) messages the signed-in customer through the API ----------
const FC6 = seeded('fc', 6);
const unreadBody = `QA-E2E unread ${Date.now()}`;
await step('unread-badge-on-booking', async () => {
  const token = await signInAs('+919000000101');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ booking_id: FC6, sender_id: RAVI, body: unreadBody }),
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
  ['portfolio', 'Your work & credentials'],
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
  await page.getByText('AC Repair', { exact: true }).first().click();
  await optional('specialisation', () => page.getByText('Split AC', { exact: true }).first().click({ timeout: 3000 }));
  await page.getByLabel('Visit fee').first().fill('199');
  await page.getByLabel('Labour / job').first().fill('499');
  await page.getByText('Local prices in', { exact: false }).first().waitFor();
  await page.getByText('Save service', { exact: true }).first().click();
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
  await visible('Your work & credentials');
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
  await page.getByLabel(/^Provider status: /).first().waitFor();
});
await step('new-pro-dashboard-status', async () => {
  await go('/dashboard');
  await page.getByText(/^(Under review|Action needed|You are live)$/).first().waitFor();
});
await step('new-pro-hub', async () => {
  await go('/provider-profile');
  await visible('Profile strength');
});

await browser.close();

writeFileSync(`${SHOTS}/report.json`, JSON.stringify({ failures, pageErrors, consoleErrors }, null, 2));
console.log(`\nScreens: ${shot}, failed steps: ${failures.length}, page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}`);
for (const f of failures) console.log(`FAIL ${f}`);
for (const e of pageErrors) console.log(`PAGEERROR ${e}`);
for (const e of consoleErrors) console.log(`CONSOLE ${e}`);
process.exit(failures.length || pageErrors.length ? 1 : 0);
