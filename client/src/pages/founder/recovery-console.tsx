/**
 * Phase 3 Week 13 — Coriander Recovery Console (operator UI).
 *
 * Wraps the seven founder-gated recovery endpoints shipped in routes-admin-
 * recovery.ts (commit 84109ef). Use cases:
 *
 *   - Customer lost their 2FA device → Reset 2FA after identity proof.
 *   - Account compromised → Revoke a single session, or all-but-current.
 *   - Original owner died, autopay still firing → Freeze autopay on the org.
 *   - Court-ordered ownership transfer → Move organizations.ownerId after
 *     uploading the supporting court document.
 *   - User can't sign in → Generate a one-time Clerk sign-in link.
 *
 * Every destructive action is wrapped in an AlertDialog confirmation. The
 * 2FA reset flow forces a 4-step identity-proof modal that captures proof
 * type, proof reference, justification, and a final "I have verified the
 * identity" checkbox before the API call fires.
 *
 * Audit trail: every backend handler writes to audit_events; this page
 * surfaces the most-recent rows (filtered to recovery.*) in a "Recent
 * recovery actions" card sourced from GET /api/admin/recovery/audit.
 *
 * W3-5 decomposition: the six tab panels + the audit card live in
 * client/src/components/founder/recovery-console/. This file owns the tab
 * shell, the selected-user banner, and the user-search query.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Wrench,
  Search,
  ShieldAlert,
  KeyRound,
  Clock,
  Snowflake,
  ArrowRightLeft,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import type { UserHit } from "@/components/founder/recovery-console/recovery-shared";
import { FindUserPanel } from "@/components/founder/recovery-console/find-user-panel";
import { SessionsPanel } from "@/components/founder/recovery-console/sessions-panel";
import { TwoFactorResetPanel } from "@/components/founder/recovery-console/two-factor-reset-panel";
import { PasswordResetPanel } from "@/components/founder/recovery-console/password-reset-panel";
import { FreezeAutopayPanel } from "@/components/founder/recovery-console/freeze-autopay-panel";
import { TransferOwnershipPanel } from "@/components/founder/recovery-console/transfer-ownership-panel";
import { RecoveryAuditCard } from "@/components/founder/recovery-console/recovery-audit-card";

// ─── Page ────────────────────────────────────────────────────────────────────

export function RecoveryConsoleContent() {
  useDocumentTitle("Recovery console");

  const [tab, setTab] = useState<string>("find");
  const [selected, setSelected] = useState<UserHit | null>(null);

  // ── Tab: Find user ────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const searchQuery = useQuery<{ results: UserHit[] }>({
    queryKey: ["/api/admin/users/search", query],
    queryFn: async () => {
      if (query.trim().length < 2) return { results: [] };
      const res = await apiRequest(
        "GET",
        `/api/admin/users/search?q=${encodeURIComponent(query.trim())}`,
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: query.trim().length >= 2,
  });

  const handleSelect = (u: UserHit) => {
    setSelected(u);
    setTab("sessions");
  };

  // Every panel calls this after a successful action so the audit card
  // below refreshes immediately (RecoveryAuditCard owns the query itself).
  const refreshAudit = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/admin/recovery/audit"] });

  return (
    <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wrench className="w-7 h-7" aria-hidden="true" />
            Recovery console
          </h1>
          <p className="text-muted-foreground mt-1 max-w-3xl">
            Founder-only operator surface for last-resort account recovery.
            Every action writes an immutable row to <code>audit_events</code>{" "}
            (7-year retention). Do not use without a documented support
            ticket.
          </p>
        </div>

        {selected && (
          <SelectedUserBanner
            user={selected}
            onClear={() => setSelected(null)}
          />
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="find">
              <Search className="w-4 h-4 mr-1" aria-hidden="true" />
              Find user
            </TabsTrigger>
            <TabsTrigger value="sessions" disabled={!selected}>
              <Clock className="w-4 h-4 mr-1" aria-hidden="true" />
              Sessions
            </TabsTrigger>
            <TabsTrigger value="2fa" disabled={!selected}>
              <ShieldAlert className="w-4 h-4 mr-1" aria-hidden="true" />
              2FA reset
            </TabsTrigger>
            <TabsTrigger value="password" disabled={!selected}>
              <KeyRound className="w-4 h-4 mr-1" aria-hidden="true" />
              Password reset link
            </TabsTrigger>
            <TabsTrigger value="autopay">
              <Snowflake className="w-4 h-4 mr-1" aria-hidden="true" />
              Freeze autopay
            </TabsTrigger>
            <TabsTrigger value="ownership">
              <ArrowRightLeft className="w-4 h-4 mr-1" aria-hidden="true" />
              Transfer ownership
            </TabsTrigger>
          </TabsList>

          <TabsContent value="find" className="mt-4">
            <FindUserPanel
              query={query}
              setQuery={setQuery}
              isLoading={searchQuery.isFetching}
              error={(searchQuery.error as Error | null) ?? null}
              onRetry={() => searchQuery.refetch()}
              results={searchQuery.data?.results ?? []}
              onSelect={handleSelect}
            />
          </TabsContent>

          <TabsContent value="sessions" className="mt-4">
            {selected ? (
              <SessionsPanel user={selected} onAction={refreshAudit} />
            ) : (
              <EmptySelection />
            )}
          </TabsContent>

          <TabsContent value="2fa" className="mt-4">
            {selected ? (
              <TwoFactorResetPanel user={selected} onAction={refreshAudit} />
            ) : (
              <EmptySelection />
            )}
          </TabsContent>

          <TabsContent value="password" className="mt-4">
            {selected ? (
              <PasswordResetPanel user={selected} onAction={refreshAudit} />
            ) : (
              <EmptySelection />
            )}
          </TabsContent>

          <TabsContent value="autopay" className="mt-4">
            <FreezeAutopayPanel onAction={refreshAudit} />
          </TabsContent>

          <TabsContent value="ownership" className="mt-4">
            <TransferOwnershipPanel onAction={refreshAudit} />
          </TabsContent>
        </Tabs>

      <RecoveryAuditCard />
    </div>
  );
}

// ─── Selected user banner ────────────────────────────────────────────────────

function SelectedUserBanner({
  user,
  onClear,
}: {
  user: UserHit;
  onClear: () => void;
}) {
  return (
    <Card className="border-primary/40">
      <CardContent className="py-4 flex items-center gap-3 flex-wrap">
        <Badge variant="outline">Selected user</Badge>
        <div className="text-sm">
          <span className="font-medium">
            {user.firstName ?? ""} {user.lastName ?? ""}
          </span>{" "}
          <span className="text-muted-foreground">
            &lt;{user.email ?? "no-email"}&gt;
          </span>
        </div>
        <code className="text-xs text-muted-foreground">
          id={user.id}
        </code>
        {user.clerkUserId && (
          <code className="text-xs text-muted-foreground">
            clerk={user.clerkUserId}
          </code>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          aria-label="Clear selected user"
        >
          Clear
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Empty selection ─────────────────────────────────────────────────────────

function EmptySelection() {
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        Select a user from the <strong>Find user</strong> tab first.
      </CardContent>
    </Card>
  );
}
