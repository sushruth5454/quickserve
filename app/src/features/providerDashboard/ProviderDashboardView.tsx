import { router } from 'expo-router';
import type { Dispatch, SetStateAction } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge, Button, Card, CountBadge, Divider, EmptyState, ErrorState, IconButton, InlineAlert, LIST_INSET, Screen, Section, SkeletonCard, Text, useToast } from '../../components/ui';
import { CategoryIcon } from '../../components/CategoryIcon';
import { statusShort, statusTone } from '../../components/status';
import { acceptBooking, declineBooking } from '../../lib/api';
import { formatINR, settleVisitOnly } from '../../lib/money';
import { pct } from '../../lib/providerInsights';
import type { ProviderJob } from '../../lib/types';
import type { BusinessProviderContext } from '../merchantStaff/api';
import { useUnread } from '../../lib/unreadContext';
import type { Theme } from '../../theme/ThemeProvider';
import { GoLiveStatusCard } from '../providerOnboarding/GoLiveStatusCard';
import type { DocumentType, GoLive } from '../../lib/onboarding';
import { TravelRequestInbox } from '../travel/TravelRequestInbox';
import { ProviderProposalInbox } from '../proposals/ProviderProposalInbox';
import { ProviderRecurringOverview } from '../recurring/ProviderRecurringOverview';
import { firstName } from './model';
import { openBooking } from './navigation';
import { DeclineSheet, NextJobCard, RequestCard } from './JobCards';
import { getNextStep, OnlineCard, StatsStrip } from './DashboardWidgets';

type ProviderDashboardViewProps = {
  t: Theme;
  insets: ReturnType<typeof useSafeAreaInsets>;
  gutter: { paddingHorizontal: number };
  refreshing: boolean;
  setRefreshing: Dispatch<SetStateAction<boolean>>;
  load: () => Promise<void>;
  provider: Extract<BusinessProviderContext, { business_role: 'owner' }> | null;
  online: boolean;
  toggleOnline: (value: boolean) => Promise<void>;
  goLive: { status: GoLive; docTypes: DocumentType[] } | null;
  error: string | null;
  bellCount: number;
  stats: { acceptance: number | null; completion: number | null };
  today: number;
  me: string;
  incoming: ProviderJob[];
  jobs: ProviderJob[] | null;
  photos: Record<string, string[]>;
  now: number;
  earningRates: Record<string, number | null>;
  busyId: string | null;
  unread: ReturnType<typeof useUnread>;
  iconFor: (name: string) => string | undefined;
  act: (id: string, fn: () => Promise<void>, msg: string, expectedStatus: ProviderJob['status']) => Promise<void>;
  primaryAction: (job: ProviderJob) => unknown;
  next: ProviderJob | undefined;
  rest: ProviderJob[];
  declining: ProviderJob | null;
  setDeclining: Dispatch<SetStateAction<ProviderJob | null>>;
  toast: ReturnType<typeof useToast>;
};

