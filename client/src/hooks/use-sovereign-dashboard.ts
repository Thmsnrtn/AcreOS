import { useQuery } from "@tanstack/react-query";

// ─── Sovereign Dashboard hooks (Phase A) ─────────────────────────────────────

export function useAgentRuntimeStates() {
  return useQuery({
    queryKey: ["/api/founder/v12/runtime"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v12/runtime", { credentials: "include" });
      if (!res.ok) return [];
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      // Server rows are agent_runtime_state entries keyed by agentCodename;
      // consumers read `codename`/`name`.
      return rows.map((row: any) => ({
        ...row,
        codename: row.agentCodename,
        name: row.agentCodename,
      }));
    },
    staleTime: 30_000,
  });
}

export function useEventMeshStats() {
  return useQuery({
    queryKey: ["/api/founder/v12/events/stats"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v12/events/stats", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load event-mesh stats (${res.status})`);
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
    queryKey: ["/api/founder/v13/health/dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/health/dashboard", { credentials: "include" });
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
    queryKey: ["/api/founder/v11/negotiations/active"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v11/negotiations/active", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load negotiations (${res.status})`);
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      // Server rows are agent_negotiations entries; consumers read
      // `topic`/`participants`/`messages`.
      return rows.map((n: any) => ({
        ...n,
        topic: n.subject,
        participants: [n.initiatorAgent, n.respondentAgent].filter(Boolean),
        messages: Array.isArray(n.negotiationRounds)
          ? n.negotiationRounds.map((r: any) => ({ agent: r.agentCodename, content: r.proposal }))
          : [],
      }));
    },
    staleTime: 30_000,
  });
}

export function useRevenueAttribution() {
  return useQuery({
    queryKey: ["/api/founder/v11/attribution/reports"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v11/attribution/reports", { credentials: "include" });
      if (!res.ok) return null;
      const reports = await res.json();
      if (!Array.isArray(reports) || reports.length === 0) return null;
      // Latest revenue_attribution_reports row → the graph summary shape
      // consumers read (totalRevenue / nodeCount / topContributor / agents[]).
      const latest = reports[0];
      const contributions: any[] = Array.isArray(latest.agentContributions) ? latest.agentContributions : [];
      const totalRevenue = latest.totalAttributedRevenue ?? 0;
      const topContributor = contributions.length > 0
        ? [...contributions].sort((a, b) => (b.totalRevenue ?? 0) - (a.totalRevenue ?? 0))[0].agentCodename
        : null;
      return {
        ...latest,
        totalRevenue,
        nodeCount: contributions.reduce((sum, c) => sum + (c.actionCount ?? 0), 0),
        topContributor,
        agents: contributions.map((c) => ({
          agent: c.agentCodename,
          revenue: c.totalRevenue ?? 0,
          share: totalRevenue > 0 ? ((c.totalRevenue ?? 0) / totalRevenue) * 100 : 0,
        })),
      };
    },
    staleTime: 60_000,
  });
}

export function useDelegationTokens() {
  return useQuery({
    queryKey: ["/api/founder/v11/delegations/active"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v11/delegations/active", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load delegation tokens (${res.status})`);
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      // Server rows are delegation_tokens entries; consumers read
      // `maxAmountCents`/`usageCount`.
      return rows.map((token: any) => ({
        ...token,
        maxAmountCents: token.spendingLimitCents,
        usageCount: token.actionsTaken,
      }));
    },
    staleTime: 30_000,
  });
}

export function useCognitiveMemory() {
  return useQuery({
    queryKey: ["/api/founder/v13/memory/recent"],
    queryFn: async () => {
      // No server route exists for this yet — returns null; see task #34 sweep follow-ups.
      // (v13 only exposes /memory/episodes/:codename and /memory/stats, neither of
      // which serves a cross-agent recent-memories list.)
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
      // No server route exists for this yet — returns null; see task #34 sweep follow-ups.
      // (v13 only exposes /strategies/:codename/performance and /strategies/stats —
      // no active-strategies list.)
      const res = await fetch("/api/founder/v13/strategy/active", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60_000,
  });
}

export function useTrustEnforcement() {
  return useQuery({
    queryKey: ["/api/founder/v12/trust/history"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v12/trust/history", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load trust log (${res.status})`);
      const rows = await res.json();
      if (!Array.isArray(rows)) return [];
      // Server rows are trust_enforcement_log entries; consumers read
      // `agent`/`action`/`description`.
      return rows.map((entry: any) => ({
        ...entry,
        agent: entry.agentCodename,
        action: entry.decision,
        description: entry.actionType,
      }));
    },
    staleTime: 30_000,
  });
}

export function useFounderOverrides() {
  return useQuery({
    queryKey: ["/api/founder/v14/feedback/overrides"],
    queryFn: async () => {
      // No server route exists for this yet — returns null; see task #34 sweep follow-ups.
      // (v14 overrides are only exposed as /overrides/:orgId, which needs an org param.)
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
      // No server route exists for this yet — returns null; see task #34 sweep follow-ups.
      // (v14 cascade resolutions are only exposed as /cascade/:orgId/resolutions.)
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
      // No server route exists for this yet — returns null; see task #34 sweep follow-ups.
      // (v12 only exposes /events/channel/:channel, /events/unprocessed/:subscriber,
      // and /events/dead-letter — no cross-channel recent-events feed.)
      const res = await fetch(`/api/founder/v12/event-mesh/events?limit=${limit}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 10_000,
  });
}

export function useEventMeshSubscriptions() {
  return useQuery({
    queryKey: ["/api/founder/v12/events/subscriptions"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v12/events/subscriptions", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load subscriptions (${res.status})`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useAgentCollaborationSessions() {
  return useQuery({
    queryKey: ["/api/founder/v13/dialogues"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/dialogues", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });
}

export function useGovernanceCompliance() {
  return useQuery({
    queryKey: ["/api/founder/v13/governance/stats"],
    queryFn: async () => {
      const res = await fetch("/api/founder/v13/governance/stats", { credentials: "include" });
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
      // No server route exists for this yet — returns null; see task #34 sweep follow-ups.
      // (v13 briefings are only exposed as /intelligence/briefings/:orgId, which needs an org param.)
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
