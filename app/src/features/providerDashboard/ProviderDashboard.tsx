import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { firstName } from './model';
import { openBooking } from './navigation';
import { BusinessDashboardView } from './BusinessDashboardView';
import { ProviderDashboardView } from './ProviderDashboardView';

/** Active statuses in the order a pro should look at them (most time-critical first). */
const ACTIVE_PRIORITY: BookingStatus[] = [
  'en_route',
  'completion_requested',
  'inspecting',
  'in_progress',
  'accepted',
  'awaiting_payment',
  'quote_sent',
  'disputed',
];

export default function ProviderDashboard() {
  const t = useTheme();
  const params = useLocalSearchParams<{ providerId?: string | string[] }>();
  const providerId = Array.isArray(params.providerId) ? params.providerId[0] : params.providerId;
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [provider, setProvider] = useState<BusinessProviderContext | null>(null);
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
  const { userId } = useAuth();
  const unread = useUnread();
  const bellCount = unread.total('provider') + unread.notifications;
  const refreshUnread = unread.refresh;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setEarningRates({});
    try {
      const p = await getMyProviderBusinessContext(providerId);
      if (!p) {
        router.replace('/onboarding');
        return;
      }
      setProvider(p);
      const isOwner = p.business_role === 'owner';
      if (isOwner) {
        void Promise.all([onboardingApi.getOnboarding(), onboardingApi.getCatalog()])
          .then(([s, cat]) => setGoLive({ status: s.go_live, docTypes: cat.docTypes }))
          .catch(() => undefined);
      } else {
        setGoLive(null);
      }
      const [j, profile, cats] = await Promise.all([listMyBusinessProviderJobs(p.id), getMyProfile(), listCategories()]);
      setJobs(j);
      setPayouts(isOwner ? await listMyPayouts() : []);
      setCategories(cats);
      setMe(profile?.full_name?.split(' ')[0] ?? '');
      const requestRates = isOwner ? await Promise.all(j.filter((job) => job.status === 'requested').map(async (job) => {
        try {
          return [job.booking_id, await getBookingCommissionRate(job.booking_id)] as const;
        } catch {
          return [job.booking_id, null] as const;
        }
      })) : [];
      setEarningRates(Object.fromEntries(requestRates));
      setError(null);
      // Problem photos for open requests (RLS lets the assigned pro read the booking and its photos).
      const incoming = j.filter((x) => x.status === 'requested');
      const entries = await Promise.all(
        incoming.map(async (x) => {
          const b = await getBooking(x.booking_id).catch(() => null);
          const urls = b?.photos.length ? await signedPhotoUrls(b.photos).catch(() => []) : [];
          return [x.booking_id, urls] as const;
        }),
      );
      setPhotos(Object.fromEntries(entries));
    } catch (e) {
      setError((e as Error).message);
    }
    void refreshUnread();
  }, [providerId, refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleOnline = async (value: boolean) => {
    haptics.select();
    setProvider((p) => (p ? { ...p, is_online: value } : p));
    try {
      await setOnline(value);
      toast({ message: value ? "You're online — new requests will reach you" : "You're offline", tone: value ? 'success' : 'default' });
      // Going online is when a pro wants to hear about new requests: ask for notification permission here.
      if (value && userId) void registerForPush(userId, { prompt: true });
    } catch (e) {
      setError((e as Error).message);
      setProvider((p) => (p ? { ...p, is_online: !value } : p));
    }
  };

  const act = async (id: string, fn: () => Promise<void>, msg: string) => {
    setBusyId(id);
    try {
      await fn();
      await load();
      toast({ message: msg, tone: 'success' });
    } catch (e) {
      haptics.error();
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const iconFor = (name: string) => iconForCategory(categories.find((c) => c.name === name));
  const incoming = (jobs ?? []).filter((j) => j.status === 'requested');
  const active = useMemo(
    () =>
      (jobs ?? [])
        .filter((j) => ACTIVE_PRIORITY.includes(j.status))
        .sort(
          (a, b) =>
            ACTIVE_PRIORITY.indexOf(a.status) - ACTIVE_PRIORITY.indexOf(b.status) ||
            (a.scheduled_at ?? a.created_at).localeCompare(b.scheduled_at ?? b.created_at),
        ),
    [jobs],
  );
  const [next, ...rest] = active;
  const stats = useMemo(() => providerStats((jobs ?? []).map((j) => j.status)), [jobs]);
  const sod = new Date(now);
  sod.setHours(0, 0, 0, 0);
  const today = payouts.filter((p) => new Date(p.created_at) >= sod && p.status !== 'reversed').reduce((a, p) => a + p.amount, 0);
  const online = !!provider?.is_online;
  const gutter = { paddingHorizontal: t.spacing.lg };

  const primaryAction = (j: ProviderJob) => {
    if (j.status === 'accepted') return void act(j.booking_id, () => startTrip(j.booking_id), `${firstName(j.customer_name)} has been told you're on the way`);
    if (j.status === 'inspecting') return router.push({ pathname: '/quote/[bookingId]', params: { bookingId: j.booking_id, changeOrder: '0' } });
    openBooking(j.booking_id);
  };

  if (provider && provider.business_role !== 'owner') {
    return (
      <BusinessDashboardView
        provider={provider}
        t={t}
        refreshing={refreshing}
        setRefreshing={setRefreshing}
        load={load}
        error={error}
        jobs={jobs}
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
      provider={provider}
      online={online}
      toggleOnline={toggleOnline}
      goLive={goLive}
      error={error}
      bellCount={bellCount}
      stats={stats}
      today={today}
      me={me}
      incoming={incoming}
      jobs={jobs}
      photos={photos}
      now={now}
      earningRates={earningRates}
      busyId={busyId}
      unread={unread}
      iconFor={iconFor}
      act={act}
      primaryAction={primaryAction}
      next={next}
      rest={rest}
      declining={declining}
      setDeclining={setDeclining}
      toast={toast}
    />
  );
}
