/**
 * OriginationFactsPanel — the Notes V2 Leg 3 origination record for one
 * originated note, rendered in the note drawer.
 *
 * Three things live here:
 *   1. The seller-finance counter for this note's seller (GET
 *      /api/notes/:id/seller-finance-count) — the same numbers the
 *      activation gate decides on, each track labelled in plain language.
 *   2. The operator's origination facts (POST .../origination-facts) and
 *      RMLO engagement (POST .../rmlo-engagement) forms. Every element is
 *      a fact the OPERATOR supplies; tri-state questions default to
 *      "unanswered", never to a guessed yes/no — the gate treats
 *      "unanswered" as its own answer and refuses on it where the rule
 *      requires an answer.
 *   3. The note's append-only origination records (GET
 *      .../origination-records), newest first.
 *
 * Copy discipline (load-bearing): an exclusion is something the operator
 * CLAIMS, never something AcreOS determines; an RMLO record states that
 * the operator recorded an engagement, and the licence itself is never
 * described as checked or verified — the server's completeness statement
 * is rendered verbatim. A balloon payment does not break the (a)(5)
 * claim; the element that claim turns on is the stated rate cap.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { SELLER_TYPES, type TriState } from "@shared/notes/sellerFinanceGate";

interface CountResponse {
  noteId: number;
  sellerKey: string | null;
  consummationDate: string;
  consummationDateSource: "origination_facts" | "start_date";
  factsRecordId: string | null;
  includesThisNote: boolean;
  counts: {
    trackA_dwellingSecuredRolling12Months: number;
    trackB_dwellingSecuredConsumerRolling12Months: number;
    trackB_dwellingSecuredConsumerCalendarYear: number;
    trackC_allSellerFinancedRolling12Months: number;
    unknownDwellingRolling12Months: number;
    unknownDwellingCalendarYear: number;
    legacyFlaggedNotCounted: number;
  };
  sellerKeyLimitation: string;
}

interface OriginationRecord {
  id: string;
  noteId: number | null;
  noteIdAtRecord: number;
  kind: "origination_facts" | "rmlo_engagement" | "activation_gate_passed" | "threshold_release" | "atr_determination_written";
  detail: Record<string, unknown>;
  supersedesId: string | null;
  recordedBy: string;
  recordedAt: string;
}

const SELLER_TYPE_LABELS: Record<(typeof SELLER_TYPES)[number], string> = {
  natural_person: "Natural person — an individual",
  estate_or_trust: "Estate or trust",
  entity: "Entity — LLC, corporation, or partnership",
  unanswered: "Not answered",
};

const KIND_LABELS: Record<OriginationRecord["kind"], string> = {
  origination_facts: "Origination facts",
  rmlo_engagement: "RMLO engagement",
  activation_gate_passed: "Activation gate passed",
  threshold_release: "Creditor-threshold release",
  atr_determination_written: "ATR determination recorded",
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok) throw new Error(data?.message ?? `Request failed (${res.status})`);
  return data as T;
}

function TriSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: TriState;
  onChange: (v: TriState) => void;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as TriState)}>
        <SelectTrigger id={id} className="mt-1" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unanswered">Not answered</SelectItem>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function OriginationFactsPanel({ noteId }: { noteId: number }) {
  const { toast } = useToast();
  const countKey = [`/api/notes/${noteId}/seller-finance-count`];
  const recordsKey = [`/api/notes/${noteId}/origination-records`];

  const countQuery = useQuery({ queryKey: countKey, queryFn: () => fetchJson<CountResponse>(countKey[0]) });
  const recordsQuery = useQuery({
    queryKey: recordsKey,
    queryFn: () => fetchJson<{ noteId: number; records: OriginationRecord[] }>(recordsKey[0]),
  });

  const records = recordsQuery.data?.records ?? [];
  const latestFacts = useMemo(
    () => records.find((r) => r.kind === "origination_facts" && !records.some((s) => s.supersedesId === r.id)),
    [records],
  );

  // ── Facts form state (seeded from the governing facts record when the
  // records load; "unanswered" is the default for anything not recorded).
  const [sellerKeyText, setSellerKeyText] = useState<string | null>(null);
  const [sellerType, setSellerType] = useState<(typeof SELLER_TYPES)[number]>("unanswered");
  const [dwellingSecured, setDwellingSecured] = useState<TriState>("unanswered");
  const [consumerPurpose, setConsumerPurpose] = useState<TriState>("unanswered");
  const [claimedExclusion, setClaimedExclusion] = useState<"a4" | "a5" | "none">("none");
  const [balloon, setBalloon] = useState<TriState>("unanswered");
  const [negativeAmortization, setNegativeAmortization] = useState<TriState>("unanswered");
  const [rateType, setRateType] = useState<"fixed" | "adjustable" | "unanswered">("unanswered");
  const [firstRateAdjustmentMonths, setFirstRateAdjustmentMonths] = useState("");
  const [rateCapsStated, setRateCapsStated] = useState<TriState>("unanswered");
  const [sellerConstructedDwelling, setSellerConstructedDwelling] = useState<TriState>("unanswered");
  const [consummationDate, setConsummationDate] = useState("");
  const [seededFor, setSeededFor] = useState<string | null>(null);

  // Seed once per governing record (and once from the count when no record
  // exists) without clobbering in-progress edits on refetch.
  const seedKey = latestFacts ? latestFacts.id : countQuery.data ? "count" : null;
  if (seedKey !== null && seededFor !== seedKey) {
    const d = (latestFacts?.detail ?? {}) as Record<string, unknown>;
    setSellerKeyText(latestFacts ? (d.sellerKey as string | null) ?? "" : countQuery.data?.sellerKey ?? "");
    if (latestFacts) {
      setSellerType((d.sellerType as (typeof SELLER_TYPES)[number]) ?? "unanswered");
      setDwellingSecured((d.dwellingSecured as TriState) ?? "unanswered");
      setConsumerPurpose((d.consumerPurpose as TriState) ?? "unanswered");
      setClaimedExclusion((d.claimedExclusion as "a4" | "a5" | "none") ?? "none");
      setBalloon((d.balloon as TriState) ?? "unanswered");
      setNegativeAmortization((d.negativeAmortization as TriState) ?? "unanswered");
      setRateType((d.rateType as "fixed" | "adjustable" | "unanswered") ?? "unanswered");
      setFirstRateAdjustmentMonths(d.firstRateAdjustmentMonths == null ? "" : String(d.firstRateAdjustmentMonths));
      setRateCapsStated((d.rateCapsStated as TriState) ?? "unanswered");
      setSellerConstructedDwelling((d.sellerConstructedDwelling as TriState) ?? "unanswered");
      setConsummationDate((d.consummationDate as string) ?? "");
    } else if (countQuery.data) {
      setConsummationDate(countQuery.data.consummationDate);
    }
    setSeededFor(seedKey);
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: countKey });
    void queryClient.invalidateQueries({ queryKey: recordsKey });
  };

  const factsMutation = useMutation({
    mutationFn: () =>
      postJson<{ record: OriginationRecord }>(`/api/notes/${noteId}/origination-facts`, {
        sellerKey: sellerKeyText && sellerKeyText.trim() !== "" ? sellerKeyText.trim() : null,
        sellerType,
        dwellingSecured,
        consumerPurpose,
        claimedExclusion,
        balloon,
        negativeAmortization,
        rateType,
        firstRateAdjustmentMonths:
          firstRateAdjustmentMonths.trim() === "" ? null : Number.parseInt(firstRateAdjustmentMonths, 10),
        rateCapsStated,
        sellerConstructedDwelling,
        consummationDate,
        ...(latestFacts ? { supersedesId: latestFacts.id } : {}),
      }),
    onSuccess: () => {
      toast({ title: "Origination facts recorded" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't record origination facts", description: err.message, variant: "destructive" });
    },
  });

  // ── RMLO form state.
  const [rmloName, setRmloName] = useState("");
  const [rmloLicence, setRmloLicence] = useState("");
  const [rmloDate, setRmloDate] = useState("");
  const [rmloOutcome, setRmloOutcome] = useState<{ complete: boolean; statement: string } | null>(null);

  const rmloMutation = useMutation({
    mutationFn: () =>
      postJson<{ record: OriginationRecord; complete: boolean; completenessStatement: string }>(
        `/api/notes/${noteId}/rmlo-engagement`,
        {
          originatorName: rmloName.trim(),
          licenceIdentifierAsStated: rmloLicence.trim(),
          engagementDate: rmloDate,
        },
      ),
    onSuccess: (data) => {
      setRmloOutcome({ complete: data.complete, statement: data.completenessStatement });
      toast({ title: "RMLO engagement recorded" });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't record RMLO engagement", description: err.message, variant: "destructive" });
    },
  });

  const countData = countQuery.data;
  const counts = countData?.counts;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileCheck className="w-4 h-4" aria-hidden="true" />
          Seller-finance origination record
        </CardTitle>
        <CardDescription className="text-xs">
          The facts behind this note's activation gate: how many deals this seller has financed, what you
          have recorded about this one, and the record the gate read. An exclusion below is your claim,
          recorded as you state it — AcreOS does not determine that an exclusion applies.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 space-y-5">
        {/* ── The counter ─────────────────────────────────────────────── */}
        <section aria-label="Seller-finance counts" className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Deals by this seller, as the gate counts them</p>
          {countQuery.isLoading ? (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Counting…
            </p>
          ) : countQuery.isError || !countData || !counts ? (
            <p className="text-xs text-acr-neg flex items-center gap-2" role="alert">
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Couldn't load the counts for this note.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Dwelling-secured deals, last 12 months</dt>
                  <dd className="tabular-nums font-medium">{counts.trackA_dwellingSecuredRolling12Months}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Of those, consumer-purpose — last 12 months</dt>
                  <dd className="tabular-nums font-medium">{counts.trackB_dwellingSecuredConsumerRolling12Months}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Consumer-purpose, dwelling-secured — calendar year (the creditor threshold count)</dt>
                  <dd className="tabular-nums font-medium">{counts.trackB_dwellingSecuredConsumerCalendarYear}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">All seller-financed deals, last 12 months</dt>
                  <dd className="tabular-nums font-medium">{counts.trackC_allSellerFinancedRolling12Months}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Dwelling answer not recorded (counted as dwelling-secured by the gate)</dt>
                  <dd className="tabular-nums font-medium">{counts.unknownDwellingRolling12Months}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Grandfathered (legacy) — flagged, never counted</dt>
                  <dd className="tabular-nums font-medium">{counts.legacyFlaggedNotCounted}</dd>
                </div>
              </dl>
              <p className="text-xs text-muted-foreground">
                Consummation date counted from:{" "}
                {countData.consummationDateSource === "origination_facts"
                  ? "the origination facts record"
                  : "the note's start date"}{" "}
                ({countData.consummationDate}).
                {countData.includesThisNote ? " This note is included in these counts." : ""}
              </p>
              <p className="text-xs text-muted-foreground italic">{countData.sellerKeyLimitation}</p>
            </>
          )}
        </section>

        {/* ── Origination facts form ──────────────────────────────────── */}
        <section aria-label="Record origination facts" className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">
            {latestFacts ? "Correct the origination facts (saves as a new record that supersedes the current one)" : "Record the origination facts"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="of-seller-key" className="text-xs">Seller (owning entity; blank = this organization)</Label>
              <Input
                id="of-seller-key"
                value={sellerKeyText ?? ""}
                onChange={(e) => setSellerKeyText(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="of-seller-type" className="text-xs">Seller type</Label>
              <Select value={sellerType} onValueChange={(v) => setSellerType(v as (typeof SELLER_TYPES)[number])}>
                <SelectTrigger id="of-seller-type" className="mt-1" aria-label="Seller type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SELLER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{SELLER_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TriSelect id="of-dwelling" label="Secured by a dwelling?" value={dwellingSecured} onChange={setDwellingSecured} />
            <TriSelect id="of-consumer" label="Consumer purpose?" value={consumerPurpose} onChange={setConsumerPurpose} />
            <TriSelect id="of-constructed" label="Seller constructed the dwelling?" value={sellerConstructedDwelling} onChange={setSellerConstructedDwelling} />
            <div>
              <Label htmlFor="of-claim" className="text-xs">Loan-originator exclusion claimed</Label>
              <Select value={claimedExclusion} onValueChange={(v) => setClaimedExclusion(v as "a4" | "a5" | "none")}>
                <SelectTrigger id="of-claim" className="mt-1" aria-label="Loan-originator exclusion claimed">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No exclusion claimed</SelectItem>
                  <SelectItem value="a4">(a)(4) — three-property exclusion</SelectItem>
                  <SelectItem value="a5">(a)(5) — one-property exclusion</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TriSelect id="of-balloon" label="Balloon payment?" value={balloon} onChange={setBalloon} />
            <TriSelect id="of-negam" label="Negative amortization possible?" value={negativeAmortization} onChange={setNegativeAmortization} />
            <div>
              <Label htmlFor="of-rate-type" className="text-xs">Rate type</Label>
              <Select value={rateType} onValueChange={(v) => setRateType(v as "fixed" | "adjustable" | "unanswered")}>
                <SelectTrigger id="of-rate-type" className="mt-1" aria-label="Rate type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unanswered">Not answered</SelectItem>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="adjustable">Adjustable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <TriSelect id="of-caps" label="Rate caps stated in the terms?" value={rateCapsStated} onChange={setRateCapsStated} />
            <div>
              <Label htmlFor="of-first-adjust" className="text-xs">Months until the rate can first change (adjustable only)</Label>
              <Input
                id="of-first-adjust"
                type="number"
                min={0}
                inputMode="numeric"
                value={firstRateAdjustmentMonths}
                onChange={(e) => setFirstRateAdjustmentMonths(e.target.value)}
                className="mt-1 tabular-nums"
              />
            </div>
            <div>
              <Label htmlFor="of-consummation" className="text-xs">Consummation date</Label>
              <Input
                id="of-consummation"
                type="date"
                value={consummationDate}
                onChange={(e) => setConsummationDate(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <Button
            type="button"
            disabled={factsMutation.isPending || consummationDate === ""}
            onClick={() => factsMutation.mutate()}
            className="w-full"
          >
            {factsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : null}
            {latestFacts ? "Save corrected facts" : "Record origination facts"}
          </Button>
        </section>

        {/* ── RMLO engagement form ────────────────────────────────────── */}
        <section aria-label="Record RMLO engagement" className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">Record an RMLO engagement</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rmlo-name" className="text-xs">Registered mortgage loan originator (name)</Label>
              <Input id="rmlo-name" value={rmloName} onChange={(e) => setRmloName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="rmlo-licence" className="text-xs">Licence identifier, as the originator stated it</Label>
              <Input id="rmlo-licence" value={rmloLicence} onChange={(e) => setRmloLicence(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="rmlo-date" className="text-xs">Engagement date</Label>
              <Input id="rmlo-date" type="date" value={rmloDate} onChange={(e) => setRmloDate(e.target.value)} className="mt-1" />
            </div>
          </div>
          <Button
            type="button"
            disabled={rmloMutation.isPending || rmloName.trim() === "" || rmloLicence.trim() === "" || rmloDate === ""}
            onClick={() => rmloMutation.mutate()}
            className="w-full"
            variant="outline"
          >
            {rmloMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" /> : null}
            Record RMLO engagement
          </Button>
          {rmloOutcome ? (
            <p className="text-xs text-muted-foreground" role="status">
              {rmloOutcome.complete ? "All stated fields are present. " : "Some stated fields are missing, so this record does not cure an activation refusal. "}
              {rmloOutcome.statement}
            </p>
          ) : null}
        </section>

        {/* ── The records ─────────────────────────────────────────────── */}
        <section aria-label="Origination records" className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Records on this note</p>
          {recordsQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : records.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No origination records yet.</p>
          ) : (
            <ul className="space-y-2" aria-label="Origination records">
              {records.map((r) => (
                <li key={r.id} className="text-xs border rounded p-2 space-y-1">
                  <div className="flex justify-between gap-3 flex-wrap">
                    <span className="font-medium">{KIND_LABELS[r.kind]}</span>
                    <span className="text-muted-foreground tabular-nums">{new Date(r.recordedAt).toLocaleString()}</span>
                  </div>
                  {r.kind === "activation_gate_passed" ? (
                    <p className="text-muted-foreground">
                      Counts the gate saw — consumer-purpose, dwelling-secured:{" "}
                      {String((r.detail.counts as Record<string, unknown> | undefined)?.trackBCalendarYear ?? "?")} in the
                      calendar year, {String((r.detail.counts as Record<string, unknown> | undefined)?.trackBRolling ?? "?")} in
                      the last 12 months.
                    </p>
                  ) : null}
                  {r.supersedesId ? <p className="text-muted-foreground">Supersedes an earlier record.</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
