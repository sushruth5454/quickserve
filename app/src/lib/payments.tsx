import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { BottomSheet, Button, Text } from '../components/ui';
import { useTheme } from '../theme';
import { createPayment, createSchedulePayment, type PaymentLinkResponse } from './api';
import { demoPaymentsEnabled, isDemoMode } from './config';
import { completeDemoPayment } from './demo/demoApi';
import { haptics } from './haptics';
import { formatINR } from './money';
import { supabase } from './supabase';

type PayResult = 'paid' | 'opened' | 'cancelled';

const PaymentContext = createContext<(bookingId: string, scheduleId?: string) => Promise<PayResult>>(async () => 'cancelled');

/**
 * Starts payment for a booking. Real mode: opens the Razorpay Payment Link (the webhook advances the booking).
 * Demo mode: shows a simulated checkout sheet and records the payment locally.
 */
export function usePayment() {
  return useContext(PaymentContext);
}

const PURPOSE: Record<PaymentLinkResponse['purpose'], string> = {
  visit_fee: 'Visit / inspection fee',
  balance: 'Job payment (held until completion)',
  fixed: 'Fixed-price job',
  package: 'Fixed-price package',
  advance: 'Booking advance',
  milestone: 'Payment milestone',
  final: 'Final payment',
  platform_fee: 'QuickServe platform fee',
  addon: 'Approved add-on',
  session: 'Session payment',
};

const METHODS = [
  { id: 'upi', label: 'UPI', sub: 'Google Pay, PhonePe, Paytm', icon: 'qr-code-outline' as const },
  { id: 'card', label: 'Card', sub: 'Visa, Mastercard, RuPay', icon: 'card-outline' as const },
  { id: 'nb', label: 'Netbanking', sub: 'All major banks', icon: 'business-outline' as const },
];

async function settleDemoPayment(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('demo_settle_payment', { p_booking_id: bookingId });
  if (error) {
    throw new Error(/demo providers/i.test(error.message)
      ? 'Demo payments work only with demo providers. This booking needs a real payment.'
      : error.message.replace(/^[a-z_]+: /, ''));
  }
}

async function mockPayment(bookingId: string, scheduleId?: string): Promise<PaymentLinkResponse> {
  if (scheduleId) {
    const { data, error } = await supabase.from('payment_schedule').select('amount, purpose').eq('id', scheduleId).single();
    if (error) throw new Error(error.message);
    return {
      short_url: 'demo://payment',
      amount: Number(data.amount),
      purpose: (data.purpose as PaymentLinkResponse['purpose']) ?? 'milestone',
      schedule_id: scheduleId,
    };
  }
  const { data, error } = await supabase
    .from('bookings')
    .select('visit_fee, total_amount, archetype, status')
    .eq('id', bookingId)
    .single();
  if (error) throw new Error(error.message);
  if (data.archetype === 'proposal' || data.archetype === 'fixed' || data.archetype === 'time_based') {
    // Same as the server: one payment for every obligation due now (e.g. advance + platform fee).
    const { data: due, error: dueError } = await supabase
      .from('payment_schedule')
      .select('amount')
      .eq('booking_id', bookingId)
      .eq('status', 'due');
    if (dueError) throw new Error(dueError.message);
    const amount = (due ?? []).reduce((sum, row) => sum + Number(row.amount), 0);
    if (amount > 0) return { short_url: 'demo://payment', amount, purpose: data.archetype === 'fixed' ? 'fixed' : data.archetype === 'time_based' ? 'session' : 'advance' };
  }
  const fixed = data.archetype === 'fixed' || data.archetype === 'proposal' || data.archetype === 'time_based';
  return {
    short_url: 'demo://payment',
    amount: Number(fixed ? data.total_amount ?? 0 : data.visit_fee),
    purpose: data.archetype === 'fixed' ? 'fixed' : data.archetype === 'proposal' ? 'advance' : data.archetype === 'time_based' ? 'session' : 'visit_fee',
  };
}

