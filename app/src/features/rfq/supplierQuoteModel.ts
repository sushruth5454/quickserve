import type { SupplierRfq, SupplierQuoteSaved, SupplierQuoteStatus } from './api';
import type { ProductCategory } from '../shops/api';

export type SupplierQuoteDraftLine = {
  rfqItemId: string;
  brand: string;
  model: string;
  specs: Record<string, string>;
  offeredQuantity: string;
  unitPriceRupees: string;
  gstRate: string;
  available: boolean;
};

export type SupplierQuoteDraftState = {
  contextKey: string;
  revisionKey: string;
  quoteStatus: SupplierQuoteStatus | null;
  dirty: boolean;
  lines: SupplierQuoteDraftLine[];
  deliveryChargeRupees: string;
  deliveryDays: string;
  notes: string;
};

export function supplierQuoteContextKey(rfqId: string, shopId: string): string {
  return `${rfqId}:${shopId}`;
}

export function supplierQuoteRevisionKey(quote: Pick<SupplierQuoteSaved, 'id' | 'version'> | null): string {
  return quote ? `${quote.id}/${quote.version}` : 'none';
}

export function supplierCategorySchema(
  categories: ProductCategory[],
  categoryId: string,
): ProductCategory['attribute_schema'] {
  return categories.find((category) => category.id === categoryId)?.attribute_schema ?? { properties: {} };
}

function paiseInput(paise: number): string {
  const wholeRupees = Math.trunc(paise / 100);
  const remainderPaise = Math.abs(paise % 100);
  return `${wholeRupees}.${String(remainderPaise).padStart(2, '0')}`;
}

function specsInput(specs: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(specs ?? {}).map(([key, value]) => [key, String(value)]));
}

function blankLine(rfqItemId: string, shopHasGstin: boolean): SupplierQuoteDraftLine {
  return {
    rfqItemId,
    brand: '',
    model: '',
    specs: {},
    offeredQuantity: '',
    unitPriceRupees: '',
    gstRate: shopHasGstin ? '1800' : '0',
    available: true,
  };
}

function hydrateLine(
  rfqItemId: string,
  shopHasGstin: boolean,
  savedLine: SupplierQuoteSaved['items'][number] | undefined,
): SupplierQuoteDraftLine {
  if (!savedLine) return blankLine(rfqItemId, shopHasGstin);
  return {
    rfqItemId,
    brand: savedLine.brand,
    model: savedLine.model,
    specs: specsInput(savedLine.specs),
    offeredQuantity: String(savedLine.quantity),
    unitPriceRupees: savedLine.available ? paiseInput(savedLine.unit_price_paise) : '',
    gstRate: shopHasGstin ? String(savedLine.gst_rate_bp) : '0',
    available: savedLine.available,
  };
}

export function hydrateSupplierQuoteDraft(rfq: SupplierRfq): SupplierQuoteDraftState {
  const latestQuote = rfq.my_quote;
  const editableSentQuote = latestQuote?.status === 'sent' ? latestQuote : null;
  const savedLines = new Map(editableSentQuote?.items.map((item) => [item.rfq_item_id, item]) ?? []);
  return {
    contextKey: supplierQuoteContextKey(rfq.id, rfq.shop_id),
    revisionKey: supplierQuoteRevisionKey(latestQuote),
    quoteStatus: latestQuote?.status ?? null,
    dirty: false,
    lines: rfq.items.map((item) => hydrateLine(
      item.id,
      rfq.shop_has_gstin,
      savedLines.get(item.id),
    )),
    deliveryChargeRupees: editableSentQuote ? paiseInput(editableSentQuote.delivery_charge_paise) : '0',
    deliveryDays: editableSentQuote?.delivery_days == null ? '' : String(editableSentQuote.delivery_days),
    notes: editableSentQuote?.notes ?? '',
  };
}

export function reconcileSupplierQuoteDraft(
  current: SupplierQuoteDraftState | null,
  rfq: SupplierRfq,
): SupplierQuoteDraftState {
  const contextKey = supplierQuoteContextKey(rfq.id, rfq.shop_id);
  const revisionKey = supplierQuoteRevisionKey(rfq.my_quote);
  const quoteStatus = rfq.my_quote?.status ?? null;
  if (!current || current.contextKey !== contextKey) return hydrateSupplierQuoteDraft(rfq);
  if (current.dirty) {
    return {
      ...current,
      revisionKey,
      quoteStatus,
      lines: rfq.shop_has_gstin
        ? current.lines
        : current.lines.map((line) => ({ ...line, gstRate: '0' })),
    };
  }
  if (current.revisionKey !== revisionKey || current.quoteStatus !== quoteStatus) return hydrateSupplierQuoteDraft(rfq);
  if (!rfq.shop_has_gstin && current.lines.some((line) => line.gstRate !== '0')) {
    return { ...current, lines: current.lines.map((line) => ({ ...line, gstRate: '0' })) };
  }
  return current;
}

export function updateSupplierQuoteDraftLine(
  state: SupplierQuoteDraftState,
  rfqItemId: string,
  patch: Partial<SupplierQuoteDraftLine>,
): SupplierQuoteDraftState {
  return {
    ...state,
    dirty: true,
    lines: state.lines.map((line) => line.rfqItemId === rfqItemId ? { ...line, ...patch } : line),
  };
}

export function updateSupplierQuoteDraftTerms(
  state: SupplierQuoteDraftState,
  patch: Partial<Pick<SupplierQuoteDraftState, 'deliveryChargeRupees' | 'deliveryDays' | 'notes'>>,
): SupplierQuoteDraftState {
  return { ...state, ...patch, dirty: true };
}
