/**
 * Bid discipline on the auction worksheet — V-Tax-1 T3a.
 *
 *   - MaxBidLine: the max bid with its basis, never a bare number. A derived
 *     max says so and shows its lines; a typed max says it has no basis.
 *   - RightsStackEditor: the operator states value, the liens their own
 *     search says survive, other taxes, costs and required return — each with
 *     its source. The derivation is previewed live with the SAME function the
 *     server records with (deriveMaxBid), labelled as a screen, and refuses,
 *     naming the missing lines, rather than treat a gap as zero.
 *   - BidDialog: the amount actually bid, flagged against the max BEFORE it is
 *     logged; going over is recorded only with the operator's reason.
 *   - DiscardControl: "lots, ditches and few gems" — a lot thrown out before
 *     bidding, with its reason recorded; reopening keeps the record.
 */
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Ban, RotateCcw, Scale, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ApiError, apiRequest, queryClient } from "@/lib/queryClient";
import { Verbs } from "@/lib/labels";
import {
  bidAgainstMax,
  deriveMaxBid,
  DISCARD_REASON_LABEL,
  DISCARD_REASONS,
  isDiscarded,
  STACK_LINE_LABEL,
  type DiscardReason,
  type DiscardRecord,
  type MaxBidRecord,
  type RightsStackInput,
  type StackAmount,
} from "@shared/tax/maxBid";

export interface BidDisciplineListing {
  id: number;
  apn: string;
  marketValue: string | null;
  maxBidCents: number | null;
  maxBidBasis?: MaxBidRecord | null;
  discard?: DiscardRecord | null;
}

