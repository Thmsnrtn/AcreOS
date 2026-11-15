/**
 * AgencyDisclosurePanel — the agent_investor agency disclosure RECORD, behind
 * the Deals door (deal detail → Details tab).
 *
 * Reads and writes GET/PUT /api/deals/:id/dual-agency (server/routes-deals.ts):
 * the side the agent represented, the date a disclosure was acknowledged and a
 * link to the disclosure the operator keeps. RECORD ONLY: AcreOS stores what
 * the operator enters. It does not prepare, send or sign a disclosure, and it
 * does not say whether one is required — that depends on the state and the
 * brokerage, and AcreOS encodes no such rule.
 *
 * Self-gates like CmaPanel: agent_investor orgs only, and nothing is fetched
 * for any other persona.
 */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";

export interface AgencyRecord {
  dealId: number;
  dualAgencySide: "seller" | "buyer" | "dual" | null;
  disclosureAcknowledgedAt: string | null;
  disclosureDocRef: string | null;
}

const SIDES = [
  ["seller", "Seller"],
  ["buyer", "Buyer"],
  ["dual", "Both sides (dual agency)"],
] as const;

export function AgencyDisclosurePanel({ dealId }: { dealId: number }) {
  const { data: org } = useOrganization();
  const isAgent = org?.onboardingData?.businessType === "agent_investor";
  const path = `/api/deals/${dealId}/dual-agency`;
  const { data, isLoading, isError, error, refetch } = useQuery<AgencyRecord>({
    queryKey: [path],
    queryFn: () => apiRequest("GET", path).then((r) => r.json()),
    enabled: isAgent,
  });
  const [editing, setEditing] = useState(false);

  if (!isAgent) return null;

  const empty = !!data && !data.dualAgencySide && !data.disclosureAcknowledgedAt && !data.disclosureDocRef;

  return (
    <Card className="shadow-acr-1" data-testid="agency-disclosure-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <FileCheck className="w-4 h-4" aria-hidden="true" /> Agency disclosure
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Record only. AcreOS stores what you enter here. It doesn&apos;t prepare, send or sign a
          disclosure, or decide whether one is required.
        </p>
        {isError ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => void refetch()}
            title="Couldn't load the agency record"
            compact
            testId="agency-disclosure-error"
          />
        ) : isLoading || !data ? (
          <div role="status" aria-busy="true" className="space-y-2" data-testid="agency-disclosure-loading">
            <span className="sr-only">Loading agency record</span>
            <Skeleton announce={false} className="h-9 w-full" />
            <Skeleton announce={false} className="h-9 w-2/3" />
          </div>
        ) : empty && !editing ? (
          <EmptyState
            icon={FileCheck}
            headline="Nothing recorded for this deal"
            cta={{ label: "Record agency details", onClick: () => setEditing(true) }}
            actionIcon={null}
            framed
            testId="agency-disclosure-empty"
          />
        ) : (
          <AgencyForm key={JSON.stringify(data)} path={path} record={data} />
        )}
      </CardContent>
    </Card>
  );
}

function AgencyForm({ path, record }: { path: string; record: AgencyRecord }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const ids = useId();
  const [side, setSide] = useState<string>(record.dualAgencySide ?? "none");
  // Stored at UTC midnight of the chosen day, so the first ten ISO characters
  // are that day in every timezone.
  const [date, setDate] = useState(record.disclosureAcknowledgedAt?.slice(0, 10) ?? "");
  const [docRef, setDocRef] = useState(record.disclosureDocRef ?? "");

  const save = useMutation({
    mutationFn: () =>
      apiRequest("PUT", path, {
        dualAgencySide: side === "none" ? null : side,
        disclosureAcknowledgedAt: date ? `${date}T00:00:00.000Z` : null,
        disclosureDocRef: docRef.trim() || null,
      }).then((r) => r.json() as Promise<AgencyRecord>),
    onSuccess: (saved) => {
      qc.setQueryData([path], saved);
      toast({ title: "Agency record saved" });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't save the agency record",
        description: `${err.message}. Nothing was changed.`,
        variant: "destructive",
      });
    },
  });

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="agency-disclosure-form">
      <div className="space-y-1">
        <Label htmlFor={`${ids}-side`}>Side you represented</Label>
        <Select value={side} onValueChange={setSide}>
          <SelectTrigger id={`${ids}-side`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Not recorded</SelectItem>
            {SIDES.map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${ids}-date`}>Disclosure acknowledged on</Label>
        <Input id={`${ids}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${ids}-doc`}>Link to the disclosure</Label>
        <Input
          id={`${ids}-doc`}
          value={docRef}
          maxLength={2048}
          placeholder="URL or document reference"
          onChange={(e) => setDocRef(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save record"}
      </Button>
    </form>
  );
}
