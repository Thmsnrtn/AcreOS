import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Organization } from "@shared/schema";

export interface DashboardStats {
  totalLeads: number;
  activeLeads: number;
  activeDeals: number;
  activeProperties: number;
  activeNotes: number;
  monthlyRevenue: number;
  recentActivity: Array<{
    id: number;
    action: string;
    entityType: string;
    entityId: number;
    description?: string;
    createdAt: string;
  }>;
}

export interface StripeProduct {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  metadata: Record<string, string>;
  prices: Array<{
    id: string;
    unit_amount: number;
    currency: string;
    recurring: { interval: string; interval_count: number } | null;
    active: boolean;
    metadata: Record<string, string>;
  }>;
}

export interface StripeSubscription {
  id: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  items: {
    data: Array<{
      price: {
        id: string;
        product: string;
        unit_amount: number;
        currency: string;
        recurring: { interval: string };
      };
    }>;
  };
}

export function useOrganization() {
  return useQuery<Organization>({
    queryKey: ["/api/organization"],
    queryFn: async () => {
      const res = await fetch("/api/organization", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch organization");
      return res.json();
    },
  });
}

export function useDashboardStats() {
  return useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard/stats", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch dashboard stats");
      return res.json();
    },
  });
}

export interface UsageLimitsData {
  tier: "free" | "starter" | "professional" | "enterprise";
  usage: {
    leads: { current: number; limit: number | null; percentage: number | null };
    properties: { current: number; limit: number | null; percentage: number | null };
    notes: { current: number; limit: number | null; percentage: number | null };
    ai_requests: { current: number; limit: number | null; percentage: number | null };
  };
}

export function useUsageLimits() {
  return useQuery<UsageLimitsData>({
    queryKey: ["/api/usage"],
    queryFn: async () => {
      const res = await fetch("/api/usage", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch usage data");
      return res.json();
    },
  });
}

export function useStripeProducts() {
  return useQuery<StripeProduct[]>({
    queryKey: ["/api/stripe/products"],
    queryFn: async () => {
      const res = await fetch("/api/stripe/products", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch products");
      return res.json();
    },
  });
}

export function useStripeSubscription() {
  return useQuery<{ subscription: StripeSubscription | null }>({
    queryKey: ["/api/stripe/subscription"],
    queryFn: async () => {
      const res = await fetch("/api/stripe/subscription", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch subscription");
      return res.json();
    },
  });
}

export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: async (priceId: string) => {
      const res = await apiRequest("POST", "/api/stripe/checkout", { priceId });
      return res.json() as Promise<{ url: string }>;
    },
  });
}

export function useCreatePortalSession() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/stripe/portal", {});
      return res.json() as Promise<{ url: string }>;
    },
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: Partial<Organization>) => {
      const res = await apiRequest("PATCH", "/api/organization", updates);
      return res.json() as Promise<Organization>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
    },
  });
}

export type Role = "owner" | "admin" | "member" | "viewer";

export interface RolePermissions {
  canAccessSettings: boolean;
  canManageBilling: boolean;
  canDeleteOrg: boolean;
  canManageTeam: boolean;
  canCreateCampaign: boolean;
  canDeleteCampaign: boolean;
  canExportData: boolean;
  canImportData: boolean;
  canDeleteLeads: boolean;
  canDeleteProperties: boolean;
  canDeleteDeals: boolean;
  canDeleteNotes: boolean;
  canEditLeads: boolean;
  canEditProperties: boolean;
  canEditDeals: boolean;
  canEditNotes: boolean;
  canCreateLeads: boolean;
  canCreateProperties: boolean;
  canCreateDeals: boolean;
  canCreateNotes: boolean;
  canViewLeads: boolean;
  canViewProperties: boolean;
  canViewDeals: boolean;
  canViewNotes: boolean;
  canAssignLeads: boolean;
  viewOnlyAssignedLeads: boolean;
}

export interface UserPermissions {
  userId: string;
  teamMemberId: number;
  role: Role;
  permissions: RolePermissions;
  availableRoles: Role[];
}

export function useUserPermissions() {
  return useQuery<UserPermissions>({
    queryKey: ["/api/me/permissions"],
    queryFn: async () => {
      const res = await fetch("/api/me/permissions", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch permissions");
      return res.json();
    },
  });
}

export interface TeamMember {
  id: number;
  organizationId: number;
  userId: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  permissions: string[] | null;
  isActive: boolean;
  invitedAt: string | null;
  joinedAt: string | null;
}

export function useTeamMembers() {
  return useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
    queryFn: async () => {
      const res = await fetch("/api/team", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch team members");
      return res.json();
    },
  });
}

export function useUpdateTeamMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ memberId, role }: { memberId: number; role: Role }) => {
      const res = await apiRequest("PATCH", `/api/team/${memberId}/role`, { role });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update role");
      }
      return res.json() as Promise<TeamMember>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/permissions"] });
    },
  });
}

export function getRoleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "admin":
      return "Admin";
    case "member":
      return "Member";
    case "viewer":
      return "Viewer";
    default:
      return "Member";
  }
}

export function getRoleBadgeStyle(role: string): string {
  switch (role) {
    case "owner":
      return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
    case "admin":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300";
    case "member":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    case "viewer":
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
}
