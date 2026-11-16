import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Linking, ScrollView, Switch, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { QuoteView } from '../../src/components/QuoteView';
import { statusLabel } from '../../src/components/status';
import { StatusHero, type HeroCopy } from '../../src/components/StatusHero';
import { ChatButton } from '../../src/components/UnreadChat';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  Header,
  IconButton,
  InlineAlert,
  LIST_INSET,
  ListItem,
  OTPInput,
  RatingStars,
  Screen,
  Section,
  Skeleton,
  Text,
  TextArea,
  useConfirm,
  useToast,
  type Tone,
} from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { isDemoMode } from '../../src/lib/config';
import { DEMO_PROVIDER_END_CODE, DEMO_PROVIDER_START_CODE } from '../../src/lib/demo/seed';
import { haptics } from '../../src/lib/haptics';
import { amountDue, formatINR } from '../../src/lib/money';
import { coinPaiseToCoins, earnedCoinPaise, type CoinRedemptionPreview } from '../../src/lib/coins';
import { usePayment } from '../../src/lib/payments';
import { typicalRange } from '../../src/lib/pricing';
import { registerForPush } from '../../src/lib/push';
import { bookingRef, dayLabel, scheduleLabel } from '../../src/lib/schedule';
import type { Booking, BookingAddress, BookingEvent, BookingOtps, Payment, PaymentSchedule as PaymentScheduleRow, PaymentStatus, Quote, Review, ReviewInput } from '../../src/lib/types';
import { useUnread } from '../../src/lib/unreadContext';
import { useTheme } from '../../src/theme';
import { PaymentScheduleTimeline } from '../../src/features/catalogue/PaymentScheduleTimeline';

interface Data {
  booking: Booking;
  quotes: Quote[];
  payments: Payment[];
  events: BookingEvent[];
  otps: BookingOtps | null;
  address: BookingAddress | null;
  review: Review | null;
  counterpart: string;
  photoUrls: string[];
  coinPreview: CoinRedemptionPreview | null;
  paymentSchedule: PaymentScheduleRow[];
}

