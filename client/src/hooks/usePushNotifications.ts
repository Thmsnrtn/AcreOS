/**
 * usePushNotifications — Capacitor Push Notifications Hook (Task 347)
 *
 * Registers the device for push notifications via the Capacitor Push
 * Notifications plugin (@capacitor/push-notifications), handles incoming
 * notifications, routes them to the appropriate page, and stores the device
 * token on the server.
 *
 * On web (non-Capacitor context) this gracefully falls back to a no-op so
 * the same hook can be imported everywhere without platform guards.
 */

import { useEffect, useCallback, useState } from 'react';
import { useToast } from '@/hooks/use-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PushNotificationPayload {
  title?: string;
  body?: string;
  data?: Record<string, string>;
}

export interface UsePushNotificationsResult {
  /** Whether the Capacitor plugin is available on this platform */
  isCapacitor: boolean;
  /** Whether the user has granted push permission */
  permissionGranted: boolean;
  /** The FCM/APNS device token (null until registered) */
  deviceToken: string | null;
  /** Request permission and register with the push server */
  register: () => Promise<void>;
  /** Unregister (remove token from server) */
  unregister: () => Promise<void>;
}

// ─── Navigation route resolver ────────────────────────────────────────────────

function resolveNotificationRoute(data?: Record<string, string>): string | null {
  if (!data) return null;
  const { type, id } = data;
  switch (type) {
    case 'deal_room':
      return id ? `/marketplace?dealRoom=${id}` : '/marketplace';
    case 'new_bid':
      return id ? `/marketplace?listing=${id}` : '/marketplace';
    case 'message':
      return '/inbox';
    case 'match':
      return '/buyer-network';
    case 'document':
      return id ? `/marketplace?dealRoom=${id}&tab=documents` : '/marketplace';
    default:
      return null;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePushNotifications(): UsePushNotificationsResult {
  const { toast } = useToast();
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);

  // Detect Capacitor runtime
  const isCapacitor =
    typeof (window as any).Capacitor !== 'undefined' &&
    (window as any).Capacitor?.isNativePlatform?.();

  // ── Store device token on server ────────────────────────────────────────────
  const storeTokenOnServer = useCallback(async (token: string) => {
    try {
      await fetch('/api/push/device-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, platform: (window as any).Capacitor?.getPlatform?.() ?? 'unknown' }),
      });
    } catch (err) {
      console.warn('[Push] Failed to store device token:', err);
    }
  }, []);

  // ── Remove device token from server ─────────────────────────────────────────
  const removeTokenFromServer = useCallback(async (token: string) => {
    try {
      await fetch('/api/push/device-token', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch (err) {
      console.warn('[Push] Failed to remove device token:', err);
    }
  }, []);

  // ── Register ────────────────────────────────────────────────────────────────
  const register = useCallback(async () => {
    if (!isCapacitor) {
      console.log('[Push] Not a Capacitor native platform; skipping registration.');
      return;
    }

    try {
      // Dynamic import so this compiles fine in web-only builds
      const { PushNotifications } = await import('@capacitor/push-notifications');

      // Request permission
      const result = await PushNotifications.requestPermissions();
      if (result.receive !== 'granted') {
        toast({
          title: 'Push notifications blocked',
          description: 'Enable them in device Settings to receive deal alerts.',
          variant: 'destructive',
        });
        return;
      }

      setPermissionGranted(true);
      await PushNotifications.register();

      // ── Registration success — get token ──────────────────────────────────
      PushNotifications.addListener('registration', async ({ value: token }) => {
        console.log('[Push] Device token:', token);
        setDeviceToken(token);
        await storeTokenOnServer(token);
      });

      // ── Registration error ────────────────────────────────────────────────
      PushNotifications.addListener('registrationError', (err) => {
        console.error('[Push] Registration error:', err.error);
        toast({ title: 'Push registration failed', description: err.error, variant: 'destructive' });
      });

      // ── Notification received while app is in foreground ──────────────────
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        const payload = notification as PushNotificationPayload;
        toast({
          title: payload.title ?? 'New notification',
          description: payload.body,
        });
      });

      // ── Notification tapped (app brought to foreground/background) ────────
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const data = action.notification?.data as Record<string, string> | undefined;
        const route = resolveNotificationRoute(data);
        if (route && typeof window !== 'undefined') {
          // Navigate using history API; react-router will pick it up
          window.history.pushState({}, '', route);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
      });
    } catch (err) {
      console.error('[Push] Capacitor plugin error:', err);
    }
  }, [isCapacitor, storeTokenOnServer, toast]);

  // ── Unregister ──────────────────────────────────────────────────────────────
  const unregister = useCallback(async () => {
    if (!isCapacitor || !deviceToken) return;
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await PushNotifications.removeAllListeners();
      await removeTokenFromServer(deviceToken);
      setDeviceToken(null);
      setPermissionGranted(false);
    } catch (err) {
      console.error('[Push] Unregister error:', err);
    }
  }, [isCapacitor, deviceToken, removeTokenFromServer]);

  // ── Auto-register on Capacitor platforms ────────────────────────────────────
  useEffect(() => {
    if (isCapacitor) {
      register();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCapacitor]);

  return { isCapacitor, permissionGranted, deviceToken, register, unregister };
}
