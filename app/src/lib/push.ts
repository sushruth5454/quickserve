import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { isDemoMode, registerPushDevice } from './api';
import { notificationRoute } from './unread';

type NotificationsModule = typeof import('expo-notifications');
type NotificationResponse = import('expo-notifications').NotificationResponse;
// Metro's module require; loaded lazily so platforms without remote push never touch expo-notifications.
declare const require: (id: string) => unknown;

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Remote push needs a native build with FCM/APNs credentials. It is unavailable on web, in demo mode and in Expo Go
 * on Android (removed in SDK 53). Everything else (unread badges, in-app banners) works without it.
 */
export const pushAvailable = Platform.OS !== 'web' && !isDemoMode && !(isExpoGo && Platform.OS === 'android');

let cached: NotificationsModule | null | undefined;

function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!pushAvailable) return cached;
  try {
    cached = require('expo-notifications') as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

/** Android channels referenced by the server's messages (a push to a missing channel is not displayed). */
async function ensureChannels(N: NotificationsModule) {
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync('messages', { name: 'Chat messages', importance: N.AndroidImportance.HIGH });
  await N.setNotificationChannelAsync('bookings', { name: 'Booking updates', importance: N.AndroidImportance.HIGH });
}

/** Foreground pushes are shown, except a chat message for the chat that is open on screen. */
export function configureForegroundHandling(getActiveChat: () => string | null) {
  const N = notifications();
  if (!N) return;
  N.setNotificationHandler({
    handleNotification: async (n) => {
      const data = n.request.content.data as { kind?: unknown; booking_id?: unknown } | null;
      const hide = data?.kind === 'chat_message' && typeof data.booking_id === 'string' && data.booking_id === getActiveChat();
      return { shouldShowBanner: !hide, shouldShowList: !hide, shouldPlaySound: !hide, shouldSetBadge: true };
    },
  });
}

export type PushResult = 'registered' | 'denied' | 'unavailable' | 'error';

let registeredFor: string | null = null;
let askedThisSession = false;
let inflight: Promise<PushResult> | null = null;

/**
 * Registers this device's Expo push token for the signed-in user. With `prompt` the OS permission dialog may be shown
 * (only at meaningful moments: opening a chat, viewing a booking, going online); without it, it only refreshes the
 * token when permission was already granted. Never throws.
 */
export function registerForPush(userId: string, opts: { prompt: boolean }): Promise<PushResult> {
  if (registeredFor === userId) return Promise.resolve('registered');
  if (inflight) return inflight;
  inflight = (async (): Promise<PushResult> => {
    const N = notifications();
    if (!N) return 'unavailable';
    try {
      await ensureChannels(N);
      let perm = await N.getPermissionsAsync();
      if (!perm.granted && opts.prompt && perm.canAskAgain && !askedThisSession) {
        askedThisSession = true;
        perm = await N.requestPermissionsAsync();
      }
      if (!perm.granted) return 'denied';
      const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
      const projectId = Constants.easConfig?.projectId ?? extra?.eas?.projectId;
      if (!projectId) return 'unavailable';
      const { data } = await N.getExpoPushTokenAsync({ projectId });
      await registerPushDevice(data, Platform.OS === 'ios' ? 'ios' : 'android');
      registeredFor = userId;
      return 'registered';
    } catch {
      // No credentials (e.g. Expo Go), offline or simulator: in-app badges and banners still work.
      return 'error';
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Forget the registration on sign-out (the API layer removes the token from the server). */
export function resetPushRegistration() {
  registeredFor = null;
}

export async function setAppBadge(count: number) {
  const N = notifications();
  if (!N) return;
  await N.setBadgeCountAsync(Math.max(0, count)).catch(() => false);
}

const handled = new Set<string>();

/** Tapping a notification opens its chat/booking (also when it launched the app). Only our own routes are followed. */
export function useNotificationRouting(enabled: boolean) {
  useEffect(() => {
    const N = notifications();
    if (!N || !enabled) return;
    const open = (r: NotificationResponse | null) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      if (handled.has(id)) return;
      handled.add(id);
      const route = notificationRoute(r.notification.request.content.data);
      if (route) router.push(route as Href);
    };
    void N.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const sub = N.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [enabled]);
}