const PAYMENT_STATUS: Record<PaymentStatus, [string, Tone]> = {
  created: ['Pending', 'warning'],
  paid: ['Paid', 'success'],
  failed: ['Failed', 'danger'],
  refund_pending: ['Refund pending', 'neutral'],
  refund_processing: ['Refund processing', 'neutral'],
  refunded: ['Refunded', 'neutral'],
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function BookingDetail() {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const startPayment = usePayment();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const unread = useUnread();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Provider code entry (start / completion), submitted from the sticky footer.
  const [otp, setOtp] = useState('');
  const [otpMsg, setOtpMsg] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [useCoins, setUseCoins] = useState(true);

  const load = useCallback(async () => {
    if (!id || !userId) return;
    try {
      const booking = await api.getBooking(id);
      const isCustomer = booking.customer_id === userId;
      const [quotes, payments, events, otps, address, review, counterpart, photoUrls, paymentSchedule] = await Promise.all([
        api.getQuotes(id),
        api.getPayments(id),
        api.getEvents(id).catch(() => [] as BookingEvent[]),
        isCustomer ? api.getBookingOtps(id) : Promise.resolve(null),
        api.getBookingAddress(id),
        api.getReviewForBooking(id),
        api.getProfileName(isCustomer ? booking.provider_id : booking.customer_id),
        api.signedPhotoUrls(booking.photos).catch(() => []),
        api.listPaymentSchedule(id).catch(() => [] as PaymentScheduleRow[]),
      ]);
      const sentQuote = quotes.find((q) => q.status === 'sent') ?? null;
      const coinPreview = isCustomer && sentQuote
        ? await api.getCoinRedemptionPreview(id, sentQuote.id).catch(() => null)
        : null;
      setData({ booking, quotes, payments, events, otps, address, review, counterpart, photoUrls, coinPreview, paymentSchedule });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, userId]);

  useEffect(() => {
    void load();
    if (!id) return;
    return api.subscribeToBooking(id, () => void load());
  }, [id, load]);

  // A live booking is the moment updates matter (acceptance, quotes, chat): ask for notification permission once.
  const liveBooking = !!data && !['pending_payment', 'declined', 'expired', 'cancelled', 'closed', 'refunded'].includes(data.booking.status);
  useEffect(() => {
    if (liveBooking && userId) void registerForPush(userId, { prompt: true });
  }, [liveBooking, userId]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      setActionError(null);
      try {
        await fn();
        await load();
        if (success) toast({ message: success, tone: 'success' });
      } catch (e) {
        haptics.error();
        setActionError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load, toast],
  );

  const pay = useCallback(
    () =>
      run(async () => {
        if (!id) return;
        const res = await startPayment(id);
        if (res === 'paid') toast({ message: 'Payment received', tone: 'success' });
      }),
    [id, run, startPayment, toast],
  );

  if (!data || !userId) {
    return (
      <Screen header={<Header title="Booking" />}>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <>
            <Skeleton height={150} radius={t.radii.lg} />
            <Skeleton height={110} radius={t.radii.lg} />
            <Skeleton height={200} radius={t.radii.lg} />
          </>
        )}
      </Screen>
    );
  }

  const { booking, quotes, payments, otps, review } = data;
  const s = booking.status;
  const isCustomer = booking.customer_id === userId;
  const isTimeBased = booking.archetype === 'time_based';
  // Proposal, fixed and pay-per-session bookings pay every obligation due now (e.g. advance + platform fee) in one payment.
  const scheduled = (booking.archetype === 'proposal' || booking.archetype === 'fixed' || isTimeBased) && data.paymentSchedule.length > 0;
  const dueNow = data.paymentSchedule.filter((row) => row.status === 'due').reduce((sum, row) => sum + row.amount, 0);
  const first = data.counterpart.split(' ')[0] ?? data.counterpart;
  // Net of partial refunds (e.g. a change order that lowered the total), matching the server's amount owed.
  const paid = payments
    .filter((p) => p.status === 'paid')
    .reduce((acc, p) => acc + p.amount - (p.refunds ?? []).filter((r) => r.status !== 'failed').reduce((sum, r) => sum + r.amount, 0), 0);
  const coinPaid = payments
    .filter((p) => p.status === 'paid' && p.funding_source === 'coins')
    .reduce((acc, p) => acc + p.amount, 0);
  const openQuote = quotes.find((q) => q.status === 'sent') ?? null;
  const pendingPaymentQuote = quotes.find((q) => q.status === 'approved_pending_payment') ?? null;
  const approvedQuote = quotes.find((q) => q.id === booking.approved_quote_id) ?? null;
  const shownQuoteIds = new Set([openQuote?.id, pendingPaymentQuote?.id].filter(Boolean));
  const typical = typicalRange(booking.categories?.slug);
  const customerRespondsToQuote = isCustomer && !!openQuote && (s === 'quote_sent' || s === 'in_progress');
  const dueForPending = pendingPaymentQuote
    ? amountDue({ quoteTotal: pendingPaymentQuote.total, visitFee: booking.visit_fee, platformFee: booking.platform_fee, alreadyPaid: paid })
    : 0;

  // ---------- actions ----------
  const cancel = async (warning: string) => {
    const ok = await confirm({
      title: 'Cancel this booking?',
      message: warning,
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep booking',
      destructive: true,
    });
    if (ok) void run(() => api.cancelBooking(booking.id), 'Booking cancelled');
  };

  const approve = (quote: Quote) =>
    run(async () => {
      const res = await api.approveQuote(booking.id, quote.id, useCoins);
      if (res.amount_due > 0) await startPayment(booking.id);
    }, 'Quote approved');

  const reject = async (quote: Quote) => {
    const initial = s === 'quote_sent';
    const ok = await confirm({
      title: initial ? 'Decline the quote?' : 'Decline the change order?',
      message: initial
        ? `The job will close and your visit fee is paid to ${first} for the inspection.`
        : 'Work continues on the already-approved scope.',
      confirmLabel: 'Decline',
      destructive: true,
    });
    if (ok) void run(() => api.rejectQuote(booking.id, quote.id), 'Quote declined');
  };

  const submitOtp = async (value = otp) => {
    if (value.length !== 4) return;
    const arriving = s === 'en_route' || (isTimeBased && s === 'accepted');
    const proposalStart = s === 'confirmed' && booking.archetype === 'proposal';
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = proposalStart
        ? await api.startProposalBooking(booking.id, value)
        : arriving ? await api.arrive(booking.id, value) : await api.completeBooking(booking.id, value);
      if (res.ok) {
        haptics.success();
        setOtp('');
        void run(async () => undefined, arriving ? 'Arrival confirmed' : 'Job completed');
      } else {
        haptics.error();
        setOtpMsg(
          res.error === 'locked'
            ? 'Locked after 5 wrong attempts. Ask the customer to generate a new code.'
            : `Wrong code. ${res.attempts_left ?? 0} attempts left.`,
        );
      }
    } catch (e) {
      setOtpMsg((e as Error).message);
    } finally {
      setOtpBusy(false);
    }
  };

  const openEditor = (changeOrder: boolean) =>
    router.push({ pathname: '/quote/[bookingId]', params: { bookingId: booking.id, changeOrder: changeOrder ? '1' : '0' } });
  const call = () => toast({ message: 'Masked calling is coming soon. Use chat for now — numbers stay private.' });
  const navigate =
    !isCustomer && data.address?.lat != null && data.address?.lng != null
      ? () =>
          Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${data.address!.lat},${data.address!.lng}`).catch(() =>
            toast({ message: 'Could not open maps.', tone: 'error' }),
          )
      : null;

  // ---------- sticky footer ----------
  let footer: ReactNode;
  if (isCustomer) {
    if (customerRespondsToQuote && openQuote) {
      const previewDiscount = useCoins ? data.coinPreview?.maximum_paise ?? 0 : 0;
      const due = Math.max(
        0,
        amountDue({ quoteTotal: openQuote.total, visitFee: booking.visit_fee, platformFee: booking.platform_fee, alreadyPaid: paid })
          - previewDiscount,
      );
      footer = (
        <AmountFooter label={openQuote.is_change_order ? 'Extra to pay' : 'To pay now'} amount={due}>
          <Button title={due > 0 ? 'Approve & pay' : 'Approve'} onPress={() => void approve(openQuote)} loading={busy} size="lg" style={{ flex: 1 }} />
        </AmountFooter>
      );
    } else if (pendingPaymentQuote && dueForPending > 0 && !scheduled) {
      footer = (
        <AmountFooter label="Balance due" amount={dueForPending}>
          <Button
            title={pendingPaymentQuote.is_change_order ? 'Pay extra' : 'Pay to start work'}
            leftIcon="lock-closed"
            onPress={() => void pay()}
            loading={busy}
            size="lg"
            style={{ flex: 1 }}
          />
        </AmountFooter>
      );
    } else if (s === 'pending_payment') {
      footer = (
        <AmountFooter label={scheduled ? 'Due now' : isTimeBased ? 'Session payment' : 'Visit fee'} amount={scheduled ? dueNow : isTimeBased ? booking.total_amount ?? 0 : booking.visit_fee}>
          <Button title={isTimeBased ? 'Pay session' : scheduled ? 'Pay & confirm' : 'Pay & send request'} leftIcon="lock-closed" onPress={() => void pay()} loading={busy} size="lg" style={{ flex: 1 }} />
        </AmountFooter>
      );
    } else if (s === 'completion_requested') {
      if (booking.archetype === 'proposal' && booking.delivery_status === 'submitted') {
        footer = (
          <Button title="Accept delivery" leftIcon="checkmark-done" size="lg" fullWidth loading={busy}
            onPress={() => void run(() => api.acceptDelivery(booking.id), 'Delivery accepted')} />
        );
      } else {
      footer = (
        <Button
          title="Confirm job done"
          leftIcon="checkmark-done"
          size="lg"
          fullWidth
          loading={busy}
          onPress={() => void run(() => api.confirmCompletion(booking.id), 'Job marked complete')}
        />
      );
      }
    }
  } else if (s === 'accepted') {
    footer = (
      <Button
        title={isTimeBased ? 'Verify session start code' : 'Start trip'}
        leftIcon={isTimeBased ? 'key-outline' : 'navigate'}
        size="lg"
        fullWidth
        disabled={isTimeBased && otp.length !== 4}
        loading={otpBusy || busy}
        onPress={() => isTimeBased ? void submitOtp() : void run(() => api.startTrip(booking.id), 'Customer notified you are on the way')}
      />
    );
  } else if (s === 'confirmed' && booking.archetype === 'proposal') {
    footer = (
      <Button
        title="Enter start code"
        leftIcon="keypad-outline"
        size="lg"
        fullWidth
        disabled={otp.length !== 4}
        loading={otpBusy || busy}
        onPress={() => void submitOtp()}
      />
    );
  } else if (s === 'in_progress' && booking.archetype === 'proposal' && booking.delivery_status === 'pending') {
    footer = (
      <Button title="Begin deliverables" size="lg" fullWidth loading={busy}
        onPress={() => void run(() => api.beginDelivery(booking.id), 'Deliverables opened')} />
    );
  } else if (s === 'delivery_pending' && booking.archetype === 'proposal') {
    footer = <Button title="Submit delivery" size="lg" fullWidth onPress={() => router.push({ pathname: '/proposal-delivery/[id]', params: { id: booking.id } })} />;
  } else if (s === 'en_route' || s === 'completion_requested') {
    footer = (
      <Button
        title={s === 'en_route' ? 'Verify start code' : 'Verify completion code'}
        size="lg"
        fullWidth
        disabled={otp.length !== 4}
        loading={otpBusy || busy}
        onPress={() => void submitOtp()}
      />
    );
  } else if (s === 'inspecting') {
    footer = <Button title="Create quote" leftIcon="receipt-outline" size="lg" fullWidth onPress={() => openEditor(false)} />;
  } else if (s === 'in_progress') {
    footer = (
      <Button
        title="Request completion"
        leftIcon="checkmark-done"
        size="lg"
        fullWidth
        disabled={!!openQuote}
        loading={busy}
        onPress={() => void run(() => api.requestCompletion(booking.id), 'Customer asked to confirm')}
      />
    );
  }

  // ---------- secondary actions at the bottom (cancel / report) ----------
  const cancelAction: [string, string] | null = !isCustomer
    ? null
    : s === 'pending_payment'
      ? ['Cancel booking', 'No charge — you have not paid yet.']
      : s === 'requested' || s === 'accepted'
        ? ['Cancel booking', 'Your visit fee will be refunded in full.']
        : s === 'en_route'
          ? ['Cancel booking', `${first} is already on the way, so the visit fee will not be refunded.`]
          : s === 'awaiting_payment'
            ? ['Cancel job', `The inspection is done, so the visit fee will be paid to ${first}.`]
            : null;
  const canReport = isCustomer && (s === 'in_progress' || s === 'completion_requested' || s === 'completed');

  const startCode = otps?.start_otp ?? null;
  const endCode = otps?.end_otp ?? null;
  const hero = heroCopy({
    status: s,
    archetype: booking.archetype ?? 'inspect_quote',
    isCustomer,
    first,
    visitFee: booking.visit_fee,
    startCode,
    endCode,
    changeOrderOpen: s === 'in_progress' && !!openQuote,
    cancelledReason: booking.cancelled_reason,
  });
  const pro = booking.providers;
  const helpItems: { key: string; title: string; icon: keyof typeof Ionicons.glyphMap; destructive?: boolean; onPress: () => void }[] = [
    {
      key: 'help',
      title: 'Get help with this booking',
      icon: 'help-buoy-outline',
      onPress: () =>
        void Linking.openURL(`mailto:support@quickserve.app?subject=${encodeURIComponent(`Booking ${bookingRef(booking.id)}`)}`).catch(() =>
          toast({ message: 'Email support@quickserve.app' }),
        ),
    },
    { key: 'safety', title: 'Safety & guarantee', icon: 'shield-checkmark-outline', onPress: () => router.push({ pathname: '/info/[topic]', params: { topic: 'safety' } }) },
  ];
  if (canReport && !disputeOpen) helpItems.push({ key: 'report', title: 'Report a problem', icon: 'flag-outline', onPress: () => setDisputeOpen(true) });
  if (cancelAction) helpItems.push({ key: 'cancel', title: cancelAction[0], icon: 'close-circle-outline', destructive: true, onPress: () => void cancel(cancelAction[1]) });

  return (
    <Screen
      header={<Header title={booking.categories?.name ?? 'Booking'} subtitle={`${bookingRef(booking.id)} · ${dayLabel(new Date(booking.created_at))}`} />}
      footer={footer}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <StatusHero status={s} copy={hero} events={data.events} archetype={booking.archetype} />
      <InlineAlert message={actionError} />
      {/* Single payment schedule view; the footer collects the first payment while the booking is pending. */}
      <PaymentScheduleTimeline key={`${booking.id}:${s}`} bookingId={booking.id} canPay={isCustomer} showPay={s !== 'pending_payment'} onPaid={() => void load()} />

      {/* ---------- customer actions ---------- */}
      {isCustomer && (s === 'accepted' || s === 'en_route' || (s === 'confirmed' && booking.archetype === 'proposal')) ? (
        <OtpCard
          title="Start code"
          hint={
            booking.archetype === 'proposal'
              ? `Share only when ${first} starts the work (at the shoot or event, or on call for remote work).`
              : `Share only when ${first} is at your door.`
          }
          code={startCode}
          locked={!!otps?.start_locked}
          onRegenerate={() => void run(() => api.regenerateOtp(booking.id, 'start'), 'New code generated')}
        />
      ) : null}
      {isCustomer && s === 'completion_requested' ? (
        <OtpCard
          title="Completion code"
          hint={`Share only if you're happy with the work. Auto-confirms 24 hours after ${first} marked it done.`}
          code={endCode}
          locked={!!otps?.end_locked}
          onRegenerate={() => void run(() => api.regenerateOtp(booking.id, 'end'), 'New code generated')}
        />
      ) : null}
      {customerRespondsToQuote && openQuote ? (
        <View style={{ gap: t.spacing.xs }}>
          {data.coinPreview && data.coinPreview.maximum_paise > 0 ? (
            <Card
              gap={t.spacing.sm}
              style={{ flexDirection: 'row', alignItems: 'center' }}
              accessibilityLabel={`Use ${formatINR(data.coinPreview.maximum_paise)} in Seva Coins`}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="calloutStrong">Use {formatINR(data.coinPreview.maximum_paise)} Seva Coins</Text>
                <Text variant="footnote" color="muted">
                  {coinPaiseToCoins(data.coinPreview.maximum_paise)} of your {coinPaiseToCoins(data.coinPreview.balance_paise)} coins · 1 coin = ₹1
                </Text>
              </View>
              <Switch
                accessibilityLabel="Use Seva Coins"
                value={useCoins}
                onValueChange={setUseCoins}
                trackColor={{ false: t.colors.outline, true: t.colors.primary }}
                thumbColor="#FFFFFF"
              />
            </Card>
          ) : null}
          <QuoteView
            quote={openQuote}
            visitFee={booking.visit_fee}
            platformFee={booking.platform_fee}
            alreadyPaid={paid}
            counterpartName={data.counterpart}
            coinDiscountPreview={useCoins ? data.coinPreview?.maximum_paise ?? 0 : 0}
            coinPaid={coinPaid}
            typical={openQuote.is_change_order ? null : typical}
          />
          <Button
            title={openQuote.is_change_order ? 'Decline change order' : 'Decline quote'}
            variant="destructiveGhost"
            onPress={() => void reject(openQuote)}
            disabled={busy}
          />
        </View>
      ) : null}
      {isCustomer && pendingPaymentQuote && dueForPending > 0 ? (
        <QuoteView quote={pendingPaymentQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} counterpartName={data.counterpart} coinPaid={coinPaid} />
      ) : null}
      {isCustomer && (s === 'completed' || s === 'closed') && !review ? (
        <ReviewForm name={first} busy={busy} reviewTags={booking.categories?.review_tags ?? []} onSubmit={(r) => void run(() => api.submitReview(booking.id, r), 'Thanks for your review!')} />
      ) : null}
      {isCustomer && (s === 'completed' || s === 'closed') && approvedQuote ? (
        <InlineAlert
          tone="success"
          icon="sparkles-outline"
          message={`${formatINR(
            earnedCoinPaise({
              serviceValuePaise: Math.max(approvedQuote.total, booking.visit_fee),
              coinDiscountPaise: booking.coin_discount ?? 0,
              refundPaise: booking.refund_amount,
            }),
          )} Seva Coins ${s === 'closed' ? 'added to your wallet' : 'will be added after the 24-hour dispute window'}.`}
        />
      ) : null}

      {/* ---------- provider actions ---------- */}
      {!isCustomer && (s === 'en_route' || s === 'completion_requested' || (isTimeBased && s === 'accepted') || (s === 'confirmed' && booking.archetype === 'proposal')) ? (
        <Card variant="elevated" gap={t.spacing.lg}>
          <Text variant="subheadStrong" color="textSecondary" align="center">
            {s === 'completion_requested' ? 'Completion code' : 'Start code'} from {first}
          </Text>
          <OTPInput
            length={4}
            value={otp}
            onChange={(v) => {
              setOtp(v);
              setOtpMsg(null);
            }}
            onComplete={(v) => void submitOtp(v)}
            error={!!otpMsg}
            accessibilityLabel="4-digit code from the customer"
          />
          <InlineAlert message={otpMsg} />
          {isDemoMode ? (
            <InlineAlert
              tone="warning"
              icon="flask-outline"
              message={`Demo: the customer's code is ${s === 'en_route' || (isTimeBased && s === 'accepted') || (s === 'confirmed' && booking.archetype === 'proposal') ? DEMO_PROVIDER_START_CODE : DEMO_PROVIDER_END_CODE}.`}
            />
          ) : null}
        </Card>
      ) : null}
      {!isCustomer && s === 'quote_sent' ? (
        <Button title="Revise quote" leftIcon="create-outline" variant="outline" onPress={() => openEditor(false)} />
      ) : null}
      {!isCustomer && s === 'in_progress' ? (
        <Button title="Send change order" variant="outline" leftIcon="add-circle-outline" onPress={() => openEditor(true)} />
      ) : null}
      {openQuote && !customerRespondsToQuote ? (
        <QuoteView quote={openQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} counterpartName={data.counterpart} coinPaid={coinPaid} />
      ) : null}
      {pendingPaymentQuote && !isCustomer ? (
        <QuoteView quote={pendingPaymentQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} counterpartName={data.counterpart} coinPaid={coinPaid} />
      ) : null}

      {/* ---------- details ---------- */}
      <Section title="Booking details">
        <Card gap={t.spacing.md}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
            <Avatar name={data.counterpart} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="calloutStrong" numberOfLines={1}>
                {data.counterpart}
              </Text>
              {isCustomer && pro && pro.rating_count > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Ionicons name="star" size={13} color={t.colors.star} />
                  <Text variant="footnoteStrong" tabular>
                    {Number(pro.rating_avg).toFixed(1)}
                  </Text>
                  <Text variant="footnote" color="muted">
                    ({pro.rating_count}) · Your pro
                  </Text>
                </View>
              ) : (
                <Text variant="footnote" color="muted">
                  {isCustomer ? 'Your pro' : 'Customer'}
                </Text>
              )}
            </View>
            <ChatButton bookingId={booking.id} count={unread.countFor(booking.id)} accessibilityLabel={`Chat with ${first}`} />
            <IconButton icon="call-outline" variant="neutral" accessibilityLabel="Call" accessibilityHint="Masked calling is coming soon" onPress={call} />
            {navigate ? <IconButton icon="navigate-outline" variant="neutral" accessibilityLabel="Open in Maps" onPress={() => void navigate()} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="lock-closed-outline" size={13} color={t.colors.muted} />
            <Text variant="caption" color="muted" style={{ flex: 1 }}>
              Phone numbers stay private · use chat (masked calling coming soon)
            </Text>
          </View>
          <Divider />
          <InfoRow
            icon="location-outline"
            label="Address"
            text={
              data.address?.address_line
                ? `${data.address.address_line}, ${data.address.area}`
                : `${data.address?.area ?? '—'} · full address after you accept`
            }
          />
          <InfoRow
            icon="calendar-outline"
            label="When"
            text={booking.scheduled_at ? scheduleLabel(booking.scheduled_at) : `As soon as possible (requested ${fmt(booking.created_at)})`}
          />
          {booking.description ? <InfoRow icon="construct-outline" label="Issue" text={booking.description} /> : null}
          {data.photoUrls.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm, paddingLeft: 30 }}>
              {data.photoUrls.map((u) => (
                <Image key={u} source={{ uri: u }} style={{ width: 64, height: 64, borderRadius: t.radii.md }} contentFit="cover" accessibilityLabel="Problem photo" />
              ))}
            </ScrollView>
          ) : null}
        </Card>
      </Section>

      {isCustomer && review ? (
        <Section title="Your review">
          <Card gap={t.spacing.sm}>
            <RatingStars value={review.rating} size={18} />
            {review.comment ? (
              <Text variant="callout" color="textSecondary">
                {review.comment}
              </Text>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {approvedQuote && !shownQuoteIds.has(approvedQuote.id) ? (
        <Section title="Approved scope">
          <QuoteView quote={approvedQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} counterpartName={data.counterpart} coinPaid={coinPaid} title="Quote" />
        </Section>
      ) : null}


      <Section title="Payments">
        <Card padding={0} gap={0}>
          {payments.length === 0 ? (
            <View style={{ padding: t.spacing.lg }}>
              <Text variant="callout" color="muted">
                No payments yet.
              </Text>
            </View>
          ) : (
            payments.map((p, i) => {
              const [label, tone] = PAYMENT_STATUS[p.status];
              return (
                <Fragment key={p.id}>
                  {i > 0 ? <Divider inset={LIST_INSET} /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md }}>
                    <View
                      style={{ width: 32, height: 32, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Ionicons name={p.purpose === 'visit_fee' ? 'home-outline' : 'construct-outline'} size={18} color={t.colors.textSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="body">{p.funding_source === 'coins' ? 'Seva Coins' : p.purpose === 'visit_fee' ? 'Visit fee' : 'Job payment'}</Text>
                      <Text variant="footnote" color="muted">
                        {fmt(p.paid_at ?? p.created_at)}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4 }}>
                      <Text variant="calloutStrong" tabular>
                        {formatINR(p.amount)}
                      </Text>
                      <Badge label={label} tone={tone} />
                    </View>
                  </View>
                </Fragment>
              );
            })
          )}
        </Card>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'flex-start', paddingHorizontal: t.spacing.xs }}>
          <Ionicons name="shield-checkmark-outline" size={16} color={t.colors.successText} style={{ marginTop: 1 }} />
          <Text variant="footnote" color="muted" style={{ flex: 1 }}>
            Held by QuickServe and released to the pro 24 hours after completion.
          </Text>
        </View>
      </Section>

      {canReport && disputeOpen ? (
        <Animated.View entering={FadeInDown.duration(200)}>
          <Card gap={t.spacing.md}>
            <View style={{ gap: 2 }}>
              <Text variant="title3">Report a problem</Text>
              <Text variant="footnote" color="muted">
                Payment to the pro is paused while our support team reviews it.
              </Text>
            </View>
            <TextArea label="What went wrong?" value={reason} onChangeText={setReason} maxLength={500} />
            <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <Button title="Back" variant="outline" onPress={() => setDisputeOpen(false)} style={{ flex: 1 }} />
              <Button
                title="Raise dispute"
                variant="destructive"
                disabled={!reason.trim()}
                loading={busy}
                onPress={() => void run(() => api.disputeBooking(booking.id, reason.trim()), 'Dispute raised')}
                style={{ flex: 2 }}
              />
            </View>
          </Card>
        </Animated.View>
      ) : null}

      <Section title="Help">
        <Card padding={0} gap={0}>
          {helpItems.map((h, i) => (
            <Fragment key={h.key}>
              {i > 0 ? <Divider inset={LIST_INSET} /> : null}
              <ListItem title={h.title} icon={h.icon} destructive={h.destructive} chevron={!h.destructive} onPress={busy ? undefined : h.onPress} />
            </Fragment>
          ))}
        </Card>
      </Section>
    </Screen>
  );
}

