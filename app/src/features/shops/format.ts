import { formatINR } from '../../lib/money';
import type { ProductUnit } from './api';

export const UNIT_LABELS: Record<ProductUnit, string> = {
  piece: 'piece',
  sqft: 'sq ft',
  box: 'box',
  kg: 'kg',
  litre: 'litre',
  bag: 'bag',
  metre: 'metre',
  set: 'set',
};

export function formatIndicativePrice(pricePaise: number | null, unit: ProductUnit): string {
  if (pricePaise == null) return 'Ask shop for price';
  return `${formatINR(pricePaise)} / ${UNIT_LABELS[unit]}`;
}
