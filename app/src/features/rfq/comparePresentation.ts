import { getLowestQuoteId } from '../../components/market/compareModel';
import type { CompareRow } from '../../components/market/compareModel';
import { formatINR } from '../../lib/money';
import type { RfqQuoteComparison, RfqStatus } from './api';

export interface ComparePresentation {
  rows: CompareRow[];
  warnings: Record<string, string[]>;
  selectableQuoteIds: string[];
  excludedFromLowestQuoteIds: string[];
  lowestQuoteId: string | null;
}

export function buildComparePresentation(
  quotes: readonly RfqQuoteComparison[],
  options: { rfqStatus: RfqStatus; rfqExpiresAt: string; nowMs: number; enquiriesEnabled: boolean },
): ComparePresentation {
  const warnings: Record<string, string[]> = {};
  const selectableQuoteIds: string[] = [];
  const excludedFromLowestQuoteIds: string[] = [];
  const rfqExpiryMs = Date.parse(options.rfqExpiresAt);
  const rfqIsLive = options.rfqStatus === 'open'
    && Number.isFinite(rfqExpiryMs)
    && rfqExpiryMs > options.nowMs;

  const rows = quotes.map((quote) => {
    const rowWarnings: string[] = [];

    if (!quote.complete || quote.unavailable_count > 0) {
      const offeredCount = Math.max(0, quote.items.length - quote.unavailable_count);
      rowWarnings.push(`Coverage: ${offeredCount}/${quote.items.length} requested items`);
    }
    for (const item of quote.items) {
      if (!item.available) rowWarnings.push(`Unavailable: ${item.description}`);
      if (item.brand_differs) {
        rowWarnings.push(`Brand differs: ${item.requested_brand} → ${item.brand || 'Brand not specified'}`);
      }
      if (item.specs_missing) {
        const missingSpecs = item.missing_spec_keys.length > 0 ? ` (${item.missing_spec_keys.join(', ')})` : '';
        rowWarnings.push(`Missing specifications: ${item.description}${missingSpecs}`);
      }
      if (item.specs_differ) {
        const differingSpecs = item.differing_spec_keys.length > 0 ? ` (${item.differing_spec_keys.join(', ')})` : '';
        rowWarnings.push(`Different specifications: ${item.description}${differingSpecs}`);
      }
      if (item.quantity_rounded_up) {
        rowWarnings.push(`Quoted quantity rounded up: ${item.description} (${item.quantity} ${item.unit})`);
      }
    }
    if (quote.arrives_after_needed_by) rowWarnings.push('Arrives after needed-by date');
    if (quote.delivery_terms_missing) rowWarnings.push('Delivery timing or terms not stated');

    if (rowWarnings.length > 0) warnings[quote.quote_id] = rowWarnings;
    const quoteExpiryMs = Date.parse(quote.valid_until);
    const quoteIsLive = Number.isFinite(quoteExpiryMs) && quoteExpiryMs > options.nowMs;
    if (
      options.enquiriesEnabled
      && rfqIsLive
      && quoteIsLive
      && quote.status === 'sent'
      && quote.can_select === true
    ) {
      selectableQuoteIds.push(quote.quote_id);
    }
    if (!quote.complete || quote.status !== 'sent' || !rfqIsLive || !quoteIsLive) {
      excludedFromLowestQuoteIds.push(quote.quote_id);
    }

    const deliveryTiming = quote.delivery_days == null ? 'time not specified' : `${quote.delivery_days} days`;
    return {
      id: quote.quote_id,
      who: quote.shop_name,
      pricePaise: quote.total_paise,
      detail1: `${formatINR(quote.delivery_charge_paise)} · ${deliveryTiming}`,
      detail2: new Date(quote.valid_until).toLocaleDateString(),
    };
  });

  const lowestQuoteId = getLowestQuoteId(rows, (id) => excludedFromLowestQuoteIds.includes(id));
  return { rows, warnings, selectableQuoteIds, excludedFromLowestQuoteIds, lowestQuoteId };
}
