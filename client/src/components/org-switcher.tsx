/**
 * OrgSwitcher — topbar dropdown for VAs / multi-org users (Reyna §2).
 *
 * Background: VAs work for multiple Land Investors and currently log out
 * + back in to switch orgs (~8-12 minutes lost nightly per Reyna's
 * field interviews). This component lets them flip orgs without
 * re-authenticating.
 *
 * Behavior:
 * - Lists every org the user is a verified active member of (owner
 *   OR active team_members row). Source of truth: GET /api/auth/organizations.
 * - Selecting an org calls POST /api/auth/switch-organization. The server
 *   sets a signed cookie which getOrCreateOrg honors on subsequent requests
 *   (re-verifying membership server-side every time — a revoked seat can't
 *   keep operating by holding the cookie).
 * - On success, every authenticated query is invalidated so dashboards
 *   refetch under the new org.
 *
 * Visibility: hidden for users with only one org (no value to a switcher
 * that only shows the current org).
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface OrgMembership {
  id: number;
  name: string;
  slug: string | null;
  role: string;
  isOwner: boolean;
}

interface OrgListResponse {
  organizations: OrgMembership[];
  activeOrganizationId: number | null;
}

export function OrgSwitcher({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data, isLoading } = useQuery<OrgListResponse>({
    queryKey: ["/api/auth/organizations"],
    queryFn: async () => {
      const res = await fetch("/api/auth/organizations", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load organizations");
      return res.json();
    },
    staleTime: 60_000,
  });

  const switchMutation = useMutation({
    mutationFn: async (organizationId: number) => {
      const res = await apiRequest("POST", "/api/auth/switch-organization", {
        organizationId,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || `Switch failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (_data, orgId) => {
      const target = data?.organizations.find((o) => o.id === orgId);
      toast({
        title: "Organization switched",
        description: target ? `Now working in ${target.name}` : "Active organization updated",
      });
      // Refetch every authenticated query — every dashboard, lead list,
      // deal pipeline etc. is org-scoped server-side.
      queryClient.invalidateQueries();
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Could not switch organization",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const orgs = data?.organizations ?? [];
  const activeId = data?.activeOrganizationId ?? null;
  const activeOrg = orgs.find((o) => o.id === activeId) ?? orgs[0];

  // Hide the switcher when there's nothing to switch to. New / single-org
  // users shouldn't see chrome they can't use.
  if (!isLoading && orgs.length <= 1) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch organization"
          className={cn(
            "gap-2 h-8 max-w-[180px]",
            compact && "max-w-[140px]",
          )}
          data-testid="org-switcher-trigger"
        >
          <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate text-xs font-medium">
            {isLoading ? "Loading…" : activeOrg?.name ?? "Select org"}
          </span>
          <ChevronsUpDown className="w-3 h-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search organizations…" />
          <CommandList>
            <CommandEmpty>No organizations found.</CommandEmpty>
            <CommandGroup heading="Your organizations">
              {orgs.map((o) => {
                const isActive = o.id === activeId;
                const isPending = switchMutation.isPending && switchMutation.variables === o.id;
                return (
                  <CommandItem
                    key={o.id}
                    value={`${o.name} ${o.slug ?? ""}`}
                    onSelect={() => {
                      if (!isActive && !switchMutation.isPending) {
                        switchMutation.mutate(o.id);
                      }
                    }}
                    data-testid={`org-switcher-item-${o.id}`}
                    className="flex items-center gap-2"
                  >
                    <Building2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{o.name}</div>
                      <div className="text-[11px] text-muted-foreground capitalize">
                        {o.role}
                        {o.isOwner ? " · owner" : ""}
                      </div>
                    </div>
                    {isPending ? (
                      <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
                    ) : isActive ? (
                      <Check className="w-3.5 h-3.5 shrink-0 text-primary" aria-hidden="true" />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