function heroCopy(p: {
  status: Booking['status'];
  archetype: NonNullable<Booking['archetype']>;
  isCustomer: boolean;
  first: string;
  visitFee: number;
  startCode: string | null;
  endCode: string | null;
  changeOrderOpen: boolean;
  cancelledReason: string | null;
}): HeroCopy {
  const { first } = p;
  const refundLine = 'Any payment you made is refunded — see Payments below.';
  if (p.isCustomer) {
    switch (p.status) {
      case 'pending_payment':
        if (p.archetype === 'proposal') return { title: 'Pay the advance to confirm', subtitle: `Your hold keeps ${first} reserved for 30 minutes. Pay the booking advance and platform fee below.` };
        if (p.archetype === 'fixed') return { title: 'Pay to confirm your booking', subtitle: `Pay the package price to send the booking to ${first}. It's refunded if they can't take it.` };
        if (p.archetype === 'time_based') return { title: 'Pay to confirm your session', subtitle: `Pay for the session to send it to ${first}. It's refunded if they can't take it.` };
        return { title: 'Pay the visit fee to send your request', subtitle: `${first} is notified as soon as the ${formatINR(p.visitFee)} visit fee is paid. It's adjusted in your final bill.` };
      case 'confirmed':
        if (p.archetype === 'proposal')
          return { title: 'Booking confirmed', subtitle: p.startCode ? `Share code ${p.startCode} with ${first} when the work starts.` : `Share your start code with ${first} when the work starts.` };
        return { title: 'Booking confirmed', subtitle: `${first} has your booking. Any remaining milestones are in the payment timeline.` };
      case 'delivery_pending':
        return { title: `Waiting for ${first}'s delivery`, subtitle: 'Review the delivery when it arrives. The final milestone is due on delivery.' };
      case 'requested':
        return {
          title: `Waiting for ${first} to accept`,
          subtitle: p.archetype === 'inspect_quote'
            ? 'Pros respond within 15 minutes. If not, your visit fee is refunded automatically.'
            : 'Pros respond within 15 minutes. If not, your payment is refunded automatically.',
        };
      case 'accepted':
        return { title: `${first} accepted your booking`, subtitle: p.startCode ? `Share code ${p.startCode} when ${first} arrives.` : `Share your start code when ${first} arrives.` };
      case 'en_route':
        return { title: `${first} is on the way`, subtitle: p.startCode ? `Share code ${p.startCode} when they arrive.` : 'Keep your start code ready.' };
      case 'inspecting':
        return { title: `${first} is inspecting the problem`, subtitle: "You'll get an itemised quote to approve before any work starts." };
      case 'quote_sent':
        return { title: `${first} sent a quote — review & approve`, subtitle: 'Nothing more is charged until you approve.' };
      case 'awaiting_payment':
        return { title: 'Pay the balance to start work', subtitle: 'Your payment is held safely until the job is done.' };
      case 'in_progress':
        return p.changeOrderOpen
          ? { title: `${first} sent a change order`, subtitle: 'Review the extra work below. Declining keeps the approved scope.' }
          : { title: 'Work in progress', subtitle: 'Your payment is held safely until you confirm the job is done.' };
      case 'completion_requested':
        return { title: `${first} marked the job done`, subtitle: p.endCode ? `Check the work, then share code ${p.endCode}.` : 'Check the work, then share your completion code.' };
      case 'completed':
      case 'closed':
        return { title: 'Job completed', subtitle: 'Thanks for booking with QuickServe.' };
      case 'closed_no_work':
        return { title: 'Closed — no work done', subtitle: 'The quote was declined, so only the inspection was charged.' };
      case 'declined':
        return { title: `${first} couldn't take this job`, subtitle: refundLine };
      case 'expired':
        return { title: 'Request expired', subtitle: refundLine };
      case 'cancelled':
        return { title: 'Booking cancelled', subtitle: p.cancelledReason ?? 'See Payments below for any refund.' };
      case 'disputed':
        return { title: 'Support is reviewing your report', subtitle: 'Payment to the pro is paused until it is resolved.' };
      case 'refunded':
        return { title: 'Refunded', subtitle: 'Your payment has been refunded.' };
    }
  }
  switch (p.status) {
    case 'confirmed':
      return p.archetype === 'proposal'
        ? { title: 'Booking confirmed', subtitle: `When the work starts, ask ${first} for the 4-digit start code.` }
        : { title: statusLabel[p.status] };
    case 'delivery_pending':
      return { title: 'Prepare the deliverables', subtitle: `Submit the delivery links so ${first} can review them.` };
    case 'requested':
      return { title: `New request from ${first}`, subtitle: 'Accept or decline from your Jobs tab within 15 minutes.' };
    case 'accepted':
      return { title: `Head to ${first}'s address`, subtitle: 'Tap Start trip when you leave.' };
    case 'en_route':
      return { title: 'Arrived? Enter the start code', subtitle: `Ask ${first} for the 4-digit start code.` };
    case 'inspecting':
      return { title: 'Inspect and send a quote', subtitle: 'List labour, parts and other charges. The customer approves and pays before work starts.' };
    case 'quote_sent':
      return { title: 'Quote sent — waiting for approval', subtitle: 'Sending a new quote replaces the open one.' };
    case 'awaiting_payment':
      return { title: 'Quote approved', subtitle: `Waiting for ${first}'s payment before work starts.` };
    case 'in_progress':
      return p.changeOrderOpen
        ? { title: 'Work in progress', subtitle: `A change order is waiting for ${first}'s approval.` }
        : { title: 'Work in progress', subtitle: 'Mark the job done when you finish.' };
    case 'completion_requested':
      return { title: 'Enter the completion code', subtitle: `Ask ${first} for the 4-digit completion code.` };
    case 'completed':
    case 'closed':
      return { title: 'Job complete', subtitle: 'Your payout is released after the 24-hour dispute window.' };
    case 'disputed':
      return { title: 'Customer raised a dispute', subtitle: 'Your payout is on hold until support resolves it.' };
    case 'cancelled':
      return { title: 'Booking cancelled', subtitle: p.cancelledReason ?? undefined };
    default:
      return { title: statusLabel[p.status] };
  }
}
function AmountFooter({ label, amount, children }: { label: string; amount: number; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
      <View>
        <Text variant="caption" color="muted">
          {label}
        </Text>
        <Text variant="title2" tabular>
          {formatINR(amount)}
        </Text>
      </View>
      {children}
    </View>
  );
}

