import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { iconForCategory } from '../../components/CategoryIcon';
import { useToast } from '../../components/ui';
import {
  acceptBooking,
  declineBooking,
  getBooking,
  getBookingCommissionRate,
  getMyProfile,
  listCategories,
  listMyPayouts,
  setOnline,
  signedPhotoUrls,
  startTrip,
} from '../../lib/api';
import { haptics } from '../../lib/haptics';
import { providerStats } from '../../lib/providerInsights';
import { useAuth } from '../../lib/auth';
import { registerForPush } from '../../lib/push';
import type { BookingStatus, Category, Payout, ProviderJob } from '../../lib/types';
import {
  getMyProviderBusinessContext,
  listMyBusinessProviderJobs,
  type BusinessProviderContext,
} from '../merchantStaff/api';
import { useUnread } from '../../lib/unreadContext';
import { useTheme } from '../../theme';
import { onboardingApi, type DocumentType, type GoLive } from '../../lib/onboarding';
import { firstName, selectDashboardWork } from './model';
import { openBooking } from './navigation';
import { BusinessDashboardView } from './BusinessDashboardView';
import { ProviderDashboardView } from './ProviderDashboardView';
import { getPrimaryJobAction } from './DashboardWidgets';

export default function ProviderDashboard() {
  const t = useTheme();
  const params = useLocalSearchParams<{ providerId?: string | string[] }>();
  const providerId = Array.isArray(params.providerId) ? params.providerId[0] : params.providerId;
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [provider, setProvider] = useState<BusinessProviderContext | null>(null);
  const providerRef = useRef(provider);
  providerRef.current = provider;
  const [me, setMe] = useState('');
  const [jobs, setJobs] = useState<ProviderJob[] | null>(null);
  const [earningRates, setEarningRates] = useState<Record<string, number | null>>({});
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [declining, setDeclining] = useState<ProviderJob | null>(null);
  const [goLive, setGoLive] = useState<{ status: GoLive; docTypes: DocumentType[] } | null>(null);
  const [goLiveReadFailed, setGoLiveReadFailed] = useState(false);
  const [payoutReadFailed, setPayoutReadFailed] = useState(false);
  const { userId } = useAuth();
  const contextKey = JSON.stringify([userId, providerId ?? null]);
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  const [loadedContextKey, setLoadedContextKey] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const unread = useUnread();
  const bellCount = unread.total('provider') + unread.notifications;
  const refreshUnread = unread.refresh;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    requestGeneration.current += 1;
    setLoadedContextKey(contextKey);
    providerRef.current = null;
    setProvider(null);
    setJobs(null);
    setPayouts([]);
    setCategories([]);
    setPhotos({});
    setEarningRates({});
    setGoLive(null);
    setGoLiveReadFailed(false);
    setPayoutReadFailed(false);
    setMe('');
    setError(null);
    setBusyId(null);
    setDeclining(null);
    setRefreshing(false);
    return () => {
      requestGeneration.current += 1;
    };
  }, [contextKey]);

  const load = useCallback(async () => {
    const requestContextKey = contextKey;
    const generation = ++requestGeneration.current;
    const isCurrent = () =>
      generation === requestGeneration.current && requestContextKey === contextKeyRef.current;
    if (!isCurrent()) return;

    setEarningRates({});
    try {
      const selectedProvider = await getMyProviderBusinessContext(providerId);
      if (!isCurrent()) return;
      if (!selectedProvider) {
        providerRef.current = null;
        setProvider(null);
        setJobs(null);
        setPayouts([]);
        setGoLive(null);
        setLoadedContextKey(requestContextKey);
        router.replace('/onboarding');
        return;
      }

      const isOwner = selectedProvider.business_role === 'owner';
      const goLiveRequest = isOwner
        ? Promise.all([onboardingApi.getOnboarding(), onboardingApi.getCatalog()])
            .then(([status, catalog]) => ({
              value: { status: status.go_live, docTypes: catalog.docTypes },
              failed: false as const,
            }))
            .catch(() => ({ value: null, failed: true as const }))
        : Promise.resolve({ value: null, failed: false as const });
      const payoutRequest = isOwner
        ? listMyPayouts()
            .then((value) => ({ value, failed: false as const }))
            .catch(() => ({ value: [] as Payout[], failed: true as const }))
        : Promise.resolve({ value: [] as Payout[], failed: false as const });

      const [selectedJobs, profile, selectedCategories, goLiveResult, payoutResult] = await Promise.all([
        listMyBusinessProviderJobs(selectedProvider.id),
        getMyProfile(),
        listCategories(),
        goLiveRequest,
        payoutRequest,
      ]);
      if (!isCurrent()) return;

      providerRef.current = selectedProvider;
      setProvider(selectedProvider);
      setJobs(selectedJobs);
      setPayouts(payoutResult.value);
      setPayoutReadFailed(payoutResult.failed);
      setCategories(selectedCategories);
      setMe(profile?.full_name?.split(' ')[0] ?? '');
      setGoLive(goLiveResult.value);
      setGoLiveReadFailed(goLiveResult.failed);
      setError(null);
      setLoadedContextKey(requestContextKey);

      const requestRates = isOwner
        ? await Promise.all(
            selectedJobs
              .filter((job) => job.status === 'requested')
              .map(async (job) => {
                try {
                  return [job.booking_id, await getBookingCommissionRate(job.booking_id)] as const;
                } catch {
                  return [job.booking_id, null] as const;
                }
              }),
          )
        : [];
      if (!isCurrent()) return;
      setEarningRates(Object.fromEntries(requestRates));

      const incomingJobs = selectedJobs.filter((job) => job.status === 'requested');
      const entries = await Promise.all(
        incomingJobs.map(async (job) => {
          const booking = await getBooking(job.booking_id).catch(() => null);
          const urls = booking?.photos.length ? await signedPhotoUrls(booking.photos).catch(() => []) : [];
          return [job.booking_id, urls] as const;
        }),
      );
      if (!isCurrent()) return;
      setPhotos(Object.fromEntries(entries));
    } catch (e) {
      if (isCurrent()) setError((e as Error).message);
    } finally {
      if (isCurrent()) void refreshUnread();
    }
  }, [contextKey, providerId, refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleOnline = async (value: boolean) => {
    const requestContextKey = contextKey;
    const isCurrent = () => requestContextKey === contextKeyRef.current;
    if (!isCurrent() || providerRef.current?.business_role !== 'owner') return;
    haptics.select();
    setProvider((p) => (p ? { ...p, is_online: value } : p));
    try {
      await setOnline(value);
      if (!isCurrent()) return;
      toast({ message: value ? 'Online preference turned on' : 'Online preference turned off', tone: value ? 'success' : 'default' });
      // Going online is when a pro wants to hear about new requests: ask for notification permission here.
      if (value && userId) void registerForPush(userId, { prompt: true });
    } catch (e) {
      if (!isCurrent()) return;
      setError((e as Error).message);
      setProvider((p) => (p ? { ...p, is_online: !value } : p));
    }
  };

  const act = async (id: string, fn: () => Promise<void>, msg: string, expectedStatus: BookingStatus) => {
    const requestContextKey = contextKey;
    const isCurrent = () => requestContextKey === contextKeyRef.current;
    if (!isCurrent() || providerRef.current?.business_role !== 'owner') return;
    setBusyId(id);
    try {
      await fn();
      if (!isCurrent()) return;
      await load();
      if (!isCurrent()) return;
      const loadedGeneration = requestGeneration.current;
      const currentProvider = providerRef.current;
      if (!currentProvider || currentProvider.business_role !== 'owner') {
        throw new Error('The business owner context is unavailable. Refresh and try again.');
      }
      const refreshedJobs = await listMyBusinessProviderJobs(currentProvider.id);
      if (!isCurrent() || loadedGeneration !== requestGeneration.current) return;
      const updatedJob = refreshedJobs.find((job) => job.booking_id === id);
      if (!updatedJob || updatedJob.status !== expectedStatus) {
        throw new Error('The server did not confirm this booking update. Refresh and try again.');
      }
      setJobs(refreshedJobs);
      toast({ message: msg, tone: 'success' });
    } catch (e) {
      if (!isCurrent()) return;
      haptics.error();
      setError((e as Error).message);
    } finally {
      if (isCurrent()) setBusyId(null);
    }
  };

  const contextIsCurrent = loadedContextKey === contextKey;
  const currentProvider = contextIsCurrent ? provider : null;
  const currentJobs = contextIsCurrent ? jobs : null;
  const currentError = contextIsCurrent ? error : null;
  const currentGoLive = contextIsCurrent ? goLive : null;
  const currentGoLiveReadFailed = contextIsCurrent && (goLiveReadFailed || !!currentError);
  const currentPayoutReadFailed = contextIsCurrent && (payoutReadFailed || !!currentError);
  const currentCategories = contextIsCurrent ? categories : [];
  const currentPhotos = contextIsCurrent ? photos : {};
  const currentEarningRates = contextIsCurrent ? earningRates : {};
  const { incoming, next, rest } = useMemo(() => selectDashboardWork(currentJobs), [currentJobs]);
  const stats = useMemo(() => providerStats((currentJobs ?? []).map((j) => j.status)), [currentJobs]);
  const iconFor = (name: string) => iconForCategory(currentCategories.find((c) => c.name === name));
  const sod = new Date(now);
  sod.setHours(0, 0, 0, 0);
  const today = !contextIsCurrent || currentPayoutReadFailed
    ? null
    : payouts.filter((p) => new Date(p.created_at) >= sod && p.status !== 'reversed').reduce((a, p) => a + p.amount, 0);
  const online = currentProvider && !currentError ? currentProvider.is_online : null;
  const gutter = { paddingHorizontal: t.spacing.lg };

  const primaryAction = (j: ProviderJob) => {
    if (contextKey !== contextKeyRef.current || providerRef.current?.business_role !== 'owner') return;
    const action = getPrimaryJobAction(j);
    if (action === 'start_trip') {
      return void act(
        j.booking_id,
        () => startTrip(j.booking_id),
        `${firstName(j.customer_name)} has been told you're on the way`,
        'en_route',
      );
    }
    if (action === 'quote') return router.push({ pathname: '/quote/[bookingId]', params: { bookingId: j.booking_id, changeOrder: '0' } });
    openBooking(j.booking_id);
  };

  if (currentProvider && currentProvider.business_role !== 'owner') {
    return (
      <BusinessDashboardView
        provider={currentProvider}
        t={t}
        refreshing={refreshing}
        setRefreshing={setRefreshing}
        load={load}
        error={currentError}
        jobs={currentJobs}
      />
    );
  }

  return (
    <ProviderDashboardView
      t={t}
      insets={insets}
      gutter={gutter}
      refreshing={refreshing}
      setRefreshing={setRefreshing}
      load={load}
      provider={currentProvider}
      online={online}
      toggleOnline={toggleOnline}
      goLive={currentGoLive}
      goLiveReadFailed={currentGoLiveReadFailed}
      payoutReadFailed={currentPayoutReadFailed}
      error={currentError}
      bellCount={bellCount}
      stats={stats}
      today={today}
      me={contextIsCurrent ? me : ''}
      incoming={incoming}
      jobs={currentJobs}
      photos={currentPhotos}
      now={now}
      earningRates={currentEarningRates}
      busyId={contextIsCurrent ? busyId : null}
      unread={unread}
      iconFor={iconFor}
      act={act}
      primaryAction={primaryAction}
      next={next}
      rest={rest}
      declining={contextIsCurrent ? declining : null}
      setDeclining={setDeclining}
      toast={toast}
    />
  );
}
