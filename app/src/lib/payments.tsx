import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { BottomSheet, Button, Text } from '../components/ui';
import { useTheme } from '../theme';
import { createPayment, type PaymentLinkResponse } from './api';
import { isDemoMode } from './config';
import { completeDemoPayment } from './demo/demoApi';
import { haptics } from './haptics';
import { formatINR } from './money';

type PayResult = 'paid' | 'opened' | 'cancelled';

const PaymentContext = createContext<(bookingId: string) => Promise<PayResult>>(async () => 'cancelled');

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
  addon: 'Approved add-on',
  session: 'Session payment',
};

const METHODS = [
  { id: 'upi', label: 'UPI', sub: 'Google Pay, PhonePe, Paytm', icon: 'qr-code-outline' as const },
  { id: 'card', label: 'Card', sub: 'Visa, Mastercard, RuPay', icon: 'card-outline' as const },
  { id: 'nb', label: 'Netbanking', sub: 'All major banks', icon: 'business-outline' as const },
];

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

  const pay = useCallback(async (bookingId: string): Promise<PayResult> => {
    const res = await createPayment(bookingId);
    if (!isDemoMode) {
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
      await completeDemoPayment(link.bookingId);
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
