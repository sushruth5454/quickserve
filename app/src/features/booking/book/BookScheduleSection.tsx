import { Pressable, ScrollView, View } from 'react-native';
import { InlineAlert, Text } from '../../../components/ui';
import { formatINR } from '../../../lib/money';
import { dayLabel, WINDOW_START_HOURS, windowLabel } from '../../../lib/schedule';
import type { BookScreenController } from './useBookScreenController';
import { Block, ModeCard } from './BookControls';

export function BookScheduleSection({ controller, firstName }: { controller: BookScreenController; firstName: string }) {
  const {
    t, travel, travelPending, travelApproved, mode, asapOk, setMode, days, dayOk,
    dayIndex, setDayIndex, day, slotOk, hour, setHour,
  } = controller;
  return (
    <Block title="When">
      {travel?.needs_approval ? (
        <InlineAlert
          tone={travelPending ? 'info' : travelApproved ? 'success' : 'warning'}
          title={`${Number(travel.distance_km ?? 0).toFixed(1)} km away`}
          message={
            travelPending
              ? `Request sent with a ${formatINR(travel.quoted_fee)} travel fee. Approval is valid until ${new Date(travel.expires_at ?? '').toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}.`
              : travelApproved
                ? `Travel approved. The ${formatINR(travel.quoted_fee)} fee will appear on your first quote.`
                : `This pro travels here by approval. The ${formatINR(travel.quoted_fee)} fee is added to the first quote.`
          }
        />
      ) : null}
      <View style={{ flexDirection: 'row', gap: t.spacing.sm }}>
        <ModeCard
          icon="flash-outline"
          title="As soon as possible"
          subtitle={asapOk ? 'Pros accept in ~15 min' : 'Not available right now'}
          selected={mode === 'asap'}
          disabled={!asapOk}
          onPress={() => setMode('asap')}
        />
        <ModeCard icon="calendar-outline" title="Schedule" subtitle="Pick a day & time" selected={mode === 'schedule'} onPress={() => setMode('schedule')} />
      </View>
      {mode === 'schedule' ? (
        <View style={{ gap: t.spacing.md }}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -t.spacing.lg }}
            contentContainerStyle={{ paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }}
          >
            {days.map((d, i) => {
              const any = dayOk(d.date);
              const sel = i === dayIndex;
              return (
                <Pressable
                  key={d.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel, disabled: !any }}
                  accessibilityLabel={`${d.label}, ${dayLabel(d.date)}${any ? '' : ', no slots left'}`}
                  disabled={!any}
                  onPress={() => setDayIndex(i)}
                  style={{
                    width: 76,
                    paddingVertical: t.spacing.sm,
                    borderRadius: t.radii.md,
                    borderWidth: sel ? 1.5 : 1,
                    borderColor: sel ? t.colors.primary : t.colors.border,
                    backgroundColor: sel ? t.colors.primarySoft : t.colors.surface,
                    alignItems: 'center',
                    gap: 2,
                    opacity: any ? 1 : 0.45,
                  }}
                >
                  <Text variant="caption" color={sel ? 'primaryText' : 'muted'} numberOfLines={1}>
                    {d.label}
                  </Text>
                  <Text variant="title3" color={sel ? 'primaryText' : 'text'} tabular>
                    {d.dayOfMonth}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
            {WINDOW_START_HOURS.map((h) => {
              const ok = slotOk(day.date, h);
              const sel = hour === h;
              return (
                <Pressable
                  key={h}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sel, disabled: !ok }}
                  accessibilityLabel={`${windowLabel(h)}${ok ? '' : ', unavailable'}`}
                  disabled={!ok}
                  onPress={() => setHour(h)}
                  style={{
                    width: '31.5%',
                    height: 44,
                    borderRadius: t.radii.md,
                    borderWidth: sel ? 1.5 : 1,
                    borderColor: sel ? t.colors.primary : t.colors.border,
                    backgroundColor: sel ? t.colors.primarySoft : ok ? t.colors.surface : t.colors.surfaceAlt,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text variant="subheadStrong" color={sel ? 'primaryText' : ok ? 'text' : 'muted'} style={ok ? undefined : { textDecorationLine: 'line-through' }}>
                    {windowLabel(h)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {hour != null ? (
            <Text variant="footnote" color="textSecondary">
              {firstName} arrives {dayLabel(day.date)}, between {windowLabel(hour)}.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Block>
  );
}
