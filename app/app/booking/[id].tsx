import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { ChatPanel } from '../../src/components/ChatPanel';
import { QuoteEditor } from '../../src/components/QuoteEditor';
import { QuoteView } from '../../src/components/QuoteView';
import { RatingStars } from '../../src/components/RatingStars';
import { Card, ErrorText, Field, Loading, Screen, Section } from '../../src/components/Screen';
import { StatusTimeline, statusLabel } from '../../src/components/StatusTimeline';
import * as api from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { amountDue, formatINR } from '../../src/lib/money';
import { colors, font, minTouch, radius, spacing } from '../../src/lib/theme';
import type {
  Booking,
  BookingAddress,
  BookingOtps,
  OtpResult,
  Payment,
  Quote,
  QuoteItemDraft,
  Review,
  ReviewInput,
} from '../../src/lib/types';

interface Data {
  booking: Booking;
  quotes: Quote[];
  payments: Payment[];
  otps: BookingOtps | null;
  address: BookingAddress | null;
  review: Review | null;
  counterpart: string;
  photoUrls: string[];
}

const CHAT_CLOSED = new Set(['pending_payment', 'declined', 'expired', 'cancelled']);

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id || !userId) return;
    setRefreshing(true);
    try {
      const booking = await api.getBooking(id);
      const isCustomer = booking.customer_id === userId;
      const [quotes, payments, otps, address, review, counterpart, photoUrls] = await Promise.all([
        api.getQuotes(id),
        api.getPayments(id),
        isCustomer ? api.getBookingOtps(id) : Promise.resolve(null),
        api.getBookingAddress(id),
        api.getReviewForBooking(id),
        api.getProfileName(isCustomer ? booking.provider_id : booking.customer_id),
        api.signedPhotoUrls(booking.photos).catch(() => []),
      ]);
      setData({ booking, quotes, payments, otps, address, review, counterpart, photoUrls });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }, [id, userId]);

  useEffect(() => {
    void load();
    if (!id) return;
    return api.subscribeToBooking(id, () => void load());
  }, [id, load]);

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const pay = useCallback(
    () =>
      run(async () => {
        if (!id) return;
        const link = await api.createPayment(id);
        await WebBrowser.openBrowserAsync(link.short_url);
      }),
    [id, run],
  );

  if (!data || !userId) return error ? <Screen><ErrorText message={error} /></Screen> : <Loading />;

  const { booking, quotes, payments } = data;
  const isCustomer = booking.customer_id === userId;
  const paid = payments.filter((p) => p.status === 'paid').reduce((acc, p) => acc + p.amount, 0);
  const openQuote = quotes.find((q) => q.status === 'sent') ?? null;
  const pendingPaymentQuote = quotes.find((q) => q.status === 'approved_pending_payment') ?? null;
  const approvedQuote = quotes.find((q) => q.id === booking.approved_quote_id) ?? null;
  const shownQuoteIds = new Set([openQuote?.id, pendingPaymentQuote?.id].filter(Boolean));

  return (
    <Screen refreshing={refreshing} onRefresh={load}>
      <Stack.Screen options={{ title: booking.categories?.name ?? 'Booking' }} />
      <Card>
        <Text style={font.heading}>{statusLabel[booking.status]}</Text>
        <Text style={font.body}>
          {isCustomer ? 'Provider' : 'Customer'}: {data.counterpart}
        </Text>
        <Text style={font.caption}>
          {data.address?.address_line ? `${data.address.address_line}, ${data.address.area}` : `Area: ${data.address?.area ?? '—'}`}
        </Text>
        <Text style={font.caption}>
          {booking.scheduled_at ? `Scheduled ${new Date(booking.scheduled_at).toLocaleString()}` : 'ASAP'}
        </Text>
        {booking.description ? <Text style={font.body}>“{booking.description}”</Text> : null}
        {data.photoUrls.length > 0 && (
          <View style={styles.photos}>
            {data.photoUrls.map((u) => (
              <Image key={u} source={{ uri: u }} style={styles.thumb} accessibilityLabel="Problem photo" />
            ))}
          </View>
        )}
      </Card>

      <ErrorText message={error} />

      {isCustomer ? (
        <CustomerActions
          data={data}
          paid={paid}
          openQuote={openQuote}
          pendingPaymentQuote={pendingPaymentQuote}
          busy={busy}
          run={run}
          pay={pay}
        />
      ) : (
        <ProviderActions booking={booking} openQuote={openQuote} busy={busy} run={run} />
      )}

      <Section title="Progress">
        <StatusTimeline status={booking.status} />
      </Section>

      {openQuote && !(isCustomer && ['quote_sent', 'in_progress'].includes(booking.status)) && (
        <QuoteView quote={openQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} />
      )}
      {pendingPaymentQuote && !isCustomer && (
        <QuoteView
          quote={pendingPaymentQuote}
          visitFee={booking.visit_fee}
          platformFee={booking.platform_fee}
          alreadyPaid={paid}
        />
      )}
      {approvedQuote && !shownQuoteIds.has(approvedQuote.id) && (
        <Section title="Approved scope">
          <QuoteView quote={approvedQuote} visitFee={booking.visit_fee} platformFee={booking.platform_fee} alreadyPaid={paid} />
        </Section>
      )}

      <Section title="Payments">
        {payments.length === 0 && <Text style={font.caption}>No payments yet.</Text>}
        {payments.map((p) => (
          <View key={p.id} style={styles.between}>
            <Text style={font.body}>{p.purpose === 'visit_fee' ? 'Visit fee' : 'Job payment'}</Text>
            <Text style={font.caption}>
              {formatINR(p.amount)} • {p.status.replace('_', ' ')}
            </Text>
          </View>
        ))}
      </Section>

      <Section title="Chat">
        <ChatPanel bookingId={booking.id} userId={userId} enabled={!CHAT_CLOSED.has(booking.status)} />
      </Section>
    </Screen>
  );
}

