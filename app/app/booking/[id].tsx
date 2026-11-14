import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { QuoteView } from '../../src/components/QuoteView';
import { StatusPill } from '../../src/components/status';
import { StatusTimeline } from '../../src/components/StatusTimeline';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  ErrorState,
  Header,
  InlineAlert,
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
import { usePayment } from '../../src/lib/payments';
import { typicalRange } from '../../src/lib/pricing';
import type { Booking, BookingAddress, BookingEvent, BookingOtps, Payment, PaymentStatus, Quote, Review, ReviewInput } from '../../src/lib/types';
import { useTheme } from '../../src/theme';

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

  const load = useCallback(async () => {
    if (!id || !userId) return;
    try {
      const booking = await api.getBooking(id);
      const isCustomer = booking.customer_id === userId;
      const [quotes, payments, events, otps, address, review, counterpart, photoUrls] = await Promise.all([
        api.getQuotes(id),
        api.getPayments(id),
        api.getEvents(id).catch(() => [] as BookingEvent[]),
        isCustomer ? api.getBookingOtps(id) : Promise.resolve(null),
        api.getBookingAddress(id),
        api.getReviewForBooking(id),
        api.getProfileName(isCustomer ? booking.provider_id : booking.customer_id),
        api.signedPhotoUrls(booking.photos).catch(() => []),
      ]);
      setData({ booking, quotes, payments, events, otps, address, review, counterpart, photoUrls });
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
  const first = data.counterpart.split(' ')[0] ?? data.counterpart;
  // Net of partial refunds (e.g. a change order that lowered the total), matching the server's amount owed.
  const paid = payments
    .filter((p) => p.status === 'paid')
    .reduce((acc, p) => acc + p.amount - (p.refunds ?? []).filter((r) => r.status !== 'failed').reduce((sum, r) => sum + r.amount, 0), 0);
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
      const res = await api.approveQuote(booking.id, quote.id);
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
    const arriving = s === 'en_route';
    setOtpBusy(true);
    setOtpMsg(null);
    try {
      const res = arriving ? await api.arrive(booking.id, value) : await api.completeBooking(booking.id, value);
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
  const openChat = () => router.push({ pathname: '/chat/[bookingId]', params: { bookingId: booking.id } });
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
      const due = amountDue({ quoteTotal: openQuote.total, visitFee: booking.visit_fee, platformFee: booking.platform_fee, alreadyPaid: paid });
      footer = (
        <AmountFooter label={openQuote.is_change_order ? 'Extra to pay' : 'To pay now'} amount={due}>
          <Button title={due > 0 ? 'Approve & pay' : 'Approve'} onPress={() => void approve(openQuote)} loading={busy} size="lg" style={{ flex: 1 }} />
        </AmountFooter>
      );
    } else if (pendingPaymentQuote && dueForPending > 0) {
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
        <AmountFooter label="Visit fee" amount={booking.visit_fee}>
          <Button title="Pay & send request" leftIcon="lock-closed" onPress={() => void pay()} loading={busy} size="lg" style={{ flex: 1 }} />
        </AmountFooter>
      );
    } else if (s === 'completion_requested') {
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
  } else if (s === 'accepted') {
    footer = (
      <Button
        title="Start trip"
        leftIcon="navigate"
        size="lg"
        fullWidth
        loading={busy}
        onPress={() => void run(() => api.startTrip(booking.id), 'Customer notified you are on the way')}
      />
    );
  } else if (s === 'en_route' || s === 'completion_requested') {
    footer = (
      <Button
        title="Verify code"
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
        title="Mark job done"
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

  return (
    <Screen
      header={
        <Header
          title={booking.categories?.name ?? 'Booking'}
          subtitle={`Booking #${booking.id.slice(0, 8)}`}
          right={<StatusPill status={booking.status} />}
        />
      }
      footer={footer}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      {/* Who, where, when + contact bar */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <Avatar name={data.counterpart} size={48} />
          <View style={{ flex: 1 }}>
            <Text variant="caption" color="muted">
              {isCustomer ? 'Your pro' : 'Customer'}
            </Text>
            <Text variant="title3" numberOfLines={1}>
              {data.counterpart}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
          <Button title="Chat" variant="secondary" size="sm" leftIcon="chatbubble-ellipses-outline" onPress={openChat} style={{ flex: 1 }} />
          <Button
            title="Call"
            variant="outline"
            size="sm"
            leftIcon="call-outline"
            onPress={call}
            accessibilityHint="Masked calling is coming soon"
            style={{ flex: 1 }}
          />
          {navigate ? (
            <Button title="Navigate" variant="outline" size="sm" leftIcon="navigate-outline" onPress={() => void navigate()} style={{ flex: 1 }} />
          ) : null}
        </View>
        <Divider />
        <InfoRow
          icon="location-outline"
          text={
            data.address?.address_line
              ? `${data.address.address_line}, ${data.address.area}`
              : `${data.address?.area ?? '—'} · exact address after you accept`
          }
        />
        <InfoRow icon="time-outline" text={booking.scheduled_at ? `Scheduled · ${fmt(booking.scheduled_at)}` : `As soon as possible · booked ${fmt(booking.created_at)}`} />
        {booking.description ? <InfoRow icon="chatbox-ellipses-outline" text={`“${booking.description}”`} /> : null}
        {data.photoUrls.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: t.spacing.sm }}>
            {data.photoUrls.map((u) => (
              <Image key={u} source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: t.radii.md }} contentFit="cover" accessibilityLabel="Problem photo" />
            ))}
          </ScrollView>
        ) : null}
      </Card>

      <InlineAlert message={actionError} />

      {/* ---------- customer state ---------- */}
      {isCustomer && s === 'pending_payment' ? (
        <InlineAlert
          tone="warning"
          title="Pay the visit fee to send your request"
          message={`${first} is notified as soon as the ${formatINR(booking.visit_fee)} visit fee is paid. It's adjusted in your final bill.`}
        />
      ) : null}
      {isCustomer && s === 'requested' ? (
        <InlineAlert
          tone="neutral"
          icon="hourglass-outline"
          title={`Waiting for ${first} to accept`}
          message="Pros respond within 15 minutes. If not, your visit fee is refunded automatically."
        />
      ) : null}
      {isCustomer && (s === 'accepted' || s === 'en_route') ? (
        <OtpCard
          title="Start code"
          hint={`Share this code with ${first} only when they arrive at your door.`}
          code={otps?.start_otp ?? null}
          locked={!!otps?.start_locked}
          onRegenerate={() => void run(() => api.regenerateOtp(booking.id, 'start'), 'New code generated')}
        />
      ) : null}
      {customerRespondsToQuote && openQuote ? (
        <View style={{ gap: t.spacing.xs }}>
          <QuoteView
            quote={openQuote}
            visitFee={booking.visit_fee}
            platformFee={booking.platform_fee}
            alreadyPaid={paid}
            counterpartName={data.counterpart}
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
        <QuoteView
          quote={pendingPaymentQuote}
          visitFee={booking.visit_fee}
          platformFee={booking.platform_fee}
          alreadyPaid={paid}
          counterpartName={data.counterpart}
        />
      ) : null}
      {isCustomer && s === 'completion_requested' ? (
        <View style={{ gap: t.spacing.sm }}>
          <OtpCard
            title="Completion code"
            hint={`Check the work first. Share this code with ${first} only if you're satisfied.`}
            code={otps?.end_otp ?? null}
            locked={!!otps?.end_locked}
            onRegenerate={() => void run(() => api.regenerateOtp(booking.id, 'end'), 'New code generated')}
          />
          <Text variant="footnote" color="muted" align="center">
            The job auto-confirms 24 hours after {first} marks it done.
          </Text>
        </View>
      ) : null}
      {isCustomer && (s === 'completed' || s === 'closed') && !review ? (
        <ReviewForm name={first} busy={busy} onSubmit={(r) => void run(() => api.submitReview(booking.id, r), 'Thanks for your review!')} />
      ) : null}
      {isCustomer && review ? (
        <Card gap={t.spacing.sm}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="title3">Your review</Text>
            <RatingStars value={review.rating} size={16} />
          </View>
          {review.comment ? (
            <Text variant="callout" color="textSecondary">
              {review.comment}
            </Text>
          ) : null}
        </Card>
      ) : null}

      {/* ---------- provider state ---------- */}
      {!isCustomer && s === 'requested' ? (
        <InlineAlert tone="neutral" message="Accept or decline this request from your Jobs tab within 15 minutes." />
      ) : null}
      {!isCustomer && (s === 'en_route' || s === 'completion_requested') ? (
        <Card variant="elevated" gap={t.spacing.lg}>
          <View style={{ gap: 2 }}>
            <Text variant="title3">{s === 'en_route' ? 'Arrived?' : 'Finish the job'}</Text>
            <Text variant="callout" color="muted">
              Ask the customer for their 4-digit {s === 'en_route' ? 'start' : 'completion'} code.
            </Text>
          </View>
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
              message={`Demo: the customer's code is ${s === 'en_route' ? DEMO_PROVIDER_START_CODE : DEMO_PROVIDER_END_CODE}.`}
            />
          ) : null}
        </Card>
      ) : null}
      {!isCustomer && s === 'inspecting' ? (
        <InlineAlert
          tone="neutral"
          icon="receipt-outline"
          title="Send an itemised quote"
          message="List labour, parts and any other charges. The customer approves and pays before work starts."
        />
      ) : null}
      {!isCustomer && s === 'quote_sent' ? (
        <Card gap={t.spacing.md}>
          <View style={{ gap: 2 }}>
            <Text variant="title3">Quote sent — waiting for approval</Text>
            <Text variant="callout" color="muted">
              Sending a new quote replaces the open one.
            </Text>
          </View>
          <Button title="Revise quote" leftIcon="create-outline" variant="outline" onPress={() => openEditor(false)} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}
      {!isCustomer && s === 'awaiting_payment' ? (
        <InlineAlert tone="warning" title="Quote approved" message="Waiting for the customer's payment before work starts." />
      ) : null}
      {!isCustomer && s === 'in_progress' ? (
        <View style={{ gap: t.spacing.sm }}>
          {openQuote ? <InlineAlert tone="info" message="A change order is waiting for the customer's approval." /> : null}
          <Button title="Send change order" variant="outline" leftIcon="add-circle-outline" onPress={() => openEditor(true)} />
        </View>
      ) : null}
      {!isCustomer && s === 'completed' ? (
        <InlineAlert tone="success" title="Job complete" message="Your payout is released after the 24-hour dispute window." />
      ) : null}
      {!isCustomer && s === 'disputed' ? (
        <InlineAlert tone="danger" title="Customer raised a dispute" message="Your payout is on hold until support resolves it." />
      ) : null}

      {openQuote && !customerRespondsToQuote ? (
        <QuoteView quote={openQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} counterpartName={data.counterpart} />
      ) : null}
      {pendingPaymentQuote && !isCustomer ? (
        <QuoteView
          quote={pendingPaymentQuote}
          visitFee={booking.visit_fee}
          platformFee={booking.platform_fee}
          alreadyPaid={paid}
          counterpartName={data.counterpart}
        />
      ) : null}

      <Section title="Progress">
        <Card>
          <StatusTimeline status={booking.status} events={data.events} />
        </Card>
      </Section>

      {approvedQuote && !shownQuoteIds.has(approvedQuote.id) ? (
        <Section title="Approved scope">
          <QuoteView
            quote={approvedQuote}
            visitFee={booking.visit_fee}
            platformFee={booking.platform_fee}
            alreadyPaid={paid}
            counterpartName={data.counterpart}
            title="Quote"
          />
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
                  {i > 0 ? <Divider inset={t.spacing.lg} /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md }}>
                    <View
                      style={{ width: 32, height: 32, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Ionicons name={p.purpose === 'visit_fee' ? 'home-outline' : 'construct-outline'} size={18} color={t.colors.textSecondary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="calloutStrong">{p.purpose === 'visit_fee' ? 'Visit fee' : 'Job payment'}</Text>
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
            Payments are held by QuickServe and released to the pro 24 hours after completion.
          </Text>
        </View>
      </Section>

      {canReport ? (
        disputeOpen ? (
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
        ) : (
          <Button title="Report a problem" variant="outline" leftIcon="flag-outline" onPress={() => setDisputeOpen(true)} />
        )
      ) : null}
      {cancelAction ? (
        <Button title={cancelAction[0]} variant="destructiveGhost" onPress={() => void cancel(cancelAction[1])} disabled={busy} />
      ) : null}
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

function InfoRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={t.colors.muted} style={{ marginTop: 1 }} />
      <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
        {text}
      </Text>
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

function ReviewForm({ name, busy, onSubmit }: { name: string; busy: boolean; onSubmit: (r: ReviewInput) => void }) {
  const t = useTheme();
  const [rating, setRating] = useState(0);
  const [sub, setSub] = useState({ punctuality: 0, quality: 0, behaviour: 0, pricing: 0 });
  const [comment, setComment] = useState('');

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
          })
        }
      />
    </Card>
  );
}
