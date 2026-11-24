import type { ProductCategory } from '../../shops/api';
import type { SupplierRfq } from '../api';
import { supplierRfqDetailRouteParams } from '../api';
import {
  hydrateSupplierQuoteDraft,
  reconcileSupplierQuoteDraft,
  supplierCategorySchema,
  updateSupplierQuoteDraftLine,
  updateSupplierQuoteDraftTerms,
} from '../supplierQuoteModel';

jest.mock('../../../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

function supplierRfq(overrides: Partial<SupplierRfq> = {}): SupplierRfq {
  return {
    id: 'rfq-1',
    category_id: 'category-1',
    category_name: 'Tiles',
    title: 'Floor tiles',
    city: 'Pune',
    area: 'Shivaji Nagar',
    needs_delivery: true,
    needed_by: '2027-01-15',
    notes: 'Requested notes',
    status: 'open',
    expires_at: '2027-01-20T00:00:00.000Z',
    shop_id: 'shop-1',
    shop_name: 'North Shop',
    business_role: 'owner',
    shop_has_gstin: true,
    can_send_quote: true,
    send_block_reason: null,
    items: [{
      id: 'item-1',
      seq: 1,
      description: 'Ceramic tile',
      brand_pref: '',
      specs: {},
      quantity: 2.5,
      unit: 'box',
    }],
    my_quote: {
      id: 'quote-2',
      version: 2,
      status: 'sent',
      delivery_charge_paise: 250,
      delivery_days: 4,
      valid_until: '2027-01-20T00:00:00.000Z',
      notes: 'Saved quote notes',
      subtotal_paise: 253,
      gst_paise: 46,
      total_paise: 549,
      items: [{
        rfq_item_id: 'item-1',
        seq: 1,
        description: 'Ceramic tile',
        brand: 'Aster',
        model: 'A-7',
        specs: { finish: 'matte' },
        quantity: 2.5,
        unit: 'box',
        unit_price_paise: 101,
        gst_rate_bp: 1800,
        available: true,
        line_total_paise: 253,
      }],
    },
    ...overrides,
  };
}

describe('supplier quote draft model', () => {
  it('MK-SUPPLIER-hydrate-real-version: hydrates persisted paise, quantity and revision', () => {
    const state = hydrateSupplierQuoteDraft(supplierRfq());

    expect(state).toMatchObject({
      contextKey: 'rfq-1:shop-1',
      revisionKey: 'quote-2/2',
      dirty: false,
      deliveryChargeRupees: '2.50',
      deliveryDays: '4',
      notes: 'Saved quote notes',
      lines: [{
        rfqItemId: 'item-1',
        brand: 'Aster',
        model: 'A-7',
        specs: { finish: 'matte' },
        offeredQuantity: '2.5',
        unitPriceRupees: '1.01',
        gstRate: '1800',
        available: true,
      }],
    });

    const savedQuote = supplierRfq().my_quote!;
    const unavailable = supplierRfq({
      my_quote: {
        ...savedQuote,
        items: savedQuote.items.map((item) => ({
          ...item,
          available: false,
          unit_price_paise: 0,
          line_total_paise: 0,
        })),
      },
    });
    expect(hydrateSupplierQuoteDraft(unavailable).lines[0]).toMatchObject({
      available: false,
      unitPriceRupees: '',
      offeredQuantity: '2.5',
    });
  });

  it('MK-SUPPLIER-context-reset-dirty-preserve: preserves dirty same-context edits and resets IDs on context switch', () => {
    const original = supplierRfq();
    const dirty = updateSupplierQuoteDraftTerms(
      updateSupplierQuoteDraftLine(hydrateSupplierQuoteDraft(original), 'item-1', { unitPriceRupees: '9.99' }),
      { notes: 'Unsaved notes' },
    );
    const refetched = supplierRfq({
      my_quote: {
        ...original.my_quote!,
        id: 'quote-3',
        version: 3,
        items: original.my_quote!.items.map((item) => ({ ...item, unit_price_paise: 777 })),
      },
    });
    const preserved = reconcileSupplierQuoteDraft(dirty, refetched);

    expect(preserved.lines[0]).toMatchObject({ rfqItemId: 'item-1', unitPriceRupees: '9.99' });
    expect(preserved).toMatchObject({ revisionKey: 'quote-3/3', dirty: true, notes: 'Unsaved notes' });

    const terminal = reconcileSupplierQuoteDraft(
      hydrateSupplierQuoteDraft(original),
      supplierRfq({ my_quote: { ...original.my_quote!, status: 'expired' } }),
    );
    expect(terminal).toMatchObject({
      revisionKey: 'quote-2/2',
      quoteStatus: 'expired',
      lines: [{ rfqItemId: 'item-1', unitPriceRupees: '' }],
      deliveryChargeRupees: '0',
      notes: '',
    });

    const switched = supplierRfq({
      id: 'rfq-2',
      shop_id: 'shop-2',
      items: [{
        id: 'item-2',
        seq: 1,
        description: 'Ceramic tile',
        brand_pref: '',
        specs: {},
        quantity: 2.5,
        unit: 'box',
      }],
      my_quote: null,
    });
    const reset = reconcileSupplierQuoteDraft(preserved, switched);

    expect(reset).toMatchObject({
      contextKey: 'rfq-2:shop-2',
      revisionKey: 'none',
      dirty: false,
      lines: [{ rfqItemId: 'item-2', unitPriceRupees: '', brand: '' }],
    });
    expect(reset.lines.some((line) => line.rfqItemId === 'item-1')).toBe(false);
  });

  it('MK-BUSINESS-explicit-shop-route: shared RFQ rows retain exact shop route context despite duplicate labels', () => {
    const rows = [
      { rfq_id: 'rfq-shared', shop_id: 'shop-alpha', shop_name: 'Same shop', category_name: 'Same category' },
      { rfq_id: 'rfq-shared', shop_id: 'shop-beta', shop_name: 'Same shop', category_name: 'Same category' },
    ];

    expect(rows.map(supplierRfqDetailRouteParams)).toEqual([
      { id: 'rfq-shared', shopId: 'shop-alpha' },
      { id: 'rfq-shared', shopId: 'shop-beta' },
    ]);
  });

  it('MK-SUPPLIER-category-id: duplicate display names resolve schema by category UUID', () => {
    const categories: ProductCategory[] = [
      {
        id: 'category-a',
        slug: 'tiles-a',
        name: 'Tiles',
        icon: 'square',
        sort_order: 1,
        attribute_schema: { properties: { finish: { type: 'string' } } },
      },
      {
        id: 'category-b',
        slug: 'tiles-b',
        name: 'Tiles',
        icon: 'square',
        sort_order: 2,
        attribute_schema: { properties: { thickness: { type: 'number' } } },
      },
    ];

    expect(supplierCategorySchema(categories, 'category-b')).toEqual({
      properties: { thickness: { type: 'number' } },
    });
    expect(supplierCategorySchema(categories, 'missing-category')).toEqual({ properties: {} });
  });
});
