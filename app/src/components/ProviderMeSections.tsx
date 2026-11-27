import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useRef, useState, type ReactNode } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { deleteService, getProviderDetail, listMyServices, upsertService } from '../lib/api';
import { formatINR, rupeesToPaise } from '../lib/money';
import type { PublicReview } from '../lib/apiTypes';
import type { Provider, ProviderService, RateUnit, SkillLevel } from '../lib/types';
import type { BusinessProviderContext } from '../features/merchantStaff/api';
import { useTheme } from '../theme';
import { CategoryIcon, iconForSlug } from './CategoryIcon';
import { skillLabel } from './ProviderCard';
import { BottomSheet, Button, Card, Chip, Divider, InlineAlert, Input, LIST_INSET, ListItem, RatingStars, SegmentedControl, Skeleton, Text, useToast } from './ui';

const LEVELS: SkillLevel[] = ['beginner', 'skilled', 'expert', 'certified'];
type ProviderContext = Provider | BusinessProviderContext;
type ReadState<T> = { value: T | null; error: string | null; loading: boolean };

function isOwnerProvider(provider: ProviderContext): provider is Provider {
  return !('business_role' in provider) || provider.business_role === 'owner';
}
/** react-native-web paints the ON thumb teal unless ctiveThumbColor is set (not in the RN types). */
const webSwitchThumb = { activeThumbColor: '#FFFFFF' } as object;

