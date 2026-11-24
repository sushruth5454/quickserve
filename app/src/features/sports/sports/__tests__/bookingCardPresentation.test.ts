import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Button, Card, Text } from '../../../../components/ui';
import { getSportsBookingCardPresentation, SportsBookingCard, type SportsBookingCardBooking } from '../../SportsBookingCard';
import { getSportsBookingDeadline, getSportsBookingStatusLabel } from '../../model';
import {
  getSportsBookingsCardComposition,
  SportsBookingsHistoryCard,
} from '../../../sportsScreens/SportsBookingsScreen';

jest.mock('react-native', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    View: (props: any) => React.createElement('View', props, props.children),
  };
});

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
    push: jest.fn(),
    replace: jest.fn(),
  },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
}));

jest.mock('../../../../lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));
jest.mock('../../../../lib/auth', () => ({ useAuth: jest.fn() }));
jest.mock('../../../../lib/featureFlags', () => ({ useAppFeatureFlags: jest.fn() }));
jest.mock('../../../../theme', () => ({ useTheme: jest.fn() }));
jest.mock('../../useSportsReadRefresh', () => ({ useSportsReadRefresh: jest.fn() }));

jest.mock('../../../../components/ui', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const createComponent = (name: string) => (props: any) =>
    React.createElement(name, props, props.children);
  return {
    Badge: createComponent('Badge'),
    Button: createComponent('Button'),
    Card: createComponent('Card'),
    Text: createComponent('Text'),
  };
});

const booking: SportsBookingCardBooking = {
  id: 'sports-booking-known-pk',
  venue_name: 'North Court',
  activity_name: 'Badminton',
  resource_name: 'Court 1',
  starts_at: '2026-11-25T04:30:00.000Z',
  ends_at: '2026-11-25T06:00:00.000Z',
  status: 'accepted',
  price_paise: 100000,
  total_paise: 105000,
  payment_mode: 'online',
  paid_at: '2026-11-24T10:00:00.000Z',
  participants: 2,
  expires_at: '2026-11-24T11:00:00.000Z',
  hold_expires_at: null,
  pay_by: null,
};

function cardElements(node: ReactNode): ReactElement[] {
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  return [node, ...Children.toArray(children).flatMap(cardElements)];
}

function cardText(node: ReactNode): string[] {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(cardText);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; label?: unknown };
  return [
    ...(typeof props.label === 'string' ? [props.label] : []),
    ...cardText(props.children),
  ];
}

