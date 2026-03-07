interface TelemetryEvent {
  event: string;
  properties?: Record<string, any>;
  timestamp: number;
}

const eventQueue: TelemetryEvent[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;

export function trackEvent(event: string, properties?: Record<string, any>) {
  eventQueue.push({
    event,
    properties,
    timestamp: Date.now(),
  });
  
  // Debounce flush
  if (flushTimeout) clearTimeout(flushTimeout);
  flushTimeout = setTimeout(flushEvents, 5000);
}

function flushEvents() {
  if (eventQueue.length === 0) return;
  
  const events = [...eventQueue];
  eventQueue.length = 0;
  
  try {
    // Use sendBeacon for reliable unload delivery, fall back to fetch with keepalive
    const payload = JSON.stringify({ events });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/telemetry', new Blob([payload], { type: 'application/json' }));
    } else {
      // Fire-and-forget with keepalive to not block navigation
      void fetch('/api/telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Silently fail - telemetry should never break the app
  }
}

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flushEvents());
}

// Pre-defined event helpers
export const telemetry = {
  pageView: (page: string) => trackEvent('page_view', { page }),
  featureUsed: (feature: string) => trackEvent('feature_used', { feature }),
  actionCompleted: (action: string, details?: Record<string, any>) => 
    trackEvent('action_completed', { action, ...details }),
  aiUsed: (agent: string, tokensUsed?: number) => 
    trackEvent('ai_used', { agent, tokensUsed }),
  error: (errorType: string, message: string) =>
    trackEvent('error', { errorType, message }),
  sessionStart: () => trackEvent('session_start'),
};

/** Check whether the user qualifies for beta activation (stub — extend as needed). */
export function checkBetaActivation(usageMinutes: number): boolean {
  return usageMinutes >= 30;
}
