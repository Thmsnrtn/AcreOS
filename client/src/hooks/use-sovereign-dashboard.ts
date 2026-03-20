import { useQuery } from "@tanstack/react-query";

// ─── Sovereign Dashboard hooks (Phase A) ─────────────────────────────────────

export function useAgentRuntimeStates() {
  return useQuery({
    queryKey: ["/api/founder/v12/lifecycle/agents"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v12/lifecycle/agents", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useEventMeshStats() {
  return useQuery({
    queryKey: ["/api/founder/v12/event-mesh/stats"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v12/event-mesh/stats", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 15_000,
  });
}

export function useAutonomyScore() {
  return useQuery({
    queryKey: ["/api/founder/v14/autonomy/score"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v14/autonomy/score", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useSelfHealingStatus() {
  return useQuery({
    queryKey: ["/api/founder/v13/self-healing/status"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/self-healing/status", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useJobHealthLogs() {
  return useQuery({
    queryKey: ["/api/founder/job-health"],
    queryFn: async () => {
      const res = await fetch("/api/founder/job-health", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useAgentNegotiations() {
  return useQuery({
    queryKey: ["/api/founder/v11/negotiation/active"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v11/negotiation/active", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useRevenueAttribution() {
  return useQuery({
    queryKey: ["/api/founder/v11/revenue/graph"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v11/revenue/graph", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useDelegationTokens() {
  return useQuery({
    queryKey: ["/api/founder/v11/delegation/tokens"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v11/delegation/tokens", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useCognitiveMemory() {
  return useQuery({
    queryKey: ["/api/founder/v13/memory/recent"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/memory/recent", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useAdaptiveStrategies() {
  return useQuery({
    queryKey: ["/api/founder/v13/strategy/active"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/strategy/active", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useTrustEnforcement() {
  return useQuery({
    queryKey: ["/api/founder/v12/trust/log"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v12/trust/log", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useFounderOverrides() {
  return useQuery({
    queryKey: ["/api/founder/v14/feedback/overrides"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v14/feedback/overrides", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useConfidenceCascade() {
  return useQuery({
    queryKey: ["/api/founder/v14/confidence/recent"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v14/confidence/recent", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useEventMeshEvents(limit: number = 50) {
  return useQuery({
    queryKey: ["/api/founder/v12/event-mesh/events", limit],
    queryFn: async () => {
      const res = await fetch(`/api/founder/v12/event-mesh/events?limit=${limit}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 10_000,
  });
}

export function useEventMeshSubscriptions() {
  return useQuery({
    queryKey: ["/api/founder/v12/event-mesh/subscriptions"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v12/event-mesh/subscriptions", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useAgentCollaborationSessions() {
  return useQuery({
    queryKey: ["/api/founder/v13/collaboration/sessions"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/collaboration/sessions", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useGovernanceCompliance() {
  return useQuery({
    queryKey: ["/api/founder/v13/governance/status"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/governance/status", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useFounderIntelligence() {
  return useQuery({
    queryKey: ["/api/founder/v13/intelligence/briefing"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/intelligence/briefing", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: ["/api/notifications/preferences"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/preferences", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 120_000,
  });
}
