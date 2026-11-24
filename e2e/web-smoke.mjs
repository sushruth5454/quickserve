// Web smoke test: logs in with the Supabase test OTP and visits every screen against the configured E2E project.
// Run by .github/workflows/e2e-web.yml and e2e-local.yml. Env: BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SHOTS_DIR,
// E2E_CUSTOMER_PHONE, NEW_PRO_PHONE, GUEST_E2E_PHONE (required when E2E_FLAGS=on).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromium, devices } from 'playwright';
import { DEMO_IDS, runAllServiceScenarios } from './all-services.mjs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8081';
const SHOTS = process.env.SHOTS_DIR ?? 'e2e-shots';
const SUPABASE_URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const QA_MARKER = process.env.QA_MARKER ?? `QA-E2E manual-${Date.now()}`;
const E2E_FLAGS_ON = process.env.E2E_FLAGS === 'on';
const CITY = (process.env.EXPO_PUBLIC_DEMO_CITY ?? '').trim() || 'Vijayawada';
const TOP_RATED_HOME_TITLE = E2E_FLAGS_ON ? `Top rated in ${CITY}` : 'Top rated near you';
const TOP_RATED_DETAIL_TITLE = `Top rated in ${CITY}`;
const TOP_RATED_RANKING_SUMMARY = /^\d+ verified pros? \u00b7 ranked by average rating, then review count$/;
const PRIVATE_LOCAL_E2E = process.env.PROJECT_REF === 'local'
  && process.env.SUPABASE_MGMT_URL === 'http://127.0.0.1:54399';
const PHONE = process.env.E2E_CUSTOMER_PHONE ?? '9999999999';
const OTP = '123456';
const ADMIN_E2E_PHONE = process.env.ADMIN_E2E_PHONE;
const RAVI = '11111111-1111-1111-1111-111111111111';
const RAVI_E2E_PHONE = '+919000000101';
// Fresh-provider onboarding user: test OTP number reset by e2e-web.yml before each run (no seed data).
const NEW_PRO_PHONE = process.env.NEW_PRO_PHONE ?? '9000000301';
// Pass B requires a separate, workflow-reset SMS test account that has no completed customer role.
const GUEST_E2E_PHONE = process.env.GUEST_E2E_PHONE?.trim() ?? '';
const OTP_COOLDOWN_MS = 60_000; // Matches the verify screen's resend timer.
const seeded = (prefix, n) => `${prefix}${String(n).padStart(6, '0')}-5eed-5eed-8000-000000000000`;

mkdirSync(SHOTS, { recursive: true });
const pageErrors = [];
const consoleErrors = [];
const httpFailures = [];
const appFeatureResponses = [];
let qaProductEnquiryId = null;
let localE2eCustomerToken = null;
const failures = [];
const softFailures = [];
const skippedSteps = [];
const blockedSteps = [];
let shot = 0;
let bookAgainAppFlag = null;
let guestBookBoundaryPassed = false;
let guestVenuePath = null;
let guestVenueName = null;
const otpCooldownPath = `${SHOTS}/otp-cooldowns.json`;
let otpCooldowns = {};
if (existsSync(otpCooldownPath)) {
  try {
    otpCooldowns = JSON.parse(readFileSync(otpCooldownPath, 'utf8'));
    if (!otpCooldowns || typeof otpCooldowns !== 'object' || Array.isArray(otpCooldowns)) throw new Error('expected an object');
  } catch (error) {
    throw new Error(`OTP cooldown state is invalid: ${String(error?.message ?? error)}`);
  }
}

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
page.on('response', (response) => {
  if (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_app_features')
  ) {
    appFeatureResponses.push(response);
  }
});
page.on('request', (request) => {
  if (
    request.method() !== 'POST'
    || !new URL(request.url()).pathname.endsWith('/rest/v1/rpc/get_product_enquiry')
  ) return;
  const args = request.postDataJSON();
  if (typeof args?.p_enquiry_id === 'string') qaProductEnquiryId = args.p_enquiry_id;
});
function recordHttpFailures(pageName, target) {
  target.on('response', (response) => {
    if (response.status() !== 403) return;
    const url = new URL(response.url());
    const path = url.pathname.replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, '[UUID]');
    httpFailures.push({
      page: pageName,
      route: new URL(target.url()).pathname,
      status: response.status(),
      method: response.request().method(),
      host: url.host,
      path,
    });
  });
}
recordHttpFailures('app', page);
const guestContext = await browser.newContext({
  ...devices['iPhone 15'],
  geolocation: { latitude: 16.4995, longitude: 80.656 },
  permissions: ['geolocation'],
  timezoneId: 'Asia/Kolkata',
});
const guestPage = await guestContext.newPage();
guestPage.setDefaultTimeout(20000);
guestPage.on('pageerror', (e) => pageErrors.push(`[guest ${guestPage.url()}] ${e.message}`));
guestPage.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`[guest ${guestPage.url()}] ${m.text()}`);
});
recordHttpFailures('guest', guestPage);

const guestPrivateDataRequests = [];
const guestSportsCommitRequests = [];
guestPage.on('request', (request) => {
  const url = new URL(request.url());
  if (
    /\/rest\/v1\/rpc\/(?:get_my_|list_my_)[^/]*$/.test(url.pathname)
    || url.pathname === '/rest/v1/profiles'
  ) {
    guestPrivateDataRequests.push({ method: request.method(), url: request.url() });
  }
  if (url.pathname.endsWith('/rest/v1/rpc/book_sports_slot')) {
    guestSportsCommitRequests.push({ method: request.method(), url: request.url() });
  }
});

async function snap(name, target = page) {
  shot += 1;
  await target.waitForTimeout(800);
  await target.screenshot({ path: `${SHOTS}/${String(shot).padStart(2, '0')}-${name}.png` });
}

async function step(name, fn, target = page) {
  console.log(`> ${name}`);
  try {
    await fn();
    await snap(name, target);
  } catch (e) {
    const actual = {
      url: target.url(),
      body: await target.locator('body').innerText().catch(() => '<body unavailable>'),
    };
    const msg = `${String(e?.message ?? e).split('\n')[0]} | actual=${JSON.stringify({
      url: actual.url,
      body: redactPhoneNumbers(actual.body).slice(0, 2400),
    })}`;
    failures.push(`${name}: ${msg}`);
    console.log(`  FAILED: ${msg}`);
    await snap(`${name}-FAILED`, target).catch(() => undefined);
  }
}

function redactPhoneNumbers(value) {
  return value.replace(/(?<!\d)(?:\+?\d[\d\s()-]{6,}\d)(?!\d)/g, '[REDACTED-PHONE]');
}

const visible = (text) => page.getByText(text, { exact: true }).first().waitFor({ state: 'visible' });
const goOn = async (target, path) => {
  await target.goto(BASE + path);
  await target.waitForLoadState('networkidle').catch(() => undefined);
};
const go = (path) => goOn(page, path);
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

// Call self-service RPCs with the signed-in browser session; never use service-role credentials or table writes.
async function currentUserRpc(name, args = {}) {
  const result = await page.evaluate(async ({ url, anonKey, functionName, params }) => {
    let accessToken = null;
    for (const key of Object.keys(localStorage)) {
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null');
        const sessions = [value, value?.currentSession, value?.session, value?.data?.session];
        const session = sessions.find((candidate) => typeof candidate?.access_token === 'string');
        if (session) {
          accessToken = session.access_token;
          break;
        }
      } catch {
        continue;
      }
    }
    if (!accessToken) return { ok: false, status: 0, error: 'Signed-in session token is missing from browser storage.' };
    const response = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const body = await response.text();
    let data = null;
    try {
      data = body ? JSON.parse(body) : null;
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, resultExists: data !== null, error: response.ok ? '' : body };
  }, { url: SUPABASE_URL, anonKey: ANON, functionName: name, params: args });
  if (!result.ok) throw new Error(`${name} RPC failed (${result.status}): ${result.error}`);
  return result.resultExists;
}

function phoneKey(phone) {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
}

function phoneE164(phone) {
  const digits = phoneKey(phone);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Error(`Invalid E2E test phone configuration: ${JSON.stringify({ validIndianMobile: false })}`);
  return `+91${digits}`;
}

function phoneRoleCollisions(roles) {
  const firstRoleByPhone = new Map();
  const collisions = [];
  for (const [role, phone] of roles) {
    const key = phoneKey(phone);
    if (!key) continue;
    if (firstRoleByPhone.has(key)) collisions.push([firstRoleByPhone.get(key), role]);
    else firstRoleByPhone.set(key, role);
  }
  return collisions;
}

function getGuestE2ePhone() {
  const digits = GUEST_E2E_PHONE.replace(/\D/g, '');
  const normalized = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  const phoneRoles = [
    ['E2E_CUSTOMER_PHONE', PHONE],
    ['NEW_PRO_PHONE', NEW_PRO_PHONE],
    ['RAVI_SIGN_IN', RAVI_E2E_PHONE],
    ['GUEST_E2E_PHONE', GUEST_E2E_PHONE],
  ];
  if (ADMIN_E2E_PHONE?.trim()) phoneRoles.push(['ADMIN_E2E_PHONE', ADMIN_E2E_PHONE.trim()]);
  const phoneCollisions = phoneRoleCollisions(phoneRoles);
  if (!/^[6-9]\d{9}$/.test(normalized) || phoneCollisions.length) {
    throw new Error(`OTP test phones must be distinct; GUEST_E2E_PHONE must also be SMS-test-enabled: ${JSON.stringify({
      configured: !!GUEST_E2E_PHONE,
      validIndianMobile: /^[6-9]\d{9}$/.test(normalized),
      phoneRoleCollisions: phoneCollisions,
    })}`);
  }
  return GUEST_E2E_PHONE;
}

async function waitForOtpCooldown(target, flowName) {
  const savedTimestamp = otpCooldowns[flowName];
  const lastSentAt = Number(savedTimestamp ?? 0);
  if (!Number.isFinite(lastSentAt) || lastSentAt < 0) {
    throw new Error(`OTP cooldown timestamp is invalid for ${flowName}: ${JSON.stringify(savedTimestamp)}`);
  }
  const remaining = OTP_COOLDOWN_MS - (Date.now() - lastSentAt);
  if (remaining > 0) {
    console.log(`  Waiting ${Math.ceil(remaining / 1000)}s for the prior OTP cooldown to expire.`);
    await target.waitForTimeout(remaining);
  }
}

function recordOtpSent(flowName) {
  otpCooldowns[flowName] = Date.now();
  writeFileSync(otpCooldownPath, JSON.stringify(otpCooldowns, null, 2));
}

async function sendOtpFromUi(target, phone, flowName) {
  await waitForOtpCooldown(target, flowName);
  const responsePromise = target.waitForResponse((response) =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/auth/v1/otp',
  );
  await target.getByLabel('Mobile number, India plus 91').fill(phone);
  await target.getByText('Send OTP', { exact: true }).click();
  const response = await responsePromise;
  const responseBody = redactPhoneNumbers(await response.text());
  if (response.status() === 429) {
    throw new Error(`${flowName} OTP request was rate-limited (HTTP 429): ${responseBody.slice(0, 400)}`);
  }
  if (!response.ok()) {
    throw new Error(`${flowName} OTP send failed (HTTP ${response.status()}): ${responseBody.slice(0, 400)}`);
  }
  recordOtpSent(flowName);
  await target.getByText('Verify your number', { exact: true }).waitFor({ state: 'visible' });
}

/** Signs a second test user in through the Auth API (fixed test OTP) and returns their access token. */
async function signInAs(phone) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  await waitForOtpCooldown(page, 'signInAs');
  const sent = await fetch(`${SUPABASE_URL}/auth/v1/otp`, { method: 'POST', headers, body: JSON.stringify({ phone }) });
  const sentBody = redactPhoneNumbers(await sent.text());
  if (sent.status === 429) throw new Error(`OTP request for signInAs was rate-limited (HTTP 429): ${sentBody.slice(0, 400)}`);
  if (!sent.ok) throw new Error(`OTP request for signInAs failed (HTTP ${sent.status}): ${sentBody.slice(0, 400)}`);
  recordOtpSent('signInAs');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, { method: 'POST', headers, body: JSON.stringify({ phone, token: OTP, type: 'sms' }) });
  const verifyResponseText = await res.text();
  const verifyBody = redactPhoneNumbers(verifyResponseText);
  if (!res.ok) throw new Error(`verify ${res.status}: ${verifyBody.slice(0, 400)}`);
  return JSON.parse(verifyResponseText).access_token;
}

function getAdminPhone() {
  const raw = ADMIN_E2E_PHONE?.trim();
  if (!raw || !/^(?:\+91)?[6-9]\d{9}$/.test(raw)) {
    throw new Error('ADMIN_E2E_PHONE must be a 10-digit Indian number or +91 E.164 number');
  }
  return raw.startsWith('+91') ? raw : `+91${raw}`;
}

async function grantE2eAdminMembership(phone) {
  if (process.env.DEMO_PROJECT !== '1') {
    throw new Error('Admin E2E membership may only be provisioned when DEMO_PROJECT=1');
  }
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.PROJECT_REF;
  if (!token || !projectRef) {
    throw new Error('Admin E2E requires the demo project reference and Management API token');
  }

  const query = `insert into public.admins (user_id)
    select id from auth.users where phone = '${phone}'
    on conflict (user_id) do nothing`;
  const response = await fetch(
    `${process.env.SUPABASE_MGMT_URL ?? 'https://api.supabase.com'}/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Admin E2E provisioning failed (${response.status}): ${responseText.slice(0, 200)}`);
  }
  if (responseText.trim()) {
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('Admin E2E provisioning returned an invalid Management API response');
    }
    if (result?.error) throw new Error('Management API returned a database error');
  }
}

function skipStep(name, reason) {
  const message = `${name}: ${reason}`;
  skippedSteps.push(message);
  console.log(`  SKIPPED: ${reason}`);
}

function blockStep(name, reason) {
  const message = `${name}: ${reason}`;
  skippedSteps.push(message);
  blockedSteps.push(message);
  console.warn(`  SKIPPED: BLOCKED: ${reason}`);
  console.warn(`::warning::BLOCKED ${message}`);
}