export function ProviderDashboardView(props: ProviderDashboardViewProps) {
  const { t, insets, gutter, refreshing, setRefreshing, load, provider, online, toggleOnline, goLive, error, bellCount, stats, today, me, incoming, jobs, photos, now, earningRates, busyId, unread, iconFor, act, primaryAction, next, rest, declining, setDeclining, toast } = props;
  return (
    <Screen
      inTabs
      padded={false}
      gap={t.spacing.xl}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
    >
      <View style={[gutter, { paddingTop: insets.top + t.spacing.md, gap: t.spacing.lg }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="footnote" color="muted">
              {new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
            <Text variant="title1" accessibilityRole="header" numberOfLines={1}>
              {me ? `Hi ${me}` : 'Your jobs'}
            </Text>
          </View>
          <IconButton
            icon="notifications-outline"
            accessibilityLabel={bellCount ? `Notifications, ${bellCount} unread` : 'Notifications'}
            onPress={() => router.push('/notifications')}
            variant="neutral"
            badge={bellCount}
          />
        </View>

        <OnlineCard online={online} radiusKm={provider?.service_radius_km ?? null} onChange={(v) => void toggleOnline(v)} disabled={!provider} />
        {provider?.business_role === 'owner' ? (
          <Button title="Manage business staff" variant="outline" onPress={() => router.push('/merchant-staff')} />
        ) : null}

        {goLive && (goLive.status.state !== 'live' || goLive.status.paused) ? (
          <GoLiveStatusCard
            goLive={goLive.status}
            docTypes={goLive.docTypes}
            onFix={(s) => router.push({ pathname: '/provider-profile/[section]', params: { section: s, returnTo: 'hub' } })}
            onContinue={() => router.push('/onboarding')}
          />
        ) : !goLive && provider && provider.kyc_status !== 'verified' ? (
          <InlineAlert tone="warning" title="Not visible in search yet" message="Finish your provider profile and payout setup to go live." />
        ) : null}
        {provider?.suspended ? <InlineAlert title="Account suspended" message="Contact support to restore access." /> : null}
        {error ? <InlineAlert message={error} /> : null}

        <StatsStrip
          items={[
            { label: 'Today', value: formatINR(today), onPress: () => router.navigate('/earnings') },
            { label: 'Rating', value: provider && provider.rating_count > 0 ? Number(provider.rating_avg).toFixed(1) : '—', icon: 'star' },
            { label: 'Acceptance', value: pct(stats.acceptance) },
            { label: 'Completion', value: pct(stats.completion) },
          ]}
        />
      </View>

      {/* Ordinary requests expire; recurring occurrences use their own lifecycle. */}
      <View style={gutter}>
        <TravelRequestInbox />
      </View>
      {provider ? (
        <View style={gutter}>
          <ProviderRecurringOverview providerId={provider.id} role={provider.business_role} />
          <ProviderProposalInbox providerId={provider.id} />
        </View>
      ) : null}

      <View style={gutter}>
        <Section title="New requests">
          {!jobs ? (
            error ? (
              <ErrorState message={error} onRetry={() => void load()} compact />
            ) : (
              <SkeletonCard lines={3} />
            )
          ) : incoming.length === 0 ? (
            <EmptyState
              compact
              icon={online ? 'radio-outline' : 'moon-outline'}
              title={online ? 'Waiting for requests' : 'Go online to start receiving requests.'}
              message={online ? 'We’ll notify you when a customer nearby books you.' : undefined}
            />
          ) : (
            incoming.map((j) => (
              <RequestCard
                key={j.booking_id}
                job={j}
                icon={iconFor(j.category_name)}
                photos={photos[j.booking_id] ?? []}
                now={now}
                minEarning={earningRates[j.booking_id] == null
                  ? null
                  : settleVisitOnly({ visitFee: j.visit_fee, rateBp: earningRates[j.booking_id]! }).payout}
                busy={busyId === j.booking_id}
                unread={unread.countFor(j.booking_id)}
                onAccept={() => void act(
                  j.booking_id,
                  () => acceptBooking(j.booking_id),
                  j.archetype === 'time_based'
                    ? 'Request accepted. Open the job to enter the session start code.'
                    : 'Accepted! Start your trip when ready.',
                  'accepted',
                )}
                onDecline={() => setDeclining(j)}
                onViewDetails={() => openBooking(j.booking_id)}
              />
            ))
          )}
        </Section>
      </View>

      {next ? (
        <View style={gutter}>
          <Section title="Next job">
            <NextJobCard
              job={next}
              icon={iconFor(next.category_name)}
              busy={busyId === next.booking_id}
              onPrimary={() => primaryAction(next)}
              unread={unread.countFor(next.booking_id)}
              onNavigate={
                next.lat != null && next.lng != null
                  ? () =>
                      void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${next.lat},${next.lng}`).catch(() =>
                        toast({ message: 'Could not open maps.', tone: 'error' }),
                      )
                  : null
              }
            />
          </Section>
        </View>
      ) : null}

      <View style={gutter}>
        <Section title={next ? 'Other active jobs' : 'Active jobs'} actionLabel="All jobs" onAction={() => router.push('/jobs')}>
          {!jobs ? (
            <SkeletonCard lines={2} />
          ) : rest.length === 0 ? (
            <EmptyState compact icon="briefcase-outline" title={next ? 'No other active jobs.' : 'No active jobs right now.'} />
          ) : (
            <Card padding={0} gap={0}>
              {rest.map((j, i) => (
                <View key={j.booking_id}>
                  {i > 0 ? <Divider inset={LIST_INSET + 8} /> : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${j.category_name} for ${j.customer_name}. Next: ${getNextStep(j)?.label ?? ''}`}
                    onPress={() => openBooking(j.booking_id)}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: t.spacing.md,
                      paddingHorizontal: t.spacing.lg,
                      paddingVertical: t.spacing.md,
                      backgroundColor: pressed ? t.colors.surfaceAlt : 'transparent',
                    })}
                  >
                    <CategoryIcon icon={iconFor(j.category_name)} size={40} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="calloutStrong" numberOfLines={1}>
                        {firstName(j.customer_name)} · {j.category_name}
                      </Text>
                      <Text variant="footnote" color="muted" numberOfLines={1}>
                        Next: {getNextStep(j)?.label ?? '—'}
                      </Text>
                    </View>
                    <CountBadge count={unread.countFor(j.booking_id)} />
                    <Badge label={statusShort[j.status]} tone={statusTone[j.status]} dot />
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </Section>
      </View>

      <DeclineSheet
        job={declining}
        busy={!!declining && busyId === declining.booking_id}
        onClose={() => setDeclining(null)}
        onConfirm={(reason) => {
          const j = declining;
          if (!j) return;
          setDeclining(null);
          void act(j.booking_id, () => declineBooking(j.booking_id, reason), 'Request declined · the customer is refunded', 'declined');
        }}
      />
    </Screen>
  );
}
