import { AppState } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppFeatureFlags } from '../../lib/featureFlags';
import { useAuth } from '../../lib/auth';
import {
  getMyActivityUnreadCounts,
  markMyActivityNotificationRead,
  type ActivityResourceType,
  type ActivityUnreadCounts,
} from './api';
import { totalVisibleActivityUnread, visibleActivityUnreadCounts } from './model';

interface ActivityUnreadState {
  counts: ActivityUnreadCounts;
  total: number;
  refresh: () => Promise<void>;
  markRead: (resourceType: ActivityResourceType, resourceId: string) => Promise<void>;
}

const EMPTY_COUNTS: ActivityUnreadCounts = { services: 0, requests: 0, shop: 0, sports: 0 };
const ActivityUnreadContext = createContext<ActivityUnreadState | null>(null);
const POLL_MS = 60_000;

export function ActivityUnreadProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const flags = useAppFeatureFlags();
  const productsEnabled = flags.isOn('products');
  const enquiriesEnabled = productsEnabled && flags.isOn('product_enquiries');
  const rfqEnabled = productsEnabled && flags.isOn('product_rfq');
  const sportsEnabled = flags.isOn('sports');
  const userRef = useRef(userId);
  const [sourceCounts, setSourceCounts] = useState<ActivityUnreadCounts>(EMPTY_COUNTS);
  userRef.current = userId;

  const refresh = useCallback(async () => {
    if (!userId) {
      setSourceCounts(EMPTY_COUNTS);
      return;
    }
    try {
      const next = await getMyActivityUnreadCounts();
      if (userRef.current === userId) setSourceCounts(next);
    } catch {
      // Keep the last server-confirmed counts until a later refresh succeeds.
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setSourceCounts(EMPTY_COUNTS);
      return;
    }
    setSourceCounts(EMPTY_COUNTS);
    void refresh();
  }, [userId, enquiriesEnabled, rfqEnabled, sportsEnabled, refresh]);

  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, POLL_MS);
    return () => {
      subscription.remove();
      clearInterval(poll);
    };
  }, [userId, refresh]);

  const markRead = useCallback(async (resourceType: ActivityResourceType, resourceId: string) => {
    await markMyActivityNotificationRead(resourceType, resourceId);
    await refresh();
  }, [refresh]);

  const features = useMemo(
    () => ({ products: productsEnabled, sports: sportsEnabled }),
    [productsEnabled, sportsEnabled],
  );
  const counts = useMemo(
    () => visibleActivityUnreadCounts(sourceCounts, features),
    [sourceCounts, features],
  );
  const total = totalVisibleActivityUnread(sourceCounts, features);
  const value = useMemo(() => ({ counts, total, refresh, markRead }), [counts, total, refresh, markRead]);

  return <ActivityUnreadContext.Provider value={value}>{children}</ActivityUnreadContext.Provider>;
}

export function useActivityUnread(): ActivityUnreadState {
  const context = useContext(ActivityUnreadContext);
  if (!context) throw new Error('useActivityUnread must be used inside ActivityUnreadProvider');
  return context;
}