// ---------- Auth (per-phone OTP cooldown state is shared between the two E2E passes) ----------
await step('login-help-link', async () => {
  await go('/login');
  await page.getByRole('link', { name: 'Need help signing in?' }).click();
  await visible('Sign-in help');
  await visible('Changed your number?');
  await page.getByRole('button', { name: /^Email / }).waitFor({ state: 'visible' });
  await go('/login');
});
if (E2E_FLAGS_ON) {
  await step('guest-private-routes-no-personal-data', async () => {
    for (const path of ['/bookings', '/account']) {
      guestPrivateDataRequests.length = 0;
      await goOn(guestPage, path);
      const promptVisible = await guestPage.getByText('Sign in to continue', { exact: true }).first().isVisible().catch(() => false);
      if (!promptVisible || guestPrivateDataRequests.length) {
        throw new Error(`guest ${path} gate did not stay private: ${JSON.stringify({
          path,
          promptVisible,
          privateDataRequests: guestPrivateDataRequests,
          url: guestPage.url(),
          body: await guestPage.locator('body').innerText().catch(() => '<body unavailable>'),
        })}`);
      }
    }
  }, guestPage);

  await step('guest-sports-browse-book-login-boundary', async () => {
    await goOn(guestPage, '/');
    await guestPage.getByText(/Search services, shops, venues/).first().waitFor({ state: 'visible' });
    await guestPage.getByText('Sports & venues', { exact: true }).first().click();
    await guestPage.waitForURL((url) => new URL(url).pathname === '/sports');
    await guestPage.getByText('Badminton', { exact: true }).first().click();
    await guestPage.waitForURL((url) => new URL(url).pathname === '/sports/badminton');

    const initialSlotsResponsePromise = guestPage.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/rest/v1/rpc/get_sports_slots'),
    );
    const venueName = 'Benz Circle Demo Badminton Courts';
    await guestPage.getByText(venueName, { exact: true }).first().click();
    const venuePath = `/venue/${DEMO_IDS.sportsVenue}`;
    await guestPage.waitForURL((url) => new URL(url).pathname === venuePath);
    await guestPage.getByText('Choose an activity and slot', { exact: true }).first().waitFor();

    const initialResponse = await initialSlotsResponsePromise;
    if (!initialResponse.ok()) {
      throw new Error(`guest get_sports_slots failed (${initialResponse.status()}): ${await initialResponse.text()}`);
    }
    let candidateDate = initialResponse.request().postDataJSON().p_date;
    let slots = await initialResponse.json();
    let selectedSlot = null;
    const checkedDates = [];
    for (let offset = 0; offset < 7; offset++) {
      if (offset > 0) {
        const nextDate = new Date(`${candidateDate}T00:00:00.000Z`);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        candidateDate = nextDate.toISOString().slice(0, 10);
        const responsePromise = guestPage.waitForResponse((response) =>
          response.request().method() === 'POST'
          && response.url().includes('/rest/v1/rpc/get_sports_slots')
          && response.request().postDataJSON().p_date === candidateDate,
        );
        const dateLabel = new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        }).format(new Date(`${candidateDate}T12:00:00+05:30`));
        await guestPage.getByRole('button', { name: dateLabel, exact: true }).click();
        const response = await responsePromise;
        if (!response.ok()) {
          throw new Error(`guest get_sports_slots failed for ${candidateDate} (${response.status()}): ${await response.text()}`);
        }
        slots = await response.json();
      }
      if (!Array.isArray(slots)) {
        throw new Error(`guest get_sports_slots returned unexpected data: ${JSON.stringify({ candidateDate, slots })}`);
      }
      const freeSlots = slots.filter((slot) => slot.state === 'free' && (slot.remaining == null || slot.remaining >= 1));
      checkedDates.push({ date: candidateDate, free: freeSlots.length });
      if (!freeSlots.length) continue;

      const startsAt = freeSlots[0].starts_at;
      const timeLabel = new Date(startsAt).toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: '2-digit',
      });
      await guestPage.getByRole('radio', { name: timeLabel, exact: true }).click();
      selectedSlot = { date: candidateDate, startsAt, timeLabel };
      break;
    }
    if (!selectedSlot) {
      throw new Error(`guest could not select a free sports slot: ${JSON.stringify({
        checkedDates,
        url: guestPage.url(),
        body: await guestPage.locator('body').innerText(),
      })}`);
    }

    const commitButton = guestPage.getByRole('button', { name: /^(Book|Send request)$/ }).last();
    await commitButton.waitFor({ state: 'visible' });
    if (!await commitButton.isEnabled()) {
      throw new Error(`guest sports commit action stayed disabled: ${JSON.stringify({
        selectedSlot,
        label: await commitButton.getAttribute('aria-label'),
        body: await guestPage.locator('body').innerText(),
      })}`);
    }
    await commitButton.click();
    await guestPage.waitForURL((url) => new URL(url).pathname === '/login', { timeout: 5000 }).catch(() => undefined);
    const loginUrl = new URL(guestPage.url());
    const returnTo = loginUrl.searchParams.get('returnTo');
    if (loginUrl.pathname !== '/login' || returnTo !== venuePath || guestSportsCommitRequests.length) {
      throw new Error(`guest Book action did not gate at login and preserve the venue: ${JSON.stringify({
        selectedSlot,
        expectedReturnTo: venuePath,
        actualReturnTo: returnTo,
        url: guestPage.url(),
        sportsCommitRequests: guestSportsCommitRequests,
        body: await guestPage.locator('body').innerText(),
      })}`);
    }
    guestVenueName = venueName;
    guestVenuePath = venuePath;
    guestBookBoundaryPassed = true;
  }, guestPage);

  if (!GUEST_E2E_PHONE) {
    const boundaryNote = guestBookBoundaryPassed
      ? ''
      : 'The guest Book-to-login boundary also failed. ';
    blockStep(
      'guest-otp-customer-role-return',
      `${boundaryNote}Owner action: add a dedicated fresh test-only phone to Supabase sms_test_otp and provide it as GUEST_E2E_PHONE.`,
    );
  } else if (!guestBookBoundaryPassed) {
    blockStep(
      'guest-otp-customer-role-return',
      'The guest Book-to-login boundary did not pass; the customer OTP/role/return substep is blocked until that boundary passes.',
    );
  } else {
    await step('guest-otp-customer-role-return', async () => {
      const guestPhone = getGuestE2ePhone();
      await sendOtpFromUi(guestPage, guestPhone, 'G-01 guest');
      await guestPage.getByLabel('6-digit verification code').fill(OTP);
      await guestPage.waitForURL((url) => new URL(url).pathname === '/role');
      await guestPage.getByText('Welcome to QuickServe', { exact: true }).waitFor({ state: 'visible' });
      await guestPage.getByRole('radio', { name: /^I need a service\./ }).click();
      const venueResponsePromise = guestPage.waitForResponse((response) => {
        if (
          response.request().method() !== 'POST'
          || !new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_sports_venue')
        ) return false;
        return response.request().postDataJSON()?.p_id === DEMO_IDS.sportsVenue;
      }, { timeout: 20000 });
      await guestPage.getByText('Continue', { exact: true }).last().click();
      await guestPage.waitForURL((url) => new URL(url).pathname === guestVenuePath);
      let venueResponse;
      try {
        venueResponse = await venueResponsePromise;
      } catch (error) {
        throw new Error(`return-to-venue get_sports_venue response was not observed: ${JSON.stringify({
          expectedPath: guestVenuePath,
          expectedVenueId: DEMO_IDS.sportsVenue,
          failure: error instanceof Error ? error.message : String(error),
          url: guestPage.url(),
          body: await guestPage.locator('body').innerText(),
        })}`);
      }
      const venueResponseBody = redactPhoneNumbers(await venueResponse.text());
      if (!venueResponse.ok()) {
        throw new Error(`return-to-venue get_sports_venue failed (HTTP ${venueResponse.status()}): ${venueResponseBody.slice(0, 400)}`);
      }
      let returnedVenue;
      try {
        returnedVenue = JSON.parse(venueResponseBody);
      } catch {
        returnedVenue = null;
      }
      if (!returnedVenue || returnedVenue.name !== guestVenueName) {
        throw new Error(`return-to-venue get_sports_venue returned no matching venue: ${JSON.stringify({
          expectedName: guestVenueName,
          actualName: returnedVenue?.name ?? null,
          status: venueResponse.status(),
        })}`);
      }
      await guestPage.locator(`text="${guestVenueName}" >> visible=true`).first().waitFor({ state: 'visible' });
    }, guestPage);
  }
} else {
  await step('guest-browse-off-gate', async () => {
    await goOn(guestPage, '/');
    await guestPage.getByLabel('Mobile number, India plus 91').waitFor({ state: 'visible' });
    const actualPath = new URL(guestPage.url()).pathname;
    if (actualPath !== '/login') {
      throw new Error(`guest_browse OFF should redirect the guest home to /login: ${JSON.stringify({
        expectedPath: '/login',
        actualPath,
        url: guestPage.url(),
        body: await guestPage.locator('body').innerText(),
      })}`);
    }
  }, guestPage);
}
await step('login', async () => {
  await go('/login');
  const phoneCollisions = phoneRoleCollisions([
    ['E2E_CUSTOMER_PHONE', PHONE],
    ['NEW_PRO_PHONE', NEW_PRO_PHONE],
    ['RAVI_SIGN_IN', RAVI_E2E_PHONE],
  ]);
  if (phoneCollisions.length) {
    throw new Error(`OTP test roles must use separate phones: ${JSON.stringify({ phoneRoleCollisions: phoneCollisions })}`);
  }
  await sendOtpFromUi(page, PHONE, 'existing customer');
});
await step('verify', async () => {
  await page.getByLabel('6-digit verification code').fill(OTP);
  await page.waitForURL((u) => new URL(u).pathname === '/dashboard');
  await page.getByText(/^You're (online|offline)$/).first().waitFor();
});
await step('returning-provider-switch-to-customer', async () => {
  await go('/pro-account');
  await page.getByText('Switch to customer mode', { exact: true }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
  await visible('Bookings');
});

await runAllServiceScenarios({ page, go, step, visible, qaMarker: QA_MARKER });
const sportsScenarioBookingMatch = new URL(page.url()).pathname.match(/^\/sports-booking\/([0-9a-f-]{36})$/i);
const sportsScenarioBookingId = sportsScenarioBookingMatch?.[1] ?? null;
if (!sportsScenarioBookingId) {
  throw new Error(`sports booking scenario did not finish on its detail route: ${JSON.stringify({ url: page.url() })}`);
}
if (PRIVATE_LOCAL_E2E) {
  localE2eCustomerToken = await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null');
        const sessions = [value, value?.currentSession, value?.session, value?.data?.session];
        const session = sessions.find((candidate) => typeof candidate?.access_token === 'string');
        if (session) return session.access_token;
      } catch {
        continue;
      }
    }
    return null;
  });
  if (!localE2eCustomerToken) {
    throw new Error(`MK-ADMIN authenticated customer token was not present after the customer journey: ${JSON.stringify({
      url: page.url(),
      storageKeys: await page.evaluate(() => Object.keys(localStorage)),
    })}`);
  }
}
if (PRIVATE_LOCAL_E2E) {
  await step('MK-READ-admin-and-enquiry-retry-customer', async () => {
    const enquiryId = qaProductEnquiryId;
    if (!enquiryId) {
      throw new Error(`MK-READ customer enquiry fixture was not observed: ${JSON.stringify({
        url: page.url(),
        body: await page.locator('body').innerText(),
      })}`);
    }

    let retryEnabled = false;
    let injectedFailures = 0;
    const routePattern = '**/rest/v1/rpc/get_product_enquiry';
    const matchesEnquiry = (response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_product_enquiry')
      && response.request().postDataJSON()?.p_enquiry_id === enquiryId;
    const routeHandler = async (route) => {
      if (route.request().postDataJSON()?.p_enquiry_id === enquiryId && !retryEnabled) {
        injectedFailures += 1;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'MK-READ injected enquiry read failure' }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(routePattern, routeHandler);
    try {
      const failurePromise = page.waitForResponse((response) =>
        matchesEnquiry(response) && response.status() === 503,
      );
      await go(`/enquiry/${enquiryId}`);
      const failure = await failurePromise;
      const failureBody = await page.locator('body').innerText();
      const retryButton = page.getByRole('button', { name: 'Try again', exact: true }).first();
      await retryButton.waitFor({ state: 'visible' });
      const unavailableVisible = await page.getByText('Enquiry unavailable', { exact: true }).isVisible().catch(() => false);
      if (!failureBody.includes('MK-READ injected enquiry read failure') || unavailableVisible) {
        throw new Error(`MK-READ failure was not represented as a retryable read error: ${JSON.stringify({
          enquiryId,
          status: failure.status(),
          injectedFailures,
          retryVisible: await retryButton.isVisible().catch(() => false),
          unavailableVisible,
          body: failureBody,
        })}`);
      }
      await snap('mk-read-enquiry-error');

      retryEnabled = true;
      const retryPromise = page.waitForResponse((response) =>
        matchesEnquiry(response) && response.ok(),
      );
      await retryButton.click();
      const recoveredResponse = await retryPromise;
      const recoveredRows = await recoveredResponse.json();
      const recoveredThread = Array.isArray(recoveredRows)
        ? recoveredRows.find((row) => row.id === enquiryId)
        : null;
      await page.getByText(QA_MARKER, { exact: false }).last().waitFor({ state: 'visible' });
      await page.getByText('Conversation status: open', { exact: true }).first().waitFor({ state: 'visible' });
      const retryButtonCount = await page.getByRole('button', { name: 'Try again', exact: true }).count();
      const actual = {
        enquiryId,
        initialStatus: failure.status(),
        injectedFailures,
        recoveredStatus: recoveredResponse.status(),
        recoveredThreadId: recoveredThread?.id ?? null,
        recoveredThreadStatus: recoveredThread?.status ?? null,
        retryButtonCount,
        qaMarkerVisible: await page.getByText(QA_MARKER, { exact: false }).last().isVisible().catch(() => false),
      };
      if (
        recoveredResponse.status() !== 200
        || recoveredThread?.id !== enquiryId
        || recoveredThread?.status !== 'open'
        || retryButtonCount !== 0
        || !actual.qaMarkerVisible
      ) {
        throw new Error(`MK-READ enquiry retry did not recover the same current thread: ${JSON.stringify(actual)}`);
      }
      console.log(`MK-READ-admin-and-enquiry-retry customer: ${JSON.stringify(actual)}`);
      await snap('mk-read-enquiry-recovered');
    } finally {
      await page.unroute(routePattern, routeHandler);
    }
  });
}

// ---------- Customer ----------
await step('home', async () => {
  await go('/');
  if (E2E_FLAGS_ON) {
    await page.getByText(/Search services, shops, venues/).first().waitFor({ state: 'visible' });
    for (const pillar of ['Home services', 'Shops & products', 'Sports & venues', 'Creators & freelancers']) {
      await visible(pillar);
    }
    await visible('Verified providers');
    await visible('See the price before you pay');
    await visible('Secure online payments');
    const legacyHomeVisible = await page.getByText('Choose a category', { exact: true }).first().isVisible().catch(() => false);
    if (legacyHomeVisible) {
      throw new Error(`home_v2 ON still rendered the legacy category header: ${JSON.stringify({
        legacyHomeVisible,
        url: page.url(),
        body: await page.locator('body').innerText(),
      })}`);
    }
  } else {
    await visible('Choose a category');
    await page.getByRole('button', { name: /^(Home & vehicle services|Home services)$/ }).first().waitFor({ state: 'visible' });
  }
});
if (PRIVATE_LOCAL_E2E && E2E_FLAGS_ON) {
  await step('MK-PILLAR-portrait-before-after', async () => {
    const originalViewport = page.viewportSize();
    if (!originalViewport) {
      throw new Error(`Expected a measurable browser viewport: ${JSON.stringify({ url: page.url() })}`);
    }

    const labels = ['Home services', 'Shops & products', 'Sports & venues', 'Creators & freelancers'];
    try {
      for (const width of [320, 393]) {
        await page.setViewportSize({ width, height: 844 });
        await go('/');
        const labelResults = await Promise.all(labels.map(async (label) => ({
          label,
          visible: await page.getByText(label, { exact: true }).first().isVisible().catch(() => false),
        })));
        const layout = await page.evaluate(() => ({
          viewportWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        const result = {
          width,
          labels: labelResults,
          layout,
          body: (await page.locator('body').innerText()).slice(0, 1200),
        };
        if (labelResults.some((item) => !item.visible) || layout.scrollWidth > layout.viewportWidth + 1) {
          throw new Error(`Pillar titles did not remain visible and within the portrait viewport: ${JSON.stringify(result)}`);
        }
        await snap(`mk-pillar-portrait-${width}`);
      }
    } finally {
      await page.setViewportSize(originalViewport);
    }
  });
}
await step('unified-search-flag', async () => {
  const searchTabVisible = await page.getByText('Search', { exact: true }).first().isVisible().catch(() => false);
  if (searchTabVisible !== E2E_FLAGS_ON) {
    throw new Error(`unified_search tab visibility did not match this pass: ${JSON.stringify({
      expectedVisible: E2E_FLAGS_ON,
      actualVisible: searchTabVisible,
      url: page.url(),
      body: await page.locator('body').innerText(),
    })}`);
  }
  await go('/search');
  if (E2E_FLAGS_ON) {
    const body = await page.locator('body').innerText();
    if (!body.includes('Type at least 2 letters')) {
      throw new Error(`unified_search route did not match this pass: ${JSON.stringify({
        expected: 'search input with minimum-length hint',
        actual: body,
        url: page.url(),
      })}`);
    }
  } else {
    const actualPath = new URL(page.url()).pathname;
    const legacyHome = await page.locator('body').innerText();
    const legacyHomeVisible = legacyHome.includes('Choose a category');
    if (actualPath !== '/' || !legacyHomeVisible) {
      throw new Error(`unified_search OFF did not safely fall back to the legacy home: ${JSON.stringify({
        expectedPath: '/',
        actualPath,
        expectedLegacyHomeVisible: true,
        legacyHomeVisible,
        body: legacyHome,
      })}`);
    }
  }
  await go('/');
});
await step('home-family-drilldown-and-marketplace-entry-points', async () => {
  if (E2E_FLAGS_ON) {
    await page.getByText('Home services', { exact: true }).first().click();
    await visible('Choose a service');
    await visible('AC Repair');
    await page.getByRole('button', { name: 'AC Repair, Request a quote' }).click();
    await page.waitForURL(/\/category\/ac-repair(?:\?|$)/);
    await go('/');
    await page.getByText('Sports & venues', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === '/sports');
    await go('/');
    await page.getByText('Shops & products', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === '/shop');
    await go('/');
    await page.getByText('Creators & freelancers', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === '/creators');
    await visible('How it works');
  } else {
    await page.getByRole('button', { name: /^(Home & vehicle services|Home services)$/ }).first().click();
    await visible('Choose a service');
    await visible('AC Repair');
    await page.getByRole('button', { name: 'AC Repair, Request a quote' }).click();
    await page.waitForURL(/\/category\/ac-repair(?:\?|$)/);
    await go('/');
    await page.getByRole('button', { name: 'Learning & sessions' }).click();
    await visible('Demo Home Tutor');
    await go('/');
    await page.getByRole('button', { name: 'Sports & venues' }).click();
    await page.waitForURL(/\/sports/);
    await go('/');
    await page.getByRole('button', { name: 'Shop local' }).click();
    await page.waitForURL(/\/shop/);
    await go('/');
    await go('/creators');
    const creatorsOff = await page.locator('body').innerText();
    if (!/Creators & freelancers is not available right now/i.test(creatorsOff)) {
      throw new Error(`creators_landing OFF did not render its disabled state: ${JSON.stringify({
        url: page.url(),
        body: creatorsOff,
      })}`);
    }
    await go('/');
  }
});
if (PRIVATE_LOCAL_E2E && E2E_FLAGS_ON) {
  await step('SP-T14-sports-selection-detail-before-after', async () => {
    if (
      process.env.DEMO_PROJECT !== '1'
      || process.env.PROJECT_REF !== 'local'
      || process.env.SUPABASE_MGMT_URL !== 'http://127.0.0.1:54399'
    ) {
      throw new Error('SP-T14 flag comparison is restricted to the disposable local E2E backend');
    }
    const token = process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) throw new Error('Local Management API token is missing for SP-T14');

    const privateQuery = async (query) => {
      const response = await fetch('http://127.0.0.1:54399/v1/projects/local/database/query', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'quickserve-oorva-private-e2e',
        },
        body: JSON.stringify({ query }),
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Local database query failed (${response.status}): ${responseText.slice(0, 500)}`);
      }
      let result = [];
      if (responseText.trim()) {
        try {
          result = JSON.parse(responseText);
        } catch {
          throw new Error('Local Management API returned invalid JSON');
        }
      }
      if (result?.error || (Array.isArray(result) && result.some((row) => row?.error))) {
        throw new Error(`Local database query returned an error: ${JSON.stringify(result?.error ?? result)}`);
      }
      return result;
    };
    const readFlags = async () => {
      const rows = await privateQuery(
        "select key, enabled from public.feature_flags where key in ('oorva_brand', 'oorva_sports_ux')",
      );
      if (!Array.isArray(rows)) {
        throw new Error(`SP-T14 feature flag query returned an unexpected shape: ${JSON.stringify(rows)}`);
      }
      const actual = Object.fromEntries(rows.map((row) => [row.key, row.enabled]));
      const missing = ['oorva_brand', 'oorva_sports_ux'].filter((key) => typeof actual[key] !== 'boolean');
      if (missing.length) {
        throw new Error(`SP-T14 required feature flags are missing: ${JSON.stringify({ missing, actual })}`);
      }
      return actual;
    };
    const applyFlags = async (values) => {
      const payload = JSON.stringify(values);
      if (payload.includes('$flags$')) throw new Error('Unsafe SP-T14 feature flag snapshot payload');
      await privateQuery(
        'update public.feature_flags f set enabled = v.value::boolean, updated_at = now() '
        + `from json_each_text($flags$${payload}$flags$::json) v where f.key = v.key`,
      );
      const actual = await readFlags();
      const mismatches = Object.fromEntries(
        Object.entries(values)
          .filter(([key, value]) => actual[key] !== value)
          .map(([key, value]) => [key, { expected: value, actual: actual[key] }]),
      );
      if (Object.keys(mismatches).length) {
        throw new Error(`SP-T14 feature flag update/readback mismatch: ${JSON.stringify({ mismatches, actual })}`);
      }
    };
    const captureState = async (name, familyEnabled) => {
      const featuresPromise = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_app_features'),
      );
      await go('/');
      const featuresResponse = await featuresPromise;
      if (!featuresResponse.ok()) {
        throw new Error(`SP-T14 get_app_features failed (${featuresResponse.status()}): ${await featuresResponse.text()}`);
      }
      const features = await featuresResponse.json();
      const actualFlags = {
        oorva_brand: features?.oorva_brand,
        oorva_sports_ux: features?.oorva_sports_ux,
      };
      const expectedFlags = { oorva_brand: familyEnabled, oorva_sports_ux: familyEnabled };
      const flagMismatches = Object.fromEntries(
        Object.entries(expectedFlags)
          .filter(([key, value]) => actualFlags[key] !== value)
          .map(([key, value]) => [key, { expected: value, actual: actualFlags[key] }]),
      );
      if (Object.keys(flagMismatches).length) {
        throw new Error(`SP-T14 app feature state mismatch: ${JSON.stringify({ expectedFlags, actualFlags, flagMismatches })}`);
      }

      await go('/sports');
      const expectedHome = `sports-home-${familyEnabled ? 'family' : 'legacy'}`;
      await page.getByTestId(expectedHome).waitFor({ state: 'visible' });
      await snap(`sp-t14-${name}-selection`);
      const activity = page.getByRole('button', { name: 'Badminton sports venues', exact: true });
      await activity.waitFor({ state: 'visible' });
      const venueResponsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/search_sports_venues')
        && response.request().postDataJSON()?.p_activity_slug === 'badminton',
      );
      await activity.click();
      await page.waitForURL((url) => new URL(url).pathname === '/sports/badminton');
      const venueResponse = await venueResponsePromise;
      if (!venueResponse.ok()) {
        throw new Error(`SP-T14 search_sports_venues failed (${venueResponse.status()}): ${await venueResponse.text()}`);
      }
      const rows = await venueResponse.json();
      const venue = Array.isArray(rows) ? rows.find((row) => row.id === DEMO_IDS.sportsVenue) : null;
      if (!venue) {
        throw new Error(`SP-T14 expected the same seeded venue in the detail state: ${JSON.stringify({
          expectedVenueId: DEMO_IDS.sportsVenue,
          actualRows: rows,
          url: page.url(),
          body: await page.locator('body').innerText(),
        })}`);
      }
      const venueName = 'Benz Circle Demo Badminton Courts';
      await page.getByText(venueName, { exact: true }).first().waitFor({ state: 'visible' });
      const priceLabel = (await page.locator('body').innerText())
        .split('\n')
        .find((line) => line.startsWith('From ₹') && line.endsWith('/ slot'));
      if (!priceLabel) {
        throw new Error(`SP-T14 venue price was not visible in the detail state: ${JSON.stringify({
          venueId: venue.id,
          expectedMinimumPricePaise: venue.min_price_paise,
          body: await page.locator('body').innerText(),
        })}`);
      }
      await snap(`sp-t14-${name}-detail`);
      return {
        appFlags: actualFlags,
        activitySlug: 'badminton',
        homeComposition: familyEnabled ? 'family' : 'legacy',
        priceLabel,
        venueId: venue.id,
        venueName,
      };
    };

    const originalFlags = await readFlags();
    let restoreRequired = false;
    try {
      restoreRequired = true;
      await applyFlags({ oorva_brand: false, oorva_sports_ux: false });
      const before = await captureState('before', false);
      await applyFlags({ oorva_brand: true, oorva_sports_ux: true });
      const after = await captureState('after', true);
      if (
        before.activitySlug !== after.activitySlug
        || before.venueId !== after.venueId
        || before.venueName !== after.venueName
        || before.priceLabel !== after.priceLabel
        || before.homeComposition === after.homeComposition
      ) {
        throw new Error(`SP-T14 before/after states did not match the same selection/detail data: ${JSON.stringify({
          before,
          after,
        })}`);
      }
      console.log(`SP-T14 matching actual selection/detail states: ${JSON.stringify({ before, after })}`);
    } finally {
      if (restoreRequired) await applyFlags(originalFlags);
    }
  });
}
await optional('home-top-rated', async () => {
  await go('/');
  await page.getByText(TOP_RATED_HOME_TITLE, { exact: true }).first().scrollIntoViewIfNeeded();
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, 200);
  await snap('home-top-rated');
});
await step('top-rated-see-all', async () => {
  await go('/');
  const topRatedHeading = page.getByRole('heading', { name: TOP_RATED_HOME_TITLE, exact: true }).first();
  await topRatedHeading.waitFor({ state: 'visible' });
  await topRatedHeading.locator('xpath=../..').getByText('See all', { exact: true }).click();
  await page.waitForURL(/\/top-rated$/);
  await page.getByRole('heading', { name: TOP_RATED_DETAIL_TITLE, exact: true }).first().waitFor({ state: 'visible' });
  await page.getByText(TOP_RATED_RANKING_SUMMARY).first().waitFor({ state: 'visible' });
});

// ---------- Location picker ----------
// Demo-seed runs set EXPO_PUBLIC_DEMO_CITY, which becomes the app's launch city.
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
const catalogResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_catalog`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_city: CITY }),
});
if (!catalogResponse.ok) throw new Error(`rpc/get_catalog ${catalogResponse.status}: ${await catalogResponse.text()}`);
const categories = (await catalogResponse.json()).filter((category) => category.archetype != null);
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
if (PRIVATE_LOCAL_E2E && E2E_FLAGS_ON) {
  await step('MK-PACKAGE-two-city-visible-result', async () => {
    const verifyCityPackages = async (addressLabel, expectedProvider, excludedProvider) => {
      await go('/location');
      const addresses = page.getByText(addressLabel, { exact: true });
      const address = addresses.first();
      const addressCount = await addresses.count();
      if (addressCount === 0) {
        throw new Error(`Expected saved city address was absent: ${JSON.stringify({
          addressLabel,
          addressCount,
          body: (await page.locator('body').innerText()).slice(0, 1200),
        })}`);
      }

      await address.click();
      await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 }).catch(() => undefined);
      const selectedPath = new URL(page.url()).pathname;
      if (selectedPath !== '/') {
        throw new Error(`Selecting ${addressLabel} did not return home: ${JSON.stringify({
          addressLabel,
          expectedPath: '/',
          actualPath: selectedPath,
          body: (await page.locator('body').innerText()).slice(0, 1200),
        })}`);
      }

      await go('/category/house-cleaning?name=House%20Cleaning');
      await page.waitForFunction(
        () => /Laxmi Home Cleaning|Durga Demo Home Care|No packages live yet/.test(document.body.innerText),
        null,
        { timeout: 15000 },
      ).catch(() => undefined);
      const body = await page.locator('body').innerText();
      const result = {
        addressLabel,
        expectedProvider,
        excludedProvider,
        expectedVisible: body.includes(expectedProvider),
        excludedVisible: body.includes(excludedProvider),
        body: body.slice(0, 1600),
      };
      if (!result.expectedVisible || result.excludedVisible) {
        throw new Error(`Package results did not match the selected city: ${JSON.stringify(result)}`);
      }
      await snap(`mk-package-${expectedProvider.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    };

    await verifyCityPackages('Sangareddy (demo)', 'Laxmi Home Cleaning', 'Durga Demo Home Care');
    await verifyCityPackages('Demo home', 'Durga Demo Home Care', 'Laxmi Home Cleaning');
  });

  await step('MK-FRESH-top-rated-city-error', async () => {
    const alternateCity = 'Sangareddy';
    const previousProviderName = 'MK-FRESH previous-city provider';
    const injectedError = 'MK-FRESH top-rated city failure';
    const routePattern = '**/rest/v1/rpc/list_top_rated_public';
    let previousCity = null;
    let previousCityResponseSeen = false;
    let alternateCityFailureSeen = false;
    const syntheticPreviousCityProvider = {
      id: '11111111-1111-4111-8111-111111111111',
      city: null,
      rating_avg: 4.8,
      rating_count: 7,
      jobs_completed: 12,
      years_experience: 5,
      is_online: true,
      on_leave_until: null,
      profiles: { full_name: previousProviderName, avatar_url: null },
      provider_services: [],
    };
    const routeHandler = async (route) => {
      const request = route.request();
      const payload = request.postDataJSON();
      const requestCity = typeof payload?.p_city === 'string' ? payload.p_city : null;
      if (requestCity?.toLowerCase() === alternateCity.toLowerCase()) {
        alternateCityFailureSeen = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'E2E_MK_FRESH',
            message: injectedError,
            details: 'Synthetic city-scoped failure',
            hint: '',
          }),
        });
        return;
      }
      if (!previousCityResponseSeen) {
        previousCityResponseSeen = true;
        previousCity = requestCity;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([{ ...syntheticPreviousCityProvider, city: requestCity }]),
        });
        return;
      }
      await route.continue();
    };
    const isTopRatedCityResponse = (response, city) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/list_top_rated_public')
      && response.request().postDataJSON()?.p_city === city;
    const isTopRatedOtherCityResponse = (response) => {
      if (
        response.request().method() !== 'POST'
        || !new URL(response.url()).pathname.endsWith('/rest/v1/rpc/list_top_rated_public')
      ) return false;
      const requestCity = response.request().postDataJSON()?.p_city;
      return typeof requestCity === 'string' && requestCity.toLowerCase() !== alternateCity.toLowerCase();
    };
    const home = CITY === 'Vijayawada' ? /^Flat 302, Sri Sai Residency/ : /^Flat 302, Sai Residency/;

    await page.route(routePattern, routeHandler);
    try {
      const previousCityResponsePromise = page.waitForResponse(isTopRatedOtherCityResponse);
      await go('/top-rated');
      const previousCityResponse = await previousCityResponsePromise;
      const previousRows = await previousCityResponse.json();
      if (
        !previousCityResponse.ok()
        || !Array.isArray(previousRows)
        || previousRows[0]?.profiles?.full_name !== previousProviderName
        || !previousCity
      ) {
        throw new Error(`Could not establish the previous-city result fixture: ${JSON.stringify({
          status: previousCityResponse.status(),
          previousCity,
          previousRows,
        })}`);
      }
      await page.getByText(previousProviderName, { exact: true }).waitFor({ state: 'visible' });

      await go('/location');
      const alternateAddress = page.getByText('Sangareddy (demo)', { exact: true }).first();
      const alternateAddressCount = await page.getByText('Sangareddy (demo)', { exact: true }).count();
      if (!alternateAddressCount) {
        throw new Error(`Private E2E seed has no Sangareddy address: ${JSON.stringify({
          alternateAddressCount,
          body: (await page.locator('body').innerText()).slice(0, 1200),
        })}`);
      }
      await alternateAddress.click();
      await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 });

      const alternateCityResponsePromise = page.waitForResponse((response) =>
        isTopRatedCityResponse(response, alternateCity),
      );
      await go('/top-rated');
      const alternateCityResponse = await alternateCityResponsePromise;
      await page.getByRole('heading', { name: `Top rated in ${alternateCity}`, exact: true }).first().waitFor({ state: 'visible' });
      await page.getByText(injectedError, { exact: true }).first().waitFor({ state: 'visible' });
      const staleRows = await page.getByText(previousProviderName, { exact: true }).count();
      if (
        alternateCityResponse.status() !== 503
        || !alternateCityFailureSeen
        || previousCity.toLowerCase() === alternateCity.toLowerCase()
        || staleRows
      ) {
        throw new Error(`Top-rated city failure leaked or used the wrong city: ${JSON.stringify({
          previousCity,
          alternateCity,
          responseStatus: alternateCityResponse.status(),
          alternateCityFailureSeen,
          staleRows,
          body: (await page.locator('body').innerText()).slice(0, 1600),
        })}`);
      }
    } finally {
      await page.unroute(routePattern, routeHandler);
      await go('/location');
      await page.getByText(home).first().click();
      await page.waitForURL((url) => new URL(url).pathname === '/', { timeout: 10000 });
      await page.getByText(new RegExp(`^Benz Circle, ${escapeRe(CITY)}$`)).first().waitFor({ state: 'visible' });
    }
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
let proposalSent = false;
let proposalCompared = false;
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
  proToken = await signInAs(RAVI_E2E_PHONE);
  const [reel] = await asPro('/rest/v1/categories?select=id&slug=eq.reel-maker', null, 'GET');
  if (!reel?.id) throw new Error('authenticated category query did not find reel-maker');
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
  if (!proReelServiceId) {
    throw new Error(`reel-maker service was not created for the proposal flow: ${JSON.stringify({ proReelServiceId })}`);
  }
  // The test pro works in Vijayawada; requests are routed only within the request's city.
  await go('/location');
  await page.getByText(/^Flat 302, Sri Sai Residency/).first().click();
  await page.waitForURL((u) => new URL(u).pathname === '/');
  await go(`/provider/${PRO_ID}?category=reel-maker`);
  await page.getByText('Request proposal', { exact: true }).first().click();
  await page.waitForURL(/\/request\/new/);
  await page.getByText(/^Request a proposal from /).first().waitFor();
  await page.getByLabel('What do you need?').first().fill(`${QA_MARKER} 30-second launch reel for my cafe, vertical, 2 revisions`);
  await page.getByLabel('Number of deliverables').first().fill('2');
  await page.getByText('9:16', { exact: true }).first().click();
  await page.getByLabel('Deliver by', { exact: true }).first().fill(iso(proposalDay).slice(0, 10));
  await page.getByLabel('Venue / area').first().fill('Benz Circle cafe');
  await page.getByLabel('Approximate maximum (₹)').first().fill('15000');
  await page.getByText(/^Send to /).first().click();
  await page.waitForURL(/\/request\/[0-9a-f-]{36}$/);
  briefRequestId = new URL(page.url()).pathname.split('/').pop();
  await visible('Waiting for proposals');
});
await step('proposal-flow-pro-sends-proposal', async () => {
  if (!briefRequestId) {
    throw new Error(`customer brief was not created; not sending a proposal: ${JSON.stringify({ briefRequestId })}`);
  }
  const inbox = await asPro('/rest/v1/service_request_provider_view?select=id&id=eq.' + briefRequestId, null, 'GET');
  if (inbox.length !== 1) throw new Error('targeted creator did not receive the brief');
  await asPro('/rest/v1/rpc/send_proposal', {
    p_request_id: briefRequestId,
    p_items: [{ kind: 'package', title: '30-second launch reel', qty: 1, unit: 'job', unit_price: 1200000 }],
    p_schedule: [
      { label: 'Booking advance', amount: 300000, due_rule: 'at_booking' },
      { label: 'On delivery', amount: 900000, due_rule: 'on_delivery' },
    ],
    p_valid_until: iso(3),
    p_note: `${QA_MARKER} fixed proposal`,
    p_deliverables: [{ type: 'edited_reel', qty: 1, spec: '30s vertical 1080p with captions' }],
  });
  proposalSent = true;
});
await step('proposal-flow-customer-compares', async () => {
  if (!proposalSent || !briefRequestId) {
    throw new Error(`proposal comparison prerequisites are missing: ${JSON.stringify({ proposalSent, briefRequestId })}`);
  }
  await go(`/request/${briefRequestId}`);
  await page.getByText('₹12,000', { exact: true }).first().waitFor();
  await page.getByText('Compare proposal', { exact: true }).first().click();
  await page.waitForURL(/\/proposal\//);
  // The request comparison remains mounted behind the pushed proposal detail screen.
  await page.getByText('Payment milestones', { exact: true }).last().waitFor({ state: 'visible' });
  await visible('Booking advance');
  await page.getByText(/30s vertical 1080p|edited_reel/i).first().waitFor();
  proposalCompared = true;
});
await step('proposal-flow-accept-and-checkout', async () => {
  if (!proposalCompared) {
    throw new Error(`proposal was not compared; checkout cannot continue: ${JSON.stringify({ proposalCompared })}`);
  }
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
await step('provider-detail-fixed-service-routes-to-packages', async () => {
  const fixedServiceRows = await asPro(
    `/rest/v1/provider_services?select=id,provider_id,categories(slug,archetype)&id=eq.${DEMO_IDS.fixedService}&active=eq.true`,
    null,
    'GET',
  );
  const fixedService = fixedServiceRows[0];
  if (!fixedService?.provider_id || !fixedService.categories?.slug) {
    throw new Error(`seeded fixed service is unavailable: ${JSON.stringify({ fixedServiceRows })}`);
  }
  const providerServices = await asPro(`/rest/v1/provider_services?select=id,categories(archetype)&provider_id=eq.${fixedService.provider_id}&active=eq.true`, null, 'GET');
  if (
    fixedService.categories.archetype !== 'fixed' ||
    providerServices.length !== 1 ||
    providerServices[0]?.categories?.archetype !== 'fixed'
  ) {
    throw new Error(`expected a fixed-only provider fixture; got ${JSON.stringify({ fixedService, providerServices })}`);
  }
  await go(`/provider/${fixedService.provider_id}?category=${encodeURIComponent(fixedService.categories.slug)}`);
  await visible('Ratings & reviews');
  if (await page.getByText(/^(Visit fee|Labour per )/).count()) {
    throw new Error('fixed service profile still shows visit-fee pricing');
  }
  const packageTitle = 'Demo 2 BHK deep clean';
  await page.getByRole('button', { name: `Select package: ${packageTitle}`, exact: true }).click();
  await page.getByRole('button', { name: 'Book package', exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/book/'));
  const actualRoute = new URL(page.url());
  const actual = {
    providerServiceId: actualRoute.pathname.split('/').pop(),
    packageId: actualRoute.searchParams.get('packageId'),
  };
  const expected = {
    providerServiceId: fixedService.id,
    packageId: DEMO_IDS.fixedPackage,
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`fixed package did not route to the exact service/package; actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  }
  await page.locator(`text="${packageTitle}" >> visible=true`).first().waitFor();
});
await step('book-screen', async () => {
  const raviServices = await asPro(
    `/rest/v1/provider_services?select=id&provider_id=eq.${RAVI}&active=eq.true&limit=1`,
    null,
    'GET',
  );
  if (!raviServices[0]) throw new Error(`no active service for Ravi: ${JSON.stringify({ raviServices })}`);
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
let assistantDraftReady = false;
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
await step('assistant-draft-or-busy-fallback', async () => {
  if (process.env.E2E_AI_UNAVAILABLE === '1') {
    skipStep('assistant-draft-or-busy-fallback', 'No AI provider key in this backend (local E2E stack); hosted E2E covers the assistant.');
    return;
  }
  await page.getByLabel('Message QuickServe AI').first().fill('AC not cooling, making noise, need tomorrow evening');
  let http429Seen = false;
  let resolveRateLimit;
  const rateLimitResponse = new Promise((resolve) => {
    resolveRateLimit = resolve;
  });
  const onAssistantResponse = (response) => {
    if (response.status() === 429 && response.url().includes('/functions/v1/ai-assistant')) {
      http429Seen = true;
      resolveRateLimit();
    }
  };
  page.on('response', onAssistantResponse);
  let outcome;
  try {
    await page.getByLabel('Send message').first().click();
    outcome = await Promise.race([
      page.getByText(/Understanding your request|Switching to a backup AI model|Working on it/).first().waitFor({ timeout: 30000 }).then(() => 'progress'),
      rateLimitResponse.then(() => 'http-429'),
    ]);
    if (outcome !== 'http-429') {
      outcome = await Promise.race([
        page.waitForFunction(() => {
          const body = document.body?.innerText ?? '';
          return body.includes('Review & pay')
            || body.includes('QuickServe AI is busy right now')
            || body.includes("You've used today's")
            || body.includes("You're sending messages very quickly");
        }, undefined, { timeout: 150000 }).then(() => 'message'),
        rateLimitResponse.then(() => 'http-429'),
      ]);
    }
  } finally {
    page.off('response', onAssistantResponse);
  }
  const assistantText = await page.locator('body').innerText();
  const limitCopy = assistantText.match(/You've used today's[^\n]*|You're sending messages very quickly[^\n]*/)?.[0] ?? '';
  if (http429Seen || outcome === 'http-429' || limitCopy) {
    skipStep(
      'assistant-draft-or-busy-fallback',
      `AI assistant rate limit${http429Seen || outcome === 'http-429' ? ' (HTTP 429)' : ''}; draft/review path was not validated${limitCopy ? `: ${limitCopy}` : '.'}`,
    );
    return;
  }
  // Live progress from real server work, then either a draft or an explicit busy fallback.
  assistantDraftReady = await page.getByText('Review & pay', { exact: true }).last().isVisible().catch(() => false);
  if (!assistantDraftReady) {
    await page.getByText(/QuickServe AI is busy right now/).last().waitFor({ state: 'visible' });
    await page.getByText('Try again', { exact: true }).last().waitFor({ state: 'visible' });
    const warning = 'AI assistant returned a generic unavailable response; the draft/review path was not validated and the cause may be transient or permanent.';
    softFailures.push(warning);
    console.warn(`::warning::${warning}`);
    return;
  }
  await page.getByText('Review & pay', { exact: true }).last().waitFor({ state: 'visible' });
  await page.getByText('Booking draft', { exact: true }).first().waitFor();
  await page.getByText(/^Done in \d+\.\ds · \d+ steps?$/).first().waitFor();
  await page.getByText('Issue', { exact: true }).first().waitFor();
  await page.getByText('You reported', { exact: true }).first().waitFor();
});
await optional('assistant-draft-scrolled', () => snapScrolled('assistant-draft-scrolled', 600));
await step('assistant-review-prefills-book', async () => {
  if (!assistantDraftReady) {
    skipStep('assistant-review-prefills-book', 'No assistant draft was produced to review.');
    return;
  }
  await page.getByText('Review & pay', { exact: true }).last().click();
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
  await visible('My activity');
  const response = appFeatureResponses.at(-1);
  if (!response) {
    throw new Error(`get_app_features response was not observed before the book_again check: ${JSON.stringify({
      url: page.url(),
      responseCount: appFeatureResponses.length,
      body: await page.locator('body').innerText(),
    })}`);
  }
  if (!response.ok()) {
    throw new Error(`get_app_features failed while checking book_again (${response.status()}): ${await response.text()}`);
  }
  const appFeatures = await response.json();
  bookAgainAppFlag = appFeatures?.book_again;
  if (bookAgainAppFlag !== E2E_FLAGS_ON) {
    throw new Error(`book_again app flag did not match this pass: ${JSON.stringify({
      expected: E2E_FLAGS_ON,
      actual: bookAgainAppFlag,
      appFeatures,
      url: page.url(),
    })}`);
  }
});
await step('bookings-past', async () => {
  await page.getByText('Past', { exact: true }).first().click();
  const completedSeedBooking = page.getByRole('button', {
    name: /Electrician with Srinivas Rao Electricals, Completed/,
  }).first();
  await completedSeedBooking.waitFor({ state: 'visible' });
  await completedSeedBooking.getByText('Frequent MCB tripping in the kitchen', { exact: true }).waitFor({ state: 'visible' });
  const bookAgainButton = completedSeedBooking.getByText('Book again', { exact: true }).first();
  if (bookAgainAppFlag === true) {
    await bookAgainButton.waitFor({ state: 'visible' });
  } else if (await bookAgainButton.isVisible().catch(() => false)) {
    throw new Error(`book_again visibility did not match this pass: ${JSON.stringify({
      expectedVisible: E2E_FLAGS_ON,
      actualVisible: true,
      bookAgainAppFlag,
      completedFixtureVisible: await completedSeedBooking.isVisible().catch(() => false),
      url: page.url(),
      body: await page.locator('body').innerText(),
    })}`);
  }
  await page.waitForTimeout(500);
});
await step('my-activity-requests-segment', async () => {
  await page.getByTestId('activity-segment-requests').click();
  await page.getByTestId('my-activity-panel-requests').waitFor();
});
await step('my-activity-shop-segment', async () => {
  await page.getByTestId('activity-segment-shop').click();
  await page.getByTestId('my-activity-panel-shop').waitFor();
  await visible('Product enquiries');
  await visible('Product RFQs');
});
if (PRIVATE_LOCAL_E2E && E2E_FLAGS_ON) {
  await step('MK-OFF-same-entity-history-cancel-private-backend', async () => {
    const featureKeys = ['products', 'product_enquiries', 'product_rfq'];
    const featureOn = { products: true, product_enquiries: true, product_rfq: true };
    const featureOff = { products: false, product_enquiries: true, product_rfq: true };
    const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const sqlUuid = (value) => `${sqlLiteral(value)}::uuid`;
    const privateQuery = async (query) => {
      if (
        !PRIVATE_LOCAL_E2E
        || process.env.DEMO_PROJECT !== '1'
        || process.env.PROJECT_REF !== 'local'
        || process.env.SUPABASE_MGMT_URL !== 'http://127.0.0.1:54399'
      ) {
        throw new Error('O18 fixture/flag management is restricted to the disposable local E2E backend');
      }
      const token = process.env.SUPABASE_ACCESS_TOKEN;
      if (!token) throw new Error('Local Management API token is missing');
      const response = await fetch('http://127.0.0.1:54399/v1/projects/local/database/query', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'quickserve-oorva-private-e2e',
        },
        body: JSON.stringify({ query }),
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Local database query failed (${response.status}): ${responseText.slice(0, 500)}`);
      }
      let result = [];
      if (responseText.trim()) {
        try {
          result = JSON.parse(responseText);
        } catch {
          throw new Error('Local Management API returned invalid JSON');
        }
      }
      if (result?.error || (Array.isArray(result) && result.some((row) => row?.error))) {
        throw new Error(`Local database query returned an error: ${JSON.stringify(result?.error ?? result)}`);
      }
      return result;
    };
    const readFlags = async () => {
      const rows = await privateQuery(
        "select key, enabled from public.feature_flags where key in ('products', 'product_enquiries', 'product_rfq')",
      );
      if (!Array.isArray(rows)) throw new Error(`Feature flag query returned an unexpected shape: ${JSON.stringify(rows)}`);
      return Object.fromEntries(rows.map((row) => [row.key, row.enabled]));
    };
    const applyFlags = async (values) => {
      const payload = JSON.stringify(values);
      if (payload.includes('$flags$')) throw new Error('Unsafe feature flag snapshot payload');
      await privateQuery(
        'update public.feature_flags f set enabled = v.value::boolean, updated_at = now() '
        + `from json_each_text($flags$${payload}$flags$::json) v where f.key = v.key`,
      );
      const actual = await readFlags();
      const mismatches = Object.fromEntries(
        Object.entries(values).filter(([key, value]) => actual[key] !== value).map(([key, value]) => [key, { expected: value, actual: actual[key] }]),
      );
      if (Object.keys(mismatches).length) {
        throw new Error(`Feature flag update/readback mismatch: ${JSON.stringify({ mismatches, actual })}`);
      }
    };
    const refreshFeatureState = async (expected) => {
      const responsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_app_features'),
      );
      await page.reload();
      const response = await responsePromise;
      if (!response.ok()) throw new Error(`get_app_features failed after local toggle (${response.status()}): ${await response.text()}`);
      const actual = await response.json();
      const mismatches = Object.fromEntries(
        Object.entries(expected).filter(([key, value]) => actual?.[key] !== value).map(([key, value]) => [key, { expected: value, actual: actual?.[key] }]),
      );
      if (Object.keys(mismatches).length) {
        throw new Error(`App feature state did not refresh: ${JSON.stringify({ expected, actual, mismatches })}`);
      }
    };
    const rpc = async (token, name, args = {}) => {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const body = await response.text();
      let data = null;
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        data = null;
      }
      return { ok: response.ok, status: response.status, body, data };
    };
    const requireRpcSuccess = (name, result) => {
      if (!result.ok) {
        throw new Error(`${name} RPC expected success; actual=${JSON.stringify({ status: result.status, body: result.body })}`);
      }
      return result.data;
    };
    const requireFeatureDenial = (name, result) => {
      const actual = { ok: result.ok, status: result.status, body: result.body };
      if (result.ok || !/feature|product|disabled|turned off|not enabled/i.test(result.body)) {
        throw new Error(`${name} was not rejected by the capability-off guard; actual=${JSON.stringify(actual)} expected=non-2xx capability-off error`);
      }
    };
    const requireNotFoundDenial = (name, result, expectedText) => {
      const actual = { ok: result.ok, status: result.status, body: result.body };
      if (result.ok || !result.body.toLowerCase().includes(expectedText)) {
        throw new Error(`${name} did not hide the same entity from an outsider; actual=${JSON.stringify(actual)} expectedError=${JSON.stringify(expectedText)}`);
      }
    };
    const currentAccessToken = async () => page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        try {
          const value = JSON.parse(localStorage.getItem(key) ?? 'null');
          const sessions = [value, value?.currentSession, value?.session, value?.data?.session];
          const session = sessions.find((candidate) => typeof candidate?.access_token === 'string');
          if (session) return session.access_token;
        } catch {
          continue;
        }
      }
      return null;
    });
    const userIdFromAccessToken = (token, role) => {
      const payload = token.split('.')[1];
      if (!payload) throw new Error(`Authenticated ${role} token has no JWT payload`);
      let claims;
      try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        throw new Error(`Authenticated ${role} token payload is invalid JSON`);
      }
      const id = claims?.sub;
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
        throw new Error(`Authenticated ${role} token has an invalid subject: ${JSON.stringify({ role, subject: id ?? null })}`);
      }
      return id;
    };
    const readRfqQuoteState = async (rfqId, quoteId) => {
      const rows = await privateQuery(
        `select r.status as rfq_status, q.status as quote_status `
        + `from public.rfqs r join public.supplier_quotes q on q.rfq_id = r.id `
        + `where r.id = ${sqlUuid(rfqId)} and q.id = ${sqlUuid(quoteId)}`,
      );
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw new Error(`Expected one RFQ/quote state row; actual=${JSON.stringify(rows)} expected={rfqId:${JSON.stringify(rfqId)},quoteId:${JSON.stringify(quoteId)}}`);
      }
      return rows[0];
    };

    let snapshot = null;
    let testError = null;
    const cleanupErrors = [];
    let shopId = null;
    let productId = null;
    let enquiryId = null;
    let quoteId = null;
    const rfqIds = [];
    try {
      const initialFlags = await readFlags();
      const missingFlags = featureKeys.filter((key) => typeof initialFlags[key] !== 'boolean');
      if (missingFlags.length) throw new Error(`Required local feature flags are missing: ${JSON.stringify({ missingFlags, actual: initialFlags })}`);
      snapshot = Object.fromEntries(featureKeys.map((key) => [key, initialFlags[key]]));
      if (JSON.stringify(snapshot) !== JSON.stringify(featureOn)) {
        throw new Error(`Pass B did not start with the expected product capabilities ON: ${JSON.stringify({ actual: snapshot, expected: featureOn })}`);
      }

      const customerPhone = phoneE164(PHONE);
      const ownerPhone = getAdminPhone();
      const outsiderPhone = phoneE164(NEW_PRO_PHONE);
      const roleCollisions = phoneRoleCollisions([
        ['customer', customerPhone],
        ['shop owner/admin', ownerPhone],
        ['outsider', outsiderPhone],
      ]);
      if (roleCollisions.length) throw new Error(`O18 test identities must be distinct: ${JSON.stringify({ roleCollisions })}`);

      const customerToken = await currentAccessToken();
      if (!customerToken) throw new Error('Signed-in customer session token is missing');
      const ownerToken = await signInAs(ownerPhone);
      await grantE2eAdminMembership(ownerPhone);
      const outsiderToken = await signInAs(outsiderPhone);

      const userIds = new Map([
        ['customer', userIdFromAccessToken(customerToken, 'customer')],
        ['shop owner/admin', userIdFromAccessToken(ownerToken, 'shop owner/admin')],
        ['outsider', userIdFromAccessToken(outsiderToken, 'outsider')],
      ]);
      const userRows = await privateQuery(
        `select id from auth.users where id in (${[...userIds.values()].map(sqlUuid).join(', ')})`,
      );
      if (!Array.isArray(userRows)) throw new Error(`Test identity lookup returned an unexpected shape: ${JSON.stringify(userRows)}`);
      const existingUserIds = new Set(userRows.map((row) => row.id));
      const missingRoles = [...userIds].filter(([, id]) => !existingUserIds.has(id)).map(([role]) => role);
      if (missingRoles.length) {
        throw new Error(`Authenticated private E2E identities are absent from auth.users: ${JSON.stringify({
          missingRoles,
          expectedIds: Object.fromEntries(userIds),
          actualIds: userRows.map((row) => row.id),
        })}`);
      }

      const existingShop = requireRpcSuccess('get_my_shop', await rpc(ownerToken, 'get_my_shop'));
      const hasExistingShop = Array.isArray(existingShop) ? existingShop.some(Boolean) : existingShop != null;
      if (hasExistingShop) {
        throw new Error(`Shop owner identity is not isolated; refusing to reuse an existing shop: ${JSON.stringify({ existingShop })}`);
      }
      const categoryRows = await privateQuery(
        "select id from public.product_categories where slug = 'tiles' and active = true limit 1",
      );
      if (!Array.isArray(categoryRows) || !categoryRows[0]?.id) {
        throw new Error(`Active Tiles product category is missing: ${JSON.stringify(categoryRows)}`);
      }

      shopId = randomUUID();
      productId = randomUUID();
      const shopName = `${QA_MARKER} O18 private history shop`;
      const productName = `${QA_MARKER} O18 history product`;
      await privateQuery(
        'insert into public.shops '
        + '(id, owner_id, name, description, address_line, city, area, lat, lng, delivery_radius_km, offers_delivery, offers_pickup, status) '
        + `values (${sqlUuid(shopId)}, ${sqlUuid(userIds.get('shop owner/admin'))}, ${sqlLiteral(shopName)}, `
        + `${sqlLiteral(`${QA_MARKER} isolated local-only fixture`)}, ${sqlLiteral('88 QA Demo Market Road')}, `
        + `${sqlLiteral('Vijayawada')}, ${sqlLiteral('Benz Circle')}, 16.5, 80.6, 20, true, true, 'verified')`,
      );
      await privateQuery(
        `insert into public.shop_categories (shop_id, category_id) values (${sqlUuid(shopId)}, ${sqlUuid(categoryRows[0].id)})`,
      );
      await privateQuery(
        'insert into public.products (id, shop_id, category_id, name, brand, model, description, specs, unit) '
        + `values (${sqlUuid(productId)}, ${sqlUuid(shopId)}, ${sqlUuid(categoryRows[0].id)}, `
        + `${sqlLiteral(productName)}, 'O18', 'History', `
        + `${sqlLiteral(`${QA_MARKER} private E2E product`)}, '{"size":"10x10"}'::jsonb, 'box')`,
      );
      const ownerShop = requireRpcSuccess('get_my_shop fixture read', await rpc(ownerToken, 'get_my_shop'));
      const ownerShopRecord = Array.isArray(ownerShop) ? ownerShop[0] : ownerShop;
      if (ownerShopRecord?.id !== shopId) {
        throw new Error(`Shop owner could not read the generated fixture: ${JSON.stringify({ expectedShopId: shopId, actual: ownerShopRecord })}`);
      }

      const enquiryText = `${QA_MARKER} existing enquiry history ${randomUUID()}`;
      const ownerReplyText = `${QA_MARKER} existing owner reply ${randomUUID()}`;
      const enquiryData = requireRpcSuccess(
        'start_product_enquiry',
        await rpc(customerToken, 'start_product_enquiry', { p_shop_id: shopId, p_product_id: productId, p_body: enquiryText }),
      );
      enquiryId = Array.isArray(enquiryData) ? enquiryData[0]?.id : enquiryData?.id ?? enquiryData;
      if (typeof enquiryId !== 'string' || !enquiryId) {
        throw new Error(`start_product_enquiry returned no enquiry ID: ${JSON.stringify(enquiryData)}`);
      }
      requireRpcSuccess(
        'send_enquiry_message',
        await rpc(ownerToken, 'send_enquiry_message', { p_enquiry_id: enquiryId, p_body: ownerReplyText }),
      );

      const neededBy = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const createRfq = async (title) => {
        const data = requireRpcSuccess('create_rfq', await rpc(customerToken, 'create_rfq', {
          p_category_id: categoryRows[0].id,
          p_title: title,
          p_items: [{ description: 'Existing material', specs: { size: '10x10' }, quantity: 2, unit: 'box' }],
          p_city: 'Vijayawada',
          p_area: 'Benz Circle',
          p_lat: 16.5,
          p_lng: 80.6,
          p_needs_delivery: true,
          p_needed_by: neededBy,
          p_notes: `${QA_MARKER} existing RFQ history`,
        }));
        const id = typeof data === 'string' ? data : data?.id;
        if (typeof id !== 'string' || !id) throw new Error(`create_rfq returned no RFQ ID: ${JSON.stringify(data)}`);
        rfqIds.push(id);
        return id;
      };
      const rfqTitle = `${QA_MARKER} O18 same-entity history RFQ ${randomUUID()}`;
      const rfqId = await createRfq(rfqTitle);
      const quoteProbeId = await createRfq(`${QA_MARKER} O18 quote capability probe ${randomUUID()}`);
      const getRfqItemId = async (id) => {
        const rows = await privateQuery(`select id from public.rfq_items where rfq_id = ${sqlUuid(id)} limit 1`);
        if (!Array.isArray(rows) || !rows[0]?.id) throw new Error(`RFQ item is missing: ${JSON.stringify({ rfqId: id, rows })}`);
        return rows[0].id;
      };
      const rfqItemId = await getRfqItemId(rfqId);
      const quoteProbeItemId = await getRfqItemId(quoteProbeId);
      const quoteData = requireRpcSuccess(
        'send_supplier_quote_for_business',
        await rpc(ownerToken, 'send_supplier_quote_for_business', {
          p_rfq_id: rfqId,
          p_shop_id: shopId,
          p_items: [{ rfq_item_id: rfqItemId, brand: 'O18', model: 'History', specs: { size: '10x10' }, unit_price_paise: 1000, gst_rate_bp: 0, available: true }],
          p_delivery_charge_paise: 0,
          p_delivery_days: null,
          p_valid_until: null,
          p_notes: `${QA_MARKER} existing quote history`,
        }),
      );
      quoteId = typeof quoteData === 'string' ? quoteData : quoteData?.id;
      if (typeof quoteId !== 'string' || !quoteId) throw new Error(`Quote RPC returned no quote ID: ${JSON.stringify(quoteData)}`);
      const initialState = await readRfqQuoteState(rfqId, quoteId);
      if (initialState.rfq_status !== 'open' || initialState.quote_status !== 'sent') {
        throw new Error(`Initial same-entity state is not open/sent: ${JSON.stringify({ actual: initialState, expected: { rfq_status: 'open', quote_status: 'sent' } })}`);
      }

      await applyFlags(featureOff);
      await refreshFeatureState(featureOff);

      const ownerEnquiryRows = requireRpcSuccess(
        'get_product_enquiry owner same-ID read',
        await rpc(ownerToken, 'get_product_enquiry', { p_enquiry_id: enquiryId }),
      );
      const ownerEnquiry = Array.isArray(ownerEnquiryRows)
        ? ownerEnquiryRows.find((row) => row?.id === enquiryId)
        : ownerEnquiryRows?.id === enquiryId ? ownerEnquiryRows : null;
      if (!ownerEnquiry || ownerEnquiry.business_role !== 'owner') {
        throw new Error(`Shop owner did not read the same enquiry ID with owner context: ${JSON.stringify({
          expected: { enquiryId, business_role: 'owner' },
          actual: ownerEnquiryRows,
        })}`);
      }
      const customerRfq = requireRpcSuccess(
        'get_rfq customer history read',
        await rpc(customerToken, 'get_rfq', { p_rfq_id: rfqId }),
      );
      if (!JSON.stringify(customerRfq).includes(rfqId)) {
        throw new Error(`RFQ owner did not read the same RFQ ID: ${JSON.stringify({ expectedRfqId: rfqId, actual: customerRfq })}`);
      }

      await go('/bookings');
      await page.getByTestId('activity-segment-shop').click();
      const enquiryPanel = page.getByTestId('my-activity-panel-shop');
      await enquiryPanel.waitFor();
      const enquiryCard = enquiryPanel.getByText(productName, { exact: true });
      await enquiryCard.waitFor({ state: 'visible' });
      await enquiryCard.click();
      await page.waitForURL((url) => new URL(url).pathname === `/enquiry/${enquiryId}`);

      await visible(enquiryText);
      await visible(ownerReplyText);
      await visible('Existing enquiry history is read-only while product enquiries are turned off.');
      if (await page.getByLabel('Message', { exact: true }).count()) {
        throw new Error(`Read-only enquiry still exposes a message composer: ${JSON.stringify({ enquiryId, messageInputs: await page.getByLabel('Message', { exact: true }).count() })}`);
      }
      if (await page.getByLabel('Send message', { exact: true }).count()) {
        throw new Error(`Read-only enquiry still exposes Send message: ${JSON.stringify({ enquiryId, sendButtons: await page.getByLabel('Send message', { exact: true }).count() })}`);
      }

      await go('/bookings');
      const activityNavigationActual = async (expectedText = null) => page.evaluate((expected) => {
        const describeElement = (element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            role: element.getAttribute('role'),
            label: element.getAttribute('aria-label'),
            testId: element.getAttribute('data-testid'),
            text: (element.innerText ?? '').replace(/\s+/g, ' ').slice(0, 500),
            visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
            backgroundColor: style.backgroundColor,
            color: style.color,
          };
        };
        const tablists = Array.from(document.querySelectorAll('[role="tablist"]')).map(describeElement);
        const tabs = Array.from(document.querySelectorAll('[role="tab"]')).map(describeElement);
        const panels = Array.from(document.querySelectorAll('[data-testid^="my-activity-panel-"]')).map(describeElement);
        const matchingTextNodes = expected == null
          ? []
          : Array.from(document.querySelectorAll('body *'))
            .filter((element) => element.children.length === 0 && (element.textContent ?? '').trim() === expected)
            .slice(0, 20)
            .map(describeElement);
        return {
          url: window.location.href,
          counts: {
            tablists: tablists.length,
            visibleTablists: tablists.filter((element) => element.visible).length,
            tabs: tabs.length,
            visibleTabs: tabs.filter((element) => element.visible).length,
            panels: panels.length,
            visiblePanels: panels.filter((element) => element.visible).length,
            matchingTextNodes: matchingTextNodes.length,
            visibleMatchingTextNodes: matchingTextNodes.filter((element) => element.visible).length,
          },
          tablists,
          tabs,
          panels,
          matchingTextNodes,
          body: (document.body?.innerText ?? '').slice(0, 2400),
        };
      }, expectedText);
      const activityTabList = page.getByRole('tablist', { name: 'Activity segments' });
      const shopTab = activityTabList.getByRole('tab', { name: /^Shop/ });
      const productRfqsHeading = page.getByText('Product RFQs', { exact: true }).filter({ visible: true }).first();
      let clickTarget = null;
      let postClick = null;
      let rfqCard;
      try {
        await activityTabList.waitFor({ state: 'visible' });
        await shopTab.waitFor({ state: 'visible' });
        clickTarget = {
          tablistLocator: {
            matches: await activityTabList.count(),
            visible: await activityTabList.isVisible(),
          },
          shopTabLocator: {
            matches: await shopTab.count(),
            visible: await shopTab.isVisible(),
          },
          element: await shopTab.evaluate((element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return {
              role: element.getAttribute('role'),
              name: element.getAttribute('aria-label'),
              testId: element.getAttribute('data-testid'),
              text: (element.innerText ?? '').replace(/\s+/g, ' ').trim(),
              visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
              bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          }),
        };
        await shopTab.click();
        await productRfqsHeading.waitFor({ state: 'visible' });
        rfqCard = page.getByText(rfqTitle, { exact: true }).filter({ visible: true }).first();
        await rfqCard.waitFor({ state: 'visible' });
        postClick = await activityNavigationActual();
        console.log(`O18 Shop tab DOM diagnostics: ${JSON.stringify({ clickTarget, postClick })}`);
      } catch (error) {
        throw new Error(`Accessible Shop tab did not show the RFQ history: ${JSON.stringify({
          clickTarget,
          postClick,
          actual: await activityNavigationActual(),
          waitError: String(error?.message ?? error),
        })}`);
      }
      await rfqCard.click();
      await page.waitForURL((url) => new URL(url).pathname === `/rfq/${rfqId}`);
      const rfqDetailTitle = page.getByText(rfqTitle, { exact: true }).filter({ visible: true }).first();
      try {
        await rfqDetailTitle.waitFor({ state: 'visible' });
      } catch (error) {
        throw new Error(`Same-ID RFQ detail title was not visible: ${JSON.stringify({
          rfqId,
          clickTarget,
          postClick,
          actual: await activityNavigationActual(rfqTitle),
          waitError: String(error?.message ?? error),
        })}`);
      }
      const showOfferLines = page.getByRole('button', { name: 'Show offer lines', exact: true });
      const showOfferLinesCount = await showOfferLines.count();
      if (showOfferLinesCount < 1) {
        throw new Error(`RFQ offer details could not be expanded: ${JSON.stringify({
          rfqId,
          quoteId,
          showOfferLinesCount,
          body: (await page.locator('body').innerText()).slice(0, 1800),
        })}`);
      }
      await showOfferLines.first().click();
      await page.getByText(/History/).first().waitFor({ state: 'visible' });
      await visible('Existing RFQ history is read-only while new RFQs are turned off. You may cancel your own open request.');
      const cancelButtons = page.getByRole('button', { name: 'Cancel request', exact: true });
      if (!(await cancelButtons.count())) throw new Error(`RFQ owner cannot see Cancel request for ${JSON.stringify({ rfqId })}`);
      const chooseButtons = page.getByRole('button', { name: 'Choose this supplier', exact: true });
      const chooseButtonCount = await chooseButtons.count();
      if (chooseButtonCount !== 0) {
        throw new Error(`Supplier selection remained visible while products are OFF: ${JSON.stringify({
          rfqId,
          chooseButtonCount,
          historyVisible: true,
        })}`);
      }

      requireNotFoundDenial(
        'outsider get_product_enquiry',
        await rpc(outsiderToken, 'get_product_enquiry', { p_enquiry_id: enquiryId }),
        'enquiry not found',
      );
      requireNotFoundDenial(
        'outsider get_rfq',
        await rpc(outsiderToken, 'get_rfq', { p_rfq_id: rfqId }),
        'rfq not found',
      );
      requireNotFoundDenial(
        'outsider cancel_rfq',
        await rpc(outsiderToken, 'cancel_rfq', { p_rfq_id: rfqId }),
        'rfq not found',
      );
      const afterOutsider = await readRfqQuoteState(rfqId, quoteId);
      if (afterOutsider.rfq_status !== 'open' || afterOutsider.quote_status !== 'sent') {
        throw new Error(`Outsider changed same-entity RFQ/quote state: ${JSON.stringify({ actual: afterOutsider, expected: { rfq_status: 'open', quote_status: 'sent' } })}`);
      }

      requireFeatureDenial(
        'new start_product_enquiry',
        await rpc(customerToken, 'start_product_enquiry', { p_shop_id: shopId, p_product_id: productId, p_body: `${QA_MARKER} denied new enquiry` }),
      );
      requireFeatureDenial(
        'new create_rfq',
        await rpc(customerToken, 'create_rfq', {
          p_category_id: categoryRows[0].id,
          p_title: `${QA_MARKER} denied new RFQ ${randomUUID()}`,
          p_items: [{ description: 'New material', specs: { size: '10x10' }, quantity: 2, unit: 'box' }],
          p_city: 'Vijayawada',
          p_area: 'Benz Circle',
          p_lat: 16.5,
          p_lng: 80.6,
          p_needs_delivery: true,
          p_needed_by: neededBy,
          p_notes: `${QA_MARKER} denied new RFQ`,
        }),
      );
      requireFeatureDenial(
        'new send_enquiry_message',
        await rpc(ownerToken, 'send_enquiry_message', { p_enquiry_id: enquiryId, p_body: `${QA_MARKER} denied new reply` }),
      );
      requireFeatureDenial(
        'new send_supplier_quote_for_business',
        await rpc(ownerToken, 'send_supplier_quote_for_business', {
          p_rfq_id: quoteProbeId,
          p_shop_id: shopId,
          p_items: [{ rfq_item_id: quoteProbeItemId, brand: 'O18', model: 'Off probe', specs: { size: '10x10' }, unit_price_paise: 1000, gst_rate_bp: 0, available: true }],
          p_delivery_charge_paise: 0,
          p_delivery_days: null,
          p_valid_until: null,
          p_notes: `${QA_MARKER} denied new quote`,
        }),
      );
      requireFeatureDenial(
        'select_supplier_quote',
        await rpc(customerToken, 'select_supplier_quote', { p_quote_id: quoteId }),
      );

      let cancelDialogMessage = '';
      const handleCancelDialog = async (dialog) => {
        cancelDialogMessage = dialog.message();
        await dialog.accept();
      };
      const expectedCancelCopy = 'This closes your request. Outstanding quotes will not be selected. No payment will be taken.';
      const cancelResponsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/cancel_rfq')
        && response.request().postDataJSON()?.p_rfq_id === rfqId,
      ).then(
        (response) => ({ response }),
        (error) => ({ error: String(error?.message ?? error) }),
      );
      page.on('dialog', handleCancelDialog);
      try {
        await cancelButtons.first().click();
      } finally {
        page.off('dialog', handleCancelDialog);
      }
      if (cancelDialogMessage) {
        if (!cancelDialogMessage.includes(expectedCancelCopy)) {
          throw new Error(`Unexpected cancel confirmation dialog: ${JSON.stringify({ rfqId, message: cancelDialogMessage })}`);
        }
      } else {
        await visible(expectedCancelCopy);
        const confirmationButtons = page.getByRole('button', { name: 'Cancel request', exact: true });
        const confirmationButtonCount = await confirmationButtons.count();
        if (confirmationButtonCount < 2) {
          throw new Error(`Custom RFQ cancellation confirmation is missing its confirm action: ${JSON.stringify({
            rfqId,
            confirmationButtonCount,
            expectedCancelCopy,
            body: await page.locator('body').innerText(),
          })}`);
        }
        await confirmationButtons.last().click();
      }
      const cancelOutcome = await cancelResponsePromise;
      if ('error' in cancelOutcome) {
        throw new Error(`Owner cancel_rfq response was not observed: ${JSON.stringify({
          rfqId,
          cancelDialogMessage,
          expectedCancelCopy,
          waitError: cancelOutcome.error,
          body: await page.locator('body').innerText(),
        })}`);
      }
      const cancelResponse = cancelOutcome.response;
      if (!cancelResponse.ok()) {
        throw new Error(`Owner cancel_rfq failed (${cancelResponse.status()}): ${await cancelResponse.text()}`);
      }
      const afterOwnerCancel = await readRfqQuoteState(rfqId, quoteId);
      if (afterOwnerCancel.rfq_status !== 'cancelled' || afterOwnerCancel.quote_status !== 'rejected') {
        throw new Error(`Owner cancellation did not atomically resolve the same RFQ/quote: ${JSON.stringify({ actual: afterOwnerCancel, expected: { rfq_status: 'cancelled', quote_status: 'rejected' } })}`);
      }

      await applyFlags(featureOn);
      await refreshFeatureState(featureOn);
      await step('MK-ENQUIRY-same-PK-counterpart-refresh', async () => {
        let ownerClosed = false;
        try {
          await go(`/enquiry/${enquiryId}`);
          await visible(enquiryText);
          await visible(ownerReplyText);
          await visible('Conversation status: open');
          requireRpcSuccess(
            'owner closes the same enquiry ID',
            await rpc(ownerToken, 'set_product_enquiry_status', { p_enquiry_id: enquiryId, p_status: 'closed' }),
          );
          ownerClosed = true;

          await go('/bookings');
          await go(`/enquiry/${enquiryId}`);
          await visible('Conversation status: closed');
          await visible('Reopen this enquiry to send a message.');
          const customerClosedRows = requireRpcSuccess(
            'customer reads the same closed enquiry after counterpart refresh',
            await rpc(customerToken, 'get_product_enquiry', { p_enquiry_id: enquiryId }),
          );
          const customerClosed = Array.isArray(customerClosedRows)
            ? customerClosedRows.find((row) => row?.id === enquiryId)
            : customerClosedRows?.id === enquiryId ? customerClosedRows : null;
          const actual = {
            enquiryId,
            url: page.url(),
            customerClosed,
            messageInputs: await page.getByLabel('Message', { exact: true }).count(),
            sendButtons: await page.getByLabel('Send message', { exact: true }).count(),
            reopenButtons: await page.getByRole('button', { name: 'Reopen', exact: true }).count(),
          };
          if (
            customerClosed?.id !== enquiryId
            || customerClosed.status !== 'closed'
            || customerClosed.can_change_status !== true
            || customerClosed.can_reopen !== true
            || customerClosed.active_enquiry_id !== null
            || actual.messageInputs !== 0
            || actual.sendButtons !== 0
            || actual.reopenButtons !== 1
          ) {
            throw new Error(`Counterpart refresh did not preserve same-ID closed state and customer actions: ${JSON.stringify({
              actual,
              expected: {
                enquiryId,
                status: 'closed',
                can_change_status: true,
                can_reopen: true,
                active_enquiry_id: null,
                messageInputs: 0,
                sendButtons: 0,
                reopenButtons: 1,
              },
            })}`);
          }

          await page.getByRole('button', { name: 'Reopen', exact: true }).click();
          await visible('Conversation status: open');
          ownerClosed = false;
        } finally {
          if (ownerClosed) {
            const restore = await rpc(ownerToken, 'set_product_enquiry_status', { p_enquiry_id: enquiryId, p_status: 'open' });
            if (!restore.ok) {
              cleanupErrors.push(`counterpart refresh state restore: ${JSON.stringify({
                enquiryId,
                status: restore.status,
                body: restore.body,
              })}`);
            }
          }
        }
      });
    } catch (error) {
      testError = error;
    } finally {
      if (snapshot) {
        try {
          await applyFlags(snapshot);
          await refreshFeatureState(snapshot);
        } catch (error) {
          cleanupErrors.push(`flag restoration: ${String(error?.message ?? error)}`);
        }
      }
      try {
        if (rfqIds.length) {
          await privateQuery(`delete from public.rfqs where id in (${rfqIds.map(sqlUuid).join(', ')})`);
        }
        if (shopId) await privateQuery(`delete from public.shops where id = ${sqlUuid(shopId)}`);
        const remaining = await privateQuery(
          `select (select count(*)::int from public.shops where id = ${shopId ? sqlUuid(shopId) : 'null::uuid'}) as shops, `
          + ` (select count(*)::int from public.rfqs where id in (${rfqIds.length ? rfqIds.map(sqlUuid).join(', ') : 'null::uuid'})) as rfqs`,
        );
        if (!Array.isArray(remaining) || remaining[0]?.shops !== 0 || remaining[0]?.rfqs !== 0) {
          throw new Error(`O18 fixture cleanup readback failed: ${JSON.stringify(remaining)}`);
        }
      } catch (error) {
        cleanupErrors.push(`fixture cleanup: ${String(error?.message ?? error)}`);
      }
      try {
        await go('/bookings');
        await page.getByTestId('activity-segment-requests').click();
        await page.getByTestId('my-activity-panel-requests').waitFor();
      } catch (error) {
        cleanupErrors.push(`return to customer activity: ${String(error?.message ?? error)}`);
      }
    }
    if (testError || cleanupErrors.length) {
      throw new Error(`O18 private capability scenario failed: ${JSON.stringify({
        testError: testError ? String(testError?.message ?? testError) : null,
        cleanupErrors,
      })}`);
    }
  });
}
if (PRIVATE_LOCAL_E2E && E2E_FLAGS_ON) {
  await step('MK-BUSINESS-inbox-context', async () => {
    const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
    const sqlUuid = (value) => `${sqlLiteral(value)}::uuid`;
    const privateQuery = async (query) => {
      if (
        !PRIVATE_LOCAL_E2E
        || process.env.DEMO_PROJECT !== '1'
        || process.env.PROJECT_REF !== 'local'
        || process.env.SUPABASE_MGMT_URL !== 'http://127.0.0.1:54399'
      ) {
        throw new Error('MK-BUSINESS fixtures are restricted to the disposable local E2E backend');
      }
      const token = process.env.SUPABASE_ACCESS_TOKEN;
      if (!token) throw new Error('Local Management API token is missing for MK-BUSINESS');
      const response = await fetch('http://127.0.0.1:54399/v1/projects/local/database/query', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'quickserve-oorva-private-e2e',
        },
        body: JSON.stringify({ query }),
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Local database query failed (${response.status}): ${responseText.slice(0, 500)}`);
      }
      let result = [];
      if (responseText.trim()) {
        try {
          result = JSON.parse(responseText);
        } catch {
          throw new Error('Local Management API returned invalid JSON');
        }
      }
      if (result?.error || (Array.isArray(result) && result.some((row) => row?.error))) {
        throw new Error(`Local database query returned an error: ${JSON.stringify(result?.error ?? result)}`);
      }
      return result;
    };
    const rpc = async (token, name, args = {}) => {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      const body = await response.text();
      let data = null;
      try {
        data = body ? JSON.parse(body) : null;
      } catch {
        data = null;
      }
      return { ok: response.ok, status: response.status, body, data };
    };
    const requireRpcSuccess = (name, result) => {
      if (!result.ok) {
        throw new Error(`${name} RPC expected success; actual=${JSON.stringify({ status: result.status, body: result.body })}`);
      }
      return result.data;
    };

    let memberId = null;
    let ownerIds = [];
    let shopIds = [];
    let rfqId = null;
    let testError = null;
    const cleanupErrors = [];
    try {
      if (!localE2eCustomerToken) throw new Error('MK-BUSINESS member session is missing');
      const memberClaims = JSON.parse(Buffer.from(localE2eCustomerToken.split('.')[1], 'base64url').toString('utf8'));
      memberId = memberClaims?.sub;
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(memberId ?? '')) {
        throw new Error(`MK-BUSINESS member token has an invalid subject: ${JSON.stringify({ memberId: memberId ?? null })}`);
      }

      const ownerPhoneInputs = [
        process.env.O28_OWNER_A_PHONE?.trim() ?? '',
        process.env.O28_OWNER_B_PHONE?.trim() ?? '',
      ];
      if (ownerPhoneInputs.some((phone) => !phone)) {
        throw new Error(`MK-BUSINESS local owner phone settings are missing: ${JSON.stringify({
          ownerAConfigured: Boolean(ownerPhoneInputs[0]),
          ownerBConfigured: Boolean(ownerPhoneInputs[1]),
        })}`);
      }
      const ownerPhones = ownerPhoneInputs.map(phoneE164);
      const phoneCollisions = phoneRoleCollisions([
        ['member', PHONE],
        ['shop A owner', ownerPhones[0]],
        ['shop B owner', ownerPhones[1]],
      ]);
      if (phoneCollisions.length) {
        throw new Error(`MK-BUSINESS test identities must be distinct: ${JSON.stringify({ phoneCollisions })}`);
      }
      const ownerPhoneKeys = ownerPhones.flatMap((phone) => {
        const digits = phoneKey(phone);
        return [digits, `91${digits}`];
      });
      const existingOwnerRows = await privateQuery(
        `select id, regexp_replace(phone, '[^0-9]', '', 'g') as phone_digits from auth.users `
        + `where regexp_replace(phone, '[^0-9]', '', 'g') in (${ownerPhoneKeys.map(sqlLiteral).join(', ')})`,
      );
      if (!Array.isArray(existingOwnerRows) || existingOwnerRows.length) {
        throw new Error(`MK-BUSINESS owner identities are not fresh: ${JSON.stringify({ expected: [], actual: existingOwnerRows })}`);
      }
      for (const phone of ownerPhones) {
        const ownerToken = await signInAs(phone);
        let ownerClaims;
        try {
          const ownerPayload = typeof ownerToken === 'string' ? ownerToken.split('.')[1] : '';
          if (!ownerPayload) throw new Error('missing JWT payload');
          ownerClaims = JSON.parse(Buffer.from(ownerPayload, 'base64url').toString('utf8'));
        } catch {
          throw new Error(`MK-BUSINESS owner token payload is invalid: ${JSON.stringify({
            tokenPresent: typeof ownerToken === 'string',
            payloadPresent: typeof ownerToken === 'string' && Boolean(ownerToken.split('.')[1]),
          })}`);
        }
        const ownerId = ownerClaims?.sub;
        if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(ownerId ?? '')) {
          throw new Error(`MK-BUSINESS owner token has an invalid subject: ${JSON.stringify({ ownerId: ownerId ?? null })}`);
        }
        ownerIds.push(ownerId);
      }
      if (new Set(ownerIds).size !== 2 || ownerIds.includes(memberId)) {
        throw new Error(`MK-BUSINESS owner/member identities collided: ${JSON.stringify({ ownerIds, memberId })}`);
      }
      const profileRows = await privateQuery(
        `select id from public.profiles where id in (${[...ownerIds, memberId].map(sqlUuid).join(', ')})`,
      );
      if (!Array.isArray(profileRows) || profileRows.length !== 3) {
        throw new Error(`MK-BUSINESS fixture profiles are missing: ${JSON.stringify({ expectedIds: [...ownerIds, memberId], actual: profileRows })}`);
      }
      const existingShops = await privateQuery(
        `select id, owner_id from public.shops where owner_id in (${ownerIds.map(sqlUuid).join(', ')})`,
      );
      if (!Array.isArray(existingShops) || existingShops.length) {
        throw new Error(`MK-BUSINESS owners already have shops; refusing to overwrite: ${JSON.stringify({ existingShops })}`);
      }
      const existingMemberships = await privateQuery(
        `select owner_id, member_id from public.business_members `
        + `where member_id = ${sqlUuid(memberId)} and owner_id in (${ownerIds.map(sqlUuid).join(', ')})`,
      );
      if (!Array.isArray(existingMemberships) || existingMemberships.length) {
        throw new Error(`MK-BUSINESS memberships are not isolated: ${JSON.stringify({ existingMemberships })}`);
      }
      const categories = await privateQuery(
        "select id from public.product_categories where slug = 'tiles' and active = true limit 1",
      );
      if (!Array.isArray(categories) || !categories[0]?.id) {
        throw new Error(`MK-BUSINESS active Tiles category is missing: ${JSON.stringify(categories)}`);
      }
      const flags = await privateQuery(
        "select key, enabled from public.feature_flags where key in ('merchant_staff', 'products', 'product_rfq')",
      );
      const flagValues = Object.fromEntries((Array.isArray(flags) ? flags : []).map((row) => [row.key, row.enabled]));
      if (flagValues.merchant_staff !== true || flagValues.products !== true || flagValues.product_rfq !== true) {
        throw new Error(`MK-BUSINESS required capabilities are not ON: ${JSON.stringify({ expected: { merchant_staff: true, products: true, product_rfq: true }, actual: flagValues })}`);
      }

      shopIds = [randomUUID(), randomUUID()];
      const shopNames = [
        `${QA_MARKER} O28 shop A ${randomUUID().slice(0, 8)}`,
        `${QA_MARKER} O28 shop B ${randomUUID().slice(0, 8)}`,
      ];
      for (let index = 0; index < shopIds.length; index += 1) {
        await privateQuery(
          'insert into public.shops '
          + '(id, owner_id, name, description, address_line, city, area, lat, lng, delivery_radius_km, offers_delivery, offers_pickup, status) '
          + `values (${sqlUuid(shopIds[index])}, ${sqlUuid(ownerIds[index])}, ${sqlLiteral(shopNames[index])}, `
          + `${sqlLiteral(`${QA_MARKER} isolated O28 shop fixture`)}, ${sqlLiteral('88 QA Demo Market Road')}, `
          + `${sqlLiteral('Vijayawada')}, ${sqlLiteral('Benz Circle')}, 16.5, 80.6, 50, true, true, 'verified')`,
        );
        await privateQuery(
          `insert into public.shop_categories (shop_id, category_id) values (${sqlUuid(shopIds[index])}, ${sqlUuid(categories[0].id)})`,
        );
      }
      await privateQuery(
        'insert into public.business_members (owner_id, member_id, role, active) values '
        + `(${sqlUuid(ownerIds[0])}, ${sqlUuid(memberId)}, 'staff', true), `
        + `(${sqlUuid(ownerIds[1])}, ${sqlUuid(memberId)}, 'staff', true)`,
      );

      const rfqTitle = `${QA_MARKER} O28 two-shop RFQ ${randomUUID()}`;
      const createdRfq = requireRpcSuccess('create_rfq', await rpc(localE2eCustomerToken, 'create_rfq', {
        p_category_id: categories[0].id,
        p_title: rfqTitle,
        p_items: [{ description: 'Two-shop inbox test material', specs: { size: '10x10' }, quantity: 1, unit: 'box' }],
        p_city: 'Vijayawada',
        p_area: 'Benz Circle',
        p_lat: 16.5,
        p_lng: 80.6,
        p_needs_delivery: true,
        p_needed_by: '2099-12-31',
        p_notes: `${QA_MARKER} two-shop inbox context`,
      }));
      rfqId = typeof createdRfq === 'string' ? createdRfq : createdRfq?.id;
      if (typeof rfqId !== 'string' || !rfqId) {
        throw new Error(`MK-BUSINESS create_rfq returned no RFQ ID: ${JSON.stringify(createdRfq)}`);
      }
      const recipients = await privateQuery(
        `select shop_id from public.rfq_recipients where rfq_id = ${sqlUuid(rfqId)}`,
      );
      const recipientIds = Array.isArray(recipients) ? recipients.map((row) => row.shop_id) : [];
      const missingRecipients = shopIds.filter((id) => !recipientIds.includes(id));
      if (missingRecipients.length) {
        throw new Error(`MK-BUSINESS RFQ did not reach both fixture shops: ${JSON.stringify({
          rfqId,
          expectedShopIds: shopIds,
          actualRecipients: recipients,
          missingRecipients,
        })}`);
      }

      const listResponsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/list_my_supplier_rfqs'),
      );
      await go('/merchant-rfqs');
      const listResponse = await listResponsePromise;
      if (!listResponse.ok()) {
        throw new Error(`MK-BUSINESS supplier list failed: ${JSON.stringify({ status: listResponse.status(), body: await listResponse.text() })}`);
      }
      const listRows = await listResponse.json();
      const expectedByShop = new Map(shopIds.map((id, index) => [id, shopNames[index]]));
      const actualRows = Array.isArray(listRows)
        ? listRows.filter((row) => row.rfq_id === rfqId && expectedByShop.has(row.shop_id))
        : [];
      const actualByShop = new Map(actualRows.map((row) => [row.shop_id, row.shop_name]));
      const mismatches = shopIds.filter((id, index) => actualByShop.get(id) !== shopNames[index]);
      if (actualRows.length !== 2 || mismatches.length) {
        throw new Error(`MK-BUSINESS list did not retain both named business contexts: ${JSON.stringify({
          rfqId,
          expected: shopIds.map((shopId, index) => ({ shop_id: shopId, shop_name: shopNames[index] })),
          actual: actualRows.map((row) => ({ shop_id: row.shop_id, shop_name: row.shop_name, rfq_id: row.rfq_id })),
          mismatches,
        })}`);
      }

      for (let index = 0; index < shopIds.length; index += 1) {
        const row = page.getByRole('button', { name: `${rfqTitle}. ${shopNames[index]}` });
        await row.waitFor({ state: 'visible' });
        const detailResponsePromise = page.waitForResponse((response) => {
          const request = response.request();
          if (request.method() !== 'POST' || !new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_supplier_rfq_for_business')) {
            return false;
          }
          try {
            const body = request.postDataJSON();
            return body?.p_rfq_id === rfqId && body?.p_shop_id === shopIds[index];
          } catch {
            return false;
          }
        });
        await row.click();
        const detailResponse = await detailResponsePromise;
        if (!detailResponse.ok()) {
          throw new Error(`MK-BUSINESS detail read failed: ${JSON.stringify({ shopId: shopIds[index], status: detailResponse.status(), body: await detailResponse.text() })}`);
        }
        const detailRows = await detailResponse.json();
        const detail = Array.isArray(detailRows) ? detailRows[0] : detailRows;
        if (detail?.shop_id !== shopIds[index] || detail?.shop_name !== shopNames[index]) {
          throw new Error(`MK-BUSINESS route changed shop identity: ${JSON.stringify({
            rfqId,
            expected: { shop_id: shopIds[index], shop_name: shopNames[index] },
            actual: { shop_id: detail?.shop_id ?? null, shop_name: detail?.shop_name ?? null },
          })}`);
        }
        const detailHeading = page.getByRole('heading', { name: rfqTitle, exact: true });
        await detailHeading.waitFor({ state: 'visible' });
        const detailHeaderText = await detailHeading.locator('xpath=..').innerText();
        if (!detailHeaderText.includes(shopNames[index])) {
          throw new Error(`MK-BUSINESS detail header lost business context: ${JSON.stringify({
            expectedShopName: shopNames[index],
            actualHeaderText: detailHeaderText,
          })}`);
        }
        if (new URL(page.url()).pathname !== `/rfq/merchant/${rfqId}`) {
          throw new Error(`MK-BUSINESS detail route used a different RFQ: ${JSON.stringify({ expectedRfqId: rfqId, actualUrl: page.url(), shopId: shopIds[index] })}`);
        }
        await go('/merchant-rfqs');
      }
    } catch (error) {
      testError = error;
    } finally {
      try {
        if (rfqId) await privateQuery(`delete from public.rfqs where id = ${sqlUuid(rfqId)}`);
        if (memberId && ownerIds.length) {
          await privateQuery(
            `delete from public.business_members where member_id = ${sqlUuid(memberId)} `
            + `and owner_id in (${ownerIds.map(sqlUuid).join(', ')})`,
          );
        }
        if (shopIds.length) {
          await privateQuery(`delete from public.shops where id in (${shopIds.map(sqlUuid).join(', ')})`);
        }
        const remaining = await privateQuery(
          `select (select count(*)::int from public.shops where id in (${shopIds.length ? shopIds.map(sqlUuid).join(', ') : 'null::uuid'})) as shops, `
          + ` (select count(*)::int from public.rfqs where id = ${rfqId ? sqlUuid(rfqId) : 'null::uuid'}) as rfqs, `
          + ` (select count(*)::int from public.business_members where member_id = ${memberId ? sqlUuid(memberId) : 'null::uuid'} `
          + `and owner_id in (${ownerIds.length ? ownerIds.map(sqlUuid).join(', ') : 'null::uuid'})) as memberships`,
        );
        if (!Array.isArray(remaining) || remaining[0]?.shops !== 0 || remaining[0]?.rfqs !== 0 || remaining[0]?.memberships !== 0) {
          throw new Error(`MK-BUSINESS fixture cleanup readback failed: ${JSON.stringify(remaining)}`);
        }
      } catch (error) {
        cleanupErrors.push(String(error?.message ?? error));
      }
      try {
        await go('/bookings');
        await page.getByTestId('activity-segment-requests').click();
        await page.getByTestId('my-activity-panel-requests').waitFor();
      } catch (error) {
        cleanupErrors.push(`return to customer activity: ${String(error?.message ?? error)}`);
      }
    }
    if (testError || cleanupErrors.length) {
      throw new Error(`MK-BUSINESS inbox context failed: ${JSON.stringify({
        testError: testError ? String(testError?.message ?? testError) : null,
        cleanupErrors,
      })}`);
    }
  });
}
if (PRIVATE_LOCAL_E2E && E2E_FLAGS_ON) {
  const o27Context = await browser.newContext({
    ...devices['iPhone 15'],
    geolocation: { latitude: 16.4995, longitude: 80.656 },
    permissions: ['geolocation'],
    timezoneId: 'Asia/Kolkata',
  });
  const o27Page = await o27Context.newPage();
  o27Page.setDefaultTimeout(20000);
  o27Page.on('pageerror', (e) => pageErrors.push(`[O27 ${o27Page.url()}] ${e.message}`));
  o27Page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`[O27 ${o27Page.url()}] ${m.text()}`);
  });
  recordHttpFailures('O27 owner', o27Page);

  try {
    await step('MK-WORKSPACE-catalogue-before-after', async () => {
      const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
      const sqlUuid = (value) => `${sqlLiteral(value)}::uuid`;
      const privateQuery = async (query) => {
        if (
          !PRIVATE_LOCAL_E2E
          || process.env.DEMO_PROJECT !== '1'
          || process.env.PROJECT_REF !== 'local'
          || process.env.SUPABASE_MGMT_URL !== 'http://127.0.0.1:54399'
        ) {
          throw new Error('O27 fixtures and flag changes are restricted to the disposable local E2E backend');
        }
        const token = process.env.SUPABASE_ACCESS_TOKEN;
        if (!token) throw new Error('Local Management API token is missing for O27');
        const response = await fetch('http://127.0.0.1:54399/v1/projects/local/database/query', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'quickserve-oorva-private-e2e',
          },
          body: JSON.stringify({ query }),
        });
        const responseText = await response.text();
        if (!response.ok) {
          throw new Error(`Local database query failed (${response.status}): ${responseText.slice(0, 500)}`);
        }
        let result = [];
        if (responseText.trim()) {
          try {
            result = JSON.parse(responseText);
          } catch {
            throw new Error('Local Management API returned invalid JSON for O27');
          }
        }
        if (result?.error || (Array.isArray(result) && result.some((row) => row?.error))) {
          throw new Error(`Local O27 database query returned an error: ${JSON.stringify(result?.error ?? result)}`);
        }
        return result;
      };
      const rpc = async (token, name, args = {}) => {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
          method: 'POST',
          headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(args),
        });
        const body = await response.text();
        let data = null;
        try {
          data = body ? JSON.parse(body) : null;
        } catch {
          data = null;
        }
        return { ok: response.ok, status: response.status, body, data };
      };
      const requireRpcSuccess = (name, result) => {
        if (!result.ok) {
          throw new Error(`${name} RPC expected success; actual=${JSON.stringify({ status: result.status, body: result.body })}`);
        }
        return result.data;
      };
      const userIdFromToken = (token, role) => {
        const payload = token.split('.')[1];
        if (!payload) throw new Error(`O27 ${role} token has no JWT payload`);
        let claims;
        try {
          claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        } catch {
          throw new Error(`O27 ${role} token payload is invalid JSON`);
        }
        const id = claims?.sub;
        if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) {
          throw new Error(`O27 ${role} token has an invalid subject: ${JSON.stringify({ id: id ?? null })}`);
        }
        return id;
      };
      const privateFlags = async () => {
        const rows = await privateQuery(
          "select key, enabled from public.feature_flags where key in ('oorva_brand', 'oorva_merchant_shop_ux', 'products', 'product_enquiries')",
        );
        if (!Array.isArray(rows) || rows.length !== 4) {
          throw new Error(`O27 feature flag rows are missing: ${JSON.stringify(rows)}`);
        }
        return Object.fromEntries(rows.map((row) => [row.key, row.enabled]));
      };
      const applyLocalFlags = async (values) => {
        const payload = JSON.stringify(values);
        if (payload.includes('$flags$')) throw new Error('Unsafe O27 feature flag snapshot payload');
        await privateQuery(
          'update public.feature_flags f set enabled = v.value::boolean, updated_at = now() '
          + `from json_each_text($flags$${payload}$flags$::json) v where f.key = v.key`,
        );
        const actual = await privateFlags();
        const mismatches = Object.fromEntries(
          Object.entries(values)
            .filter(([key, value]) => actual[key] !== value)
            .map(([key, value]) => [key, { expected: value, actual: actual[key] }]),
        );
        if (Object.keys(mismatches).length) {
          throw new Error(`O27 local feature flag update did not persist: ${JSON.stringify({ mismatches, actual })}`);
        }
      };
      const refreshOwnerFeatures = async () => {
        const responsePromise = o27Page.waitForResponse((response) =>
          response.request().method() === 'POST'
          && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_app_features'),
        );
        await o27Page.reload();
        const response = await responsePromise;
        if (!response.ok()) {
          throw new Error(`O27 get_app_features failed after local toggle (${response.status()}): ${await response.text()}`);
        }
        await o27Page.waitForLoadState('networkidle').catch(() => undefined);
      };

      let flagSnapshot = null;
      let ownerId = null;
      let customerId = null;
      let shopId = null;
      let productId = null;
      let enquiryId = null;
      let identitySetWasFresh = false;
      let ownerToken = null;
      let customerToken = null;
      let phoneKeys = [];
      let testError = null;
      const cleanupErrors = [];

      try {
        const ownerPhoneInput = process.env.O27_OWNER_PHONE?.trim() ?? '';
        const customerPhoneInput = process.env.O27_CUSTOMER_PHONE?.trim() ?? '';
        if (!ownerPhoneInput || !customerPhoneInput) {
          throw new Error(`O27 local test phone settings are missing: ${JSON.stringify({
            ownerConfigured: Boolean(ownerPhoneInput),
            customerConfigured: Boolean(customerPhoneInput),
          })}`);
        }
        const ownerPhone = phoneE164(ownerPhoneInput);
        const customerPhone = phoneE164(customerPhoneInput);
        const collisions = phoneRoleCollisions([
          ['O27 shop owner', ownerPhone],
          ['O27 enquiry customer', customerPhone],
          ['E2E_CUSTOMER_PHONE', PHONE],
          ['NEW_PRO_PHONE', NEW_PRO_PHONE],
          ['RAVI_SIGN_IN', RAVI_E2E_PHONE],
          ['GUEST_E2E_PHONE', GUEST_E2E_PHONE],
          ['ADMIN_E2E_PHONE', ADMIN_E2E_PHONE ?? ''],
          ['O28_OWNER_A_PHONE', process.env.O28_OWNER_A_PHONE ?? ''],
          ['O28_OWNER_B_PHONE', process.env.O28_OWNER_B_PHONE ?? ''],
        ]);
        if (collisions.length) {
          throw new Error(`O27 identities must be distinct from other E2E roles: ${JSON.stringify({ collisions })}`);
        }
        const phoneDigits = [ownerPhone, customerPhone].map(phoneKey);
        phoneKeys = phoneDigits.flatMap((digits) => [digits, `91${digits}`]);
        const existingUsers = await privateQuery(
          `select id, regexp_replace(phone, '[^0-9]', '', 'g') as phone_digits from auth.users `
          + `where regexp_replace(phone, '[^0-9]', '', 'g') in (${phoneKeys.map(sqlLiteral).join(', ')})`,
        );
        if (!Array.isArray(existingUsers) || existingUsers.length) {
          throw new Error(`O27 test identities are not fresh: ${JSON.stringify({ expected: [], actual: existingUsers })}`);
        }
        identitySetWasFresh = true;

        await goOn(o27Page, '/login');
        await sendOtpFromUi(o27Page, ownerPhoneInput, 'O27-shop-owner');
        await o27Page.getByLabel('6-digit verification code').fill(OTP);
        await o27Page.waitForURL((url) => new URL(url).pathname === '/role');
        await o27Page.getByText('Welcome to QuickServe', { exact: true }).waitFor({ state: 'visible' });
        await o27Page.getByLabel('Your name').fill(`${QA_MARKER} O27 shop owner`);
        await o27Page.getByRole('radio', { name: /^I need a service\./ }).click();
        await o27Page.getByText('Continue', { exact: true }).last().click();
        await o27Page.waitForURL((url) => ['/', '/dashboard'].includes(new URL(url).pathname));
        ownerToken = await o27Page.evaluate(() => {
          for (const key of Object.keys(localStorage)) {
            try {
              const value = JSON.parse(localStorage.getItem(key) ?? 'null');
              const sessions = [value, value?.currentSession, value?.session, value?.data?.session];
              const session = sessions.find((candidate) => typeof candidate?.access_token === 'string');
              if (session) return session.access_token;
            } catch {
              continue;
            }
          }
          return null;
        });
        if (!ownerToken) throw new Error('O27 owner login did not persist a browser access token');
        ownerId = userIdFromToken(ownerToken, 'shop owner');
        customerToken = await signInAs(customerPhone);
        customerId = userIdFromToken(customerToken, 'enquiry customer');
        if (ownerId === customerId) throw new Error(`O27 owner and customer IDs collided: ${JSON.stringify({ ownerId, customerId })}`);

        const identityRows = await privateQuery(
          `select id from auth.users where id in (${sqlUuid(ownerId)}, ${sqlUuid(customerId)})`,
        );
        const profileRows = await privateQuery(
          `select id from public.profiles where id in (${sqlUuid(ownerId)}, ${sqlUuid(customerId)})`,
        );
        if (!Array.isArray(identityRows) || identityRows.length !== 2 || !Array.isArray(profileRows) || profileRows.length !== 2) {
          throw new Error(`O27 fresh auth/profile identities are incomplete: ${JSON.stringify({ identityRows, profileRows })}`);
        }
        const existingShop = requireRpcSuccess('get_my_shop before O27 fixture', await rpc(ownerToken, 'get_my_shop'));
        const existingShopRows = Array.isArray(existingShop) ? existingShop.filter(Boolean) : existingShop ? [existingShop] : [];
        if (existingShopRows.length) {
          throw new Error(`O27 owner already has a shop; refusing to reuse it: ${JSON.stringify(existingShopRows)}`);
        }

        flagSnapshot = await privateFlags();
        if (flagSnapshot.oorva_brand !== false || flagSnapshot.oorva_merchant_shop_ux !== false) {
          throw new Error(`O27 local baseline must start with brand and leaf OFF: ${JSON.stringify({ actual: flagSnapshot })}`);
        }
        if (flagSnapshot.products !== true || flagSnapshot.product_enquiries !== true) {
          throw new Error(`O27 local capability flags must be ON for product/inbox fixtures: ${JSON.stringify({ actual: flagSnapshot })}`);
        }

        await applyLocalFlags({ oorva_brand: false, oorva_merchant_shop_ux: false });
        await goOn(o27Page, '/merchant-shop');
        await o27Page.getByText('Set up your shop', { exact: true }).waitFor({ state: 'visible' });
        const setupButton = o27Page.getByRole('button', { name: 'Save shop details', exact: true });
        await setupButton.waitFor({ state: 'visible' });
        if (!(await setupButton.isEnabled()) || await o27Page.getByText(/^Product catalogue \(/).count()) {
          throw new Error(`New shop setup was not the primary action with both brand/leaf OFF: ${JSON.stringify({
            saveEnabled: await setupButton.isEnabled(),
            body: await o27Page.locator('body').innerText(),
          })}`);
        }
        await applyLocalFlags({ oorva_brand: true, oorva_merchant_shop_ux: true });
        await refreshOwnerFeatures();
        await o27Page.getByText('Set up your shop', { exact: true }).waitFor({ state: 'visible' });
        await o27Page.getByRole('button', { name: 'Save shop details', exact: true }).waitFor({ state: 'visible' });

        const categoryRows = await privateQuery(
          "select id from public.product_categories where slug = 'tiles' and active = true limit 1",
        );
        if (!Array.isArray(categoryRows) || !categoryRows[0]?.id) {
          throw new Error(`O27 active Tiles category is missing: ${JSON.stringify(categoryRows)}`);
        }
        shopId = randomUUID();
        productId = randomUUID();
        const shopName = `${QA_MARKER} O27 isolated shop ${randomUUID().slice(0, 8)}`;
        const productName = `${QA_MARKER} O27 catalogue item ${randomUUID().slice(0, 8)}`;
        await privateQuery(
          'insert into public.shops '
          + '(id, owner_id, name, description, address_line, city, area, lat, lng, delivery_radius_km, offers_delivery, offers_pickup, status) '
          + `values (${sqlUuid(shopId)}, ${sqlUuid(ownerId)}, ${sqlLiteral(shopName)}, `
          + `${sqlLiteral(`${QA_MARKER} isolated O27 local-only shop`)}, ${sqlLiteral('88 QA O27 Market Road')}, `
          + `${sqlLiteral('Vijayawada')}, ${sqlLiteral('Benz Circle')}, 16.5, 80.6, 20, true, true, 'verified')`,
        );
        await privateQuery(
          `insert into public.shop_categories (shop_id, category_id) values (${sqlUuid(shopId)}, ${sqlUuid(categoryRows[0].id)})`,
        );
        await privateQuery(
          'insert into public.products (id, shop_id, category_id, name, brand, model, description, specs, unit, active, in_stock) '
          + `values (${sqlUuid(productId)}, ${sqlUuid(shopId)}, ${sqlUuid(categoryRows[0].id)}, `
          + `${sqlLiteral(productName)}, 'O27', 'Workspace', ${sqlLiteral(`${QA_MARKER} O27 local catalogue product`)}, `
          + `${sqlLiteral(JSON.stringify({ size: '10x10' }))}::jsonb, 'box', true, true)`,
        );
        const ownerShopResult = requireRpcSuccess('get_my_shop O27 fixture read', await rpc(ownerToken, 'get_my_shop'));
        const ownerShop = Array.isArray(ownerShopResult) ? ownerShopResult[0] : ownerShopResult;
        if (ownerShop?.id !== shopId || ownerShop?.business_role !== 'owner') {
          throw new Error(`O27 shop owner readback mismatched: ${JSON.stringify({
            expected: { id: shopId, business_role: 'owner' },
            actual: ownerShop,
          })}`);
        }

        const assertExistingShopOrder = async (workspaceEnabled) => {
          const body = await o27Page.locator('body').innerText();
          const catalogueIndex = body.indexOf('Product catalogue (1/500)');
          const detailsIndex = body.indexOf('Shop details');
          const shopNameIndex = body.indexOf(shopName);
          const editDetailsCount = await o27Page.getByRole('button', { name: 'Edit shop details', exact: true }).count();
          const shopNameFieldCount = await o27Page.getByLabel('Shop name', { exact: true }).count();
          const actual = { shopNameIndex, catalogueIndex, detailsIndex, editDetailsCount, shopNameFieldCount };
          if (shopNameIndex < 0 || catalogueIndex < 0 || detailsIndex < 0) {
            throw new Error(`O27 existing shop sections are missing: ${JSON.stringify({ actual, body })}`);
          }
          if (workspaceEnabled) {
            if (!(shopNameIndex < catalogueIndex && catalogueIndex < detailsIndex) || editDetailsCount !== 1 || shopNameFieldCount !== 0) {
              throw new Error(`O27 enabled existing-shop order is wrong: ${JSON.stringify({ actual, expected: 'readiness < catalogue < collapsed details' })}`);
            }
          } else if (!(shopNameIndex < detailsIndex && detailsIndex < catalogueIndex) || editDetailsCount !== 0 || shopNameFieldCount < 1) {
            throw new Error(`O27 legacy existing-shop order is wrong: ${JSON.stringify({ actual, expected: 'readiness < expanded details < catalogue' })}`);
          }
        };

        await goOn(o27Page, '/merchant-shop');
        await o27Page.getByText(productName, { exact: true }).waitFor({ state: 'visible' });
        await applyLocalFlags({ oorva_brand: false, oorva_merchant_shop_ux: false });
        await refreshOwnerFeatures();
        await assertExistingShopOrder(false);

        await applyLocalFlags({ oorva_brand: true, oorva_merchant_shop_ux: false });
        await refreshOwnerFeatures();
        await assertExistingShopOrder(false);

        await applyLocalFlags({ oorva_brand: false, oorva_merchant_shop_ux: true });
        await refreshOwnerFeatures();
        await assertExistingShopOrder(false);

        await applyLocalFlags({ oorva_brand: true, oorva_merchant_shop_ux: true });
        await refreshOwnerFeatures();
        await assertExistingShopOrder(true);

        const enquiryText = `${QA_MARKER} O27 unique customer asks about catalogue ${randomUUID()}`;
        const createdEnquiry = requireRpcSuccess(
          'start_product_enquiry O27 fixture',
          await rpc(customerToken, 'start_product_enquiry', { p_shop_id: shopId, p_product_id: productId, p_body: enquiryText }),
        );
        enquiryId = Array.isArray(createdEnquiry) ? createdEnquiry[0]?.id : createdEnquiry?.id ?? createdEnquiry;
        if (typeof enquiryId !== 'string' || !enquiryId) {
          throw new Error(`O27 start_product_enquiry returned no ID: ${JSON.stringify(createdEnquiry)}`);
        }
        const inboxRows = requireRpcSuccess('list_shop_product_enquiries O27 readback', await rpc(ownerToken, 'list_shop_product_enquiries'));
        const inbox = Array.isArray(inboxRows) ? inboxRows.find((row) => row?.id === enquiryId) : null;
        if (
          !inbox
          || inbox.shop_id !== shopId
          || inbox.shop_name !== shopName
          || inbox.product_name !== productName
          || Number(inbox.shop_unread) < 1
        ) {
          throw new Error(`O27 inbox API lost business-labelled unread work: ${JSON.stringify({
            expected: { id: enquiryId, shop_id: shopId, shop_name: shopName, product_name: productName, shop_unread: 1 },
            actual: inbox,
            rows: inboxRows,
          })}`);
        }
        await goOn(o27Page, '/merchant-enquiries');
        await o27Page.getByText('Shop enquiries', { exact: true }).waitFor({ state: 'visible' });
        const inboxItem = o27Page.getByRole('button').filter({ hasText: productName }).first();
        await inboxItem.waitFor({ state: 'visible' });
        const inboxItemText = await inboxItem.innerText();
        const inboxBody = await o27Page.locator('body').innerText();
        const workIndex = inboxBody.indexOf(productName);
        const manageIndex = inboxBody.indexOf('Manage my shop');
        if (
          !inboxItemText.includes(shopName)
          || !/\b1 new\b/.test(inboxItemText)
          || workIndex < 0
          || manageIndex <= workIndex
        ) {
          throw new Error(`O27 inbox did not place business-labelled unread work before the secondary Manage link: ${JSON.stringify({
            expected: { shopName, productName, unread: '1 new', manageAfterWork: true },
            actual: { inboxItemText, workIndex, manageIndex, inboxBody },
          })}`);
        }
      } catch (error) {
        testError = error;
      } finally {
        if (flagSnapshot) {
          try {
            await applyLocalFlags(flagSnapshot);
            await refreshOwnerFeatures();
            const restored = await privateFlags();
            const mismatches = Object.fromEntries(
              Object.entries(flagSnapshot)
                .filter(([key, value]) => restored[key] !== value)
                .map(([key, value]) => [key, { expected: value, actual: restored[key] }]),
            );
            if (Object.keys(mismatches).length) {
              throw new Error(`O27 local flag restoration mismatch: ${JSON.stringify({ mismatches, restored })}`);
            }
          } catch (error) {
            cleanupErrors.push(`local feature flag restore: ${String(error?.message ?? error)}`);
          }
        }
        try {
          if (shopId) await privateQuery(`delete from public.shops where id = ${sqlUuid(shopId)}`);
          if (identitySetWasFresh && phoneKeys.length) {
            const usersByPhone = await privateQuery(
              `select id from auth.users where regexp_replace(phone, '[^0-9]', '', 'g') in (${phoneKeys.map(sqlLiteral).join(', ')})`,
            );
            const cleanupIds = [...new Set([
              ownerId,
              customerId,
              ...(Array.isArray(usersByPhone) ? usersByPhone.map((row) => row.id) : []),
            ].filter(Boolean))];
            if (cleanupIds.length) {
              await privateQuery(`delete from auth.users where id in (${cleanupIds.map(sqlUuid).join(', ')})`);
            }
            const idsSql = cleanupIds.length ? cleanupIds.map(sqlUuid).join(', ') : 'null::uuid';
            const shopSql = shopId ? sqlUuid(shopId) : 'null::uuid';
            const productSql = productId ? sqlUuid(productId) : 'null::uuid';
            const enquirySql = enquiryId ? sqlUuid(enquiryId) : 'null::uuid';
            const remaining = await privateQuery(
              `select (select count(*)::int from auth.users where id in (${idsSql})) as users, `
              + `(select count(*)::int from public.profiles where id in (${idsSql})) as profiles, `
              + `(select count(*)::int from public.shops where id = ${shopSql}) as shops, `
              + `(select count(*)::int from public.products where id = ${productSql}) as products, `
              + `(select count(*)::int from public.product_enquiries where id = ${enquirySql}) as enquiries, `
              + `(select count(*)::int from public.product_enquiry_messages where enquiry_id = ${enquirySql}) as messages`,
            );
            if (
              !Array.isArray(remaining)
              || Number(remaining[0]?.users) !== 0
              || Number(remaining[0]?.profiles) !== 0
              || Number(remaining[0]?.shops) !== 0
              || Number(remaining[0]?.products) !== 0
              || Number(remaining[0]?.enquiries) !== 0
              || Number(remaining[0]?.messages) !== 0
            ) {
              throw new Error(`O27 local fixture cleanup readback failed: ${JSON.stringify(remaining)}`);
            }
          }
        } catch (error) {
          cleanupErrors.push(`local fixture cleanup: ${String(error?.message ?? error)}`);
        }
      }
      if (testError || cleanupErrors.length) {
        throw new Error(`MK-WORKSPACE catalogue before/after failed: ${JSON.stringify({
          testError: testError ? String(testError?.message ?? testError) : null,
          cleanupErrors,
        })}`);
      }
    }, o27Page);
  } finally {
    try {
      await o27Context.close();
    } catch (error) {
      failures.push(`O27 owner context cleanup: ${String(error?.message ?? error)}`);
    }
  }
}
await step('my-activity-sports-segment', async () => {
  const sportsBookingsResponsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST'
    && response.url().includes('/rest/v1/rpc/list_my_customer_sports_bookings'),
  );
  await page.getByTestId('activity-segment-sports').click();
  const sportsPanel = page.getByTestId('my-activity-panel-sports');
  await sportsPanel.waitFor();
  const response = await sportsBookingsResponsePromise;
  if (!response.ok()) {
    throw new Error(`sports booking list failed: ${JSON.stringify({ bookingId: sportsScenarioBookingId, status: response.status(), body: await response.text() })}`);
  }
  const rows = await response.json();
  const booking = Array.isArray(rows)
    ? rows.find((row) => row.id === sportsScenarioBookingId)
    : null;
  const expected = {
    id: sportsScenarioBookingId,
    venue_name: 'Benz Circle Demo Badminton Courts',
    activity_name: 'Badminton',
    resource_name: 'Demo Court 1',
    status: 'requested',
    payment_mode: 'pay_at_venue',
    price_paise: 30000,
    customer_fee_paise: 0,
    total_paise: 30000,
    participants: 1,
    paid_at: null,
    refund_paise: 0,
  };
  const actual = booking ? {
    id: booking.id,
    venue_name: booking.venue_name,
    activity_name: booking.activity_name,
    resource_name: booking.resource_name,
    status: booking.status,
    payment_mode: booking.payment_mode,
    price_paise: booking.price_paise,
    customer_fee_paise: booking.customer_fee_paise,
    total_paise: booking.total_paise,
    participants: booking.participants,
    paid_at: booking.paid_at,
    refund_paise: booking.refund_paise,
    starts_at: booking.starts_at,
    ends_at: booking.ends_at,
  } : null;
  const fixtureMismatch = !actual
    || Object.entries(expected).some(([key, value]) => actual[key] !== value)
    || !Number.isFinite(Date.parse(actual.starts_at))
    || !Number.isFinite(Date.parse(actual.ends_at));
  if (fixtureMismatch) {
    const availableRows = Array.isArray(rows)
      ? rows.map((row) => ({
          id: row.id,
          venue_name: row.venue_name,
          activity_name: row.activity_name,
          resource_name: row.resource_name,
          status: row.status,
          payment_mode: row.payment_mode,
          price_paise: row.price_paise,
          total_paise: row.total_paise,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
        }))
      : rows;
    throw new Error(`sports booking fixture mismatch: ${JSON.stringify({ expected, actual, availableRows })}`);
  }

  const timeRange = await page.evaluate((row) => {
    const format = (value) => new Date(value).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${format(row.starts_at)} – ${format(row.ends_at)}`;
  }, booking);
  const accessibleName = `View sports booking for ${booking.venue_name}, ${booking.activity_name}, ${booking.resource_name}, ${timeRange}`;
  const bookingCard = sportsPanel.getByRole('button', { name: accessibleName, exact: true });
  const cardCount = await bookingCard.count();
  const cardText = cardCount === 1 ? await bookingCard.innerText() : null;
  const expectedVisible = ['Waiting for venue', '1 participant', '₹300', 'Pay at venue', timeRange];
  const missingVisible = expectedVisible.filter((value) => !cardText?.includes(value));
  const cards = await sportsPanel.getByRole('button').evaluateAll((elements) =>
    elements.map((element) => ({
      accessibleName: element.getAttribute('aria-label'),
      text: element.innerText,
    })),
  );
  if (cardCount !== 1 || missingVisible.length > 0 || /Refund requested|Paid online/i.test(cardText ?? '')) {
    throw new Error(`sports booking card mismatch: ${JSON.stringify({
      bookingId: sportsScenarioBookingId,
      expected,
      actual,
      expectedAccessibleName: accessibleName,
      cardCount,
      cardText,
      missingVisible,
      cards,
    })}`);
  }
});
await step('my-activity-services-segment', async () => {
  await page.getByTestId('activity-segment-services').click();
  await page.getByTestId('my-activity-panel-services').waitFor();
  await visible('Active');
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
    if (n === 1) {
      await visible('Payment pending');
      await visible('Ask support a question');
      if (await page.getByRole('button', { name: 'Call', exact: true }).count()) {
        throw new Error('call button should be hidden until masked calling is available');
      }
    }
    if (n === 10) await visible('Pauses payment to the pro while support reviews');
  });
  if (scrolled) await optional(`booking-fc${n}-scrolled`, () => snapScrolled(`booking-fc${n}-${label}-scrolled`, 900));
}
await step('booking-fc3-cancel-copy', async () => {
  await go(`/booking/${seeded('fc', 3)}`);
  await page.getByText(/^QS-[0-9A-F]{8} · /).first().waitFor();
  await page.getByRole('button', { name: 'Cancel booking', exact: true }).first().click();
  await visible('Cancel this booking?');
  const previewCopy = page.getByText(/(?:You'll be refunded|will be charged)/).last();
  await previewCopy.waitFor({ state: 'visible' });
  const actual = (await previewCopy.innerText()).trim();
  if (!actual.includes('₹')) {
    throw new Error(`expected server cancellation preview to include ₹: ${JSON.stringify({ actual })}`);
  }
  await page.getByRole('button', { name: 'Keep booking', exact: true }).click();
});
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
  const token = await signInAs(RAVI_E2E_PHONE);
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
  const coinsConfigResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/rest/v1/rpc/get_coins_config'),
  );
  await go('/account');
  const response = await coinsConfigResponse;
  const config = response.ok() ? await response.json() : null;
  if (config?.coins_earning_enabled === false && config.coins_redemption_enabled === false) {
    skipStep('coins-wallet', 'Earning and redemption are disabled; the wallet entry is correctly hidden.');
    return;
  }
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
  ['dark-home', '/', E2E_FLAGS_ON ? 'Home services' : 'Choose a category'],
  ['dark-category', '/category/ac-repair?name=AC%20Repair', null],
  ['dark-provider-detail', `/provider/${RAVI}`, 'Ratings & reviews'],
  ['dark-booking-quote', `/booking/${seeded('fc', 6)}`, null],
  ['dark-bookings', '/bookings', 'My activity'],
  ['dark-location-picker', '/location', 'Saved addresses'],
  ['dark-me-customer', '/account', 'Switch to provider mode'],
]) {
  await step(name, async () => {
    await go(path);
    if (wait) await visible(wait);
    else await page.getByText(/^QS-[0-9A-F]{8} · |verified pros? near|pros nearby yet/).first().waitFor();
    if (name === 'dark-home' && E2E_FLAGS_ON) {
      await page.getByText(/Search services, shops, venues/).first().waitFor({ state: 'visible' });
      const legacyHomeVisible = await page.getByText('Choose a category', { exact: true }).first().isVisible().catch(() => false);
      if (legacyHomeVisible) {
        throw new Error(`dark home_v2 ON still rendered the legacy category header: ${JSON.stringify({
          legacyHomeVisible,
          url: page.url(),
          body: await page.locator('body').innerText(),
        })}`);
      }
    }
  });
}
await optional('dark-home-top-rated', async () => {
  await go('/');
  await page.getByText(TOP_RATED_HOME_TITLE, { exact: true }).first().scrollIntoViewIfNeeded();
  await page.mouse.move(195, 420);
  await page.mouse.wheel(0, 200);
  await snap('dark-home-top-rated');
});
await step('dark-top-rated-see-all', async () => {
  await go('/top-rated');
  await page.getByRole('heading', { name: TOP_RATED_DETAIL_TITLE, exact: true }).first().waitFor({ state: 'visible' });
  await page.getByText(TOP_RATED_RANKING_SUMMARY).first().waitFor({ state: 'visible' });
});
await page.emulateMedia({ colorScheme: 'light' });
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

// ---------- Provider signup/onboarding or returning-provider dashboard verification (docs/08) ----------
// A 1x1 PNG is enough: the app resizes it client-side before uploading to the public avatars/portfolio buckets.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function chooseImage(trigger) {
  const chooser = page.waitForEvent('filechooser');
  await trigger();
  await (await chooser).setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
}
let newProReturningProvider = false;
const skipOnboardingStepForReturningProvider = (name) => {
  if (!newProReturningProvider) return false;
  skipStep(name, 'Returning provider onboarding cannot be replayed.');
  return true;
};
await step('new-pro-login', async () => {
  await go('/login');
  await sendOtpFromUi(page, NEW_PRO_PHONE, 'new-provider');
  await page.getByLabel('6-digit verification code').fill(OTP);
  const destination = await Promise.race([
    page.waitForURL((url) => new URL(url).pathname === '/dashboard').then(() => 'dashboard'),
    visible('Welcome to QuickServe').then(() => 'role'),
  ]);
  if (destination === 'dashboard') {
    newProReturningProvider = true;
    console.log('  Returning provider detected after login; onboarding form steps will be skipped.');
  }
});
await step('new-pro-role', async () => {
  if (newProReturningProvider) {
    console.log('  Returning provider is already on /dashboard; the role screen is not shown.');
    return;
  }
  await optional('name', () => page.getByLabel('Your name').first().fill('Kiran Test Pro', { timeout: 3000 }));
  await page.getByLabel(/^I provide services\./).first().click();
  const existingProvider = await currentUserRpc('get_my_provider');
  console.log(`  get_my_provider: ${existingProvider ? 'provider exists' : 'no provider record'}`);
  if (existingProvider) {
    newProReturningProvider = true;
    await page.reload();
    await go('/account');
    await visible('Manage jobs and earnings');
    await page.getByText('Switch to provider mode', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === '/dashboard');
    console.log('  Returning provider confirmed by get_my_provider and switched through the account UI.');
    return;
  }
  await currentUserRpc('save_provider_basics', {
    p_full_name: 'Kiran Test Pro',
    p_avatar_url: null,
    p_gender: null,
    p_languages: ['English'],
    p_years_experience: 6,
    p_bio: 'AC technician for 6 years. Split and window AC service, gas refills and installations.',
  });
  console.log('  Provider role initialized through save_provider_basics RPC.');
  if (!(await currentUserRpc('get_my_provider'))) {
    throw new Error('save_provider_basics completed but get_my_provider still returned no provider record.');
  }
  await page.reload();
  await go('/onboarding');
  await visible('Tell customers about you');
});
await step('new-pro-basics', async () => {
  if (skipOnboardingStepForReturningProvider('new-pro-basics')) return;
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
  if (skipOnboardingStepForReturningProvider('new-pro-services')) return;
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
  if (skipOnboardingStepForReturningProvider('new-pro-area')) return;
  await page.getByText('Use my current location', { exact: true }).first().click();
  await page.getByText(/^Covers about /).first().waitFor();
  const city = page.getByLabel('City').first();
  if (!(await city.inputValue())) await city.fill('Vijayawada');
  await page.getByText('8 km', { exact: true }).first().click();
  await page.getByText('Save & continue', { exact: true }).first().click();
  await visible('When can you work?');
});
await step('new-pro-hours', async () => {
  if (skipOnboardingStepForReturningProvider('new-pro-hours')) return;
  await page.getByText('Mon–Sat, 9 am–7 pm', { exact: true }).first().click();
  await page.getByText('9 am–7 pm', { exact: true }).first().waitFor();
  await page.getByText('Save & continue', { exact: true }).first().click();
  await visible('Your work, links & credentials');
});
await step('new-pro-portfolio', async () => {
  if (skipOnboardingStepForReturningProvider('new-pro-portfolio')) return;
  await chooseImage(async () => {
    await page.getByText('Add work photo', { exact: true }).first().click();
    await page.getByText('Choose from gallery', { exact: true }).first().click();
  });
  await page.getByText('Work photos (1/12)', { exact: true }).first().waitFor();
  await page.getByText('Continue', { exact: true }).first().click();
  await visible('Payouts & verification');
});
await step('new-pro-payouts', async () => {
  if (skipOnboardingStepForReturningProvider('new-pro-payouts')) return;
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
  if (skipOnboardingStepForReturningProvider('new-pro-submit')) return;
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
  const adminPhone = getAdminPhone();
  await page.getByLabel('Mobile number, India plus 91').fill(adminPhone.slice(3));
  await page.getByText('Send OTP', { exact: true }).click();
  await visible('Verify your number');
  await page.getByLabel('6-digit verification code').fill(OTP);
  await page.waitForURL((u) => ['/', '/dashboard'].includes(new URL(u).pathname));
  await grantE2eAdminMembership(adminPhone);
  const accountPath = new URL(page.url()).pathname === '/dashboard' ? '/pro-account' : '/account';
  await go(accountPath);
  await page.getByText('Admin portal', { exact: true }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/admin');
  await page.getByLabel('Go back').last().click();
  await page.waitForURL((u) => new URL(u).pathname === accountPath);
  await page.getByRole('button', { name: /Admin portal/ }).last().waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /Admin portal/ }).last().click();
  await page.waitForURL((u) => new URL(u).pathname === '/admin');

  if (PRIVATE_LOCAL_E2E) {
    await step('MK-READ-admin-and-enquiry-retry-admin', async () => {
      let retryEnabled = false;
      let injectedFailures = 0;
      const routePattern = '**/rest/v1/rpc/admin_list_shops';
      const matchesSubmitted = (response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/admin_list_shops')
        && response.request().postDataJSON()?.p_status === 'submitted';
      const routeHandler = async (route) => {
        if (route.request().postDataJSON()?.p_status === 'submitted' && !retryEnabled) {
          injectedFailures += 1;
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'MK-READ injected admin shop-list failure' }),
          });
          return;
        }
        await route.continue();
      };
      await page.route(routePattern, routeHandler);
      try {
        const failurePromise = page.waitForResponse((response) =>
          matchesSubmitted(response) && response.status() === 503,
        );
        await go('/admin/shops');
        const failure = await failurePromise;
        const errorBody = await page.locator('body').innerText();
        const retryButton = page.getByRole('button', { name: 'Try again', exact: true }).first();
        await retryButton.waitFor({ state: 'visible' });
        if (!errorBody.includes('MK-READ injected admin shop-list failure')) {
          throw new Error(`MK-READ admin failure was not presented with Retry: ${JSON.stringify({
            status: failure.status(),
            injectedFailures,
            retryVisible: await retryButton.isVisible().catch(() => false),
            body: errorBody,
          })}`);
        }
        await snap('mk-read-admin-shop-error');

        retryEnabled = true;
        const retryPromise = page.waitForResponse((response) =>
          matchesSubmitted(response) && response.ok(),
        );
        await retryButton.click();
        const recoveredResponse = await retryPromise;
        const recoveredRows = await recoveredResponse.json();
        const recoveredShop = Array.isArray(recoveredRows) && qaApprovalShopId
          ? recoveredRows.find((row) => row.id === qaApprovalShopId)
          : null;
        const actual = {
          status: failure.status(),
          injectedFailures,
          recoveredStatus: recoveredResponse.status(),
          recoveredRowCount: Array.isArray(recoveredRows) ? recoveredRows.length : null,
          qaApprovalShopId,
          recoveredShopStatus: recoveredShop?.status ?? null,
          body: await page.locator('body').innerText(),
        };
        if (
          recoveredResponse.status() !== 200
          || !Array.isArray(recoveredRows)
          || (qaApprovalShopId && recoveredShop?.status !== 'submitted')
          || !(await page.getByText('Shop verification', { exact: true }).isVisible().catch(() => false))
        ) {
          throw new Error(`MK-READ admin shop-list retry did not recover the submitted state: ${JSON.stringify(actual)}`);
        }
        console.log(`MK-READ-admin-and-enquiry-retry admin: ${JSON.stringify(actual)}`);
        await snap('mk-read-admin-shop-recovered');
      } finally {
        await page.unroute(routePattern, routeHandler);
      }
    });
  }

  await step('phase-7a-admin-approves-submitted-shop', async () => {
    if (!qaApprovalShopId) {
      if (PRIVATE_LOCAL_E2E) {
        throw new Error(`MK-ADMIN required same-shop fixture is missing: ${JSON.stringify({
          qaApprovalShopId,
          qaApprovalShopName,
          qaApprovalSkipReason,
        })}`);
      }
      console.log(`  SKIPPED: ${qaApprovalSkipReason ?? 'owner submission did not create a safe QA shop'}`);
      return;
    }
    await go('/admin/shops');
    await page.locator('text="Shop management" >> visible=true').last().waitFor();
    await page.getByText('all', { exact: true }).first().click();
    await page.getByText(qaApprovalShopName, { exact: true }).waitFor();
    const shopCard = page.getByText(qaApprovalShopName, { exact: true })
      .locator('xpath=ancestor::*[.//*[@role="button"]][1]');
    await shopCard.getByRole('button', { name: 'Verify', exact: true }).click();
    try {
      await shopCard.getByText('Verified', { exact: true }).waitFor({ state: 'visible' });
    } catch {
      const bodyText = await page.locator('body').innerText();
      throw new Error(`admin shop verification did not update the submitted row: ${JSON.stringify({
        shopId: qaApprovalShopId,
        shopName: qaApprovalShopName,
        bodyText: bodyText.slice(-1200),
      })}`);
    }
    if (PRIVATE_LOCAL_E2E) {
      await page.reload();
      await page.locator('text="Shop management" >> visible=true').last().waitFor();
      const adminReadbackPromise = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/admin_list_shops')
        && response.request().postDataJSON()?.p_status === 'all',
      );
      await page.getByText('all', { exact: true }).first().click();
      const adminResponse = await adminReadbackPromise;
      await shopCard.getByText('Verified', { exact: true }).waitFor({ state: 'visible' });
      const adminRows = await adminResponse.json();
      const adminShop = Array.isArray(adminRows)
        ? adminRows.find((row) => row.id === qaApprovalShopId)
        : null;
      const ownerShop = await asPro('/rest/v1/rpc/get_my_shop', {});
      if (!localE2eCustomerToken) {
        throw new Error(`MK-ADMIN signed-in customer token was unavailable for public shop read: ${JSON.stringify({
          shopId: qaApprovalShopId,
          adminStatus: adminShop?.status ?? null,
          ownerStatus: ownerShop?.status ?? null,
        })}`);
      }
      const customerPublicResponse = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/get_shop`, {
        method: 'POST',
        headers: { apikey: ANON, Authorization: `Bearer ${localE2eCustomerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_id: qaApprovalShopId }),
      });
      const customerPublicBody = await customerPublicResponse.text();
      let customerPublicRows = null;
      try {
        customerPublicRows = customerPublicBody ? JSON.parse(customerPublicBody) : null;
      } catch {
        customerPublicRows = null;
      }
      const customerPublicShop = Array.isArray(customerPublicRows)
        ? customerPublicRows.find((row) => row.id === qaApprovalShopId)
        : null;
      const verifyButtonCount = await shopCard.getByRole('button', { name: 'Verify', exact: true }).count();
      const actual = {
        shopId: qaApprovalShopId,
        adminStatus: adminShop?.status ?? null,
        ownerId: ownerShop?.id ?? null,
        ownerStatus: ownerShop?.status ?? null,
        customerPublicStatus: customerPublicResponse.status,
        customerPublicId: customerPublicShop?.id ?? null,
        customerPublicName: customerPublicShop?.name ?? null,
        verifyButtonCount,
      };
      if (
        !adminResponse.ok()
        || adminShop?.status !== 'verified'
        || ownerShop?.id !== qaApprovalShopId
        || ownerShop?.status !== 'verified'
        || !customerPublicResponse.ok
        || customerPublicShop?.id !== qaApprovalShopId
        || customerPublicShop?.name !== qaApprovalShopName
        || verifyButtonCount !== 0
      ) {
        throw new Error(`MK-ADMIN same-shop admin/owner/customer-public reads or action visibility diverged: ${JSON.stringify({
          actual,
          adminRows,
          ownerShop,
          customerPublicBody,
        })}`);
      }
      console.log(`MK-ADMIN-same-shop-cross-role-no-verify: ${JSON.stringify(actual)}`);
    }
  });
  await go('/admin');

  const rows = [
    { key: 'ai_assistant', enabled: true, label: 'AI assistant', description: 'AI tools.', group_name: 'AI', sort_order: 10, updated_at: new Date().toISOString() },
    { key: 'urgent_requests', enabled: true, label: 'Urgent creator requests', description: 'Urgent requests.', group_name: 'Bookings', sort_order: 20, updated_at: new Date().toISOString() },
    { key: 'fixed_asap', enabled: true, label: 'ASAP for fixed-price services', description: 'ASAP bookings.', group_name: 'Bookings', sort_order: 30, updated_at: new Date().toISOString() },
    { key: 'e2e_registry_probe', enabled: false, label: 'E2E registry probe', description: 'Proves admin switches are data-driven.', group_name: 'E2E', sort_order: 999, updated_at: new Date().toISOString() },
  ];
  let probeEnabled = false;
  const featureSetCalls = [];
  await page.route('**/rest/v1/rpc/admin_list_features', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }),
  );
  await page.route('**/rest/v1/rpc/admin_set_feature', async (route) => {
    const body = route.request().postDataJSON();
    featureSetCalls.push(body);
    if (body.p_key === 'e2e_registry_probe') probeEnabled = body.p_enabled;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ai_assistant: true,
        urgent_requests: true,
        fixed_asap: true,
        e2e_registry_probe: probeEnabled,
        archetypes: { inspect_quote: true, fixed: true, time_based: true, proposal: true, remote: false },
      }),
    });
  });
  await page.getByText('Features', { exact: true }).click();
  await page.waitForURL((u) => new URL(u).pathname === '/admin/features');
  await visible('E2E registry probe');
  for (const label of [
    'AI assistant',
    'Urgent creator requests',
    'ASAP for fixed-price services',
    'E2E registry probe',
    'Repair & inspection',
    'Fixed-price packages',
    'Time-based sessions',
    'Creators & events',
    'Remote services',
  ]) await visible(label);
  const switches = page.getByRole('switch');
  const switchCount = await switches.count();
  if (switchCount !== 9) throw new Error(`expected 4 registry + 5 archetype switches, got ${JSON.stringify({ switchCount })}`);
  const probeResponse = page.waitForResponse((response) => {
    if (new URL(response.url()).pathname !== '/rest/v1/rpc/admin_set_feature') return false;
    try {
      return response.request().postDataJSON()?.p_key === 'e2e_registry_probe';
    } catch {
      return false;
    }
  }, { timeout: 10000 }).catch(() => null);
  await switches.nth(3).click();
  const response = await probeResponse;
  const result = {
    probeEnabled,
    probeCalls: featureSetCalls.filter((call) => call.p_key === 'e2e_registry_probe'),
    responseStatus: response?.status() ?? null,
    switchCount,
    body: (await page.locator('body').innerText()).slice(0, 1200),
  };
  if (!response || !probeEnabled || result.probeCalls.length !== 1 || result.probeCalls[0].p_enabled !== true) {
    throw new Error(`admin UI did not send and apply the dynamic registry key: ${JSON.stringify(result)}`);
  }
});

await browser.close();

const guestOtpBlocked = blockedSteps.some((blocked) => blocked.startsWith('guest-otp-customer-role-return:'));
const guestJourneyFailed = failures.some((failure) =>
  failure.startsWith('guest-sports-browse-book-login-boundary:')
  || failure.startsWith('guest-otp-customer-role-return:'),
);
const guestJourneyStatus = !E2E_FLAGS_ON
  ? 'NOT_APPLICABLE'
  : guestOtpBlocked
    ? 'BLOCKED'
    : guestJourneyFailed
      ? 'FAILED'
      : 'PASS';
const status = failures.length || pageErrors.length ? 'FAILED' : blockedSteps.length ? 'BLOCKED' : 'PASS';
writeFileSync(`${SHOTS}/report.json`, JSON.stringify({ status, guestJourneyStatus, failures, softFailures, skippedSteps, blockedSteps, pageErrors, consoleErrors, httpFailures }, null, 2));
console.log(`\nQ-02 status: ${status}; G-01 guest journey: ${guestJourneyStatus}; screens: ${shot}, failed steps: ${failures.length}, soft-failed steps: ${softFailures.length}, skipped steps: ${skippedSteps.length}, blocked steps: ${blockedSteps.length}, page errors: ${pageErrors.length}, console errors: ${consoleErrors.length}, HTTP 403 responses: ${httpFailures.length}`);
for (const f of failures) console.log(`FAIL ${f}`);
for (const f of softFailures) console.log(`SOFT FAIL ${f}`);
for (const s of skippedSteps) console.log(`SKIP ${s}`);
for (const b of blockedSteps) console.log(`BLOCKED ${b}`);
for (const e of pageErrors) console.log(`PAGEERROR ${e}`);
for (const e of consoleErrors) console.log(`CONSOLE ${e}`);
for (const e of httpFailures) console.log(`HTTP ${e.status} ${e.method} ${e.path} [${e.page} ${e.route}]`);
process.exit(status === 'PASS' ? 0 : 1);
