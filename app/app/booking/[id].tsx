import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { CategoryIcon, iconForSlug } from '../../src/components/CategoryIcon';
import { ChatPanel } from '../../src/components/ChatPanel';
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
} from '../../src/components/ui';
import * as api from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { isDemoMode } from '../../src/lib/config';
import { DEMO_PROVIDER_END_CODE, DEMO_PROVIDER_START_CODE } from '../../src/lib/demo/seed';
import { haptics } from '../../src/lib/haptics';
import { amountDue, formatINR } from '../../src/lib/money';
import { usePayment } from '../../src/lib/payments';
import { typicalRange } from '../../src/lib/pricing';
import type {
  Booking,
  BookingAddress,
  BookingEvent,
  BookingOtps,
  OtpResult,
  Payment,
  Quote,
  Review,
  ReviewInput,
} from '../../src/lib/types';
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

const CHAT_CLOSED = new Set(['pending_payment', 'declined', 'expired', 'cancelled']);

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export default function BookingDetail() {
  const t = useTheme();
  const toast = useToast();
  const startPayment = usePayment();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
            <Skeleton height={260} radius={t.radii.lg} />
          </>
        )}
      </Screen>
    );
  }

  const { booking, quotes, payments } = data;
  const isCustomer = booking.customer_id === userId;
  // Net of partial refunds (e.g. a change order that lowered the total), matching the server's amount owed.
  const paid = payments
    .filter((p) => p.status === 'paid')
    .reduce((acc, p) => acc + p.amount - (p.refunds ?? []).filter((r) => r.status !== 'failed').reduce((s, r) => s + r.amount, 0), 0);
  const openQuote = quotes.find((q) => q.status === 'sent') ?? null;
  const pendingPaymentQuote = quotes.find((q) => q.status === 'approved_pending_payment') ?? null;
  const approvedQuote = quotes.find((q) => q.id === booking.approved_quote_id) ?? null;
  const shownQuoteIds = new Set([openQuote?.id, pendingPaymentQuote?.id].filter(Boolean));
  const typical = typicalRange(booking.categories?.slug);

  return (
    <Screen
      header={
        <Header
          title={booking.categories?.name ?? 'Booking'}
          subtitle={`Booking #${booking.id.slice(0, 8)}`}
          right={<StatusPill status={booking.status} />}
        />
      }
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      {/* Summary */}
      <Card gap={t.spacing.md}>
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
          <CategoryIcon icon={iconForSlug(booking.categories?.slug)} size={44} />
        </View>
        <Divider />
        <InfoRow
          icon="location-outline"
          text={data.address?.address_line ? `${data.address.address_line}, ${data.address.area}` : `${data.address?.area ?? '—'} · exact address after you accept`}
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

      {isCustomer ? (
        <CustomerActions
          data={data}
          paid={paid}
          openQuote={openQuote}
          pendingPaymentQuote={pendingPaymentQuote}
          typical={typical}
          busy={busy}
          run={run}
          pay={pay}
        />
      ) : (
        <ProviderActions booking={booking} openQuote={openQuote} busy={busy} run={run} />
      )}

      {openQuote && !(isCustomer && ['quote_sent', 'in_progress'].includes(booking.status)) ? (
        <QuoteView quote={openQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} />
      ) : null}
      {pendingPaymentQuote && !isCustomer ? (
        <QuoteView quote={pendingPaymentQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} />
      ) : null}

      <Section title="Progress">
        <Card>
          <StatusTimeline status={booking.status} events={data.events} />
        </Card>
      </Section>

      {approvedQuote && !shownQuoteIds.has(approvedQuote.id) ? (
        <Section title="Approved scope">
          <QuoteView quote={approvedQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} />
        </Section>
      ) : null}

      <Section title={`Chat with ${data.counterpart.split(' ')[0]}`}>
        <Card>
          <ChatPanel bookingId={booking.id} userId={userId} counterpartName={data.counterpart} enabled={!CHAT_CLOSED.has(booking.status)} />
        </Card>
      </Section>

      <Section title="Payments">
        <Card padding={0} gap={0}>
          {payments.length === 0 ? (
            <View style={{ padding: t.spacing.lg }}>
              <Text variant="callout" color="muted">
                No payments yet.
              </Text>
            </View>
          ) : (
            payments.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider inset={t.spacing.lg} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
                  <Ionicons
                    name={p.purpose === 'visit_fee' ? 'home-outline' : 'construct-outline'}
                    size={20}
                    color={t.colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="subhead">{p.purpose === 'visit_fee' ? 'Visit fee' : 'Job payment'}</Text>
                    <Text variant="caption" color="muted">
                      {fmt(p.paid_at ?? p.created_at)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Text variant="subhead" tabular>
                      {formatINR(p.amount)}
                    </Text>
                    <Badge
                      label={p.status.replaceAll('_', ' ')}
                      tone={p.status === 'paid' ? 'success' : p.status === 'failed' ? 'danger' : p.status === 'created' ? 'warning' : 'neutral'}
                    />
                  </View>
                </View>
              </View>
            ))
          )}
        </Card>
        <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center', paddingHorizontal: t.spacing.xs }}>
          <Ionicons name="shield-checkmark" size={16} color={t.colors.success} />
          <Text variant="caption" color="muted" style={{ flex: 1 }}>
            Payments are held by QuickServe and released to the pro 24 hours after completion.
          </Text>
        </View>
      </Section>
    </Screen>
  );
}

