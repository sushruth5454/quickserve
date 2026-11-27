/** Small building blocks shared by the onboarding sections (reuse theme + components/ui). */
import { Ionicons } from '@expo/vector-icons';
import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Chip, Header, InlineAlert, Text } from '../../components/ui';
import { label12 } from '../../lib/onboarding/availability';
import { STEP_LABELS } from '../../lib/onboarding/copy';
import { useTheme } from '../../theme';
import type { OnboardingReadState } from './useOnboardingData';

interface OnboardingReadContextValue {
  state: OnboardingReadState;
  reload: () => Promise<boolean>;
}

const OnboardingReadContext = createContext<OnboardingReadContextValue | null>(null);

export interface SectionProps {
  data: import('./useOnboardingData').OnboardingData;
  reload: (options?: { afterMutation?: boolean }) => Promise<boolean>;
  header: ReactNode;
  mode: 'wizard' | 'edit';
  oorvaComposition?: boolean;
  onDone: () => void;
  onBack?: () => void;
}

export function onboardingCompositionEnabled(brandEnabled: boolean, onboardingEnabled: boolean): boolean {
  return brandEnabled && onboardingEnabled;
}

export function OnboardingReadStateProvider({
  state,
  reload,
  children,
}: OnboardingReadContextValue & { children: ReactNode }) {
  return <OnboardingReadContext.Provider value={{ state, reload }}>{children}</OnboardingReadContext.Provider>;
}

export function useOnboardingReadState(): OnboardingReadContextValue | null {
  return useContext(OnboardingReadContext);
}

export function OnboardingReadNotice() {
  const context = useOnboardingReadState();
  if (!context || context.state.status !== 'stale') return null;
  return (
    <InlineAlert
      title={context.state.afterMutation ? 'Saved, refresh failed' : 'Latest status unavailable'}
      message={context.state.error ?? 'Provider details may be out of date.'}
      actionLabel="Retry"
      onAction={() => void context.reload().catch(() => undefined)}
    />
  );
}

export function ProgressBar({ value, tone = 'primary' }: { value: number; tone?: 'primary' | 'success' }) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
      style={{ height: 6, borderRadius: 3, backgroundColor: t.colors.surfaceAlt, overflow: 'hidden' }}
    >
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height: 6, borderRadius: 3, backgroundColor: tone === 'success' ? t.colors.success : t.colors.primary }} />
    </View>
  );
}

/** Wizard header: compact "Step n of 7" + bar (seven labelled dots do not fit a phone width). */
export function WizardHeader({ step, onBack }: { step: number; onBack?: () => void }) {
  const t = useTheme();
  return (
    <Header title="Become a provider" onBack={onBack}>
      <View style={{ paddingHorizontal: t.spacing.xl, paddingBottom: t.spacing.md, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="captionStrong" color="primaryText">
            Step {step + 1} of {STEP_LABELS.length}
          </Text>
          <Text variant="caption" color="muted">
            {STEP_LABELS[step]}
          </Text>
        </View>
        <ProgressBar value={(step + 1) / STEP_LABELS.length} />
      </View>
    </Header>
  );
}

export function SectionFooter(props: {
  primary: string;
  onPrimary: () => void;
  loading?: boolean;
  disabled?: boolean;
  onBack?: () => void;
  secondary?: { title: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <OnboardingReadNotice />
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        {props.onBack ? <Button title="Back" variant="outline" size="lg" onPress={props.onBack} style={{ flex: 1 }} /> : null}
        <Button
          title={props.primary}
          size="lg"
          rightIcon="arrow-forward"
          onPress={props.onPrimary}
          loading={props.loading}
          disabled={props.disabled}
          style={{ flex: 2 }}
        />
      </View>
      {props.secondary ? <Button title={props.secondary.title} variant="ghost" size="sm" onPress={props.secondary.onPress} /> : null}
    </View>
  );
}

export function Intro({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text variant="title2" accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="callout" color="muted">
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function FieldLabel({ children, hint, error }: { children: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="subhead" color="textSecondary">
        {children}
      </Text>
      {hint ? (
        <Text variant="footnote" color="muted">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text variant="footnote" color="dangerText" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function MultiChips({ options, selected, onToggle, label }: { options: { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }} accessibilityLabel={label}>
      {options.map((o) => (
        <Chip key={o.value} label={o.label} selected={selected.includes(o.value)} check onPress={() => onToggle(o.value)} />
      ))}
    </View>
  );
}

function StepBtn({ icon, onPress, disabled, label }: { icon: 'remove' | 'add' | 'chevron-back' | 'chevron-forward'; onPress: () => void; disabled?: boolean; label: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.border,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Ionicons name={icon} size={16} color={t.colors.textSecondary} />
    </Pressable>
  );
}

/** Time picker without a native dependency: ± 30 minutes, 00:00–24:00. */
export function TimeStepper({ minutes, onChange, min = 0, max = 1440, label }: { minutes: number; onChange: (m: number) => void; min?: number; max?: number; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityLabel={`${label}: ${label12(minutes)}`}>
      <StepBtn icon="remove" label={`Earlier ${label}`} disabled={minutes - 30 < min} onPress={() => onChange(minutes - 30)} />
      <Text variant="subheadStrong" tabular style={{ minWidth: 66, textAlign: 'center' }}>
        {minutes === 1440 ? 'Midnight' : label12(minutes)}
      </Text>
      <StepBtn icon="add" label={`Later ${label}`} disabled={minutes + 30 > max} onPress={() => onChange(minutes + 30)} />
      <View style={{ width: t.spacing.xs }} />
    </View>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** YYYY-MM-DD helpers in IST (dates are whole provider-local days). */
export function istToday(): string {
  const x = new Date(Date.now() + 330 * 60_000);
  return x.toISOString().slice(0, 10);
}
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dateLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function DateStepper({ value, onChange, min, max, label }: { value: string; onChange: (d: string) => void; min: string; max: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLabel={`${label}: ${dateLabel(value)}`}>
      <StepBtn icon="chevron-back" label={`Previous day for ${label}`} disabled={value <= min} onPress={() => onChange(addDays(value, -1))} />
      <Text variant="subheadStrong" style={{ minWidth: 110, textAlign: 'center' }}>
        {dateLabel(value)}
      </Text>
      <StepBtn icon="chevron-forward" label={`Next day for ${label}`} disabled={value >= max} onPress={() => onChange(addDays(value, 1))} />
    </View>
  );
}
