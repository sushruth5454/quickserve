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
});

/**
 * Reuses the signed-in founder page owned by web-smoke.mjs, so no second OTP is sent for CI.
 * It creates one fixed booking through the mocked checkout; every other route is inspection-only.
 */
export async function runAllServiceScenarios({ page, go, step, visible }) {
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
    // A random later day and window, so a recent run's 30-minute hold on the demo pro never collides.
    const days = page.locator('button >> visible=true').filter({ hasText: /(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{1,2} [A-Z][a-z]{2}$/ });
    const dayCount = await days.count();
    if (dayCount > 2) await days.nth(2 + Math.floor(Math.random() * (dayCount - 2))).click();
    const slots = page.locator('text=/^\\d{1,2}( am| pm)?–\\d{1,2} (am|pm)$/ >> visible=true');
    const slotCount = await slots.count();
    if (slotCount) await slots.nth(Math.floor(Math.random() * slotCount)).click();
    await page.locator('text=/^Pay ₹/ >> visible=true').last().click();
    await page.getByText('Secure checkout', { exact: true }).first().waitFor();
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
}
