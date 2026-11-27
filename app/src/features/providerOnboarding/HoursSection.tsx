import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Chip, InlineAlert, Input, ListItem, Screen, Stepper, Text, useConfirm, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { onboardingApi, type TimeOff, type WeeklySlot } from '../../lib/onboarding';
import {
  copyDay,
  formatHHMM,
  localParts,
  MAX_SLOTS_PER_DAY,
  parseHHMM,
  PRESETS,
  rangeLabel,
  sortSlots,
  validateSlots,
  WEEK_ORDER,
} from '../../lib/onboarding/availability';
import { useTheme } from '../../theme';
import { addDays, DateStepper, dateLabel, FieldLabel, Intro, istToday, SectionFooter, TimeStepper, type SectionProps } from './parts';
import { useDraft } from './useOnboardingData';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface HoursSectionState {
  slots: WeeklySlot[];
  maxJobs: number | null;
  error: string | null;
  saving: boolean;
  offFrom: string;
  offTo: string;
  offReason: string;
  offOpen: boolean;
  offBusy: boolean;
}

/** Time-off rows come back as timestamps; show them as provider-local whole days. */
export function timeOffDays(t: TimeOff, tz?: string | null): { from: string; to: string } {
  return { from: localParts(new Date(t.from), tz).dateKey, to: localParts(new Date(new Date(t.to).getTime() - 1), tz).dateKey };
}