function InfoRow({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={18} color={t.colors.muted} style={{ marginTop: 2 }} />
      <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

type Run = (fn: () => Promise<unknown>, success?: string) => Promise<void>;

function CustomerActions(props: {
  data: Data;
  paid: number;
  openQuote: Quote | null;
  pendingPaymentQuote: Quote | null;
  typical: [number, number] | null;
  busy: boolean;
  run: Run;
  pay: () => Promise<void>;
}) {
  const t = useTheme();
  const confirm = useConfirm();
  const startPayment = usePayment();
  const { data, paid, openQuote, pendingPaymentQuote, typical, busy, run, pay } = props;
  const { booking, otps, review } = data;
  const s = booking.status;
  const first = data.counterpart.split(' ')[0] ?? data.counterpart;
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');

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
      title: initial ? 'Reject the quote?' : 'Reject the change order?',
      message: initial
        ? `The job will close and your visit fee is paid to ${first} for the inspection.`
        : 'Work continues on the already-approved scope.',
      confirmLabel: 'Reject',
      destructive: true,
    });
    if (ok) void run(() => api.rejectQuote(booking.id, quote.id), 'Quote rejected');
  };

  const due = pendingPaymentQuote
    ? amountDue({ quoteTotal: pendingPaymentQuote.total, visitFee: booking.visit_fee, platformFee: booking.platform_fee, alreadyPaid: paid })
    : 0;

  return (
    <View style={{ gap: t.spacing.md }}>
      {s === 'pending_payment' ? (
        <Card variant="tinted" tint={t.colors.warningSoft} gap={t.spacing.md}>
          <Text variant="title3">Pay the visit fee to send your request</Text>
          <Text variant="callout" color="textSecondary">
            {first} is notified as soon as the {formatINR(booking.visit_fee)} visit fee is paid. It's adjusted in your final bill.
          </Text>
          <Button title={`Pay ${formatINR(booking.visit_fee)}`} onPress={() => void pay()} loading={busy} leftIcon="lock-closed" fullWidth />
          <Button title="Cancel booking" variant="ghost" onPress={() => void cancel('No charge — you have not paid yet.')} fullWidth />
        </Card>
      ) : null}
      {s === 'requested' ? (
        <Card variant="tinted" tint={t.colors.primarySoft} gap={t.spacing.sm}>
          <View style={{ flexDirection: 'row', gap: t.spacing.md, alignItems: 'center' }}>
            <Ionicons name="hourglass-outline" size={22} color={t.colors.primary} />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              Waiting for {first} to accept
            </Text>
          </View>
          <Text variant="caption" color="textSecondary">
            Pros respond within 15 minutes. If not, your visit fee is refunded automatically.
          </Text>
          <Button title="Cancel (full refund)" variant="outline" onPress={() => void cancel('Your visit fee will be refunded in full.')} />
        </Card>
      ) : null}
      {s === 'accepted' || s === 'en_route' ? (
        <OtpCard
          title="Start code"
          hint={`Share this code with ${first} only when they arrive at your door.`}
          code={otps?.start_otp ?? null}
          locked={!!otps?.start_locked}
          onRegenerate={() => void run(() => api.regenerateOtp(booking.id, 'start'), 'New code generated')}
        />
      ) : null}
      {s === 'accepted' ? (
        <Button title="Cancel (full refund)" variant="ghost" onPress={() => void cancel('Your visit fee will be refunded in full.')} />
      ) : null}
      {s === 'en_route' ? (
        <Button
          title="Cancel booking"
          variant="ghost"
          onPress={() => void cancel(`${first} is already on the way, so the visit fee will not be refunded.`)}
        />
      ) : null}
      {openQuote && (s === 'quote_sent' || s === 'in_progress') ? (
        <QuoteView
          quote={openQuote}
          visitFee={booking.visit_fee}
          platformFee={booking.platform_fee}
          alreadyPaid={paid}
          typical={openQuote.is_change_order ? null : typical}
          canRespond
          busy={busy}
          onApprove={() => void approve(openQuote)}
          onReject={() => void reject(openQuote)}
        />
      ) : null}
      {pendingPaymentQuote && due > 0 ? (
        <>
          <QuoteView quote={pendingPaymentQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} />
          <Button
            title={`${pendingPaymentQuote.is_change_order ? 'Pay extra' : 'Pay to start work'} · ${formatINR(due)}`}
            onPress={() => void pay()}
            loading={busy}
            leftIcon="lock-closed"
            size="lg"
          />
        </>
      ) : null}
      {s === 'awaiting_payment' ? (
        <Button
          title="Cancel job"
          variant="ghost"
          onPress={() => void cancel(`The inspection is done, so the visit fee will be paid to ${first}.`)}
        />
      ) : null}
      {s === 'completion_requested' ? (
        <>
          <OtpCard
            title="Completion code"
            hint={`Check the work first. Share this code with ${first} only if you're satisfied.`}
            code={otps?.end_otp ?? null}
            locked={!!otps?.end_locked}
            tone="success"
            onRegenerate={() => void run(() => api.regenerateOtp(booking.id, 'end'), 'New code generated')}
          />
          <Button
            title="Confirm job done"
            variant="success"
            leftIcon="checkmark-done"
            size="lg"
            loading={busy}
            onPress={() => void run(() => api.confirmCompletion(booking.id), 'Job marked complete')}
          />
          <Text variant="caption" color="muted" align="center">
            The job auto-confirms 24 hours after {first} marks it done.
          </Text>
        </>
      ) : null}
      {(s === 'completed' || s === 'closed') && !review ? (
        <ReviewForm name={first} busy={busy} onSubmit={(r) => void run(() => api.submitReview(booking.id, r), 'Thanks for your review!')} />
      ) : null}
      {review ? (
        <Card gap={t.spacing.sm}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="title3">Your review</Text>
            <RatingStars value={review.rating} size={18} />
          </View>
          {review.comment ? (
            <Text variant="callout" color="textSecondary">
              {review.comment}
            </Text>
          ) : null}
        </Card>
      ) : null}
      {s === 'in_progress' || s === 'completion_requested' || s === 'completed' ? (
        disputeOpen ? (
          <Card gap={t.spacing.md}>
            <Text variant="title3">Report a problem</Text>
            <Text variant="caption" color="muted">
              Payment to the pro is paused while our support team reviews it.
            </Text>
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
        ) : (
          <Button title="Report a problem" variant="ghost" leftIcon="flag-outline" onPress={() => setDisputeOpen(true)} />
        )
      ) : null}
    </View>
  );
}

