import {
  getSportsVenueSettingsVisibility,
  isSportsCapacityValid,
  resolveSportsResourceSettings,
  resolveSportsVenuePaymentModes,
  resolveSportsVenuePaymentModesForSave,
  getSportsHomePaymentNotice,
} from '../model';
import { isFeatureOn } from '../../../lib/featureFlagModel';

const sportsOnFeatureOffFlags = {
  sports: true,
  sports_instant_booking: false,
  sports_capacity_slots: false,
  sports_online_payments: false,
};

const childrenOnParentOffFlags = {
  sports: false,
  sports_instant_booking: true,
  sports_capacity_slots: true,
  sports_online_payments: true,
};

test('[SP-15][SP-07][SB-08] feature-off settings preserve pay-at-venue and hide gated controls', () => {
  expect(getSportsVenueSettingsVisibility({
    isVenueOwner: true,
    payoutAccountReady: true,
    instantBookingEnabled: isFeatureOn(sportsOnFeatureOffFlags, 'sports_instant_booking'),
    capacitySlotsEnabled: isFeatureOn(sportsOnFeatureOffFlags, 'sports_capacity_slots'),
    onlinePaymentsEnabled: isFeatureOn(sportsOnFeatureOffFlags, 'sports_online_payments'),
  })).toEqual({
    canEdit: true,
    canEditBookingMode: false,
    canEditCapacity: false,
    showPaymentModes: true,
    showOnlinePaymentOption: false,
    canSelectOnlinePayment: false,
    showPayoutStatus: false,
    showPayoutSetup: false,
    payAtVenueAvailable: true,
  });
  expect(resolveSportsVenuePaymentModes(['online'])).toEqual(['online']);
});

test('[SP-05] sports parent-off disables child booking and payment settings', () => {
  expect(getSportsVenueSettingsVisibility({
    isVenueOwner: true,
    payoutAccountReady: true,
    instantBookingEnabled: isFeatureOn(childrenOnParentOffFlags, 'sports_instant_booking'),
    capacitySlotsEnabled: isFeatureOn(childrenOnParentOffFlags, 'sports_capacity_slots'),
    onlinePaymentsEnabled: isFeatureOn(childrenOnParentOffFlags, 'sports_online_payments'),
  })).toMatchObject({
    canEditBookingMode: false,
    canEditCapacity: false,
    showOnlinePaymentOption: false,
    canSelectOnlinePayment: false,
    showPayoutSetup: false,
  });
});

test('[SP-05] online payment requires its flag and a ready payout account', () => {
  expect(getSportsVenueSettingsVisibility({
    isVenueOwner: true,
    instantBookingEnabled: true,
    capacitySlotsEnabled: true,
    onlinePaymentsEnabled: true,
    payoutAccountReady: false,
  })).toMatchObject({
    showOnlinePaymentOption: true,
    canSelectOnlinePayment: false,
    showPayoutStatus: true,
    showPayoutSetup: true,
  });

  expect(getSportsVenueSettingsVisibility({
    isVenueOwner: true,
    instantBookingEnabled: true,
    capacitySlotsEnabled: true,
    onlinePaymentsEnabled: true,
    payoutAccountReady: true,
  })).toMatchObject({
    canEditBookingMode: true,
    canEditCapacity: true,
    showOnlinePaymentOption: true,
    canSelectOnlinePayment: true,
    showPayoutStatus: true,
    showPayoutSetup: false,
  });

  expect(resolveSportsVenuePaymentModes(['online'])).toEqual(['online']);
});

test('[SB-06] non-owner business staff cannot edit venue settings', () => {
  expect(getSportsVenueSettingsVisibility({
    isVenueOwner: false,
    instantBookingEnabled: true,
    capacitySlotsEnabled: true,
    onlinePaymentsEnabled: true,
    payoutAccountReady: true,
  })).toMatchObject({
    canEdit: false,
    canEditBookingMode: false,
    canEditCapacity: false,
    showPaymentModes: false,
    showOnlinePaymentOption: false,
    canSelectOnlinePayment: false,
    showPayoutStatus: false,
    showPayoutSetup: false,
  });
});

test('[SP-03] capacity accepts only whole numbers from 1 through 100', () => {
  expect([isSportsCapacityValid('1'), isSportsCapacityValid(100), isSportsCapacityValid('0'), isSportsCapacityValid('101'), isSportsCapacityValid('1.5')])
    .toEqual([true, true, false, false, false]);
});

test('[SP-07][SP-15] disabled instant and capacity features preserve stored resource settings', () => {
  expect(resolveSportsResourceSettings('approval', 1, false, false, {
    bookingMode: 'instant',
    capacity: 8,
  })).toEqual({
    bookingMode: 'instant',
    capacity: 8,
  });
  expect(resolveSportsResourceSettings('instant', 8, true, true)).toEqual({
    bookingMode: 'instant',
    capacity: 8,
  });
  expect(resolveSportsResourceSettings('approval', 1, false, false)).toEqual({
    bookingMode: 'approval',
    capacity: 1,
  });
});

test('[SP-15] saving while online payment is unavailable preserves its stored mode', () => {
  const onlinePaymentsOff = getSportsVenueSettingsVisibility({
    isVenueOwner: true,
    instantBookingEnabled: true,
    capacitySlotsEnabled: true,
    onlinePaymentsEnabled: false,
    payoutAccountReady: true,
  });
  const payoutAccountNotReady = getSportsVenueSettingsVisibility({
    isVenueOwner: true,
    instantBookingEnabled: true,
    capacitySlotsEnabled: true,
    onlinePaymentsEnabled: true,
    payoutAccountReady: false,
  });
  expect(resolveSportsVenuePaymentModesForSave(
    ['online'],
    ['online'],
    onlinePaymentsOff.canSelectOnlinePayment,
  )).toEqual(['online']);
  expect(resolveSportsVenuePaymentModesForSave(
    ['online'],
    ['online'],
    payoutAccountNotReady.canSelectOnlinePayment,
  )).toEqual(['online']);
  expect(resolveSportsVenuePaymentModesForSave(
    ['online', 'pay_at_venue'],
    ['online', 'pay_at_venue'],
    onlinePaymentsOff.canSelectOnlinePayment,
  )).toEqual(['online', 'pay_at_venue']);
  expect(resolveSportsVenuePaymentModesForSave(
    ['online', 'pay_at_venue'],
    ['pay_at_venue'],
    onlinePaymentsOff.canSelectOnlinePayment,
  )).toEqual(['online', 'pay_at_venue']);
  expect(resolveSportsVenuePaymentModesForSave(
    ['pay_at_venue'],
    ['pay_at_venue', 'online'],
    onlinePaymentsOff.canSelectOnlinePayment,
  )).toEqual(['pay_at_venue']);
  expect(resolveSportsVenuePaymentModesForSave(
    ['pay_at_venue'],
    ['online'],
    true,
  )).toEqual(['online']);
});

test('[SB-08][SP-15] sports-home copy remains pay-at-venue-only while online payments are off', () => {
  expect(getSportsHomePaymentNotice(false)).toBe('Pay at the venue. QuickServe does not collect sports booking payments.');
  expect(getSportsHomePaymentNotice(true)).toBe('Pay at the venue or online where available.');
});
