import { parsePartialRefundRupees } from '../adminMoney';

describe('parsePartialRefundRupees', () => {
  it('converts whole rupees to exact paise at the paid cap', () => {
    expect(parsePartialRefundRupees('100', 10000)).toBe(10000);
  });

  it('rejects fractional, non-positive, unsafe and over-paid amounts', () => {
    expect(parsePartialRefundRupees('100.50', 20000)).toBeNull();
    expect(parsePartialRefundRupees('0', 20000)).toBeNull();
    expect(parsePartialRefundRupees('9007199254740992', 20000)).toBeNull();
    expect(parsePartialRefundRupees('101', 10000)).toBeNull();
  });
});
