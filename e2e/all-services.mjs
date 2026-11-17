import { createHash } from 'node:crypto';

const sid = (key) => {
  const h = createHash('md5').update(`quickserve-demo-all-services:${key}`).digest('hex');
  return `${h.slice(0, 8)}-5eed-de00-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

export const DEMO_IDS = Object.freeze({
  fixedPackage: sid('package:house-cleaning'),
  fixedService: sid('service:house-cleaning'),
  inspectBooking: sid('booking:inspect-quote'),
  fixedBooking: sid('booking:fixed-package'),
  proposal: sid('proposal:candid-photographer'),
  proposalBooking: sid('booking:proposal-milestones'),
  timePackage: sid('package:demo-home-tutor'),
  timeService: sid('service:demo-home-tutor'),
  timeBooking: sid('booking:time-session'),
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
  });

  await step('archetype-fixed-package-book-mocked-payment', async () => {
    // A random later day and window; if an earlier booking already holds it, try another one.
    const days = page.locator('button >> visible=true').filter({ hasText: /(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} [A-Z][a-z]{2}$/ });
    const slots = page.locator('text=/^\\d{1,2}( am| pm)?–\\d{1,2} (am|pm)$/ >> visible=true');
    const checkout = page.getByText('Secure checkout', { exact: true }).first();
    const taken = page.getByText(/already taken/i).first();
    for (let attempt = 0; ; attempt++) {
      const dayCount = await days.count();
      if (dayCount > 2) await days.nth(2 + Math.floor(Math.random() * (dayCount - 2))).click();
      const slotCount = await slots.count();
      if (slotCount) await slots.nth(Math.floor(Math.random() * slotCount)).click();
      await page.locator('text=/^Pay ₹/ >> visible=true').last().click();
      await checkout.or(taken).waitFor();
      if (await checkout.isVisible()) break;
      if (attempt >= 4) throw new Error('every tried slot was already taken');
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
    await page.getByText(/demo_deliverable/i).first().waitFor();
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
    await page.getByLabel('Notes for suppliers (optional)').fill(qaMarker);
    await page.getByText('Send request', { exact: true }).last().click();
    await page.waitForURL(/\/rfq\/[0-9a-f-]{36}$/);
    await page.locator(`text="${qaMarker}" >> visible=true`).last().waitFor();
    const contacted = page.locator('text=/^\\d+ shops contacted$/ >> visible=true').last();
    await contacted.waitFor({ state: 'visible' });
    const recipientCount = Number((await contacted.textContent())?.match(/^\d+/)?.[0] ?? 0);
    if (recipientCount < 2) throw new Error(`expected at least two eligible shops, got ${recipientCount}`);
    await page.locator('text="Anti-skid floor tiles for a demo bathroom" >> visible=true').last().waitFor();
    await page.locator('text="Supplier comparison" >> visible=true').last().waitFor();
  });

  await step('phase-6-sports-booking-request', async () => {
    await go('/sports');
    await visible('Sports & venues');
    await page.getByText('Badminton', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === '/sports/badminton');
    await page.getByText('Benz Circle Demo Badminton Courts', { exact: true }).first().waitFor();
    await page.getByText('Benz Circle Demo Badminton Courts', { exact: true }).first().click();
    await page.waitForURL((url) => new URL(url).pathname === `/venue/${DEMO_IDS.sportsVenue}`);
    await page.getByText('Choose an activity and slot', { exact: true }).first().waitFor();
    await page.getByText('Badminton · Demo Court 1', { exact: true }).first().waitFor();
    await page.getByText('Tomorrow', { exact: true }).first().click();
    const firstFreeSlot = page.getByRole('radio').nth(1);
    await firstFreeSlot.waitFor({ state: 'visible' });
    await firstFreeSlot.click();
    await page.getByLabel('Note (optional)').fill(`${qaMarker} sports booking`);
    await page.getByText('Request booking', { exact: true }).first().click();
    await page.waitForURL(/\/sports-booking\/[0-9a-f-]{36}$/);
    await visible('Sports booking');
    await page.getByText('REQUESTED', { exact: true }).first().waitFor();
    await page.getByText(qaMarker, { exact: false }).first().waitFor();
  });
}