const usd = (cents: number | null | undefined) =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toCents(v: string): number | null {
  const t = v.trim().replace(/[$,]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.body?.message ?? err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

// ── The max bid, with its basis ────────────────────────────────────────────

export function MaxBidLine({ listing }: { listing: BidDisciplineListing }) {
  const basis = listing.maxBidBasis ?? null;
  if (listing.maxBidCents == null) {
    return <p className="text-xs text-muted-foreground" data-testid={`max-bid-none-${listing.id}`}>No max bid yet — derive one from the rights stack.</p>;
  }
  if (!basis || basis.maxBidCents !== listing.maxBidCents) {
    return (
      <p className="text-xs" data-testid={`max-bid-bare-${listing.id}`}>
        Max bid <span className="tabular-nums font-semibold">{usd(listing.maxBidCents)}</span>{" "}
        <span className="text-acr-warning">— your typed number, no basis recorded.</span>
      </p>
    );
  }
  return (
    <div className="text-xs space-y-1" data-testid={`max-bid-derived-${listing.id}`}>
      <p>
        Max bid <span className="tabular-nums font-semibold">{usd(basis.maxBidCents)}</span> — derived from your rights stack
        {basis.leavesNothing ? <span className="text-acr-warning"> (the stack leaves nothing: any bid misses your required return)</span> : null}
      </p>
      <StackLines lines={basis.lines} />
      <p className="text-muted-foreground">Recorded {basis.recordedAt.slice(0, 10)}.</p>
    </div>
  );
}

function StackLines({ lines }: { lines: MaxBidRecord["lines"] }) {
  return (
    <table className="w-full text-xs" aria-label="Rights stack">
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} className="align-top">
            <td className="pr-2">{l.label}</td>
            <td className="pr-2 text-right tabular-nums whitespace-nowrap">{l.sign < 0 ? "−" : "+"}{usd(l.amountCents)}</td>
            <td className="text-muted-foreground">{l.basis}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── The rights stack editor ────────────────────────────────────────────────

type AmountDraft = { status: StackAmount["status"]; amount: string; source: string; asOf: string };

function draftOf(a: StackAmount | undefined, fallback: AmountDraft): AmountDraft {
  if (!a) return fallback;
  if (a.status === "known") return { status: "known", amount: String(a.amountCents / 100), source: a.source, asOf: a.asOf };
  if (a.status === "searched_none") return { status: "searched_none", amount: "", source: a.source, asOf: a.asOf };
  return { ...fallback, status: "unknown" };
}

function amountOf(d: AmountDraft): StackAmount | "invalid" {
  if (d.status === "unknown") return { status: "unknown" };
  if (!d.source.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(d.asOf)) return "invalid";
  if (d.status === "searched_none") return { status: "searched_none", source: d.source.trim(), asOf: d.asOf };
  const c = toCents(d.amount);
  return c === null ? "invalid" : { status: "known", amountCents: c, source: d.source.trim(), asOf: d.asOf };
}

function AmountField({ id, label, draft, onChange, allowSearchedNone }: { id: string; label: string; draft: AmountDraft; onChange: (d: AmountDraft) => void; allowSearchedNone: boolean }) {
  return (
    <fieldset className="space-y-1 rounded-md border p-2">
      <legend className="px-1 text-xs font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={`${id}-status`} className="text-xs">State</Label>
          <Select value={draft.status} onValueChange={(v) => onChange({ ...draft, status: v as AmountDraft["status"] })}>
            <SelectTrigger id={`${id}-status`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="known">Known amount</SelectItem>
              {allowSearchedNone && <SelectItem value="searched_none">Searched — none found</SelectItem>}
              <SelectItem value="unknown">Not known yet</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {draft.status === "known" && (
          <div className="space-y-1">
            <Label htmlFor={`${id}-amount`} className="text-xs">Amount $</Label>
            <Input id={`${id}-amount`} inputMode="decimal" value={draft.amount} onChange={(e) => onChange({ ...draft, amount: e.target.value })} className="h-8" />
          </div>
        )}
      </div>
      {draft.status !== "unknown" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-source`} className="text-xs">Where it came from</Label>
            <Input id={`${id}-source`} value={draft.source} onChange={(e) => onChange({ ...draft, source: e.target.value })} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${id}-asof`} className="text-xs">As of</Label>
            <Input id={`${id}-asof`} type="date" value={draft.asOf} onChange={(e) => onChange({ ...draft, asOf: e.target.value })} className="h-8" />
          </div>
        </div>
      )}
    </fieldset>
  );
}

export function RightsStackEditor({ listing, onDone }: { listing: BidDisciplineListing; onDone: () => void }) {
  const { toast } = useToast();
  const prior = listing.maxBidBasis?.input;
  const blank: AmountDraft = { status: "unknown", amount: "", source: "", asOf: "" };
  // The tax list's own market value is offered as the starting value, named as
  // the tax list's figure — the operator can replace it with their own.
  const listValue: AmountDraft = listing.marketValue && Number(listing.marketValue) > 0
    ? { status: "known", amount: String(Number(listing.marketValue)), source: "the tax list's market value", asOf: "" }
    : blank;
  const [value, setValue] = useState(draftOf(prior?.value, listValue));
  const [liens, setLiens] = useState(draftOf(prior?.survivingLiens, blank));
  const [taxes, setTaxes] = useState(draftOf(prior?.otherTaxes, blank));
  const [costs, setCosts] = useState<Array<{ label: string; amount: string; source: string }>>(
    prior?.costs?.map((c) => ({ label: c.label, amount: String(c.amountCents / 100), source: c.source })) ?? [],
  );
  const [costsStated, setCostsStated] = useState(prior ? prior.costs !== null : false);
  const [returnMode, setReturnMode] = useState<"cents" | "pct_of_value" | "unset">(prior?.requiredReturn?.kind ?? "unset");
  const [returnValue, setReturnValue] = useState(
    prior?.requiredReturn ? (prior.requiredReturn.kind === "cents" ? String(prior.requiredReturn.amountCents / 100) : String(prior.requiredReturn.bps / 100)) : "",
  );

  const built = useMemo((): { input: RightsStackInput } | { invalid: string } => {
    const v = amountOf(value), l = amountOf(liens), t = amountOf(taxes);
    if (v === "invalid") return { invalid: `${STACK_LINE_LABEL.value}: give an amount, where it came from and the as-of date.` };
    if (l === "invalid") return { invalid: `${STACK_LINE_LABEL.survivingLiens}: give where it came from and the as-of date.` };
    if (t === "invalid") return { invalid: `${STACK_LINE_LABEL.otherTaxes}: give where it came from and the as-of date.` };
    let costLines: RightsStackInput["costs"] = null;
    if (costsStated) {
      costLines = [];
      for (const c of costs) {
        const cents = toCents(c.amount);
        if (!c.label.trim() || cents === null || !c.source.trim()) return { invalid: "Each cost needs what it is, an amount and where the figure came from." };
        costLines.push({ label: c.label.trim(), amountCents: cents, source: c.source.trim() });
      }
    }
    let requiredReturn: RightsStackInput["requiredReturn"] = null;
    if (returnMode !== "unset") {
      const n = Number(returnValue);
      if (!Number.isFinite(n) || n < 0 || returnValue.trim() === "") return { invalid: "Give your required return." };
      requiredReturn = returnMode === "cents" ? { kind: "cents", amountCents: Math.round(n * 100) } : { kind: "pct_of_value", bps: Math.round(n * 100) };
    }
    return { input: { value: v, survivingLiens: l, otherTaxes: t, costs: costLines, requiredReturn } };
  }, [value, liens, taxes, costs, costsStated, returnMode, returnValue]);

  const screen = "input" in built ? deriveMaxBid(built.input) : null;

  const record = useMutation({
    mutationFn: async () => {
      if (!("input" in built)) throw new Error(built.invalid);
      return apiRequest("PUT", `/api/tax-researcher/listings/${listing.id}/max-bid`, built.input);
    },
    onSuccess: () => {
      toast({ title: "Max bid recorded with its basis" });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/listings", listing.id, "bid-log"] });
      onDone();
    },
    onError: (err) => toast({ title: "No max bid recorded", description: errorMessage(err), variant: "destructive" }),
  });

  const id = `stack-${listing.id}`;
  return (
    <div className="space-y-2 text-xs" data-testid={`rights-stack-${listing.id}`}>
      <AmountField id={`${id}-value`} label={STACK_LINE_LABEL.value} draft={value} onChange={setValue} allowSearchedNone={false} />
      <AmountField id={`${id}-liens`} label={STACK_LINE_LABEL.survivingLiens} draft={liens} onChange={setLiens} allowSearchedNone />
      <p className="text-muted-foreground">Which liens survive a tax sale is a reading of your title work and the state's law — AcreOS records what your search says; it does not decide it.</p>
      <AmountField id={`${id}-taxes`} label={STACK_LINE_LABEL.otherTaxes} draft={taxes} onChange={setTaxes} allowSearchedNone />

      <fieldset className="space-y-1 rounded-md border p-2">
        <legend className="px-1 text-xs font-medium">{STACK_LINE_LABEL.costs}</legend>
        {!costsStated ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setCostsStated(true); setCosts([{ label: "", amount: "", source: "" }]); }}>Add a cost</Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setCostsStated(true); setCosts([]); }}>There are none</Button>
          </div>
        ) : (
          <>
            {costs.length === 0 && <p className="text-muted-foreground">Stated as none.</p>}
            {costs.map((c, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <Input aria-label={`Cost ${i + 1} — what it is`} placeholder="Quiet title" value={c.label} onChange={(e) => setCosts(costs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="h-8" />
                <Input aria-label={`Cost ${i + 1} — amount in dollars`} inputMode="decimal" placeholder="1500" value={c.amount} onChange={(e) => setCosts(costs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className="h-8" />
                <Input aria-label={`Cost ${i + 1} — where the figure came from`} placeholder="Attorney quote" value={c.source} onChange={(e) => setCosts(costs.map((x, j) => (j === i ? { ...x, source: e.target.value } : x)))} className="h-8" />
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCosts([...costs, { label: "", amount: "", source: "" }])}>Add a cost</Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setCostsStated(false); setCosts([]); }}>Not stated</Button>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="space-y-1 rounded-md border p-2">
        <legend className="px-1 text-xs font-medium">{STACK_LINE_LABEL.requiredReturn}</legend>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-rr-mode`} className="text-xs">As</Label>
            <Select value={returnMode} onValueChange={(v) => setReturnMode(v as typeof returnMode)}>
              <SelectTrigger id={`${id}-rr-mode`} className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Not stated</SelectItem>
                <SelectItem value="cents">Dollars</SelectItem>
                <SelectItem value="pct_of_value">Percent of value</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {returnMode !== "unset" && (
            <div className="space-y-1">
              <Label htmlFor={`${id}-rr-value`} className="text-xs">{returnMode === "cents" ? "Dollars" : "Percent"}</Label>
              <Input id={`${id}-rr-value`} inputMode="decimal" value={returnValue} onChange={(e) => setReturnValue(e.target.value)} className="h-8" />
            </div>
          )}
        </div>
      </fieldset>

      <div className="rounded-md bg-muted/50 p-2 space-y-1" role="status" data-testid={`stack-screen-${listing.id}`}>
        {"invalid" in built ? (
          <p className="text-acr-warning">{built.invalid}</p>
        ) : screen?.status === "refused" ? (
          <>
            <p className="font-medium">No max bid yet. Missing:</p>
            <ul className="list-disc pl-4">{screen.missing.map((m) => <li key={m.key}>{m.label} — {m.why}</li>)}</ul>
          </>
        ) : screen?.status === "derived" ? (
          <>
            <p>Max bid <span className="tabular-nums font-semibold">{usd(screen.maxBidCents)}</span>{screen.leavesNothing ? <span className="text-acr-warning"> — the stack leaves nothing: any bid misses your required return</span> : null}</p>
            <StackLines lines={screen.lines} />
          </>
        ) : null}
        {screen && <p className="text-muted-foreground">{screen.label}</p>}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>{Verbs.CANCEL}</Button>
        <Button size="sm" onClick={() => record.mutate()} disabled={record.isPending || screen?.status !== "derived"} data-testid={`button-record-max-${listing.id}`}>
          <Scale className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          {record.isPending ? "Recording…" : "Record this max bid"}
        </Button>
      </div>
    </div>
  );
}

// ── The over-max flag, shared by the bid and win dialogs ───────────────────

export function OverMaxFlag({ listing, amountCents, reason, onReason }: { listing: BidDisciplineListing; amountCents: number | null; reason: string; onReason: (r: string) => void }) {
  if (amountCents === null || amountCents <= 0) return null;
  const against = bidAgainstMax(amountCents, listing.maxBidCents, listing.maxBidBasis ?? null);
  if (against.status === "no_max") {
    return <p className="text-xs text-muted-foreground" data-testid={`flag-no-max-${listing.id}`}>You have no max bid on this lot, so there is nothing to check this against.</p>;
  }
  if (against.status === "within") return null;
  return (
    <div className="space-y-1 rounded-md border border-acr-warning/40 bg-acr-warning/5 p-2" role="alert" data-testid={`flag-over-max-${listing.id}`}>
      <p className="text-xs">
        {usd(against.overByCents)} over your max of {usd(against.maxBidCents)}
        {against.derived ? " (derived from your rights stack)" : " (your typed number — no basis recorded)"}.
      </p>
      <Label htmlFor={`over-max-reason-${listing.id}`} className="text-xs">Why are you going over? (kept on the record)</Label>
      <Textarea id={`over-max-reason-${listing.id}`} value={reason} onChange={(e) => onReason(e.target.value)} className="text-xs min-h-[48px]" />
    </div>
  );
}

export function overMaxBlocks(listing: BidDisciplineListing, amountCents: number | null, reason: string): boolean {
  if (amountCents === null || amountCents <= 0) return false;
  return bidAgainstMax(amountCents, listing.maxBidCents, listing.maxBidBasis ?? null).status === "over" && reason.trim() === "";
}

// ── Logging a bid ──────────────────────────────────────────────────────────

export function BidDialog({ listing, open, onOpenChange }: { listing: BidDisciplineListing; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const amountCents = toCents(amount);
  const log = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/tax-researcher/listings/${listing.id}/bid-log`, {
        action: "bid",
        amountCents,
        ...(reason.trim() ? { overMaxReason: reason.trim() } : {}),
      }),
    onSuccess: () => {
      toast({ title: `Bid of ${usd(amountCents)} logged` });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/listings", listing.id, "bid-log"] });
      setAmount("");
      setReason("");
      onOpenChange(false);
    },
    onError: (err) => toast({ title: "Bid not logged", description: errorMessage(err), variant: "destructive" }),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Log a bid — {listing.apn}</DialogTitle>
          <DialogDescription>The amount you bid is checked against your max before it is logged.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`bid-amount-${listing.id}`}>Amount you bid ($)</Label>
          <Input id={`bid-amount-${listing.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid={`input-bid-amount-${listing.id}`} />
          <MaxBidLine listing={listing} />
          <OverMaxFlag listing={listing} amountCents={amountCents} reason={reason} onReason={setReason} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{Verbs.CANCEL}</Button>
          <Button
            onClick={() => log.mutate()}
            disabled={log.isPending || amountCents === null || amountCents <= 0 || overMaxBlocks(listing, amountCents, reason)}
            data-testid={`button-confirm-bid-${listing.id}`}
          >
            <Target className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
            {log.isPending ? "Logging…" : `Log bid of ${usd(amountCents)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Discarding a lot before bidding ────────────────────────────────────────

export function DiscardControl({ listing }: { listing: BidDisciplineListing }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DiscardReason>("landlocked");
  const [note, setNote] = useState("");
  const discarded = isDiscarded(listing.discard);

  const discard = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/tax-researcher/listings/${listing.id}/discard`, { reason, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      toast({ title: "Lot discarded — reason recorded" });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/listings", listing.id, "bid-log"] });
      setOpen(false);
    },
    onError: (err) => toast({ title: "Not discarded", description: errorMessage(err), variant: "destructive" }),
  });
  const reopen = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/tax-researcher/listings/${listing.id}/reopen`, {}),
    onSuccess: () => {
      toast({ title: "Lot reopened — the discard stays on record" });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/auction-worksheet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tax-researcher/listings", listing.id, "bid-log"] });
    },
    onError: (err) => toast({ title: "Not reopened", description: errorMessage(err), variant: "destructive" }),
  });

  if (discarded) {
    const d = listing.discard!;
    return (
      <div className="flex items-center gap-2 text-xs" data-testid={`discarded-${listing.id}`}>
        <span className="text-acr-warning">Discarded: {DISCARD_REASON_LABEL[d.reason]}{d.note ? ` — ${d.note}` : ""}</span>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
          <RotateCcw className="w-3 h-3 mr-1" aria-hidden="true" /> Reopen
        </Button>
      </div>
    );
  }
  return (
    <>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen(true)} data-testid={`button-discard-${listing.id}`}>
        <Ban className="w-3 h-3 mr-1" aria-hidden="true" /> Discard
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Discard {listing.apn} before bidding</DialogTitle>
            <DialogDescription>The reason is recorded, so the discard can be checked later. You can reopen the lot.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`discard-reason-${listing.id}`}>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as DiscardReason)}>
              <SelectTrigger id={`discard-reason-${listing.id}`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {DISCARD_REASONS.map((r) => <SelectItem key={r} value={r}>{DISCARD_REASON_LABEL[r]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Label htmlFor={`discard-note-${listing.id}`}>{reason === "other" ? "What is the reason?" : "Note (optional)"}</Label>
            <Textarea id={`discard-note-${listing.id}`} value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[48px]" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>{Verbs.CANCEL}</Button>
            <Button onClick={() => discard.mutate()} disabled={discard.isPending || (reason === "other" && !note.trim())} data-testid={`button-confirm-discard-${listing.id}`}>
              {discard.isPending ? "Discarding…" : "Discard lot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
