import { useState, useEffect, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface PushNotificationState {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  isConfigured: boolean;
  permission: NotificationPermission | "unsupported";
}

export function usePushNotifications() {
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: false,
    isConfigured: false,
    permission: "unsupported",
  });
  const { toast } = useToast();

  useEffect(() => {
    const checkSupport = async () => {
      const isSupported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
      
      if (!isSupported) {
        setState(prev => ({ ...prev, isSupported: false, permission: "unsupported" }));
        return;
      }

      setState(prev => ({
        ...prev,
        isSupported: true,
        permission: Notification.permission,
      }));

      if (Notification.permission === "granted") {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setState(prev => ({ ...prev, isSubscribed: !!subscription }));
      }
    };

    checkSupport();
  }, []);

  const requestPermission = useCallback(async () => {
    if (!state.isSupported) {
      toast({
        title: "Not Supported",
        description: "Push notifications are not supported in this browser.",
        variant: "destructive",
      });
      return false;
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const permission = await Notification.requestPermission();
      setState(prev => ({ ...prev, permission, isLoading: false }));

      if (permission === "granted") {
        toast({
          title: "Notifications Enabled",
          description: "You'll receive important updates about your leads and deals.",
        });
        return true;
      } else if (permission === "denied") {
        toast({
          title: "Notifications Blocked",
          description: "You can enable notifications in your browser settings.",
          variant: "destructive",
        });
      }
      return false;
    } catch (error) {
      console.error("Error requesting notification permission:", error);
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, [state.isSupported, toast]);

  const subscribe = useCallback(async () => {
    if (!state.isSupported) {
      toast({
        title: "Not Available",
        description: "Push notifications are not supported in this browser.",
        variant: "destructive",
      });
      return false;
    }

    if (state.permission !== "granted") {
      const granted = await requestPermission();
      if (!granted) return false;
    }

    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const response = await fetch("/api/push/vapid-public-key");
      if (!response.ok) {
        setState(prev => ({ ...prev, isLoading: false, isConfigured: false }));
        toast({
          title: "Not Configured",
          description: "Push notifications are not configured on this server.",
        });
        return false;
      }
      const { publicKey } = await response.json();
      
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await apiRequest("POST", "/api/push/subscribe", {
        subscription: subscription.toJSON(),
      });

      setState(prev => ({ ...prev, isSubscribed: true, isLoading: false, isConfigured: true }));
      toast({
        title: "Subscribed",
        description: "You'll now receive push notifications.",
      });
      return true;
    } catch (error) {
      console.error("Error subscribing to push notifications:", error);
      setState(prev => ({ ...prev, isLoading: false }));
      toast({
        title: "Subscription Failed",
        description: "Could not enable push notifications. Try again later.",
        variant: "destructive",
      });
      return false;
    }
  }, [state.isSupported, state.permission, requestPermission, toast]);

  const unsubscribe = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      
      if (subscription) {
        await subscription.unsubscribe();
        await apiRequest("POST", "/api/push/unsubscribe", {
          endpoint: subscription.endpoint,
        });
      }

      setState(prev => ({ ...prev, isSubscribed: false, isLoading: false }));
      toast({
        title: "Unsubscribed",
        description: "You won't receive push notifications anymore.",
      });
      return true;
    } catch (error) {
      console.error("Error unsubscribing from push notifications:", error);
      setState(prev => ({ ...prev, isLoading: false }));
      return false;
    }
  }, [toast]);

  return {
    ...state,
    requestPermission,
    subscribe,
    unsubscribe,
  };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