describe('sports booking card presentation', () => {
  it('SP-SAME-PK-CROSS-VIEW: keeps customer, activity, and business cards aligned for one booking', () => {
    const projections = {
      customer: { ...booking },
      activity: { ...booking },
      business: { ...booking, customer_name: 'Fixture Customer' },
    };
    const actual = Object.fromEntries(Object.entries(projections).map(([view, row]) => {
      const presentation = getSportsBookingCardPresentation(row);
      const visibleText = cardText(SportsBookingCard({ booking: row, showCustomer: view === 'business' })).join(' ');
      return [view, {
        id: row.id,
        status: presentation.statusLabel,
        amount: presentation.amountLabel,
        payment: presentation.paymentSummary,
        timeRangeHasStart: presentation.timeRange.includes('10:00'),
        timeRangeHasEnd: presentation.timeRange.includes('11:30'),
        visible: {
          confirmed: visibleText.includes('Confirmed'),
          paidOnline: visibleText.includes('Paid online'),
          exactTotal: visibleText.includes('₹1,050'),
        },
      }];
    }));

    expect(JSON.stringify(actual)).toBe(JSON.stringify({
      customer: {
        id: 'sports-booking-known-pk',
        status: 'Confirmed',
        amount: '₹1,050',
        payment: 'Paid online',
        timeRangeHasStart: true,
        timeRangeHasEnd: true,
        visible: { confirmed: true, paidOnline: true, exactTotal: true },
      },
      activity: {
        id: 'sports-booking-known-pk',
        status: 'Confirmed',
        amount: '₹1,050',
        payment: 'Paid online',
        timeRangeHasStart: true,
        timeRangeHasEnd: true,
        visible: { confirmed: true, paidOnline: true, exactTotal: true },
      },
      business: {
        id: 'sports-booking-known-pk',
        status: 'Confirmed',
        amount: '₹1,050',
        payment: 'Paid online',
        timeRangeHasStart: true,
        timeRangeHasEnd: true,
        visible: { confirmed: true, paidOnline: true, exactTotal: true },
      },
    }));
  });

  it('SP-ONLINE-NONZERO-FEE: uses the exact server total, says payment is due, and never calls venue payment online', () => {
    const due = { ...booking, status: 'awaiting_payment', paid_at: null, customer_fee_paise: 5000 };
    const payAtVenue = { ...booking, status: 'accepted', payment_mode: 'pay_at_venue' as const };
    const actual = {
      source: {
        status: due.status,
        payment_mode: due.payment_mode,
        price_paise: due.price_paise,
        customer_fee_paise: due.customer_fee_paise,
        total_paise: due.total_paise,
        paid_at: due.paid_at,
      },
      due: [due, { ...due }, { ...due, customer_name: 'Fixture Customer' }]
        .map((row) => getSportsBookingCardPresentation(row).paymentSummary),
      amount: getSportsBookingCardPresentation(due).amountLabel,
      payAtVenue: getSportsBookingCardPresentation(payAtVenue).paymentSummary,
    };

    expect(JSON.stringify(actual)).toBe(JSON.stringify({
      source: {
        status: 'awaiting_payment',
        payment_mode: 'online',
        price_paise: 100000,
        customer_fee_paise: 5000,
        total_paise: 105000,
        paid_at: null,
      },
      due: ['Online payment due', 'Online payment due', 'Online payment due'],
      amount: '₹1,050',
      payAtVenue: 'Pay at venue',
    }));
  });

  it('SP-FULL-TITLE-PRICE: keeps full booking title, INR amount, and actual range visible', () => {
    const longTitle = 'North Court Sports and Recreation Association - Indoor Badminton Centre';
    const longBooking = {
      ...booking,
      venue_name: longTitle,
      total_paise: 123456789,
    };
    const card = SportsBookingsHistoryCard({
      booking: longBooking,
      onPress: () => undefined,
    });
    const visibleText = cardText(card).join(' ');
    const rows = cardElements(card)
      .filter((element) => element.type === Text)
      .map((element) => ({
        variant: (element.props as { variant?: string }).variant,
        text: cardText(element).join(' '),
      }));
    const rangeRow = rows.findIndex((row) => row.text === getSportsBookingCardPresentation(longBooking).timeRange);
    const amountRow = rows.findIndex((row) => row.text.includes('₹12,34,567.89'));

    expect(JSON.stringify({
      titleVisible: visibleText.includes(longTitle),
      fullAmountVisible: visibleText.includes('₹12,34,567.89'),
      actualRangeVisible: rangeRow >= 0,
      rangeProminent: rows[rangeRow]?.variant === 'calloutStrong',
      rangeBeforeAmount: rangeRow >= 0 && amountRow > rangeRow,
      locationInvented: visibleText.includes('km away') || visibleText.includes('Address'),
      parentOffComposition: getSportsBookingsCardComposition(true, false),
      bothOffComposition: getSportsBookingsCardComposition(false, false),
    })).toBe(JSON.stringify({
      titleVisible: true,
      fullAmountVisible: true,
      actualRangeVisible: true,
      rangeProminent: true,
      rangeBeforeAmount: true,
      locationInvented: false,
      parentOffComposition: 'legacy',
      bothOffComposition: 'legacy',
    }));
  });

  it('SP-STAFF-READONLY: renders navigation and booking facts without payment, decision, or cancellation controls', () => {
    const card = SportsBookingCard({ booking: { ...booking, customer_name: 'Fixture Customer' }, showCustomer: true, onPress: () => undefined });
    const elements = cardElements(card);
    const root = elements[0];
    const actual = {
      rootIsCard: root?.type === Card,
      hasBookingNavigation: typeof (root?.props as { onPress?: unknown } | undefined)?.onPress === 'function',
      mutationControls: elements
        .filter((element) => element.type === Button)
        .length,
      visibleText: cardText(card).join(' '),
    };

    expect(JSON.stringify({
      rootIsCard: actual.rootIsCard,
      hasBookingNavigation: actual.hasBookingNavigation,
      mutationControls: actual.mutationControls,
      hasCustomer: actual.visibleText.includes('Fixture Customer'),
      hasPaymentSummary: actual.visibleText.includes('Paid online'),
    })).toBe(JSON.stringify({
      rootIsCard: true,
      hasBookingNavigation: true,
      mutationControls: 0,
      hasCustomer: true,
      hasPaymentSummary: true,
    }));
  });

  it('SP-REFUND-REQUESTED: labels refund totals as requested, never settled', () => {
    const presentation = getSportsBookingCardPresentation({
      ...booking,
      status: 'cancelled',
      refund_paise: 40000,
    });
    const actual = {
      refund: presentation.refundLabel,
      visibleText: cardText(SportsBookingCard({
        booking: { ...booking, status: 'cancelled', refund_paise: 40000 },
      })).join(' '),
    };

    expect(JSON.stringify({
      refund: actual.refund,
      visibleRefund: actual.visibleText.includes('Refund requested · ₹400'),
      saysRefunded: actual.visibleText.includes('Refunded'),
    })).toBe(JSON.stringify({
      refund: 'Refund requested · ₹400',
      visibleRefund: true,
      saysRefunded: false,
    }));
  });

  it('SP-TERMINAL-STATUSES-DISTINCT: keeps every terminal status visibly distinct', () => {
    const statuses = ['declined', 'cancelled', 'completed', 'expired'];
    const labels = statuses.map(getSportsBookingStatusLabel);
    const actual = { labels, uniqueCount: new Set(labels).size };

    expect(JSON.stringify(actual)).toBe(JSON.stringify({
      labels: ['Declined', 'Cancelled', 'Completed', 'Expired'],
      uniqueCount: 4,
    }));
  });

  it('SP-CARD-DEADLINES: uses response, hold, and pay-by deadlines only for their matching states', () => {
    const actual = {
      request: getSportsBookingDeadline({ status: 'requested', expires_at: '2026-11-24T10:00:00.000Z' }),
      hold: getSportsBookingDeadline({ status: 'pending_payment', hold_expires_at: '2026-11-24T11:00:00.000Z' }),
      payment: getSportsBookingDeadline({ status: 'awaiting_payment', pay_by: '2026-11-24T12:00:00.000Z' }),
      terminal: getSportsBookingDeadline({ status: 'completed', expires_at: '2026-11-24T09:00:00.000Z' }),
      wrongDeadline: getSportsBookingDeadline({ status: 'awaiting_payment', expires_at: '2026-11-24T09:00:00.000Z' }),
    };

    expect(JSON.stringify(actual)).toBe(JSON.stringify({
      request: { kind: 'request', label: 'Venue response due by', value: '2026-11-24T10:00:00.000Z' },
      hold: { kind: 'hold', label: 'Payment due by', value: '2026-11-24T11:00:00.000Z' },
      payment: { kind: 'payment', label: 'Payment due by', value: '2026-11-24T12:00:00.000Z' },
      terminal: null,
      wrongDeadline: null,
    }));
  });
});