type Run = (fn: () => Promise<unknown>) => Promise<void>;

function CustomerActions(props: {
  data: Data;
  paid: number;
  openQuote: Quote | null;
  pendingPaymentQuote: Quote | null;
  busy: boolean;
  run: Run;
  pay: () => Promise<void>;
}) {
  const { data, paid, openQuote, pendingPaymentQuote, busy, run, pay } = props;
  const { booking, otps, review } = data;
  const s = booking.status;
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [reason, setReason] = useState('');

  const cancel = (warning: string) =>
    Alert.alert('Cancel booking?', warning, [
      { text: 'Keep booking', style: 'cancel' },
      { text: 'Cancel booking', style: 'destructive', onPress: () => void run(() => api.cancelBooking(booking.id)) },
    ]);

  const approve = (quote: Quote) =>
    run(async () => {
      const res = await api.approveQuote(booking.id, quote.id);
      if (res.amount_due > 0) {
        const link = await api.createPayment(booking.id);
        await WebBrowser.openBrowserAsync(link.short_url);
      }
    });

  const due = pendingPaymentQuote
    ? amountDue({
        quoteTotal: pendingPaymentQuote.total,
        visitFee: booking.visit_fee,
        platformFee: booking.platform_fee,
        alreadyPaid: paid,
      })
    : 0;

  return (
    <View style={styles.actions}>
      {s === 'pending_payment' && (
        <>
          <Button title={`Pay visit fee ${formatINR(booking.visit_fee)}`} onPress={() => void pay()} loading={busy} />
          <Button title="Cancel" variant="ghost" onPress={() => cancel('No charge — you have not paid yet.')} />
        </>
      )}
      {s === 'requested' && (
        <Button title="Cancel (full refund)" variant="secondary" onPress={() => cancel('Your visit fee will be refunded.')} />
      )}
      {(s === 'accepted' || s === 'en_route') && (
        <OtpCard
          title="Start code"
          hint="Share this code with the provider when they arrive."
          code={otps?.start_otp ?? null}
          locked={!!otps?.start_locked}
          onRegenerate={() => run(() => api.regenerateOtp(booking.id, 'start'))}
        />
      )}
      {s === 'accepted' && (
        <Button title="Cancel (full refund)" variant="ghost" onPress={() => cancel('Your visit fee will be refunded.')} />
      )}
      {s === 'en_route' && (
        <Button
          title="Cancel"
          variant="ghost"
          onPress={() => cancel('The provider is on the way, so the visit fee will not be refunded.')}
        />
      )}
      {openQuote && (s === 'quote_sent' || s === 'in_progress') && (
        <QuoteView
          quote={openQuote}
          visitFee={booking.visit_fee}
          platformFee={booking.platform_fee}
          alreadyPaid={paid}
          canRespond
          busy={busy}
          onApprove={() => void approve(openQuote)}
          onReject={() => void run(() => api.rejectQuote(booking.id, openQuote.id))}
        />
      )}
      {pendingPaymentQuote && due > 0 && (
        <>
          <QuoteView
            quote={pendingPaymentQuote}
            visitFee={booking.visit_fee}
            platformFee={booking.platform_fee}
            alreadyPaid={paid}
          />
          <Button
            title={`${pendingPaymentQuote.is_change_order ? 'Pay extra' : 'Pay to start work'} ${formatINR(due)}`}
            onPress={() => void pay()}
            loading={busy}
          />
        </>
      )}
      {s === 'awaiting_payment' && (
        <Button
          title="Cancel job"
          variant="ghost"
          onPress={() => cancel('The inspection is done, so the visit fee will be paid to the provider.')}
        />
      )}
      {s === 'completion_requested' && (
        <>
          <OtpCard
            title="Completion code"
            hint="Check the work. Share this code with the provider only if you are satisfied."
            code={otps?.end_otp ?? null}
            locked={!!otps?.end_locked}
            onRegenerate={() => run(() => api.regenerateOtp(booking.id, 'end'))}
          />
          <Button title="Confirm job done" variant="success" onPress={() => void run(() => api.confirmCompletion(booking.id))} />
          <Text style={font.caption}>The job auto-confirms 24 hours after the provider marks it done.</Text>
        </>
      )}
      {(s === 'in_progress' || s === 'completion_requested' || s === 'completed') && (
        <>
          {disputeOpen ? (
            <Card>
              <Field label="What went wrong?" multiline value={reason} onChangeText={setReason} />
              <Button
                title="Raise dispute"
                variant="danger"
                disabled={!reason.trim()}
                loading={busy}
                onPress={() => void run(() => api.disputeBooking(booking.id, reason.trim()))}
              />
            </Card>
          ) : (
            <Button title="Report a problem" variant="ghost" onPress={() => setDisputeOpen(true)} />
          )}
        </>
      )}
      {(s === 'completed' || s === 'closed') && !review && (
        <ReviewForm busy={busy} onSubmit={(r) => void run(() => api.submitReview(booking.id, r))} />
      )}
      {review && (
        <Card>
          <Text style={font.heading}>Your review</Text>
          <RatingStars value={review.rating} />
          {review.comment ? <Text style={font.body}>{review.comment}</Text> : null}
        </Card>
      )}
    </View>
  );
}

