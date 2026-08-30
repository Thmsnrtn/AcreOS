import { useQuery } from "@tanstack/react-query";

// ─── Sovereign Dashboard hooks (Phase A) ─────────────────────────────────────

// The v13 hooks (self-healing status, adaptive strategies, collaboration
// sessions, governance compliance, founder intelligence — cognitive memory
// went earlier with the memory page) were REMOVED 2026-08-29 — stage-4
// turn 18, founder Decision F (OD-10): the /api/founder/v13 router is
// retired, and several of these fetched paths that never existed
// server-side (they always rendered empty). The live v12/v14 hooks below
// are untouched.

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

export function useJobHealthLogs() {
  return useQuery({
    queryKey: ["/api/founder/job-health"],
    queryFn: async () => {
      const res = await fetch("/api/founder/job-health", { credentials: "include" });
      // THROWS, where this used to `return []`. The lie was implemented twice,
      // independently, on both sides of the wire: the server's catch answered
      // 200 with an empty array and this hook turned any remaining failure back
      // into one. Fixing the server alone would have changed nothing on screen,
      // which is exactly the kind of half-fix that looks complete.
      //
      // An empty list from THIS endpoint means "no job has failed", which reads
      // as "every job is fine". A total scheduler outage and perfect health
      // rendered the same screen on the console whose only purpose is telling
      // the founder whether the jobs ran.
      if (!res.ok) throw new Error(`job-health request failed: ${res.status}`);
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
      // Cross-channel recent-events firehose (server:
      // GET /api/founder/v12/event-mesh/events, backed by
      // eventMeshService.getRecentEvents). Surface real failures instead of a
      // silent [] so the stream never fakes an empty state on error.
      const res = await fetch(`/api/founder/v12/event-mesh/events?limit=${limit}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load event stream (${res.status})`);
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
