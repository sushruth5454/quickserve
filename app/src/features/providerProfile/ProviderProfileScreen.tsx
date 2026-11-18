import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Linking from 'expo-linking';
import { Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, ErrorState, IconButton, Screen, Skeleton, Text } from '../../components/ui';
import { getProviderDetail, listLiveCities, type ProviderDetail } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import { haptics } from '../../lib/haptics';
import { formatINR } from '../../lib/money';
import { onboardingApi, type PublicProfile } from '../../lib/onboarding';
import { summarizeHours, todayLabel } from '../../lib/onboarding/availability';
import { useTheme } from '../../theme';
import { ProviderProfileCallouts } from './ProviderProfileCallouts';
import { ProviderProfileHero } from './ProviderProfileHero';
import { ProviderProfileOverview } from './ProviderProfileOverview';
import { ProviderPortfolioSection } from './ProviderPortfolioSection';
import { ProviderReviewsSection } from './ProviderReviewsSection';
import { ProviderServicesSection } from './ProviderServicesSection';
import { avg } from './model';

export default function ProviderDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id, preview, category: categorySlug } = useLocalSearchParams<{ id: string; preview?: string; category?: string }>();
  const isPreview = preview === '1';
  const [pub, setPub] = useState<PublicProfile | null>(null);
  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { location, setLocation } = useSelectedLocation();
  const [switching, setSwitching] = useState(false);

  // Bookings and proposal requests only reach pros in the customer's selected city, so a pro from another city
  // is offered as a one-tap location switch instead of a form that fails at the end.
  const switchToCity = async (city: string) => {
    setSwitching(true);
    try {
      const live = (await listLiveCities()).find((c) => c.city.trim().toLowerCase() === city.trim().toLowerCase());
      if (live?.lat != null && live.lng != null) {
        setLocation({ source: 'area', area: live.city, city: live.city, lat: live.lat, lng: live.lng, line1: null, addressId: null, label: null });
      } else {
        router.push('/location');
      }
    } catch {
      router.push('/location');
    } finally {
      setSwitching(false);
    }
  };

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [d, pp] = await Promise.all([getProviderDetail(id), onboardingApi.getPublicProfile(id).catch(() => null)]);
      setPub(pp);
      setDetail(d);
      setSelected((s) => s ?? d.services.find((x) => x.categories?.slug === categorySlug)?.id ?? d.services[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, categorySlug]);

  useEffect(() => {
    void load();
  }, [load]);

  const breakdown = useMemo(() => {
    const reviews = detail?.reviews ?? [];
    const counts = [5, 4, 3, 2, 1].map((s) => reviews.filter((r) => Math.round(r.rating) === s).length);
    return { counts, total: reviews.length };
  }, [detail]);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!detail) {
    return (
      <Screen safeTop>
        <IconButton icon="chevron-back" accessibilityLabel="Go back" onPress={back} variant="neutral" />
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <View style={{ alignItems: 'center', gap: t.spacing.md }}>
            <Skeleton width={96} height={96} radius={48} />
            <Skeleton width={180} height={22} />
            <Skeleton width={240} height={14} />
            <Skeleton height={80} radius={t.radii.lg} />
            <Skeleton height={180} radius={t.radii.lg} />
          </View>
        )}
      </Screen>
    );
  }

  const { provider, services, reviews } = detail;
  const name = provider.profiles?.full_name || 'Provider';
  const first = name.split(' ')[0];
  const rating = Number(provider.rating_avg);
  const service = services.find((s) => s.id === selected) ?? services[0];
  const proposalService = service?.categories?.archetype === 'proposal';
  const pkgArchetype = service?.categories?.archetype === 'fixed' || service?.categories?.archetype === 'time_based';
  const packagePrices = (service?.service_packages ?? [])
    .filter((item) => item.active && item.price_type !== 'quote')
    .map((item) => item.price_type === 'fixed' ? item.price : item.price_min)
    .filter((price): price is number => typeof price === 'number' && Number.isFinite(price));
  const minPackagePrice = packagePrices.length ? Math.min(...packagePrices) : null;
  const hasInspectQuoteService = services.some((item) => item.categories?.archetype === 'inspect_quote');
  const subs = [
    ['Punctuality', avg(reviews, 'punctuality')],
    ['Quality', avg(reviews, 'quality')],
    ['Behaviour', avg(reviews, 'behaviour')],
    ['Fair price', avg(reviews, 'pricing')],
  ] as const;
  const visibleReviews = showAll ? reviews : reviews.slice(0, 4);
  const now = new Date();
  const today = pub ? todayLabel(pub.hours, now, { onLeaveUntil: pub.on_leave_until }) : null;
  const hours = pub ? summarizeHours(pub.hours) : [];
  const unavailable = !!pub && (pub.paused || !!pub.on_leave_until);
  // "Vijayawada Demo" is the test city overlapping Vijayawada; the server routes targeted requests by distance.
  const cityKey = (c: string | null | undefined) => (c ?? '').trim().toLowerCase().replace(/\s+demo$/, '');
  const otherCity = !!provider.city && cityKey(provider.city) !== cityKey(location.city);
  const idVerified = pub ? pub.badges.id_verified : false;
  const payoutVerified = pub ? pub.badges.payout_verified : provider.kyc_status === 'verified';
  const share = async () => {
    haptics.tap();
    const url = Linking.createURL(`/provider/${provider.id}`);
    await Share.share({ message: `Book ${name} on QuickServe: ${url}`, url }).catch(() => undefined);
  };
  const bookSelectedService = () => {
    if (!service) return;
    if (otherCity) {
      void switchToCity(provider.city);
      return;
    }
    if (proposalService) {
      router.push({
        pathname: '/request/new',
        params: { categoryId: service.category_id, name: service.categories?.name ?? 'service', providerId: provider.id, providerName: first },
      });
      return;
    }
    if (pkgArchetype) {
      const category = service.categories;
      if (!category?.slug) return;
      router.push({ pathname: '/category/[slug]', params: { slug: category.slug, name: category.name } });
      return;
    }
    router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: service.id } });
  };
  const gutter = { paddingHorizontal: t.spacing.lg };

  return (
    <Screen
      padded={false}
      gap={t.spacing.section}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
      footer={
        service && !isPreview ? (
          <View style={{ gap: t.spacing.sm }}>
          {otherCity && !unavailable ? (
            <Text variant="footnote" color="textSecondary" accessibilityLiveRegion="polite">
              {first} works in {provider.city}. Your location is {location.city}, so switch to {provider.city} to{' '}
              {proposalService ? 'request a proposal' : 'book'}.
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.lg }}>
            <View style={{ flexShrink: 1 }}>
              <Text variant="caption" color="muted" numberOfLines={1}>
                {service.categories?.name} · {proposalService ? 'price' : pkgArchetype ? 'packages' : 'visit fee'}
              </Text>
              {proposalService ? (
                <Text variant="calloutStrong">Fixed quote per brief</Text>
              ) : pkgArchetype ? (
                <Text variant="title2" tabular>
                  {minPackagePrice == null ? 'Packages available' : `From ${formatINR(minPackagePrice)}`}
                </Text>
              ) : (
                <Text variant="title2" tabular>
                  {formatINR(service.visit_fee)}
                </Text>
              )}
            </View>
            <Button
              title={otherCity && !unavailable ? `Switch to ${provider.city}` : proposalService ? 'Request proposal' : `Book ${first}`}
              leftIcon={otherCity && !unavailable ? 'location-outline' : undefined}
              size="lg"
              style={{ flex: 1 }}
              disabled={unavailable}
              loading={switching}
              onPress={bookSelectedService}
            />
          </View>
          </View>
        ) : undefined
      }
    >
      <ProviderProfileHero
        provider={provider}
        name={name}
        payoutVerified={payoutVerified}
        theme={t}
        topInset={insets.top}
        onBack={back}
        onShare={() => void share()}
      />
      <ProviderProfileCallouts pub={pub} isPreview={isPreview} unavailable={unavailable} today={today} first={first} idVerified={idVerified} theme={t} gutter={gutter} />
      <ProviderProfileOverview provider={provider} pub={pub} rating={rating} first={first} today={today} hours={hours} theme={t} gutter={gutter} />
      <ProviderServicesSection
        services={services}
        service={service}
        pub={pub}
        hasInspectQuoteService={hasInspectQuoteService}
        onSelect={setSelected}
        theme={t}
        gutter={gutter}
      />
      <ProviderPortfolioSection pub={pub} theme={t} gutter={gutter} />
      <ProviderReviewsSection
        pub={pub}
        provider={provider}
        first={first}
        rating={rating}
        reviews={reviews}
        visibleReviews={visibleReviews}
        breakdown={breakdown}
        subs={subs}
        showAll={showAll}
        onToggleShowAll={() => setShowAll((s) => !s)}
        theme={t}
        gutter={gutter}
      />
    </Screen>
  );
}
