import { getLowestQuoteId, sortByPrice } from '../../../components/market/compareModel';
import type { RfqQuoteComparison, RfqQuoteItemComparison } from '../api';
import { buildComparePresentation } from '../comparePresentation';

function item(overrides: Partial<RfqQuoteItemComparison> = {}): RfqQuoteItemComparison {
  return {
    rfq_item_id: 'item-1',
    seq: 1,
    description: 'Ceramic tile',
    requested_brand: '',
    requested_specs: {},
    brand: '',
    model: '',
    specs: {},
    quantity: 1,
    unit: 'piece',
    unit_price_paise: 100,
    gst_rate_bp: 0,
    available: true,
    line_total_paise: 100,
    brand_differs: false,
    specs_missing: false,
    missing_spec_keys: [],
    specs_differ: false,
    differing_spec_keys: [],
    quantity_rounded_up: false,
    ...overrides,
  };
}

function quote(overrides: Partial<RfqQuoteComparison> = {}): RfqQuoteComparison {
  return {
    quote_id: 'quote-1',
    shop_id: 'shop-1',
    shop_name: 'Tile House',
    version: 1,
    status: 'sent',
    valid_until: '2030-01-01T00:00:00.000Z',
    delivery_charge_paise: 0,
    delivery_days: 2,
    notes: '',
    subtotal_paise: 100,
    gst_paise: 0,
    total_paise: 100,
    unavailable_count: 0,
    complete: true,
    arrives_after_needed_by: false,
    delivery_terms_missing: false,
    items: [item()],
    ...overrides,
  };
}

describe('RFQ quote comparison presentation', () => {
  it('never gives the lowest badge to a quote that does not cover every RFQ line', () => {
    const presentation = buildComparePresentation([
      quote({
        quote_id: 'incomplete',
        total_paise: 50,
        complete: false,
        unavailable_count: 1,
        items: [item({ available: false })],
      }),
      quote({ quote_id: 'complete', total_paise: 100 }),
    ], { rfqStatus: 'open', enquiriesEnabled: true });

    const lowestQuoteId = getLowestQuoteId(
      sortByPrice(presentation.rows),
      (id) => presentation.excludedFromLowestQuoteIds.includes(id),
    );

    expect(lowestQuoteId).toBe('complete');
  });

  it('shows warnings for unavailable items, changed brands, and missing specifications', () => {
    const presentation = buildComparePresentation([
      quote({
        complete: false,
        unavailable_count: 1,
        items: [
          item({ rfq_item_id: 'unavailable', description: 'Cement', available: false }),
          item({
            rfq_item_id: 'changed-brand',
            description: 'Paint',
            requested_brand: 'Acme',
            brand: 'Northstar',
            brand_differs: true,
          }),
          item({
            rfq_item_id: 'missing-spec',
            description: 'Wire',
            specs_missing: true,
            missing_spec_keys: ['gauge'],
          }),
        ],
      }),
    ], { rfqStatus: 'open', enquiriesEnabled: true });

    expect(presentation.warnings['quote-1']).toEqual(expect.arrayContaining([
      'Unavailable: Cement',
      'Brand differs: Acme → Northstar',
      'Missing specifications: Wire (gauge)',
    ]));
  });

  it('does not expose a select action for a quote that is not sent', () => {
    const presentation = buildComparePresentation([
      quote({ quote_id: 'expired', status: 'expired' }),
    ], { rfqStatus: 'open', enquiriesEnabled: true });

    expect(presentation.selectableQuoteIds).not.toContain('expired');
  });

  it('only exposes selection while the RFQ is open and enquiries are enabled', () => {
    const sentQuote = quote({ quote_id: 'sent' });

    expect(buildComparePresentation([sentQuote], { rfqStatus: 'closed', enquiriesEnabled: true }).selectableQuoteIds)
      .not.toContain('sent');
    expect(buildComparePresentation([sentQuote], { rfqStatus: 'open', enquiriesEnabled: false }).selectableQuoteIds)
      .not.toContain('sent');
  });
});
