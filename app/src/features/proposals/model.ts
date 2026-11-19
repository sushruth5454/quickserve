import type { ServicePackage } from '../../lib/types';
import { formatINR, rupeesToPaise } from '../../lib/money';

export interface ProposalPackagePrefill {
  title: string;
  totalPaise: number;
  deliveryDate: string | null;
  revisions: number;
  deliverables: Array<{ type: string; qty: number; spec: string }>;
}

export function parseDeliveryDate(value: string): Date | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!parts) return null;
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    return null;
  }
  return new Date(`${value}T23:59:59+05:30`);
}

export function proposalAmountError(totalRupees: number, advancePercent: number, maxAdvanceBp: number): string | null {
  if (!Number.isFinite(totalRupees) || !Number.isFinite(advancePercent)) {
    return 'Enter a valid fixed total and advance';
  }
  const amount = rupeesToPaise(totalRupees);
  const advanceAmount = Math.round(amount * advancePercent / 100);
  if (amount <= 0 || advanceAmount <= 0 || advanceAmount >= amount) {
    return 'Enter a valid fixed total and advance below 100%';
  }
  if (advanceAmount * 10000 > amount * maxAdvanceBp) {
    return `Advance can be at most ${maxAdvanceBp / 100}%`;
  }
  return null;
}

export function proposalFeeLabel(preview: { platform_fee: number; total_today: number }): string {
  return `Platform fee ${formatINR(preview.platform_fee)} · Total today ${formatINR(preview.total_today)}`;
}

export function proposalFeeChanged(
  shown: { platform_fee: number; service_due: number; total_today: number },
  latest: { platform_fee: number; service_due: number; total_today: number },
): boolean {
  return shown.platform_fee !== latest.platform_fee
    || shown.service_due !== latest.service_due
    || shown.total_today !== latest.total_today;
}

export function packageProposalPrefill(
  servicePackage: Pick<ServicePackage, 'title' | 'price_min' | 'turnaround_days' | 'revisions_included' | 'deliverables' | 'raw_files_included' | 'usage_rights'>,
  eventStart: string,
): ProposalPackagePrefill {
  const start = new Date(eventStart);
  let deliveryDate: string | null = null;
  if (Number.isFinite(start.getTime()) && servicePackage.turnaround_days != null && servicePackage.turnaround_days >= 0) {
    start.setUTCDate(start.getUTCDate() + servicePackage.turnaround_days);
    deliveryDate = start.toISOString().slice(0, 10);
  }

  const deliverables = (servicePackage.deliverables ?? [])
    .filter((item) => item.type !== 'revisions')
    .map((item) => ({ type: item.type, qty: item.qty, spec: item.spec }));
  if (servicePackage.raw_files_included) {
    deliverables.push({ type: 'raw_files', qty: 1, spec: 'Raw files included' });
  }

  const rights = servicePackage.usage_rights ?? {};
  const rightsText = [
    rights.organic_posting ? 'Organic posting' : null,
    rights.paid_ads_days && rights.paid_ads_days > 0 ? `Paid ads for ${rights.paid_ads_days} days` : null,
    rights.exclusivity_days && rights.exclusivity_days > 0 ? `Exclusivity for ${rights.exclusivity_days} days` : null,
  ].filter(Boolean).join('; ');
  if (rightsText) deliverables.push({ type: 'usage_rights', qty: 1, spec: rightsText });

  const revisions = Number.isInteger(servicePackage.revisions_included)
    && servicePackage.revisions_included >= 0
    && servicePackage.revisions_included <= 10
    ? servicePackage.revisions_included
    : 1;
  deliverables.push({ type: 'revisions', qty: revisions, spec: 'Revision rounds' });

  return {
    title: servicePackage.title,
    totalPaise: servicePackage.price_min ?? 0,
    deliveryDate,
    revisions,
    deliverables,
  };
}