export function PaymentProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const [link, setLink] = useState<(PaymentLinkResponse & { bookingId: string }) | null>(null);
  const [visible, setVisible] = useState(false);
  const [method, setMethod] = useState('upi');
  const [stage, setStage] = useState<'choose' | 'processing' | 'done'>('choose');
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((r: PayResult) => void) | null>(null);

  const finish = useCallback((r: PayResult) => {
    setVisible(false);
    resolver.current?.(r);
    resolver.current = null;
  }, []);

  const pay = useCallback(async (bookingId: string, scheduleId?: string): Promise<PayResult> => {
    const res = demoPaymentsEnabled && !isDemoMode
      ? await mockPayment(bookingId, scheduleId)
      : scheduleId ? await createSchedulePayment(bookingId, scheduleId) : await createPayment(bookingId);
    if (!demoPaymentsEnabled) {
      await WebBrowser.openBrowserAsync(res.short_url);
      return 'opened';
    }
    setLink({ ...res, bookingId });
    setStage('choose');
    setError(null);
    setVisible(true);
    return new Promise<PayResult>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const confirm = async () => {
    if (!link) return;
    setStage('processing');
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 700));
      if (isDemoMode) await completeDemoPayment(link.bookingId);
      // Live-backend demo builds: settle on the server (demo providers only), so the booking really moves on.
      else await settleDemoPayment(link.bookingId);
      haptics.success();
      setStage('done');
      setTimeout(() => finish('paid'), 900);
    } catch (e) {
      setStage('choose');
      setError((e as Error).message);
    }
  };

  return (
    <PaymentContext.Provider value={pay}>
      {children}
      <BottomSheet
        visible={visible}
        onClose={() => stage !== 'processing' && finish(stage === 'done' ? 'paid' : 'cancelled')}
        title={stage === 'done' ? undefined : 'Secure checkout'}
        subtitle={stage === 'done' ? undefined : 'Demo mode — no real money moves'}
        footer={
          stage === 'choose' && link ? (
            <Button title={`Pay ${formatINR(link.amount)}`} onPress={() => void confirm()} leftIcon="lock-closed" size="lg" fullWidth />
          ) : undefined
        }
      >
        {link && stage !== 'done' ? (
          <View style={{ gap: t.spacing.lg }}>
            <View style={{ alignItems: 'center', gap: 4, paddingVertical: t.spacing.sm }}>
              <Text variant="footnote" color="muted" align="center">
                {PURPOSE[link.purpose]}
              </Text>
              <Text variant="display" tabular>
                {formatINR(link.amount)}
              </Text>
              <Text variant="caption" color="muted">
                Booking #{link.bookingId.slice(0, 8)}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <Ionicons name="shield-checkmark-outline" size={14} color={t.colors.successText} />
                <Text variant="footnote" color="successText">
                  Held safely by QuickServe until the job is done
                </Text>
              </View>
            </View>
            <View style={{ gap: t.spacing.sm }}>
              <Text variant="subheadStrong" color="textSecondary">
                Pay with
              </Text>
              {METHODS.map((m) => {
                const selected = method === m.id;
                return (
                  <Pressable
                    key={m.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${m.label}, ${m.sub}`}
                    onPress={() => {
                      haptics.select();
                      setMethod(m.id);
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: t.spacing.md,
                      minHeight: 60,
                      paddingHorizontal: selected ? t.spacing.lg - 1 : t.spacing.lg,
                      borderRadius: t.radii.md,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? t.colors.primary : t.colors.borderStrong,
                      backgroundColor: selected ? t.colors.primarySoft : pressed ? t.colors.surfaceAlt : t.colors.surface,
                    })}
                  >
                    <Ionicons name={m.icon} size={22} color={selected ? t.colors.primaryText : t.colors.textSecondary} />
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyStrong">{m.label}</Text>
                      <Text variant="footnote" color="muted">
                        {m.sub}
                      </Text>
                    </View>
                    <View
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        borderWidth: selected ? 6 : 1.5,
                        borderColor: selected ? t.colors.primary : t.colors.outline,
                        backgroundColor: t.colors.surface,
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>
            {stage === 'processing' ? (
              <View style={{ flexDirection: 'row', gap: t.spacing.sm, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={t.colors.primary} />
                <Text variant="callout" color="muted">
                  Processing payment…
                </Text>
              </View>
            ) : null}
            {error ? (
              <Text variant="caption" color="dangerText">
                {error}
              </Text>
            ) : null}
          </View>
        ) : null}
        {stage === 'done' && link ? (
          <View style={{ alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.xxl }}>
            <View
              style={{
                width: 76,
                height: 76,
                borderRadius: 38,
                backgroundColor: t.colors.successSoft,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="checkmark-circle" size={52} color={t.colors.success} />
            </View>
            <Text variant="title2">Payment successful</Text>
            <Text variant="callout" color="muted">
              {formatINR(link.amount)} paid for booking #{link.bookingId}
            </Text>
          </View>
        ) : null}
      </BottomSheet>
    </PaymentContext.Provider>
  );
}
