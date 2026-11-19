import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Button, Card, InlineAlert, OTPInput, Text } from '../../components/ui';
import type { Booking } from '../../lib/types';
import { DEMO_PROVIDER_END_CODE, DEMO_PROVIDER_START_CODE } from '../../lib/demo/seed';
import { isDemoMode } from '../../lib/config';
import { useTheme } from '../../theme';

type Theme = ReturnType<typeof useTheme>;

export function ActionsRow({
  status,
  archetype,
  isCustomer,
  isTimeBased,
  theme,
  otp,
  otpMsg,
  first,
  onSetOtp,
  onSetOtpMsg,
  onSubmitOtp,
  onOpenEditor,
}: {
  status: Booking['status'];
  archetype: Booking['archetype'];
  isCustomer: boolean;
  isTimeBased: boolean;
  theme: Theme;
  otp: string;
  otpMsg: string | null;
  first: string;
  onSetOtp: (value: string) => void;
  onSetOtpMsg: (value: string | null) => void;
  onSubmitOtp: (value?: string) => Promise<void>;
  onOpenEditor: (changeOrder: boolean) => void;
}) {
  return (
    <Fragment>
      {!isCustomer && (status === 'en_route' || status === 'completion_requested' || (isTimeBased && status === 'accepted') || (status === 'confirmed' && archetype === 'proposal')) ? (
        <ProviderOtpCard
          status={status}
          archetype={archetype}
          isTimeBased={isTimeBased}
          theme={theme}
          first={first}
          otp={otp}
          otpMsg={otpMsg}
          onSetOtp={onSetOtp}
          onSetOtpMsg={onSetOtpMsg}
          onSubmitOtp={onSubmitOtp}
        />
      ) : null}
      {!isCustomer && status === 'quote_sent' ? (
        <Button title="Revise quote" leftIcon="create-outline" variant="outline" onPress={() => onOpenEditor(false)} />
      ) : null}
      {!isCustomer && status === 'in_progress' ? (
        <Button title="Send change order" variant="outline" leftIcon="add-circle-outline" onPress={() => onOpenEditor(true)} />
      ) : null}
    </Fragment>
  );
}

function ProviderOtpCard({
  status,
  archetype,
  isTimeBased,
  theme,
  first,
  otp,
  otpMsg,
  onSetOtp,
  onSetOtpMsg,
  onSubmitOtp,
}: {
  status: Booking['status'];
  archetype: Booking['archetype'];
  isTimeBased: boolean;
  theme: Theme;
  first: string;
  otp: string;
  otpMsg: string | null;
  onSetOtp: (value: string) => void;
  onSetOtpMsg: (value: string | null) => void;
  onSubmitOtp: (value?: string) => Promise<void>;
}) {
  const t = theme;
  return (
    <Card variant="elevated" gap={t.spacing.lg}>
      <Text variant="subheadStrong" color="textSecondary" align="center">
        {status === 'completion_requested' ? 'Completion code' : 'Start code'} from {first}
      </Text>
      <OTPInput
        length={4}
        value={otp}
        onChange={(v) => {
          onSetOtp(v);
          onSetOtpMsg(null);
        }}
        onComplete={(v) => void onSubmitOtp(v)}
        error={!!otpMsg}
        accessibilityLabel="4-digit code from the customer"
      />
      <InlineAlert message={otpMsg} />
      {isDemoMode ? (
        <InlineAlert
          tone="warning"
          icon="flask-outline"
          message={`Demo: the customer's code is ${status === 'en_route' || (isTimeBased && status === 'accepted') || (status === 'confirmed' && archetype === 'proposal') ? DEMO_PROVIDER_START_CODE : DEMO_PROVIDER_END_CODE}.`}
        />
      ) : null}
    </Card>
  );
}

export function OtpCard(props: { title: string; hint: string; code: string | null; locked: boolean; onRegenerate: () => void }) {
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
