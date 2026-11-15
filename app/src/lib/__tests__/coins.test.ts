import { coinPaiseToCoins, coinRedemptionLimit, earnedCoinPaise } from '../coins';

describe('Seva Coins', () => {
  it('earns 2% and rounds down to whole ₹1 coins', () => {
    expect(earnedCoinPaise({ serviceValuePaise: 215099 })).toBe(4300);
    expect(earnedCoinPaise({ serviceValuePaise: 215000, coinDiscountPaise: 5000 })).toBe(4200);
  });

  it('caps redemption by 10% of service value, platform revenue and balance', () => {
    expect(coinRedemptionLimit({ balancePaise: 100000, serviceValuePaise: 215000, platformRevenuePaise: 17660 })).toBe(17600);
    expect(coinRedemptionLimit({ balancePaise: 5000, serviceValuePaise: 215000, platformRevenuePaise: 17660 })).toBe(5000);
    expect(coinRedemptionLimit({ balancePaise: 25099, serviceValuePaise: 10000, platformRevenuePaise: 50000 })).toBe(1000);
  });

  it('applies the 1,000-coin monthly earn cap after coin/refund exclusions', () => {
    expect(earnedCoinPaise({ serviceValuePaise: 60000000 })).toBe(100000);
    expect(earnedCoinPaise({ serviceValuePaise: 100000, coinDiscountPaise: 10000, refundPaise: 10000 })).toBe(1600);
    expect(coinPaiseToCoins(5000)).toBe(50);
  });
});
