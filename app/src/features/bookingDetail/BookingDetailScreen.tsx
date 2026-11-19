import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Linking, ScrollView, Switch, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { QuoteView } from '../../components/QuoteView';
import { statusLabel } from '../../components/status';
import { ChatButton } from '../../components/UnreadChat';
import {
  Avatar,
  Button,
  Card,
  Chip,
  Divider,
  ErrorState,
  Header,
  IconButton,
  InlineAlert,
  RatingStars,
  Screen,
  Section,
  Skeleton,
  Text,
  TextArea,
  useConfirm,
  useToast,
} from '../../components/ui';
import * as api from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { isDemoMode } from '../../lib/config';
import { cancellationPreviewCopy } from '../../lib/cancellationCopy';
import { haptics } from '../../lib/haptics';
import { amountDue, customerDueNow, formatINR, requiredTotal } from '../../lib/money';
import {
  coinPaiseToCoins,
  coinRedemptionPreviewState,
  earnedCoinPaise,
  type CoinRedemptionPreview,
} from '../../lib/coins';
import { creatorRevisionsEnabled, requestCreatorRevision } from '../../lib/creatorRevisions';
import { usePayment } from '../../lib/payments';
import { typicalRange } from '../../lib/pricing';
import { registerForPush } from '../../lib/push';
import { bookingRef, dayLabel, scheduleLabel } from '../../lib/schedule';
import type { Booking, BookingAddress, BookingEvent, BookingOtps, Payment, PaymentSchedule as PaymentScheduleRow, Quote, Review, ReviewInput } from '../../lib/types';
import { useUnread } from '../../lib/unreadContext';
import { useTheme } from '../../theme';
import { ActionsRow, OtpCard } from './ActionsRow';
import { CancelSection, type HelpItem } from './CancelSection';
import { DeliverySection } from './DeliverySection';
import { PaymentsSection } from './PaymentsSection';
import { StatusHeader } from './StatusHeader';
import { canReportProposalPaymentDefault, fmt, heroCopy } from './model';

interface Data {
  booking: CreatorRevisionBooking;
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
  creatorRevisionsEnabled: boolean;
}

type CreatorRevisionBooking = Omit<Booking, 'delivery_status'> & {
  delivery_status?: 'not_applicable' | 'pending' | 'submitted' | 'revision_requested' | 'accepted';
  revisions_allowed?: number;
  revisions_used?: number;
};

const POLICY_CANCEL_STATUSES = new Set([
  'pending_payment', 'requested', 'accepted', 'confirmed', 'en_route',
  'inspecting', 'quote_sent', 'awaiting_payment', 'in_progress', 'completion_requested',
]);
const SESSION_CANCEL_STATUSES = new Set(['pending_payment', 'requested', 'accepted']);
const DEMO_CANCEL_STATUSES = new Set(['pending_payment', 'requested', 'accepted', 'en_route', 'awaiting_payment']);

