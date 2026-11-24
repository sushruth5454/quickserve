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
    can_select: true,
    selection_block_reason: null,
    ...overrides,
  };
}

const beforeDeadlines = {
  rfqStatus: 'open' as const,
  rfqExpiresAt: '2026-11-24T10:10:00.000Z',
  nowMs: Date.parse('2026-11-24T10:00:00.000Z'),
  enquiriesEnabled: true,
};

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
    ], beforeDeadlines);

    const lowestQuoteId = getLowestQuoteId(
      sortByPrice(presentation.rows),
      (id) => presentation.excludedFromLowestQuoteIds.includes(id),
    );

    expect(lowestQuoteId).toBe('complete');
  });

  it('shows every server coverage, specification, quantity, and delivery warning before selection', () => {
    const presentation = buildComparePresentation([
      quote({
        complete: false,
        unavailable_count: 1,
        arrives_after_needed_by: true,
        delivery_terms_missing: true,
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
            rfq_item_id: 'changed-spec',
            description: 'Wire',
            specs_differ: true,
            differing_spec_keys: ['gauge'],
            quantity_rounded_up: true,
            quantity: 2,
          }),
          item({
            rfq_item_id: 'missing-spec',
            description: 'Pipe',
            specs_missing: true,
            missing_spec_keys: ['diameter'],
          }),
        ],
      }),
    ], beforeDeadlines);

    expect(presentation.warnings['quote-1']).toEqual(expect.arrayContaining([
      'Coverage: 3/4 requested items',
      'Unavailable: Cement',
      'Brand differs: Acme → Northstar',
      'Different specifications: Wire (gauge)',
      'Quoted quantity rounded up: Wire (2 piece)',
      'Missing specifications: Pipe (diameter)',
      'Arrives after needed-by date',
      'Delivery timing or terms not stated',
    ]));
    expect(presentation.selectableQuoteIds).toContain('quote-1');
  });

  it('does not expose a select action for a quote that is not sent', () => {
    const presentation = buildComparePresentation([
      quote({ quote_id: 'expired', status: 'expired' }),
    ], beforeDeadlines);

    expect(presentation.selectableQuoteIds).not.toContain('expired');
  });

  it('only exposes selection while the RFQ is open and enquiries are enabled', () => {
    const sentQuote = quote({ quote_id: 'sent' });

    expect(buildComparePresentation([sentQuote], { ...beforeDeadlines, rfqStatus: 'closed' }).selectableQuoteIds)
      .not.toContain('sent');
    const capabilityOff = buildComparePresentation([sentQuote], { ...beforeDeadlines, enquiriesEnabled: false });
    expect(capabilityOff.selectableQuoteIds).not.toContain('sent');
    expect(capabilityOff.lowestQuoteId).toBe('sent');
  });

  it.each([
    ['RFQ at', '2026-11-24T10:00:00.000Z', '2030-01-01T00:00:00.000Z'],
    ['RFQ after', '2026-11-24T09:59:59.999Z', '2030-01-01T00:00:00.000Z'],
    ['quote at', '2030-01-01T00:00:00.000Z', '2026-11-24T10:00:00.000Z'],
    ['quote after', '2030-01-01T00:00:00.000Z', '2026-11-24T09:59:59.999Z'],
  ])('blocks selection and lowest %s its deadline', (_label, rfqExpiresAt, validUntil) => {
    const presentation = buildComparePresentation([
      quote({ valid_until: validUntil }),
    ], { ...beforeDeadlines, rfqExpiresAt });

    expect(presentation.selectableQuoteIds).toEqual([]);
    expect(presentation.lowestQuoteId).toBeNull();
    expect(presentation.excludedFromLowestQuoteIds).toContain('quote-1');
  });

  it('fails closed without server selection authorization and preserves server totals', () => {
    const presentation = buildComparePresentation([
      quote({
        can_select: false,
        selection_block_reason: 'shop_unavailable',
        subtotal_paise: 101,
        gst_paise: 18,
        delivery_charge_paise: 25,
        total_paise: 144,
      }),
    ], beforeDeadlines);

    expect(presentation.selectableQuoteIds).toEqual([]);
    expect(presentation.rows[0].pricePaise).toBe(144);
  });

  it('keeps a live incomplete offer selectable but never lowest complete', () => {
    const presentation = buildComparePresentation([
      quote({
        quote_id: 'partial',
        total_paise: 50,
        complete: false,
        unavailable_count: 1,
        items: [item({ available: false })],
      }),
      quote({ quote_id: 'complete', total_paise: 100 }),
    ], beforeDeadlines);

    expect(presentation.selectableQuoteIds).toContain('partial');
    expect(presentation.lowestQuoteId).toBe('complete');
  });
});