function InfoRow({ icon, label, text }: { icon: keyof typeof Ionicons.glyphMap; label: string; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={t.colors.muted} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="caption" color="muted">
          {label}
        </Text>
        <Text variant="callout" color="text">
          {text}
        </Text>
      </View>
    </View>
  );
}

function OtpCard(props: { title: string; hint: string; code: string | null; locked: boolean; onRegenerate: () => void }) {
  const t = useTheme();
  const digits = (props.code ?? '····').split('');
  return (
    <Animated.View entering={FadeIn.duration(250)}>
      <Card variant="elevated" gap={t.spacing.md} style={{ alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="key-outline" size={16} color={t.colors.textSecondary} />
          <Text variant="subheadStrong" color="textSecondary">
            {props.title}
          </Text>
        </View>
        <View
          style={{ flexDirection: 'row', gap: t.spacing.sm }}
          accessible
          accessibilityLabel={`${props.title}: ${props.code ? props.code.split('').join(' ') : 'not available'}`}
        >
          {digits.map((d, i) => (
            <View
              key={i}
              style={{
                width: 56,
                height: 64,
                borderRadius: t.radii.md,
                backgroundColor: t.colors.surfaceAlt,
                borderWidth: 1,
                borderColor: t.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text variant="display" color="text" tabular maxFontSizeMultiplier={1.2}>
                {d}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="footnote" color="muted" align="center" style={{ maxWidth: 300 }}>
          {props.hint}
        </Text>
        {props.locked ? (
          <View style={{ alignSelf: 'stretch', gap: t.spacing.sm }}>
            <InlineAlert message="Too many wrong attempts. Generate a new code." />
            <Button title="Generate new code" variant="outline" leftIcon="refresh" onPress={props.onRegenerate} />
          </View>
        ) : null}
      </Card>
    </Animated.View>
  );
}

const SUB_LABELS = [
  ['punctuality', 'Punctuality'],
  ['quality', 'Quality'],
  ['behaviour', 'Behaviour'],
  ['pricing', 'Fair price'],
] as const;

const RATING_WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

function ReviewForm({
  name,
  busy,
  reviewTags,
  onSubmit,
}: {
  name: string;
  busy: boolean;
  reviewTags: string[];
  onSubmit: (r: ReviewInput) => void;
}) {
  const t = useTheme();
  const [rating, setRating] = useState(0);
  const [sub, setSub] = useState({ punctuality: 0, quality: 0, behaviour: 0, pricing: 0 });
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  return (
    <Card variant="elevated" gap={t.spacing.lg}>
      <View style={{ alignItems: 'center', gap: t.spacing.xs }}>
        <Text variant="title2" align="center">
          How was {name}?
        </Text>
        <RatingStars value={rating} size={36} onChange={setRating} label="Overall rating" />
        <Text variant="subheadStrong" color={rating ? 'textSecondary' : 'muted'}>
          {rating ? RATING_WORDS[rating] : 'Tap a star to rate'}
        </Text>
      </View>
      {rating > 0 ? (
        <Animated.View entering={FadeInDown.duration(220)} style={{ gap: t.spacing.lg }}>
          <View style={{ borderTopWidth: 1, borderTopColor: t.colors.border, paddingTop: t.spacing.sm }}>
            {SUB_LABELS.map(([key, label]) => (
              <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: t.spacing.sm }}>
                <Text variant="callout" color="textSecondary">
                  {label}
                </Text>
                <RatingStars value={sub[key]} size={22} compact onChange={(v) => setSub((x) => ({ ...x, [key]: v }))} label={label} />
              </View>
            ))}
          </View>
          {reviewTags.length ? (
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="calloutStrong">What stood out? Pick up to 5</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.xs }}>
                {reviewTags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag.replaceAll('_', ' ')}
                    selected={tags.includes(tag)}
                    check
                    disabled={!tags.includes(tag) && tags.length >= 5}
                    onPress={() => setTags((current) => (current.includes(tag) ? current.filter((x) => x !== tag) : [...current, tag]))}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <TextArea
            placeholder="Tell others about your experience (optional)"
            value={comment}
            onChangeText={setComment}
            maxLength={1000}
            accessibilityLabel="Review comment (optional)"
          />
        </Animated.View>
      ) : null}
      <Button
        title="Submit review"
        disabled={rating === 0}
        loading={busy}
        size="lg"
        fullWidth
        onPress={() =>
          onSubmit({
            rating,
            punctuality: sub.punctuality || undefined,
            quality: sub.quality || undefined,
            behaviour: sub.behaviour || undefined,
            pricing: sub.pricing || undefined,
            comment: comment.trim() || undefined,
            tags,
          })
        }
      />
    </Card>
  );
}