export function HoursSection({ data, reload, header, mode, onDone, onBack }: SectionProps) {
  const t = useTheme();
  const toast = useToast();
  const confirm = useConfirm();
  const { userId } = useAuth();
  const currentUserIdRef = useRef(userId);
  currentUserIdRef.current = userId;
  const p = data.state.provider;
  const today = istToday();
  const initialState: HoursSectionState = {
    slots: userId ? sortSlots(data.state.availability) : [],
    maxJobs: userId ? p?.max_jobs_per_day ?? null : null,
    error: null,
    saving: false,
    offFrom: today,
    offTo: today,
    offReason: '',
    offOpen: false,
    offBusy: false,
  };
  const [ownedState, setOwnedState] = useState<{ ownerId: string | null; value: HoursSectionState }>({
    ownerId: userId,
    value: initialState,
  });
  const sectionState = ownedState.ownerId === userId ? ownedState.value : initialState;
  const updateSectionState = (update: (current: HoursSectionState) => HoursSectionState) => {
    if (currentUserIdRef.current !== userId) return;
    setOwnedState((current) => ({
      ownerId: userId,
      value: update(current.ownerId === userId ? current.value : initialState),
    }));
  };
  const { slots, maxJobs, error, saving, offFrom, offTo, offReason, offOpen, offBusy } = sectionState;
  const setSlots = (next: WeeklySlot[] | ((current: WeeklySlot[]) => WeeklySlot[])) =>
    updateSectionState((current) => ({
      ...current,
      slots: typeof next === 'function' ? next(current.slots) : next,
    }));
  const setMaxJobs = (value: number | null) => updateSectionState((current) => ({ ...current, maxJobs: value }));
  const setError = (value: string | null) => updateSectionState((current) => ({ ...current, error: value }));
  const setSaving = (value: boolean) => updateSectionState((current) => ({ ...current, saving: value }));
  const setOffFrom = (value: string) => updateSectionState((current) => ({ ...current, offFrom: value }));
  const setOffTo = (value: string) => updateSectionState((current) => ({ ...current, offTo: value }));
  const setOffReason = (value: string) => updateSectionState((current) => ({ ...current, offReason: value }));
  const setOffOpen = (value: boolean) => updateSectionState((current) => ({ ...current, offOpen: value }));
  const setOffBusy = (value: boolean) => updateSectionState((current) => ({ ...current, offBusy: value }));
  const draft = useDraft(userId, 'provider-hours', { slots, maxJobs }, (d) => {
    if (data.state.availability.length === 0 && d.slots?.length) {
      setSlots(d.slots);
      setMaxJobs(d.maxJobs ?? null);
    }
  });
  const problem = useMemo(() => (slots.length ? validateSlots(slots) : null), [slots]);

  const daySlots = (d: number) => slots.filter((s) => s.weekday === d);
  const replaceDay = (d: number, next: WeeklySlot[]) => setSlots(sortSlots([...slots.filter((s) => s.weekday !== d), ...next]));
  const updateSlot = (d: number, i: number, patch: Partial<WeeklySlot>) => replaceDay(d, daySlots(d).map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const addSlot = (d: number) => {
    const cur = daySlots(d);
    const lastEnd = cur.length ? parseHHMM(cur[cur.length - 1]!.end) : 9 * 60 - 60;
    const start = Math.min(lastEnd + 60, 22 * 60);
    replaceDay(d, [...cur, { weekday: d, start: formatHHMM(start), end: formatHHMM(Math.min(start + 4 * 60, 1440)) }]);
  };

  const save = async () => {
    const ownerId = userId;
    if (!ownerId || currentUserIdRef.current !== ownerId) return;
    const msg = validateSlots(slots);
    if (msg) return setError(msg);
    setSaving(true);
    setError(null);
    try {
      await onboardingApi.setAvailability(slots, maxJobs);
      if (currentUserIdRef.current !== ownerId) return;
      await draft.clear();
      if (currentUserIdRef.current !== ownerId) return;
      await reload();
      if (currentUserIdRef.current !== ownerId) return;
      if (mode === 'edit') toast({ message: 'Working hours saved', tone: 'success' });
      onDone();
    } catch (e) {
      if (currentUserIdRef.current === ownerId) setError((e as Error).message);
    } finally {
      if (currentUserIdRef.current === ownerId) setSaving(false);
    }
  };

  const addOff = async () => {
    const ownerId = userId;
    if (!ownerId || currentUserIdRef.current !== ownerId) return;
    setOffBusy(true);
    try {
      await onboardingApi.addTimeOff(offFrom, offTo, offReason.trim() || null);
      if (currentUserIdRef.current !== ownerId) return;
      setOffOpen(false);
      setOffReason('');
      await reload();
      if (currentUserIdRef.current !== ownerId) return;
      toast({ message: 'Time off added', tone: 'success' });
    } catch (e) {
      if (currentUserIdRef.current === ownerId) setError((e as Error).message);
    } finally {
      if (currentUserIdRef.current === ownerId) setOffBusy(false);
    }
  };

  const removeOff = async (o: TimeOff) => {
    const ownerId = userId;
    if (!ownerId || currentUserIdRef.current !== ownerId || !o.id) return;
    const ok = await confirm({ title: 'Remove time off?', message: 'Customers will be able to book you on these days again.', confirmLabel: 'Remove', destructive: true });
    if (!ok || currentUserIdRef.current !== ownerId) return;
    await onboardingApi.deleteTimeOff(o.id).catch((e: Error) => {
      if (currentUserIdRef.current === ownerId) setError(e.message);
    });
    if (currentUserIdRef.current !== ownerId) return;
    await reload();
  };

  return (
    <Screen
      header={header}
      gap={t.spacing.xl}
      footer={<SectionFooter primary={mode === 'wizard' ? 'Save & continue' : 'Save'} onPrimary={() => void save()} loading={saving} disabled={!!problem || slots.length === 0} onBack={onBack} />}
    >
      <Intro title="When can you work?" subtitle="Customers can only book 2-hour visits inside these hours (India time). Use the Online switch on your dashboard for jobs right now." />
      <InlineAlert message={error ?? problem} />

      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel>Quick start</FieldLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {PRESETS.map((pr) => (
            <Chip key={pr.key} label={pr.label} onPress={() => setSlots(sortSlots(pr.slots))} />
          ))}
        </View>
      </View>

      <Card gap={t.spacing.lg}>
        {WEEK_ORDER.map((d) => {
          const ds = daySlots(d);
          return (
            <View key={d} style={{ gap: t.spacing.sm }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="calloutStrong">{DAY_NAMES[d]}</Text>
                {ds.length === 0 ? (
                  <Text variant="footnote" color="muted">
                    Off
                  </Text>
                ) : (
                  <Text variant="footnote" color="muted">
                    {ds.map((s) => rangeLabel(s.start, s.end)).join(', ')}
                  </Text>
                )}
              </View>
              {ds.map((s, i) => (
                <View key={`${d}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: t.spacing.sm }}>
                  <TimeStepper label={`${DAY_NAMES[d]} slot ${i + 1} start`} minutes={parseHHMM(s.start)} max={1410} onChange={(m) => updateSlot(d, i, { start: formatHHMM(m) })} />
                  <Text variant="footnote" color="muted">
                    to
                  </Text>
                  <TimeStepper label={`${DAY_NAMES[d]} slot ${i + 1} end`} minutes={parseHHMM(s.end)} min={30} onChange={(m) => updateSlot(d, i, { end: formatHHMM(m) })} />
                  <Button title="Remove" size="sm" variant="destructiveGhost" accessibilityLabel={`Remove ${DAY_NAMES[d]} slot ${i + 1}`} onPress={() => replaceDay(d, ds.filter((_, j) => j !== i))} />
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: t.spacing.sm, flexWrap: 'wrap' }}>
                {ds.length < MAX_SLOTS_PER_DAY ? (
                  <Button title={ds.length ? 'Add break / another slot' : 'Add hours'} size="sm" variant="ghost" leftIcon="add" onPress={() => addSlot(d)} />
                ) : null}
                {ds.length > 0 && d === 1 ? (
                  <Button title="Copy Monday to all days" size="sm" variant="ghost" leftIcon="copy-outline" onPress={() => setSlots(copyDay(slots, 1, [0, 2, 3, 4, 5, 6]))} />
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel hint="Optional. We stop new bookings for a day once you reach this number.">Maximum jobs per day</FieldLabel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <Chip label="No limit" selected={maxJobs == null} onPress={() => setMaxJobs(null)} />
          <Chip label="Set a limit" selected={maxJobs != null} onPress={() => setMaxJobs(maxJobs ?? 6)} />
          {maxJobs != null ? <Stepper value={maxJobs} min={1} max={30} onChange={setMaxJobs} label="Maximum jobs per day" /> : null}
        </View>
      </View>

      <View style={{ gap: t.spacing.sm }}>
        <FieldLabel hint="Customers cannot book you on these days. For a longer break, use Holiday mode in your provider profile.">Time off</FieldLabel>
        {data.state.time_off.length === 0 ? (
          <Text variant="footnote" color="muted">
            No upcoming time off.
          </Text>
        ) : (
          <View style={{ marginHorizontal: -t.spacing.lg }}>
            {data.state.time_off.map((o) => {
              const d = timeOffDays(o, p?.timezone);
              return (
                <ListItem
                  key={o.id ?? o.from}
                  icon="airplane-outline"
                  title={d.from === d.to ? dateLabel(d.from) : `${dateLabel(d.from)} – ${dateLabel(d.to)}`}
                  subtitle={o.reason ?? undefined}
                  right={<Button title="Remove" size="sm" variant="destructiveGhost" onPress={() => void removeOff(o)} />}
                />
              );
            })}
          </View>
        )}
        {offOpen ? (
          <Card gap={t.spacing.md} variant="filled">
            <View style={{ gap: 6 }}>
              <Text variant="footnote" color="muted">
                From
              </Text>
              <DateStepper
                label="Time off start"
                value={offFrom}
                min={today}
                max={addDays(today, 365)}
                onChange={(v) => {
                  setOffFrom(v);
                  if (offTo < v) setOffTo(v);
                }}
              />
            </View>
            <View style={{ gap: 6 }}>
              <Text variant="footnote" color="muted">
                To (inclusive)
              </Text>
              <DateStepper label="Time off end" value={offTo} min={offFrom} max={addDays(offFrom, 90)} onChange={setOffTo} />
            </View>
            <Input placeholder="Reason (optional, private)" value={offReason} onChangeText={setOffReason} maxLength={120} />
            <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
              <Button title="Cancel" variant="outline" onPress={() => setOffOpen(false)} style={{ flex: 1 }} />
              <Button title="Add time off" onPress={() => void addOff()} loading={offBusy} style={{ flex: 2 }} />
            </View>
          </Card>
        ) : (
          <Button title="Add time off" variant="outline" leftIcon="calendar-outline" onPress={() => setOffOpen(true)} disabled={!p} />
        )}
      </View>
    </Screen>
  );
}