function ProviderActions(props: { booking: Booking; openQuote: Quote | null; busy: boolean; run: Run }) {
  const t = useTheme();
  const { booking, openQuote, busy, run } = props;
  const s = booking.status;
  const openEditor = (changeOrder: boolean) =>
    router.push({ pathname: '/quote/[bookingId]', params: { bookingId: booking.id, changeOrder: changeOrder ? '1' : '0' } });

  return (
    <View style={{ gap: t.spacing.md }}>
      {s === 'requested' ? (
        <InlineAlert tone="info" message="Accept or decline this request from your Jobs tab within 15 minutes." />
      ) : null}
      {s === 'accepted' ? (
        <Button
          title="Start trip"
          leftIcon="navigate"
          size="lg"
          onPress={() => void run(() => api.startTrip(booking.id), 'Customer notified you are on the way')}
          loading={busy}
        />
      ) : null}
      {s === 'en_route' ? (
        <OtpEntry
          title="Arrived?"
          label="Ask the customer for their 4-digit start code."
          demoHint={DEMO_PROVIDER_START_CODE}
          busy={busy}
          onSubmit={(otp) => api.arrive(booking.id, otp)}
          onDone={() => void run(async () => undefined, 'Arrival confirmed')}
        />
      ) : null}
      {s === 'inspecting' || s === 'quote_sent' ? (
        <Card variant="tinted" tint={t.colors.primarySoft} gap={t.spacing.md}>
          <Text variant="title3">{s === 'inspecting' ? 'Send an itemised quote' : 'Quote sent — waiting for approval'}</Text>
          <Text variant="callout" color="textSecondary">
            {s === 'inspecting'
              ? 'List labour, parts and any other charges. The customer approves and pays before work starts.'
              : 'Sending a new quote replaces the open one.'}
          </Text>
          <Button
            title={s === 'inspecting' ? 'Create quote' : 'Revise quote'}
            leftIcon="receipt-outline"
            onPress={() => openEditor(false)}
            variant={s === 'inspecting' ? 'primary' : 'outline'}
          />
        </Card>
      ) : null}
      {s === 'awaiting_payment' ? (
        <InlineAlert tone="warning" title="Quote approved" message="Waiting for the customer's payment before work starts." />
      ) : null}
      {s === 'in_progress' ? (
        <>
          <Button
            title="Mark job done"
            variant="success"
            leftIcon="checkmark-done"
            size="lg"
            disabled={!!openQuote}
            onPress={() => void run(() => api.requestCompletion(booking.id), 'Customer asked to confirm')}
            loading={busy}
          />
          <Button title="Send change order" variant="outline" leftIcon="add-circle-outline" onPress={() => openEditor(true)} />
          {openQuote ? <InlineAlert tone="info" message="A change order is waiting for the customer's approval." /> : null}
        </>
      ) : null}
      {s === 'completion_requested' ? (
        <OtpEntry
          title="Finish the job"
          label="Ask the customer for their 4-digit completion code."
          demoHint={DEMO_PROVIDER_END_CODE}
          busy={busy}
          onSubmit={(otp) => api.completeBooking(booking.id, otp)}
          onDone={() => void run(async () => undefined, 'Job completed 🎉')}
        />
      ) : null}
      {s === 'completed' ? (
        <InlineAlert tone="success" title="Job complete" message="Your payout is released after the 24-hour dispute window." />
      ) : null}
      {s === 'disputed' ? (
        <InlineAlert tone="danger" title="Customer raised a dispute" message="Your payout is on hold until support resolves it." />
      ) : null}
    </View>
  );
}