/** Provider-only sections of the Me tab: services (with active toggle + edit), work settings, reviews received. */
export function ProviderMeSections({ provider }: { provider: ProviderContext }) {
  const t = useTheme();
  const toast = useToast();
  const [services, setServices] = useState<ReadState<ProviderService[]>>({ value: null, error: null, loading: true });
  const [reviews, setReviews] = useState<ReadState<PublicReview[]>>({ value: null, error: null, loading: true });
  const [editing, setEditing] = useState<ProviderService | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const serviceRequest = useRef(0);
  const reviewRequest = useRef(0);

  const loadServices = useCallback(async () => {
    const request = ++serviceRequest.current;
    setServices((current) => ({ ...current, loading: current.value === null, error: null }));
    try {
      const value = await listMyServices(true);
      if (serviceRequest.current !== request) return;
      setServices({ value, error: null, loading: false });
    } catch (error) {
      if (serviceRequest.current !== request) return;
      setServices((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Services are unavailable.',
        loading: false,
      }));
    }
  }, []);

  const loadReviews = useCallback(async () => {
    const request = ++reviewRequest.current;
    setReviews((current) => ({ ...current, loading: current.value === null, error: null }));
    try {
      const detail = await getProviderDetail(provider.id);
      if (reviewRequest.current !== request) return;
      setReviews({ value: detail?.reviews ?? [], error: null, loading: false });
    } catch (error) {
      if (reviewRequest.current !== request) return;
      setReviews((current) => ({
        ...current,
        error: error instanceof Error ? error.message : 'Reviews are unavailable.',
        loading: false,
      }));
    }
  }, [provider.id]);

  useFocusEffect(
    useCallback(() => {
      void loadServices();
      void loadReviews();
      return () => {
        serviceRequest.current += 1;
        reviewRequest.current += 1;
      };
    }, [loadReviews, loadServices]),
  );

  const toggle = async (s: ProviderService, on: boolean) => {
    setBusyId(s.id);
    const previousServices = services.value;
    setServices((current) => ({
      ...current,
      value: current.value?.map((x) => (x.id === s.id ? { ...x, active: on } : x)) ?? null,
      error: null,
      loading: false,
    }));
    try {
      if (on) {
        await upsertService({ categoryId: s.category_id, skillLevel: s.skill_level, visitFee: s.visit_fee, labourRate: s.labour_rate, rateUnit: s.rate_unit });
      } else {
        await deleteService(s.id);
      }
      toast({ message: on ? `${s.categories?.name ?? 'Service'} is enabled` : `${s.categories?.name ?? 'Service'} paused · hidden from search`, tone: on ? 'success' : 'default' });
      await loadServices();
    } catch (e) {
      setServices((current) => ({ ...current, value: previousServices, error: null, loading: false }));
      toast({ message: (e as Error).message, tone: 'error' });
      await loadServices();
    } finally {
      setBusyId(null);
    }
  };

  const ownerProvider = isOwnerProvider(provider);
  const kycText = !ownerProvider
    ? null
    : provider.kyc_status === 'verified'
      ? 'Payout verified'
      : provider.kyc_status === 'rejected' || provider.kyc_status === 'needs_clarification' || provider.kyc_status === 'suspended'
        ? 'Payout action needed'
        : 'Payout pending';

  return (
    <>
      <Group title="My services" action={{ label: 'Add', onPress: () => router.push({ pathname: '/provider-profile/[section]', params: { section: 'services', returnTo: 'hub' } }) }}>
        {services.value === null ? (
          <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
            {services.loading ? (
              <>
                <Skeleton width="60%" height={14} />
                <Skeleton width="40%" height={12} />
              </>
            ) : (
              <RetryNotice message={services.error ?? 'Services are unavailable.'} label="Retry services" onRetry={() => void loadServices()} />
            )}
          </View>
        ) : (
          <>
            {services.error ? (
              <RetryNotice message={services.error} label="Retry services" onRetry={() => void loadServices()} />
            ) : null}
            {services.value.length === 0 && !services.error && !services.loading ? (
              <ListItem icon="add-circle-outline" title="Add your first service" subtitle="Pick a category and set your fees" chevron onPress={() => router.push({ pathname: '/provider-profile/[section]', params: { section: 'services', returnTo: 'hub' } })} />
            ) : null}
            {services.value.map((s, i) => (
              <Fragment key={s.id}>
                {i > 0 ? <Divider inset={LIST_INSET + 8} /> : null}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingLeft: t.spacing.lg, paddingRight: t.spacing.md }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${s.categories?.name ?? 'service'}`}
                    onPress={() => router.push({ pathname: '/provider-profile/[section]', params: { section: 'services', edit: s.id, returnTo: 'hub' } })}
                    style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, paddingVertical: t.spacing.md, opacity: pressed ? 0.7 : 1 })}
                  >
                    <View style={{ opacity: s.active ? 1 : 0.5 }}>
                      <CategoryIcon icon={iconForSlug(s.categories?.slug)} size={40} />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="calloutStrong" color={s.active ? 'text' : 'muted'} numberOfLines={1}>
                        {s.categories?.name ?? 'Service'} · {skillLabel[s.skill_level]}
                      </Text>
                      <Text variant="footnote" color="muted" numberOfLines={1} tabular>
                        {s.active ? `Visit ${formatINR(s.visit_fee)} · Labour ${formatINR(s.labour_rate)}/${s.rate_unit}` : 'Paused · not shown to customers'}
                      </Text>
                    </View>
                  </Pressable>
                  <Switch
                    value={s.active}
                    disabled={busyId === s.id}
                    onValueChange={(v) => void toggle(s, v)}
                    trackColor={{ true: t.colors.success, false: t.colors.outline }}
                    thumbColor="#FFFFFF"
                    {...webSwitchThumb}
                    style={{ alignSelf: 'center' }}
                    accessibilityLabel={`${s.categories?.name ?? 'Service'} ${s.active ? 'active' : 'paused'}`}
                  />
                </View>
              </Fragment>
            ))}
          </>
        )}
      </Group>

      <Group title="Work settings">
        <ListItem icon="navigate-circle-outline" title="Service radius" value={`${provider.service_radius_km} km`} chevron onPress={() => router.push({ pathname: '/provider-profile/[section]', params: { section: 'area', returnTo: 'hub' } })} />
        {ownerProvider ? (
          <>
            <Divider inset={LIST_INSET} />
            <ListItem icon="shield-checkmark-outline" title="Payout account & verification" value={kycText ?? undefined} chevron onPress={() => router.push({ pathname: '/provider-profile/[section]', params: { section: 'payouts', returnTo: 'hub' } })} />
          </>
        ) : null}
        <Divider inset={LIST_INSET} />
        <ListItem icon="list-outline" title="Job history" chevron onPress={() => router.push('/jobs')} />
      </Group>

      <Group title="Reviews received">
        {reviews.value === null && reviews.loading ? (
          <View style={{ padding: t.spacing.lg }}>
            <Skeleton width="50%" height={14} />
          </View>
        ) : reviews.value === null ? (
          <RetryNotice message={reviews.error ?? 'Reviews are unavailable.'} label="Retry reviews" onRetry={() => void loadReviews()} />
        ) : (
          <>
            {reviews.error ? <RetryNotice message={reviews.error} label="Retry reviews" onRetry={() => void loadReviews()} /> : null}
            {reviews.value.length === 0 && !reviews.loading && !reviews.error ? (
              <View style={{ padding: t.spacing.lg, gap: 2 }}>
                <Text variant="calloutStrong">No reviews yet</Text>
                <Text variant="footnote" color="muted">
                  Customers rate you after each completed job.
                </Text>
              </View>
            ) : null}
            {reviews.value.length > 0 ? (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.md, padding: t.spacing.lg }}>
                  <Text variant="title1" tabular>
                    {Number(provider.rating_avg).toFixed(1)}
                  </Text>
                  <View style={{ gap: 2 }}>
                    <RatingStars value={Number(provider.rating_avg)} size={16} />
                    <Text variant="footnote" color="muted">
                      {provider.rating_count} rating{provider.rating_count === 1 ? '' : 's'}
                    </Text>
                  </View>
                </View>
                {reviews.value.slice(0, 5).map((r) => (
                  <Fragment key={r.id}>
                    <Divider inset={t.spacing.lg} />
                    <View style={{ paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.md, gap: 4 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <RatingStars value={r.rating} size={14} compact />
                        <Text variant="caption" color="muted">
                          {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </Text>
                      </View>
                      <Text variant="callout" color={r.comment ? 'text' : 'muted'}>
                        {r.comment || 'No comment'}
                      </Text>
                      {r.provider_reply ? (
                        <View style={{ marginTop: 4, padding: t.spacing.sm, borderRadius: t.radii.sm, backgroundColor: t.colors.surfaceAlt }}>
                          <Text variant="captionStrong" color="muted">
                            Your reply
                          </Text>
                          <Text variant="footnote" color="textSecondary">
                            {r.provider_reply}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </Fragment>
                ))}
              </>
            ) : null}
          </>
        )}
      </Group>

      <ServiceEditSheet
        service={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          toast({ message: 'Service updated', tone: 'success' });
          void loadServices();
        }}
      />
    </>
  );
}

function RetryNotice({ message, label, onRetry }: { message: string; label: string; onRetry: () => void }) {
  const t = useTheme();
  return (
    <View style={{ padding: t.spacing.lg, gap: t.spacing.sm }}>
      <Text variant="footnote" color="muted">{message}</Text>
      <Button title={label} variant="outline" onPress={onRetry} />
    </View>
  );
}

function ServiceEditSheet({ service, onClose, onSaved }: { service: ProviderService | null; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const [level, setLevel] = useState<SkillLevel>('skilled');
  const [visitFee, setVisitFee] = useState('');
  const [labour, setLabour] = useState('');
  const [unit, setUnit] = useState<RateUnit>('job');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forId, setForId] = useState<string | null>(null);

  if (service && service.id !== forId) {
    setForId(service.id);
    setLevel(service.skill_level);
    setVisitFee(String(service.visit_fee / 100));
    setLabour(String(service.labour_rate / 100));
    setUnit(service.rate_unit);
    setError(null);
  }

  const save = async () => {
    if (!service) return;
    const fee = Number(visitFee);
    const rate = Number(labour);
    if (visitFee === '' || labour === '' || !(fee >= 0) || !(rate >= 0)) return setError('Enter a visit fee and labour rate.');
    setBusy(true);
    setError(null);
    try {
      await upsertService({ categoryId: service.category_id, skillLevel: level, visitFee: rupeesToPaise(fee), labourRate: rupeesToPaise(rate), rateUnit: unit });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={!!service}
      onClose={() => {
        setForId(null);
        onClose();
      }}
      title={service?.categories?.name ?? 'Service'}
      subtitle="Saving also enables the service"
      footer={<Button title="Save changes" size="lg" fullWidth loading={busy} onPress={() => void save()} />}
    >
      <View style={{ gap: t.spacing.sm }}>
        <Text variant="subheadStrong" color="textSecondary">
          Skill level
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.spacing.sm }}>
          {LEVELS.map((l) => (
            <Chip key={l} label={skillLabel[l]} selected={level === l} onPress={() => setLevel(l)} />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: t.spacing.md }}>
        <Input
          label="Visit fee"
          prefix="₹"
          keyboardType="decimal-pad"
          value={visitFee}
          onChangeText={(v) => setVisitFee(v.replace(/[^\d.]/g, ''))}
          containerStyle={{ flex: 1 }}
          accessibilityLabel="Visit fee in rupees"
        />
        <Input
          label="Labour rate"
          prefix="₹"
          keyboardType="decimal-pad"
          value={labour}
          onChangeText={(v) => setLabour(v.replace(/[^\d.]/g, ''))}
          containerStyle={{ flex: 1 }}
          accessibilityLabel="Labour rate in rupees"
        />
      </View>
      <SegmentedControl<RateUnit>
        options={[
          { value: 'job', label: 'Per job' },
          { value: 'hour', label: 'Per hour' },
        ]}
        value={unit}
        onChange={setUnit}
        accessibilityLabel="Labour rate unit"
      />
      <InlineAlert message={error} />
    </BottomSheet>
  );
}

function Group({ title, action, children }: { title: string; action?: { label: string; onPress: () => void }; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.spacing.lg }}>
        <Text variant="overline" color="muted" accessibilityRole="header">
          {title}
        </Text>
        {action ? (
          <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <Ionicons name="add" size={16} color={t.colors.primaryText} />
            <Text variant="subheadStrong" color="primaryText">
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Card padding={0} gap={0} style={{ overflow: 'hidden' }}>
        {children}
      </Card>
    </View>
  );
}
