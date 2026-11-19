import type { CompareRow } from '../../components/market/compareModel';
import { formatINR } from '../../lib/money';
import type { RfqQuoteComparison, RfqStatus } from './api';

export interface ComparePresentation {
  rows: CompareRow[];
  warnings: Record<string, string[]>;
  selectableQuoteIds: string[];
  excludedFromLowestQuoteIds: string[];
}

export function buildComparePresentation(
  quotes: readonly RfqQuoteComparison[],
  options: { rfqStatus: RfqStatus; enquiriesEnabled: boolean },
): ComparePresentation {
  const warnings: Record<string, string[]> = {};
  const selectableQuoteIds: string[] = [];
  const excludedFromLowestQuoteIds: string[] = [];

  const rows = quotes.map((quote) => {
    const rowWarnings: string[] = [];

    for (const item of quote.items) {
      if (!item.available) rowWarnings.push(`Unavailable: ${item.description}`);
      if (item.brand_differs) {
        rowWarnings.push(`Brand differs: ${item.requested_brand} → ${item.brand || 'Brand not specified'}`);
      }
      if (item.specs_missing) {
        const missingSpecs = item.missing_spec_keys.length > 0 ? ` (${item.missing_spec_keys.join(', ')})` : '';
        rowWarnings.push(`Missing specifications: ${item.description}${missingSpecs}`);
      }
    }

    if (rowWarnings.length > 0) warnings[quote.quote_id] = rowWarnings;
    if (options.rfqStatus === 'open' && options.enquiriesEnabled && quote.status === 'sent') {
      selectableQuoteIds.push(quote.quote_id);
    }
    if (!quote.complete || (quote.status !== 'sent' && quote.status !== 'selected')) {
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

  return { rows, warnings, selectableQuoteIds, excludedFromLowestQuoteIds };
}