function OtpCard(props: {
  title: string;
  hint: string;
  code: string | null;
  locked: boolean;
  tone?: 'primary' | 'success';
  onRegenerate: () => void;
}) {
  const t = useTheme();
  const accent = props.tone === 'success' ? t.colors.success : t.colors.primary;
  const soft = props.tone === 'success' ? t.colors.successSoft : t.colors.primarySoft;
  const digits = (props.code ?? '····').split('');
  return (
    <Animated.View entering={FadeIn.duration(300)}>
      <Card variant="tinted" tint={soft} gap={t.spacing.md} style={{ alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="key" size={16} color={accent} />
          <Text variant="micro" uppercase style={{ color: accent }}>
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
              style={[
                {
                  width: 56,
                  height: 64,
                  borderRadius: t.radii.md,
                  backgroundColor: t.colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                },
                t.shadows.sm,
              ]}
            >
              <Text variant="display" style={{ color: accent }} maxFontSizeMultiplier={1.2}>
                {d}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="callout" color="textSecondary" align="center">
          {props.hint}
        </Text>
        {props.locked ? (
          <>
            <InlineAlert message="Too many wrong attempts. Generate a new code." />
            <Button title="Generate new code" variant="outline" leftIcon="refresh" onPress={props.onRegenerate} />
          </>
        ) : null}
      </Card>
    </Animated.View>
  );
}

function OtpEntry(props: {
  title: string;
  label: string;
  demoHint: string;
  busy: boolean;
  onSubmit: (otp: string) => Promise<OtpResult>;
  onDone: () => void;
}) {
  const t = useTheme();
  const [otp, setOtp] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (value = otp) => {
    if (value.length !== 4) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await props.onSubmit(value);
      if (res.ok) {
        haptics.success();
        setOtp('');
        props.onDone();
      } else {
        haptics.error();
        setMsg(
          res.error === 'locked'
            ? 'Locked after 5 wrong attempts. Ask the customer to generate a new code.'
            : `Wrong code. ${res.attempts_left ?? 0} attempts left.`,
        );
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card gap={t.spacing.md} elevation="md">
      <View style={{ gap: 2 }}>
        <Text variant="title3">{props.title}</Text>
        <Text variant="callout" color="muted">
          {props.label}
        </Text>
      </View>
      <OTPInput
        length={4}
        value={otp}
        onChange={(v) => {
          setOtp(v);
          setMsg(null);
        }}
        onComplete={(v) => void submit(v)}
        error={!!msg}
        accessibilityLabel="4-digit code from the customer"
      />
      <InlineAlert message={msg} />
      {isDemoMode ? <InlineAlert tone="info" icon="sparkles" message={`Demo: the customer's code is ${props.demoHint}.`} /> : null}
      <Button title="Verify code" onPress={() => void submit()} disabled={otp.length !== 4} loading={submitting || props.busy} fullWidth />
    </Card>
  );
}

const SUB_LABELS = [
  ['punctuality', 'Punctuality'],
  ['quality', 'Quality'],
  ['behaviour', 'Behaviour'],
  ['pricing', 'Fair price'],
] as const;

const RATING_WORDS = ['', 'Poor', 'Below average', 'Okay', 'Good', 'Excellent!'];

function ReviewForm({ name, busy, onSubmit }: { name: string; busy: boolean; onSubmit: (r: ReviewInput) => void }) {
  const t = useTheme();
  const [rating, setRating] = useState(0);
  const [sub, setSub] = useState({ punctuality: 0, quality: 0, behaviour: 0, pricing: 0 });
  const [comment, setComment] = useState('');

  return (
    <Card gap={t.spacing.lg} elevation="md">
      <View style={{ alignItems: 'center', gap: t.spacing.xs }}>
        <Text variant="title2" align="center">
          How was {name}?
        </Text>
        <RatingStars value={rating} size={36} onChange={setRating} label="Overall rating" />
        <Text variant="subhead" color={rating ? 'warningText' : 'muted'}>
          {rating ? RATING_WORDS[rating] : 'Tap a star to rate'}
        </Text>
      </View>
      <View style={{ backgroundColor: t.colors.surfaceAlt, borderRadius: t.radii.md, paddingHorizontal: t.spacing.md }}>
        {SUB_LABELS.map(([key, label]) => (
          <View key={key} style={{ paddingTop: t.spacing.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {label}
            </Text>
            <View style={{ marginLeft: -12 }}>
              <RatingStars value={sub[key]} size={22} onChange={(v) => setSub((x) => ({ ...x, [key]: v }))} label={label} />
            </View>
          </View>
        ))}
      </View>
      <TextArea
        placeholder="Tell others about your experience…"
        value={comment}
        onChangeText={setComment}
        maxLength={1000}
        accessibilityLabel="Review comment (optional)"
      />
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