export default function BookingDetailScreen() {
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
  const [revisionSheetOpen, setRevisionSheetOpen] = useState(false);
  const [revisionNote, setRevisionNote] = useState('');

  const load = useCallback(async () => {
    if (!id || !userId) return;
    try {
      const booking = await api.getBooking(id);
      const isCustomer = booking.customer_id === userId;
      const [quotes, payments, events, otps, address, review, counterpart, photoUrls, paymentSchedule, revisionsEnabled] = await Promise.all([
        api.getQuotes(id),
        api.getPayments(id),
        api.getEvents(id).catch(() => [] as BookingEvent[]),
        isCustomer ? api.getBookingOtps(id) : Promise.resolve(null),
        api.getBookingAddress(id),
        api.getReviewForBooking(id),
        api.getProfileName(isCustomer ? booking.provider_id : booking.customer_id),
        api.signedPhotoUrls(booking.photos).catch(() => []),
        api.listPaymentSchedule(id).catch(() => [] as PaymentScheduleRow[]),
        creatorRevisionsEnabled().catch(() => false),
      ]);
      const sentQuote = quotes.find((q) => q.status === 'sent') ?? null;
      const coinPreview = isCustomer && sentQuote
        ? await api.getCoinRedemptionPreview(id, sentQuote.id).catch(() => null)
        : null;
      setData({
        booking: booking as CreatorRevisionBooking,
        quotes,
        payments,
        events,
        otps,
        address,
        review,
        counterpart,
        photoUrls,
        coinPreview,
        paymentSchedule,
        creatorRevisionsEnabled: revisionsEnabled,
      });
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
  const revisionsAllowed = booking.revisions_allowed ?? 2;
  const revisionsUsed = booking.revisions_used ?? 0;
  const revisionsLeft = Math.max(0, revisionsAllowed - revisionsUsed);
  const deliveryReview = booking.archetype === 'proposal' && booking.delivery_status === 'submitted';
  const canRequestRevision =
    isCustomer
    && data.creatorRevisionsEnabled
    && s === 'completion_requested'
    && booking.archetype === 'proposal'
    && booking.delivery_status === 'submitted'
    && revisionsLeft > 0;
  const canReportPaymentDefault =
    !isCustomer
    && booking.archetype === 'proposal'
    && (s === 'confirmed' || s === 'in_progress' || s === 'completion_requested')
    && canReportProposalPaymentDefault(data.paymentSchedule);
  const revisionRequestEvent = data.events.slice().reverse().find(
    (event) => event.to_status === 'delivery_pending' && event.note?.startsWith('revision requested: '),
  );
  const providerRevisionNote = revisionRequestEvent?.note?.replace(/^revision requested:\s*/, '') ?? '';
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
  const coinPreviewState = data.coinPreview ? coinRedemptionPreviewState(data.coinPreview) : null;
  const coinCanRedeem = coinPreviewState?.canRedeem ?? false;
  const coinDiscountPreview = coinCanRedeem
    ? (useCoins ? data.coinPreview?.maximum_paise ?? 0 : 0)
    : coinPreviewState?.appliedPaise ?? 0;
  const shownQuoteIds = new Set([openQuote?.id, pendingPaymentQuote?.id].filter(Boolean));
  const typical = typicalRange(booking.categories?.slug);
  const customerRespondsToQuote = isCustomer && !!openQuote && (s === 'quote_sent' || s === 'in_progress');
  const dueForPending = pendingPaymentQuote
    ? amountDue({ quoteTotal: pendingPaymentQuote.total, visitFee: booking.visit_fee, platformFee: booking.platform_fee, alreadyPaid: paid })
    : 0;

  // ---------- actions ----------
  const submitRevisionRequest = () => {
    const note = revisionNote.trim();
    if (!canRequestRevision || note.length < 5 || note.length > 1000) return;
    void run(async () => {
      await requestCreatorRevision(booking.id, note);
      setRevisionSheetOpen(false);
      setRevisionNote('');
    }, 'Changes requested');
  };

  const cancel = async () => {
    let message = cancellationPreviewCopy(null);
    try {
      message = cancellationPreviewCopy(await api.previewCancellation(booking.id));
    } catch {
      message = cancellationPreviewCopy(null);
    }
    const ok = await confirm({
      title: 'Cancel this booking?',
      message,
      confirmLabel: 'Cancel booking',
      cancelLabel: 'Keep booking',
      destructive: true,
    });
    if (ok) void run(() => api.cancelBooking(booking.id), 'Booking cancelled');
  };

  const approve = (quote: Quote) =>
    run(async () => {
      const res = await api.approveQuote(
        booking.id,
        quote.id,
        useCoins && (data.coinPreview?.maximum_paise ?? 0) > 0,
      );
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
      const previewDiscount = useCoins && coinCanRedeem
        ? data.coinPreview?.maximum_paise ?? 0
        : 0;
      const appliedCoinDiscount = !coinCanRedeem
        ? coinPreviewState?.appliedPaise ?? 0
        : 0;
      const due = customerDueNow(
        requiredTotal(openQuote.total, booking.visit_fee, booking.platform_fee),
        Math.max(0, paid - coinPaid),
        previewDiscount + appliedCoinDiscount,
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
  } else if (s === 'en_route' || (s === 'completion_requested' && !deliveryReview)) {
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
  const cancellableStatuses = isDemoMode
    ? DEMO_CANCEL_STATUSES
    : isTimeBased
      ? SESSION_CANCEL_STATUSES
      : POLICY_CANCEL_STATUSES;
  const cancelAction = isCustomer && cancellableStatuses.has(s)
    ? s === 'awaiting_payment' ? 'Cancel job' : 'Cancel booking'
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
    defaultStatusLabel: statusLabel[s],
    deliveryReview,
  });
  const pro = booking.providers;
  const helpItems: HelpItem[] = [
    {
      key: 'help',
      title: 'Get help with this booking',
      subtitle: 'Ask support a question',
      icon: 'help-buoy-outline',
      onPress: () => router.push({ pathname: '/support/new', params: { bookingId: booking.id } }),
    },
    { key: 'safety', title: 'Safety & guarantee', icon: 'shield-checkmark-outline', onPress: () => router.push({ pathname: '/info/[topic]', params: { topic: 'safety' } }) },
  ];
  if (canReport && !disputeOpen) {
    helpItems.push({
      key: 'report',
      title: 'Report a problem',
      subtitle: 'Pauses payment to the pro while support reviews',
      icon: 'flag-outline',
      onPress: () => setDisputeOpen(true),
    });
  }
  if (cancelAction) helpItems.push({ key: 'cancel', title: cancelAction, icon: 'close-circle-outline', destructive: true, onPress: () => void cancel() });

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
      <StatusHeader
        status={s}
        copy={hero}
        events={data.events}
        archetype={booking.archetype}
        actionError={actionError}
        bookingId={booking.id}
        isCustomer={isCustomer}
        onPaid={() => void load()}
      />
      {booking.archetype === 'proposal' && (booking.delivery_links?.length ?? 0) > 0 ? (
        <DeliverySection
          placement="delivered"
          theme={t}
          links={booking.delivery_links ?? []}
          submittedAt={booking.delivery_submitted_at ?? null}
          onOpenLink={(url) => {
            void Linking.openURL(url).catch(() =>
              toast({ message: 'Could not open delivered work.', tone: 'error' }),
            );
          }}
        />
      ) : null}

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
      {isCustomer && s === 'completion_requested' && !deliveryReview ? (
        <OtpCard
          title="Completion code"
          hint={`Share only if you're happy with the work. Auto-confirms 24 hours after ${first} marked it done.`}
          code={endCode}
          locked={!!otps?.end_locked}
          onRegenerate={() => void run(() => api.regenerateOtp(booking.id, 'end'), 'New code generated')}
        />
      ) : null}
      {canRequestRevision ? (
        <DeliverySection
          placement="request"
          theme={t}
          revisionsLeft={revisionsLeft}
          busy={busy}
          onOpen={() => {
            setRevisionNote('');
            setRevisionSheetOpen(true);
          }}
        />
      ) : null}
      {customerRespondsToQuote && openQuote ? (
        <View style={{ gap: t.spacing.xs }}>
          {coinCanRedeem && data.coinPreview && data.coinPreview.maximum_paise > 0 ? (
            <Card
              gap={t.spacing.sm}
              style={{ flexDirection: 'row', alignItems: 'center' }}
              accessibilityLabel={`Use ${coinPaiseToCoins(data.coinPreview.maximum_paise, { coin_paise: data.coinPreview.coin_paise })} Seva Coins (${formatINR(data.coinPreview.maximum_paise)})`}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="calloutStrong">
                  Use {coinPaiseToCoins(data.coinPreview.maximum_paise, { coin_paise: data.coinPreview.coin_paise })} coins · {formatINR(data.coinPreview.maximum_paise)}
                </Text>
                <Text variant="footnote" color="muted">
                  Wallet: {coinPaiseToCoins(data.coinPreview.balance_paise, { coin_paise: data.coinPreview.coin_paise })} coins · {formatINR(data.coinPreview.balance_paise)}
                </Text>
              </View>
              <Switch
                accessibilityLabel="Use Seva Coins"
                value={useCoins}
                onValueChange={setUseCoins}
                trackColor={{ false: t.colors.outline, true: t.colors.primary }}
                thumbColor={t.colors.onPrimary}
              />
            </Card>
          ) : null}
          <QuoteView
            quote={openQuote}
            visitFee={booking.visit_fee}
            platformFee={booking.platform_fee}
            alreadyPaid={paid}
            counterpartName={data.counterpart}
            coinDiscountPreview={coinDiscountPreview}
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
      {!deliveryReview ? (
        <ActionsRow
          status={s}
          archetype={booking.archetype}
          isCustomer={isCustomer}
          isTimeBased={isTimeBased}
          theme={t}
          otp={otp}
          otpMsg={otpMsg}
          first={first}
          onSetOtp={setOtp}
          onSetOtpMsg={setOtpMsg}
          onSubmitOtp={submitOtp}
          onOpenEditor={openEditor}
        />
      ) : null}
      {canReportPaymentDefault ? (
        <DeliverySection
          placement="payment-default"
          theme={t}
          busy={busy}
          onPress={() => {
            void run(
              () => api.cancelProposalPaymentDefault(booking.id),
              'Customer payment default recorded',
            );
          }}
        />
      ) : null}
      {!isCustomer && s === 'delivery_pending' && booking.archetype === 'proposal' && booking.delivery_status === 'revision_requested' ? (
        <DeliverySection placement="revision" theme={t} revisionsUsed={revisionsUsed} revisionsAllowed={revisionsAllowed} note={providerRevisionNote} />
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


      <PaymentsSection payments={payments} theme={t} />

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

      <CancelSection items={helpItems} busy={busy} />

      <DeliverySection
        placement="sheet"
        theme={t}
        visible={revisionSheetOpen}
        onClose={() => setRevisionSheetOpen(false)}
        revisionsLeft={revisionsLeft}
        revisionNote={revisionNote}
        busy={busy}
        onChangeNote={setRevisionNote}
        onSubmit={submitRevisionRequest}
      />
    </Screen>
  );
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