function ProviderActions(props: { booking: Booking; openQuote: Quote | null; busy: boolean; run: Run }) {
  const { booking, openQuote, busy, run } = props;
  const s = booking.status;
  const [showChangeOrder, setShowChangeOrder] = useState(false);

  const sendQuote = (items: QuoteItemDraft[], note: string) =>
    run(async () => {
      await api.sendQuote(booking.id, items, note || undefined);
      setShowChangeOrder(false);
    });

  return (
    <View style={styles.actions}>
      {s === 'requested' && (
        <Text style={font.body}>Accept or decline this request from your dashboard within 15 minutes.</Text>
      )}
      {s === 'accepted' && <Button title="Start trip" onPress={() => void run(() => api.startTrip(booking.id))} loading={busy} />}
      {s === 'en_route' && (
        <OtpEntry
          label="Enter the customer's start code to mark arrival"
          busy={busy}
          onSubmit={(otp) => api.arrive(booking.id, otp)}
          onDone={() => void run(async () => undefined)}
        />
      )}
      {(s === 'inspecting' || s === 'quote_sent') && (
        <Card>
          {s === 'quote_sent' && <Text style={font.caption}>Waiting for approval. Sending a new quote replaces the open one.</Text>}
          <QuoteEditor submitting={busy} onSubmit={(items, note) => void sendQuote(items, note)} />
        </Card>
      )}
      {s === 'awaiting_payment' && <Text style={font.body}>Quote approved. Waiting for the customer's payment before work starts.</Text>}
      {s === 'in_progress' && (
        <>
          <Button
            title="Mark job done (request completion)"
            variant="success"
            disabled={!!openQuote}
            onPress={() => void run(() => api.requestCompletion(booking.id))}
            loading={busy}
          />
          {showChangeOrder ? (
            <Card>
              <QuoteEditor isChangeOrder submitting={busy} onSubmit={(items, note) => void sendQuote(items, note)} />
            </Card>
          ) : (
            <Button title="Send change order" variant="secondary" onPress={() => setShowChangeOrder(true)} />
          )}
        </>
      )}
      {s === 'completion_requested' && (
        <OtpEntry
          label="Enter the customer's completion code"
          busy={busy}
          onSubmit={(otp) => api.completeBooking(booking.id, otp)}
          onDone={() => void run(async () => undefined)}
        />
      )}
      {s === 'completed' && <Text style={font.body}>Done! Your payout is released after the 24-hour dispute window.</Text>}
      {s === 'disputed' && <Text style={font.body}>The customer raised a dispute. Your payout is on hold until support resolves it.</Text>}
    </View>
  );
}

function OtpCard(props: {
  title: string;
  hint: string;
  code: string | null;
  locked: boolean;
  onRegenerate: () => void;
}) {
  return (
    <Card style={styles.otpCard}>
      <Text style={font.heading}>{props.title}</Text>
      <Text style={styles.otp} accessibilityLabel={`${props.title} ${props.code?.split('').join(' ') ?? 'not available'}`}>
        {props.code ?? '— — — —'}
      </Text>
      <Text style={font.caption}>{props.hint}</Text>
      {props.locked && (
        <>
          <ErrorText message="Too many wrong attempts. Generate a new code." />
          <Button title="Generate new code" variant="secondary" onPress={props.onRegenerate} />
        </>
      )}
    </Card>
  );
}

function OtpEntry(props: {
  label: string;
  busy: boolean;
  onSubmit: (otp: string) => Promise<OtpResult>;
  onDone: () => void;
}) {
  const [otp, setOtp] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await props.onSubmit(otp);
      if (res.ok) {
        setOtp('');
        props.onDone();
      } else if (res.error === 'locked') {
        setMsg('Locked after 5 wrong attempts. Ask the customer to generate a new code.');
      } else {
        setMsg(`Wrong code. ${res.attempts_left ?? 0} attempts left.`);
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <Text style={font.body}>{props.label}</Text>
      <TextInput
        value={otp}
        onChangeText={(t) => setOtp(t.replace(/\D/g, '').slice(0, 4))}
        keyboardType="number-pad"
        maxLength={4}
        style={styles.otpInput}
        accessibilityLabel="4-digit code"
        placeholder="0000"
        placeholderTextColor={colors.muted}
      />
      <ErrorText message={msg} />
      <Button title="Verify code" onPress={() => void submit()} disabled={otp.length !== 4} loading={submitting || props.busy} />
    </Card>
  );
}

function ReviewForm({ busy, onSubmit }: { busy: boolean; onSubmit: (r: ReviewInput) => void }) {
  const [rating, setRating] = useState(0);
  const [sub, setSub] = useState({ punctuality: 0, quality: 0, behaviour: 0, pricing: 0 });
  const [comment, setComment] = useState('');
  const subLabels = useMemo(
    () =>
      [
        ['punctuality', 'Punctuality'],
        ['quality', 'Quality'],
        ['behaviour', 'Behaviour'],
        ['pricing', 'Pricing fairness'],
      ] as const,
    [],
  );

  return (
    <Card>
      <Text style={font.heading}>Rate this job</Text>
      <RatingStars value={rating} size={32} onChange={setRating} label="Overall" />
      {subLabels.map(([key, label]) => (
        <View key={key} style={styles.between}>
          <Text style={font.body}>{label}</Text>
          <RatingStars value={sub[key]} size={20} onChange={(v) => setSub((x) => ({ ...x, [key]: v }))} label={label} />
        </View>
      ))}
      <Field label="Comment (optional)" multiline value={comment} onChangeText={setComment} maxLength={1000} />
      <Button
        title="Submit review"
        disabled={rating === 0}
        loading={busy}
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

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
  photos: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  thumb: { width: 72, height: 72, borderRadius: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  otpCard: { alignItems: 'center', backgroundColor: colors.primarySoft },
  otp: { fontSize: 40, fontWeight: '800', letterSpacing: 12, color: colors.primary },
  otpInput: {
    minHeight: minTouch + 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    fontSize: 28,
    letterSpacing: 12,
    textAlign: 'center',
    color: colors.text,
    backgroundColor: colors.surface,
  },
});
