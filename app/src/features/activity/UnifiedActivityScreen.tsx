import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { View } from 'react-native';
import { Header, Screen } from '../../components/ui';
import { listMyCustomerSportsBookings } from '../sports/api';
import { listMyProductEnquiries } from '../shops/api';
import { listMyCustomerRfqs } from '../rfq/api';
import { getMyActivityUnreadCounts } from './api';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useAuth } from '../../lib/auth';
import { badgeLabel } from '../../lib/unread';
import { useUnread } from '../../lib/unreadContext';
import { useTheme } from '../../theme';
import { ActivitySegmentControl } from './ActivitySegmentControl';
import { useActivityUnread } from './ActivityUnreadProvider';
import { visibleActivitySegments, type ActivitySegment } from './model';
import { ServicesSegment } from './segments/ServicesSegment';
import { RequestsSegment } from './segments/RequestsSegment';
import { ShopSegment } from './segments/ShopSegment';
import { SportsSegment } from './segments/SportsSegment';

const LABELS: Record<ActivitySegment, string> = {
  services: 'Services',
  requests: 'Requests',
  shop: 'Shop',
  sports: 'Sports',
};

const NO_REFRESH = async () => {};

export default function UnifiedActivityScreen() {
  const t = useTheme();
  const flags = useAppFeatureFlags();
  const productsEnabled = flags.isOn('products');
  const sportsEnabled = flags.isOn('sports');
  const { userId } = useAuth();
  const activityUnread = useActivityUnread();
  const chatUnread = useUnread();
  const [hasSportsBookings, setHasSportsBookings] = useState(false);
  const [hasShopHistory, setHasShopHistory] = useState(false);
  const [offShopUnread, setOffShopUnread] = useState(0);
  const shopHistoryRequest = useRef(0);

  const refreshShopHistory = useCallback(async () => {
    const request = ++shopHistoryRequest.current;
    if (!userId) {
      setHasShopHistory(false);
      setOffShopUnread(0);
      return;
    }
    if (productsEnabled) setOffShopUnread(0);
    const [enquiries, rfqs, unread] = await Promise.allSettled([
      listMyProductEnquiries(),
      listMyCustomerRfqs(),
      productsEnabled ? Promise.resolve(null) : getMyActivityUnreadCounts(),
    ]);
    if (request !== shopHistoryRequest.current) return;
    setHasShopHistory(
      (enquiries.status === 'fulfilled' && enquiries.value.length > 0)
      || (rfqs.status === 'fulfilled' && rfqs.value.length > 0)
      || (unread.status === 'fulfilled' && (unread.value?.shop ?? 0) > 0),
    );
    if (unread.status === 'fulfilled' && unread.value) setOffShopUnread(unread.value.shop);
  }, [userId, productsEnabled]);

  const shopUnreadCount = productsEnabled ? activityUnread.counts.shop : offShopUnread;
  const markActivityRead = useCallback(async (resourceType: 'booking' | 'request' | 'rfq' | 'sports_booking', resourceId: string) => {
    await activityUnread.markRead(resourceType, resourceId);
    if (resourceType === 'rfq') await refreshShopHistory();
  }, [activityUnread.markRead, refreshShopHistory]);

  useEffect(() => {
    setHasSportsBookings(false);
    if (sportsEnabled || !userId) {
      return;
    }
    let active = true;
    void listMyCustomerSportsBookings()
      .then((bookings) => {
        if (active) setHasSportsBookings(bookings.length > 0);
      })
      .catch(() => {
        if (active) setHasSportsBookings(false);
      });
    return () => {
      active = false;
    };
  }, [sportsEnabled, userId]);

  const segments = useMemo(
    () => visibleActivitySegments({
      products: productsEnabled,
      sports: sportsEnabled,
      hasShopHistory: hasShopHistory || shopUnreadCount > 0,
      hasSportsBookings: hasSportsBookings || activityUnread.counts.sports > 0,
    }),
    [productsEnabled, sportsEnabled, hasShopHistory, shopUnreadCount, hasSportsBookings, activityUnread.counts.sports],
  );
  const [segment, setSegment] = useState<ActivitySegment>('services');
  const [refreshing, setRefreshing] = useState(false);
  const refreshCurrent = useRef<() => Promise<void>>(NO_REFRESH);

  useEffect(() => {
    if (!segments.includes(segment)) setSegment('services');
  }, [segments, segment]);

  const registerRefresh = useCallback((refresh: () => Promise<void>) => {
    refreshCurrent.current = refresh;
    return () => {
      if (refreshCurrent.current === refresh) refreshCurrent.current = NO_REFRESH;
    };
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshCurrent.current(), activityUnread.refresh(), chatUnread.refresh(), refreshShopHistory()]);
    } finally {
      setRefreshing(false);
    }
  }, [activityUnread.refresh, chatUnread.refresh, refreshShopHistory]);

  useFocusEffect(
    useCallback(() => {
      void activityUnread.refresh();
      void chatUnread.refresh();
      void refreshShopHistory();
    }, [activityUnread.refresh, chatUnread.refresh, refreshShopHistory]),
  );

  const options = useMemo(
    () =>
      segments.map((value) => ({
        value,
        label: LABELS[value],
        badge: badgeLabel(value === 'shop' ? shopUnreadCount : activityUnread.counts[value]),
      })),
    [segments, activityUnread.counts, shopUnreadCount],
  );
  const activeSegment = segments.includes(segment) ? segment : 'services';

  return (
    <Screen
      inTabs
      header={
        <Header title="My activity" large back={false}>
          <View style={{ paddingBottom: t.spacing.md }}>
            <ActivitySegmentControl options={options} value={activeSegment} onChange={setSegment} />
          </View>
        </Header>
      }
      refreshing={refreshing}
      onRefresh={() => void refreshAll()}
      gap={t.spacing.md}
    >
      <View testID={`my-activity-panel-${activeSegment}`}>
        {activeSegment === 'services' ? (
          <ServicesSegment registerRefresh={registerRefresh} markRead={activityUnread.markRead} />
        ) : activeSegment === 'requests' ? (
          <RequestsSegment registerRefresh={registerRefresh} markRead={activityUnread.markRead} />
        ) : activeSegment === 'shop' ? (
          <ShopSegment
            enquiriesEnabled={productsEnabled && flags.isOn('product_enquiries')}
            rfqEnabled={productsEnabled && flags.isOn('product_rfq')}
            registerRefresh={registerRefresh}
            markRead={markActivityRead}
          />
        ) : (
          <SportsSegment registerRefresh={registerRefresh} markRead={activityUnread.markRead} />
        )}
      </View>
    </Screen>
  );
}
