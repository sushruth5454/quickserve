import { DEFAULT_COINS_CONFIG, coinPaiseToCoins, coinRedemptionLimit, earnedCoinPaise } from '../coins';

describe('Seva Coins', () => {
  it('uses the owner-approved 1% policy and rounds to 10-paise coins', () => {
    expect(earnedCoinPaise({ serviceValuePaise: 123456 })).toBe(1230);
    expect(earnedCoinPaise({ serviceValuePaise: 215099 })).toBe(2000);
    expect(earnedCoinPaise({ serviceValuePaise: 215000, coinDiscountPaise: 5000 })).toBe(2000);
    expect(coinPaiseToCoins(5000)).toBe(500);
    expect(coinPaiseToCoins(5009)).toBe(500);
    expect(coinPaiseToCoins(5000, { coin_paise: 100 })).toBe(50);
  });

  it('caps and rounds redemption by configured denomination, service value, platform revenue and balance', () => {
    expect(coinRedemptionLimit({ balancePaise: 100000, serviceValuePaise: 215000, platformRevenuePaise: 17660 })).toBe(17660);
    expect(coinRedemptionLimit({ balancePaise: 5000, serviceValuePaise: 215000, platformRevenuePaise: 17660 })).toBe(5000);
    expect(coinRedemptionLimit({ balancePaise: 25099, serviceValuePaise: 10000, platformRevenuePaise: 50000 })).toBe(1000);
    expect(coinRedemptionLimit(
      { balancePaise: 1050, serviceValuePaise: 20000, platformRevenuePaise: 50000 },
      { coin_paise: 100, redeem_cap_bp: 1000 },
    )).toBe(1000);
  });

  it('applies the configured per-booking cap, first-booking bonus, monthly cap and budget', () => {
    const prdConfig = {
      ...DEFAULT_COINS_CONFIG,
      earn_rate_bp: 100,
      per_txn_cap_paise: 2000,
      first_txn_bonus_paise: 1000,
      pilot_budget_paise: 1000000,
    };
    expect(earnedCoinPaise({ serviceValuePaise: 215000, isFirstBooking: true }, prdConfig)).toBe(3000);
    expect(earnedCoinPaise({ serviceValuePaise: 215000, isFirstBooking: false }, prdConfig)).toBe(2000);
    expect(earnedCoinPaise({ serviceValuePaise: 215000, isFirstBooking: true, issuedTotalPaise: 999500 }, prdConfig)).toBe(500);
    expect(earnedCoinPaise(
      { serviceValuePaise: 60000000 },
      { ...DEFAULT_COINS_CONFIG, per_txn_cap_paise: null },
    )).toBe(100000);
    expect(earnedCoinPaise({ serviceValuePaise: 100000, coinDiscountPaise: 10000, refundPaise: 10000 })).toBe(800);
    expect(earnedCoinPaise({ serviceValuePaise: 215000, earnedThisMonthPaise: 100000 }, prdConfig)).toBe(0);
  });
});
