import { createHash } from 'node:crypto';

const E2E_FLAGS_ON = process.env.E2E_FLAGS === 'on';
const sid = (key) => {
  const h = createHash('md5').update(`quickserve-demo-all-services:${key}`).digest('hex');
  return `${h.slice(0, 8)}-5eed-de00-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const formatINR = (paise) => {
  const abs = Math.abs(Math.round(paise));
  const rupees = String(Math.floor(abs / 100));
  const amount = rupees.length <= 3
    ? rupees
    : `${rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${rupees.slice(-3)}`;
  const fraction = abs % 100;
  return `${paise < 0 ? '-' : ''}₹${amount}${fraction ? `.${String(fraction).padStart(2, '0')}` : ''}`;
};

export const DEMO_IDS = Object.freeze({
  fixedPackage: sid('package:house-cleaning'),
  fixedService: sid('service:house-cleaning'),
  inspectBooking: sid('booking:inspect-quote'),
  inspectService: sid('service:ac-repair'),
  fixedBooking: sid('booking:fixed-package'),
  proposal: sid('proposal:candid-photographer'),
  proposalBooking: sid('booking:proposal-milestones'),
  timePackage: sid('package:demo-home-tutor'),
  timeService: sid('service:demo-home-tutor'),
  timeBooking: sid('booking:time-session'),
  recurringPlan: sid('recurring:demo-home-tutor'),
  sportsVenue: sid('sports-venue:benz-circle-badminton'),
  tileShop: sid('shop:benz-circle-tile-house'),
  tileProduct: sid('product:demo-anti-skid-floor-tile'),
});
const QA_MARKER = process.env.QA_MARKER ?? `QA-E2E manual-${Date.now()}`;

/**
 * Reuses the signed-in founder page owned by web-smoke.mjs, so no second OTP is sent for CI.
 * The fixed-service checkout is mocked; marketplace requests are tagged for exact QA-E2E cleanup.
 */
export async function runAllServiceScenarios({ page, go, step, visible, qaMarker = QA_MARKER }) {
  await step('demo-data-indicator', async () => {
    await go('/');
    await visible('DEMO DATA');
    await page.getByLabel('Demo data only. No real payments.').first().waitFor();
  });

  await step('booking-steps-flag', async () => {
    const appFeaturesResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/rest/v1/rpc/get_app_features'),
    );
    await go(`/book-fixed/${DEMO_IDS.fixedService}`);
    const response = await appFeaturesResponsePromise;
    if (!response.ok()) {
      throw new Error(`get_app_features failed while checking booking_steps (${response.status()}): ${await response.text()}`);
    }
    const appFeatures = await response.json();
    const actualFlag = appFeatures?.booking_steps === true;
    if (actualFlag !== E2E_FLAGS_ON) {
      throw new Error(`booking_steps app flag did not match this pass: ${JSON.stringify({
        expected: E2E_FLAGS_ON,
        actual: appFeatures?.booking_steps,
        appFeatures,
        url: page.url(),
      })}`);
    }
    await visible('Book a package');
    const stepIndicator = page.getByRole('progressbar').first();
    if (E2E_FLAGS_ON) {
      await stepIndicator.waitFor({ state: 'visible' });
    } else if (await stepIndicator.isVisible().catch(() => false)) {
      throw new Error(`booking_steps OFF rendered a step indicator: ${JSON.stringify({
        expectedVisible: false,
        actualVisible: true,
        appFeatures,
        url: page.url(),
        body: await page.locator('body').innerText(),
      })}`);
    }
  });

  await step('archetype-inspect-quote-browse-and-quote', async () => {
    await go('/category/ac-repair?name=AC%20Repair');
    await page.getByText('Ravi Demo Kumar', { exact: true }).first().waitFor();
    await go(`/booking/${DEMO_IDS.inspectBooking}`);
    await page.getByText('AC diagnosis and repair labour', { exact: true }).first().waitFor();
    await page.getByText(/Synthetic capacitor/).first().waitFor();
  });

  await step('demo-address-for-booking', async () => {
    await go('/location');
    await page.getByText('Demo home', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === '/');
  });

  await step('archetype-fixed-package-browse', async () => {
    await go('/category/house-cleaning?name=House%20Cleaning');
    await page.getByLabel('Book package: Demo 2 BHK deep clean').first().click();
    await page.waitForURL(/\/book\//);
    // The category screen stays mounted (hidden) on web, so match only the visible copy of shared text.
    await page.locator('text="Book package" >> visible=true').first().waitFor();
    await page.locator('text="Demo 2 BHK deep clean" >> visible=true').first().waitFor();
    // This packageId route uses PackageBookingScreen; booking_steps is asserted on /book-fixed above.
  });

  await step('archetype-fixed-package-book-mocked-payment', async () => {
    const amountInPaise = (value) => {
      const match = value.match(/₹([\d,]+)(?:\.(\d{2}))?/);
      if (!match) throw new Error(`missing INR amount in ${JSON.stringify(value)}`);
      return Number(match[1].replaceAll(',', '')) * 100 + Number(match[2] ?? '0');
    };
    const priceRowPaise = async (label) => {
      const row = page.locator(`[aria-label^="${label}: "] >> visible=true`).last();
      const accessibilityLabel = await row.getAttribute('aria-label');
      if (!accessibilityLabel) throw new Error(`missing ${label} price row`);
      return amountInPaise(accessibilityLabel);
    };
    // Sweep later dates/windows deterministically; retry only the server's slot-conflict response.
    const days = page.locator('button >> visible=true').filter({ hasText: /(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} [A-Z][a-z]{2}$/ });
    const slots = page.locator('text=/^\\d{1,2}( am| pm)?–\\d{1,2} (am|pm)$/ >> visible=true');
    const checkout = page.getByText('Secure checkout', { exact: true }).first();
    const slotConflictMessage = 'provider_unavailable: service window overlaps another booking';
    const maxAttempts = 5;
    let slotConflictCount = 0;
    let checkoutReady = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const dayCount = await days.count();
      const futureDayCount = dayCount - 2;
      if (futureDayCount <= 0) throw new Error(`no later dates available: ${JSON.stringify({ dayCount })}`);
      const dayIndex = 2 + (attempt % futureDayCount);
      await days.nth(dayIndex).click();
      const slotCount = await slots.count();
      if (!slotCount) throw new Error(`no visible slots: ${JSON.stringify({ dayIndex, slotCount })}`);
      const slotIndex = attempt % slotCount;
      await slots.nth(slotIndex).click();
      const footerButton = page.locator('text=/^Pay ₹/ >> visible=true').last();
      const footerText = await footerButton.innerText();
      const packagePaise = await priceRowPaise('Package');
      const platformFeePaise = await priceRowPaise('Platform fee');
      const totalPaise = await priceRowPaise('Total');
      const footerPaise = amountInPaise(footerText);
      const breakdown = { packagePaise, platformFeePaise, totalPaise, footerText, footerPaise };
      if (packagePaise !== 99900 || platformFeePaise !== 2900 || totalPaise !== 102800
        || footerText !== 'Pay ₹1,028.00' || footerPaise !== 102800) {
        throw new Error(`fixed package Pay label does not match the ₹999 + ₹29 sample: ${JSON.stringify(breakdown)}`);
      }
      if (packagePaise + platformFeePaise !== totalPaise || totalPaise !== footerPaise) {
        throw new Error(`fixed package footer does not match the displayed price breakdown: ${JSON.stringify(breakdown)}`);
      }
      const bookingResponsePromise = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/rest/v1/rpc/create_fixed_booking',
      );
      await footerButton.click();
      const bookingResponse = await bookingResponsePromise;
      const responseText = await bookingResponse.text();
      let responseBody;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = { raw: responseText };
      }
      if (!bookingResponse.ok()) {
        const errorDetails = [responseBody?.message, responseBody?.details]
          .filter((value) => typeof value === 'string')
          .join('\n');
        if (bookingResponse.status() === 400 && errorDetails.includes(slotConflictMessage)) {
          slotConflictCount += 1;
          continue;
        }
        throw new Error(`create_fixed_booking failed: ${JSON.stringify({
          status: bookingResponse.status(),
          body: responseBody,
        })}`);
      }
      const bookingId = typeof responseBody === 'string' ? responseBody : '';
      if (!bookingId) {
        throw new Error(`create_fixed_booking returned no string booking id: ${JSON.stringify({
          status: bookingResponse.status(),
          body: responseBody,
        })}`);
      }
      await checkout.waitFor({ state: 'visible' });
      await page.getByText(`Booking #${bookingId.slice(0, 8)}`, { exact: true }).first().waitFor({ state: 'visible' });
      const checkoutAmount = await page
        .locator('text=/^₹[\\d,]+(?:\\.\\d{2})?$/ >> visible=true')
        .last()
        .innerText();
      const checkoutPayButton = await page.locator('text=/^Pay ₹/ >> visible=true').last().innerText();
      const checkoutPaise = amountInPaise(checkoutAmount);
      const checkoutButtonPaise = amountInPaise(checkoutPayButton);
      const actual = { ...breakdown, checkoutPaise, checkoutButtonPaise };
      if (checkoutPaise !== footerPaise || checkoutButtonPaise !== footerPaise) {
        throw new Error(`fixed package checkout amount differs from the footer: ${JSON.stringify(actual)}`);
      }
      checkoutReady = true;
      break;
    }
    if (!checkoutReady) {
      throw new Error(`no checkout after ${slotConflictCount} verified slot conflicts: ${JSON.stringify({ maxAttempts })}`);
    }
    await page.getByText('Demo mode — no real money moves', { exact: true }).first().waitFor();
    await page.getByText(/^Pay ₹/).last().click();
    await page.getByText('Payment successful', { exact: true }).first().waitFor();
    await page.waitForURL(/\/booking\//);
  });

  await step('archetype-proposal-deliverables-and-milestones', async () => {
    await go(`/proposal/${DEMO_IDS.proposal}`);
    await page.getByText('Proposal', { exact: true }).first().waitFor();
    await page.getByText('Payment milestones', { exact: true }).first().waitFor();
    await page.getByText('Deliverables', { exact: true }).first().waitFor();
    await page.getByText(/Demo deliverable/i).first().waitFor();
    await go(`/booking/${DEMO_IDS.proposalBooking}`);
    await page.getByText('Demo booking advance', { exact: true }).first().waitFor();
    await page.getByText('Demo delivery milestone', { exact: true }).first().waitFor();
  });

  await step('archetype-time-session-and-pack', async () => {
    await go(`/book/${DEMO_IDS.timeService}?packageId=${DEMO_IDS.timePackage}&archetype=time_based`);
    await page.getByText('Book a session', { exact: true }).first().waitFor();
    await page.getByText('Demo 60-minute session', { exact: true }).first().waitFor();
    await page.getByText('Session pack', { exact: true }).first().click();
    await page.getByText('Buy a session pack', { exact: true }).first().waitFor();
  });

  await step('recurring-plan-skip-pause-resume-web', async () => {
    await go(`/recurring/${DEMO_IDS.recurringPlan}`);
    await page.getByText('Plan status', { exact: true }).waitFor();
    await page.getByText('Cancel plan', { exact: true }).first().waitFor();

    const confirmations = [
      ['Skip next visit', 'Skip the next visit?'],
      ['Pause plan', 'Pause this plan?'],
      ['Resume plan', 'Resume this plan?'],
      ['Cancel plan', 'Cancel this plan?'],
    ];
    for (const [action, prompt] of confirmations) {
      const button = page.getByText(action, { exact: true }).first();
      if (!await button.isVisible().catch(() => false)) continue;
      await button.click();
      await page.getByText(prompt, { exact: true }).waitFor();
      await page.getByText('Not now', { exact: true }).last().click();
      await page.getByText(prompt, { exact: true }).waitFor({ state: 'hidden' });
    }
    await page.getByText('Plan status', { exact: true }).waitFor();
  });

  await step('home-inspect-book-pay-visit-fee', async () => {
    const description = `${qaMarker} split AC is not cooling`;
    await go(`/book/${DEMO_IDS.inspectService}?description=${encodeURIComponent(description)}`);
    await page.getByLabel('Describe the problem').fill(description);
    await page.getByRole('radio', { name: /Schedule/ }).click();

    const dayButtons = page.getByRole('button', { name: /^(Today|Tomorrow|Sun|Mon|Tue|Wed|Thu|Fri|Sat),/ });
    const dayCount = await dayButtons.count();
    const windowName = /^10 am–12 pm(?:, unavailable)?$/;
    let selectedSlot = null;
    // The demo reset seeds an active quote at now()+2h; skip today and tomorrow so this window cannot overlap it.
    for (let index = 2; index < dayCount; index++) {
      const day = dayButtons.nth(index);
      if (!await day.isEnabled()) continue;
      const dayLabel = await day.getAttribute('aria-label') ?? await day.innerText();
      await day.click();
      const slot = page.getByRole('button', { name: windowName });
      if (!await slot.count() || !await slot.isEnabled()) continue;
      const timeLabel = await slot.getAttribute('aria-label') ?? await slot.innerText();
      await slot.click();
      selectedSlot = { day: dayLabel, time: timeLabel };
      break;
    }
    if (!selectedSlot) {
      throw new Error(`no future 10 am–12 pm home-booking window: ${JSON.stringify({ days: await dayButtons.allTextContents(), url: page.url(), body: await page.locator('body').innerText() })}`);
    }

    const createBookingResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes('/rest/v1/rpc/create_booking'),
      { timeout: 20000 },
    ).then(async (response) => {
      const responseText = await response.text();
      let responseBody = responseText;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        // Keep the raw response when the API does not return JSON.
      }
      return { status: response.status(), ok: response.ok(), url: response.url(), body: responseBody };
    }).catch((error) => ({ status: null, ok: false, url: null, body: null, error: error.message }));
    let createBookingResponse = null;
    try {
      await page.getByText(/^Pay ₹.*& book$/).last().click();
      createBookingResponse = await createBookingResponsePromise;
      if (!createBookingResponse.ok) throw new Error('create_booking did not succeed');
      await page.getByText('Secure checkout', { exact: true }).waitFor();
      await page.getByText('Demo mode — no real money moves', { exact: true }).first().waitFor();
      await page.getByText(/^Pay ₹/).last().click();
      await page.getByText('Payment successful', { exact: true }).waitFor();
      await page.waitForURL(/\/booking\/[0-9a-f-]{36}$/);
    } catch (error) {
      if (!createBookingResponse) createBookingResponse = await createBookingResponsePromise;
      throw new Error(`home visit-fee booking flow failed: ${JSON.stringify({
        selectedSlot,
        createBookingResponse,
        failure: error instanceof Error ? error.message : String(error),
        url: page.url(),
        body: await page.locator('body').innerText(),
      })}`);
    }
    try {
      await page.getByText('Request sent', { exact: true }).waitFor();
    } catch {
      throw new Error(`home visit-fee payment did not leave a pending provider request: ${JSON.stringify({ selectedSlot, createBookingResponse, url: page.url(), body: await page.locator('body').innerText() })}`);
    }
  });

  await step('home-recurring-plan-request', async () => {
    await go(`/recurring/new/${DEMO_IDS.timeService}?archetype=time_based&description=${encodeURIComponent(`${qaMarker} weekly home visit`)}`);
    await page.getByLabel('Instructions for the provider').fill(`${qaMarker} weekly home visit`);
    await page.getByLabel('Visit duration in minutes').fill('60');
    await page.getByText('Mon–Sat', { exact: true }).click();
    try {
      await page.getByText(/Total per visit:/).waitFor();
    } catch {
      throw new Error(`home recurring quote did not load after selecting weekly duration: ${JSON.stringify({ url: page.url(), body: await page.locator('body').innerText() })}`);
    }
    const send = page.getByText(/^Send request to /).last();
    await send.waitFor({ state: 'visible' });
    await send.click();
    await page.waitForURL(/\/recurring\/[0-9a-f-]{36}$/);
    await page.getByText('Plan status', { exact: true }).waitFor();
    try {
      await page.getByText(/^Provider response:\s*Pending\b/i).waitFor();
    } catch {
      throw new Error(`home recurring request did not reach Pending: ${JSON.stringify({ url: page.url(), body: await page.locator('body').innerText() })}`);
    }
  });

  await step('home-booking-cancel-copy', async () => {
    await go(`/booking/${DEMO_IDS.fixedBooking}`);
    const previewResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/rest/v1/rpc/preview_cancellation'),
    );
    await page.getByText('Cancel booking', { exact: true }).first().click();
    const previewResponse = await previewResponsePromise;
    if (!previewResponse.ok()) {
      throw new Error(`fixed-booking cancellation preview failed: ${JSON.stringify({ status: previewResponse.status(), body: await previewResponse.text() })}`);
    }
    const preview = await previewResponse.json();
    const expectedCopy = preview.refund_amount > 0
      ? `You'll be refunded ${formatINR(preview.refund_amount)}.`
      : preview.charged_amount > 0
        ? `${formatINR(preview.charged_amount)} will be charged.`
        : 'No charge — you have not paid yet.';
    try {
      await page.getByText(expectedCopy, { exact: true }).waitFor();
    } catch {
      throw new Error(`fixed-booking cancel sheet differs from server preview: ${JSON.stringify({ preview, expectedCopy, body: await page.locator('body').innerText() })}`);
    }
    await page.getByText('Keep booking', { exact: true }).last().click();
  });

  await step('phase-7a-shop-and-product-browse', async () => {
    await go('/shop');
    await page.getByText('Benz Circle Demo Tile House', { exact: true }).first().waitFor();
    await page.getByText('Labbipet Demo Tile Mart', { exact: true }).first().waitFor();
    await page.getByText('Benz Circle Demo Tile House', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === `/shop/${DEMO_IDS.tileShop}`);
    await page.getByText('Catalogue', { exact: true }).first().waitFor();
    await page.getByText('Demo Sandstone Anti-Skid Floor Tile', { exact: true }).first().waitFor();
    await page.getByText('Demo Sandstone Anti-Skid Floor Tile', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === `/product/${DEMO_IDS.tileProduct}`);
    await page.getByText('Enquire with the shop', { exact: true }).first().waitFor();
  });

  await step('phase-7a-product-enquiry', async () => {
    await page.getByLabel('Message', { exact: true }).last().fill(`${qaMarker} product enquiry availability and delivery`);
    await page.getByText('Send enquiry', { exact: true }).first().click();
    await page.waitForURL(/\/enquiry\/[0-9a-f-]{36}$/);
    await page.getByText(qaMarker, { exact: false }).last().waitFor({ state: 'visible' });
    await page.getByText('Conversation status: open', { exact: true }).first().waitFor();
  });

  await step('phase-7a-rfq-create-and-details', async () => {
    await go('/products');
    await visible('Products');
    await page.getByText('Demo Sandstone Anti-Skid Floor Tile', { exact: true }).first().waitFor();
    await page.getByText('Demo Ivory Ceramic Wall Tile', { exact: true }).first().waitFor();
    await page.getByText('Request quotes from multiple shops', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === '/rfq/new');
    await visible('Request product quotes');
    await page.locator('text="Tiles" >> visible=true').last().click();
    await page.getByLabel('Request title').fill(`${qaMarker} tile quotation`);
    await page.getByLabel('Description').first().fill('Anti-skid floor tiles for a demo bathroom');
    await page.getByLabel('Quantity').first().fill('500');
    await page.getByLabel('Notes for suppliers (optional)').fill(qaMarker);
    await page.getByText('Send request', { exact: true }).last().click();
    await page.waitForURL(/\/rfq\/[0-9a-f-]{36}$/);
    await page.getByText(qaMarker, { exact: true }).last().waitFor({ state: 'visible' });
    const contacted = page.getByText(/^\d+ shops contacted$/).last();
    await contacted.waitFor({ state: 'visible' });
    const recipientCount = Number((await contacted.textContent())?.match(/^\d+/)?.[0] ?? 0);
    if (recipientCount < 2) throw new Error(`expected at least two eligible shops, got ${recipientCount}`);
    await page.getByText(/Anti-skid floor tiles for a demo bathroom/).last().waitFor({ state: 'visible' });
    await page.getByText('Supplier comparison', { exact: true }).last().waitFor({ state: 'visible' });
  });

  await step('phase-6-sports-booking-request', async () => {
    await go('/sports');
    await visible('Sports & venues');
    await page.getByText('Badminton', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === '/sports/badminton');
    await page.getByText('Benz Circle Demo Badminton Courts', { exact: true }).first().waitFor();
    const initialSlotsResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().includes('/rest/v1/rpc/get_sports_slots'),
    );
    await page.getByText('Benz Circle Demo Badminton Courts', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === `/venue/${DEMO_IDS.sportsVenue}`);
    await page.getByText('Choose an activity and slot', { exact: true }).first().waitFor();
    await page.getByText('Badminton · Demo Court 1', { exact: true }).first().waitFor();
    const initialResponse = await initialSlotsResponse;
    let candidateDate = initialResponse.request().postDataJSON().p_date;
    if (!initialResponse.ok()) {
      throw new Error(`get_sports_slots failed for ${candidateDate} (${initialResponse.status()}): ${await initialResponse.text()}`);
    }
    let slots = await initialResponse.json();
    const checkedDates = [];
    let slotSelected = false;
    for (let offset = 0; offset < 7; offset++) {
      if (offset > 0) {
        const nextDate = new Date(`${candidateDate}T00:00:00.000Z`);
        nextDate.setUTCDate(nextDate.getUTCDate() + 1);
        candidateDate = nextDate.toISOString().slice(0, 10);
        const responsePromise = page.waitForResponse((response) =>
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
        await page.getByRole('button', { name: dateLabel, exact: true }).click();
        const response = await responsePromise;
        if (!response.ok()) {
          throw new Error(`get_sports_slots failed for ${candidateDate} (${response.status()}): ${await response.text()}`);
        }
        slots = await response.json();
      }
      if (!Array.isArray(slots)) throw new Error(`get_sports_slots returned unexpected data for ${candidateDate}: ${JSON.stringify(slots)}`);
      const freeSlots = slots.filter((slot) => slot.state === 'free' && (slot.remaining == null || slot.remaining >= 1));
      const stateCounts = slots.reduce((counts, slot) => {
        counts[slot.state] = (counts[slot.state] ?? 0) + 1;
        return counts;
      }, {});
      checkedDates.push({ date: candidateDate, free: freeSlots.length, states: stateCounts });
      if (freeSlots.length === 0) continue;
      const firstFreeSlot = page.getByRole('radio').nth(1);
      await firstFreeSlot.waitFor({ state: 'visible' }).catch(async () => {
        const radioCount = await page.getByRole('radio').count();
        throw new Error(`sports UI did not show a slot radio for ${candidateDate}; API free slots=${JSON.stringify(freeSlots)}, radios=${radioCount}`);
      });
      await firstFreeSlot.click();
      slotSelected = true;
      break;
    }
    if (!slotSelected) throw new Error(`No free sports slot found across seven dates: ${JSON.stringify(checkedDates)}`);
    await page.getByLabel('Note (optional)').fill(`${qaMarker} sports booking`);
    await page.getByText('Send request', { exact: true }).first().click();
    await page.waitForURL(/\/sports-booking\/[0-9a-f-]{36}$/);
    await visible('Sports booking');
    await page.getByText('Waiting for venue', { exact: true }).first().waitFor();
    await page.getByText(qaMarker, { exact: false }).first().waitFor();
  });
}
