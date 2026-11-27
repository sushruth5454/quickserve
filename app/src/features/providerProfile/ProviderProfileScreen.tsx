import { router, type Href, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { Share, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, ErrorState, IconButton, InlineAlert, Screen, Skeleton, Text } from '../../components/ui';
import { PriceFooter } from '../../components/market/PriceFooter';
import { getProviderDetail, listLiveCities, type ProviderDetail } from '../../lib/api';
import { useSelectedLocation } from '../../lib/locationContext';
import { useEntityRefresh } from '../../lib/useEntityRefresh';
import { haptics } from '../../lib/haptics';
import { formatINR } from '../../lib/money';
import { packageDisplayPrice } from '../booking/packages/packageModel';
import { onboardingApi, type PublicProfile } from '../../lib/onboarding';
import { providerPublicTrust } from '../../lib/onboarding/publicTrust';
import { summarizeHours, todayLabel } from '../../lib/onboarding/availability';
import { useTheme } from '../../theme';
import { ProviderProfileCallouts } from './ProviderProfileCallouts';
import { ProviderProfileHero } from './ProviderProfileHero';
import { ProviderProfileOverview } from './ProviderProfileOverview';
import { ProviderPortfolioSection } from './ProviderPortfolioSection';
import { ProviderReviewsSection } from './ProviderReviewsSection';
import { ProviderServicesSection } from './ProviderServicesSection';
import {
  avg,
  providerProfilePackageRoute,
  reconcileProviderProfileSelection,
  selectProviderProfilePackage,
  selectProviderProfileService,
  type ProviderProfileSelection,
} from './model';

export default function ProviderDetailScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { id, preview, category: categorySlug } = useLocalSearchParams<{ id: string; preview?: string; category?: string }>();
  const isPreview = preview === '1';
  const scope = JSON.stringify([id ?? '', categorySlug ?? '']);
  const [detailResult, setDetailResult] = useState<{ scope: string; value: ProviderDetail } | null>(null);
  const [availabilityResult, setAvailabilityResult] = useState<(
    { scope: string; status: 'loading' } |
    { scope: string; status: 'ready'; value: PublicProfile } |
    { scope: string; status: 'error'; message: string }
  ) | null>(null);
  const [detailFailure, setDetailFailure] = useState<{ scope: string; message: string } | null>(null);
  const [selectionResult, setSelectionResult] = useState<{ scope: string; value: ProviderProfileSelection } | null>(null);
  const detail = detailResult?.scope === scope ? detailResult.value : null;
  const availability = availabilityResult?.scope === scope ? availabilityResult : { scope, status: 'loading' as const };
  const pub = availability.status === 'ready' ? availability.value : null;
  const publicTrust = providerPublicTrust(pub);
  const availabilityError = availability.status === 'error' ? availability.message : null;
  const selection = selectionResult?.scope === scope ? selectionResult.value : null;
  const selected = selection?.serviceId ?? null;
  const error = detailFailure?.scope === scope ? detailFailure.message : null;
  const [showAll, setShowAll] = useState(false);
  const { location, setLocation } = useSelectedLocation();
  const [switchingResult, setSwitchingResult] = useState<{ scope: string; value: boolean } | null>(null);
  const switching = switchingResult?.scope === scope && switchingResult.value;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const switchRequestRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      switchRequestRef.current++;
    };
  }, []);

  // Bookings and proposal requests only reach pros in the customer's selected city, so a pro from another city
  // is offered as a one-tap location switch instead of a form that fails at the end.
  const switchToCity = async (city: string) => {
    const requestScope = scope;
    const requestId = ++switchRequestRef.current;
    const isCurrent = () => mountedRef.current && scopeRef.current === requestScope && switchRequestRef.current === requestId;
    setSwitchingResult({ scope: requestScope, value: true });
    try {
      const live = (await listLiveCities()).find((c) => c.city.trim().toLowerCase() === city.trim().toLowerCase());
      if (!isCurrent()) return;
      if (live?.lat != null && live.lng != null) {
        setLocation({ source: 'area', area: live.city, city: live.city, lat: live.lat, lng: live.lng, line1: null, addressId: null, label: null });
      } else {
        router.push('/location');
      }
    } catch {
      if (isCurrent()) router.push('/location');
    } finally {
      if (isCurrent()) setSwitchingResult({ scope: requestScope, value: false });
    }
  };

  const load = useCallback(async (guard: { isCurrent: () => boolean }) => {
    if (!id) return;
    const requestScope = scope;
    const providerId = id;
    const requestedCategory = categorySlug;
    setAvailabilityResult({ scope: requestScope, status: 'loading' });
    setDetailFailure((current) => current?.scope === requestScope ? null : current);
    await Promise.all([
      getProviderDetail(providerId)
        .then((value) => {
          if (!guard.isCurrent()) return;
          setDetailResult({ scope: requestScope, value });
          setDetailFailure(null);
          setSelectionResult((current) => {
            const previous = current?.scope === requestScope ? current.value : null;
            return {
              scope: requestScope,
              value: reconcileProviderProfileSelection(previous, providerId, value.services, requestedCategory),
            };
          });
        })
        .catch((caught: Error) => {
          if (guard.isCurrent()) setDetailFailure({ scope: requestScope, message: caught.message });
        }),
      onboardingApi.getPublicProfile(providerId)
        .then((value) => {
          if (!guard.isCurrent()) return;
          if (value) setAvailabilityResult({ scope: requestScope, status: 'ready', value });
          else setAvailabilityResult({ scope: requestScope, status: 'error', message: 'Current availability could not be verified.' });
        })
        .catch((caught: Error) => {
          if (guard.isCurrent()) {
            setAvailabilityResult({ scope: requestScope, status: 'error', message: caught.message });
          }
        }),
    ]);
  }, [categorySlug, id, scope]);

  const { refresh, refreshing } = useEntityRefresh(load, {
    contextKey: scope,
    enabled: !!id,
    intervalMs: null,
  });

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
          <ErrorState message={error} onRetry={() => void refresh()} />
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
  const first = name.split(' ')[0]!;
  const rating = Number(provider.rating_avg);
  const service = services.find((s) => s.id === selected) ?? services[0];
  const proposalService = service?.categories?.archetype === 'proposal';
  const pkgArchetype = service?.categories?.archetype === 'fixed' || service?.categories?.archetype === 'time_based';
  const selectedPackageId = selection && selection.serviceId === service?.id ? selection.packageId : null;
  const selectedPackage = service
    ? service.service_packages?.find((item) =>
        item.id === selectedPackageId && item.provider_service_id === service.id && item.active)
    : undefined;
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
  const unavailable = provider.paused || availability.status !== 'ready' || !!pub?.paused || !!pub?.on_leave_until;
  const packageRoute = providerProfilePackageRoute({
    providerId: provider.id,
    providerName: first,
    service,
    packageId: selectedPackageId,
    canCommit: !isPreview && !unavailable,
  });
  // "Vijayawada Demo" is the test city overlapping Vijayawada; the server routes targeted requests by distance.
  const cityKey = (c: string | null | undefined) => (c ?? '').trim().toLowerCase().replace(/\s+demo$/, '');
  const otherCity = !!provider.city && cityKey(provider.city) !== cityKey(location.city);
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
      return;
    }
    router.push({ pathname: '/book/[providerServiceId]', params: { providerServiceId: service.id } });
  };
  const commitSelectedPackage = () => {
    if (otherCity) {
      void switchToCity(provider.city);
      return;
    }
    const route = providerProfilePackageRoute({
      providerId: provider.id,
      providerName: first,
      service,
      packageId: selectedPackageId,
      canCommit: !isPreview && !unavailable,
    });
    if (route) router.push(route as Href);
  };
  const gutter = { paddingHorizontal: t.spacing.lg };

  return (
    <Screen
      padded={false}
      gap={t.spacing.section}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      footer={
        service && !isPreview && (!pkgArchetype || packageRoute) ? (
          <PriceFooter
            caption={`${service.categories?.name} · ${proposalService ? 'price' : pkgArchetype ? 'package' : 'visit fee'}`}
            amountLabel={
              proposalService
                ? 'Fixed quote per brief'
                : pkgArchetype
                  ? packageDisplayPrice(selectedPackage!)
                  : formatINR(service.visit_fee)
            }
            amountVariant={proposalService ? 'text' : 'amount'}
            cta={{
              title: otherCity && !unavailable
                ? `Switch to ${provider.city}`
                : pkgArchetype
                  ? packageRoute?.pathname === '/book/[providerServiceId]' ? 'Book package' : 'Request proposal'
                  : proposalService ? 'Request proposal' : `Book ${first}`,
              leftIcon: otherCity && !unavailable ? 'location-outline' : undefined,
              disabled: unavailable || (pkgArchetype && !packageRoute),
              loading: switching,
              onPress: pkgArchetype ? commitSelectedPackage : bookSelectedService,
            }}
            above={
              otherCity && !unavailable ? (
                <Text variant="footnote" color="textSecondary" accessibilityLiveRegion="polite">
                  {first} works in {provider.city}. Your location is {location.city}, so switch to {provider.city} to{' '}
                  {proposalService ? 'request a proposal' : pkgArchetype ? 'continue with this package' : 'book'}.
                </Text>
              ) : undefined
            }
          />
        ) : undefined
      }
    >
      {availabilityError ? (
        <InlineAlert
          title="Availability could not be verified"
          message={availabilityError}
          actionLabel="Refresh"
          onAction={() => void refresh()}
        />
      ) : availability.status === 'loading' ? (
        <InlineAlert tone="neutral" message="Checking current booking availability…" />
      ) : null}
      <ProviderProfileHero
        provider={provider}
        name={name}
        payoutBadge={publicTrust.badges.payout}
        theme={t}
        topInset={insets.top}
        onBack={back}
        onShare={() => void share()}
      />
      <ProviderProfileCallouts
        pub={pub}
        trust={publicTrust}
        profileFailed={availability.status === 'error'}
        isPreview={isPreview}
        unavailable={unavailable}
        today={today}
        first={first}
        theme={t}
        gutter={gutter}
      />
      <ProviderProfileOverview provider={provider} pub={pub} rating={rating} first={first} today={today} hours={hours} theme={t} gutter={gutter} />
      <ProviderServicesSection
        services={services}
        service={service}
        providerName={name}
        rating={rating}
        ratingCount={provider.rating_count}
        selectedPackageId={selectedPackageId}
        canSelectPackages={!isPreview && !unavailable}
        pub={pub}
        hasInspectQuoteService={hasInspectQuoteService}
        onSelect={(serviceId) => setSelectionResult((current) => ({
          scope,
          value: selectProviderProfileService(current?.scope === scope ? current.value : null, provider.id, serviceId),
        }))}
        onSelectPackage={(serviceId, packageId) => setSelectionResult({
          scope,
          value: selectProviderProfilePackage(provider.id, serviceId, packageId),
        })}
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
