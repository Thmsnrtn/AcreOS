interface TelemetryEvent {
  event: string;
  properties?: Record<string, any>;
  timestamp: number;
}

const eventQueue: TelemetryEvent[] = [];
let flushTimeout: NodeJS.Timeout | null = null;

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

async function flushEvents() {
  if (eventQueue.length === 0) return;
  
  const events = [...eventQueue];
  eventQueue.length = 0;
  
  try {
    await fetch('/api/telemetry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
  } catch (error) {
    // Silently fail - telemetry should never break the app
    console.debug('Telemetry flush failed:', error);
  }
}

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushEvents);
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
};
