/**
 * ListBuilderSheet (W10.3) — build a prospect list from a county's own public
 * records, inside the Map door. No nav entry, no route: the Map page opens it.
 *
 * Every number on this sheet is the server's. The count is the county source's
 * exact match count, "already yours / new" is the server's dedupe against the
 * org's leads, and the mail cost is the server's estimate or nothing at all —
 * this component never computes, rounds into, or defaults any of them. A filter
 * the county's source cannot answer is disabled with its reason rather than
 * shown as if it narrowed the list.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AlertCircle, CheckCircle2, ListPlus, MapPinned, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { RequestCountyCTA } from "@/components/maps/RequestCountyCTA";
import { count as formatCount, formatDate, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  LIST_OWNER_TYPES,
  US_STATES,
  commitDefinitelyNotSaved,
  conflictCountOf,
  isChoosableCounty,
  isReRequestableCounty,
  isRequestableCounty,
  isTransientListBuilderFailure,
  leadsHrefForList,
  previewNonceOf,
  serverMessageOf,
  statusOf,
  useListBuilderCommit,
  useListBuilderCounties,
  useListBuilderLists,
  useListBuilderPreview,
  type ListBuilderCountBreakdown,
  type ListBuilderCounty,
  type ListBuilderPreview,
  type ListBuilderRequest,
  type ListOwnerType,
} from "@/hooks/use-list-builder";

/** Why a filter is off for this county — said, never silently ignored. */
export const FILTER_UNAVAILABLE_REASON = {
  acreage: "This county's records don't carry acreage, so an acreage filter can't be applied here.",
  ownerType: "This county's records don't say what kind of owner holds a parcel, so an owner-type filter can't be applied here.",
  yearsOwned: "This county's records don't carry a last-sale date, so a years-owned filter can't be applied here.",
} as const;

function isRefusal(status: number | null): boolean {
  return status !== null && status >= 400 && status < 500;
}

function parseNumberInput(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// ── Preview result ──────────────────────────────────────────────────

function MailCostLine({ preview }: { preview: ListBuilderPreview }) {
  const est = preview.cost.mailEstimate;
  if (!est) {
    return (
      <p data-testid="preview-mail-cost">
        Mail: the cost is shown at send time, once you pick a piece.
      </p>
    );
  }
  // Show "N × $X = $Y" only when the server's own figures say so for this
  // count. If they don't (e.g. the estimate covers only new leads), state the
  // two server numbers without naming an N we were not given.
  const perPiece = usd(est.perPieceCents / 100);
  const total = usd(est.totalCents / 100);
  const multiplies = preview.count * est.perPieceCents === est.totalCents;
  return (
    <p data-testid="preview-mail-cost">
      Mail estimate ({est.pieceType}):{" "}
      {multiplies ? (
        <span className="tabular-nums">
          {formatCount(preview.count)} × {perPiece} = {total}
        </span>
      ) : (
        <span className="tabular-nums">
          {perPiece} per piece, {total} total
        </span>
      )}
    </p>
  );
}

/**
 * The five parts of the count, in the server's figures. When the records were
 * read, they add up to the count (the server's identity, not ours — nothing
 * here sums them); when too large to read, each is "—", never a zero.
 */
const BREAKDOWN_PARTS: ReadonlyArray<{ key: keyof ListBuilderCountBreakdown; label: string; testId: string }> = [
  { key: "alreadyLeads", label: "Already your leads", testId: "preview-already-leads" },
  { key: "newLeads", label: "New leads", testId: "preview-new-leads" },
  { key: "suppressedDeleted", label: "Match a lead you deleted — not re-added", testId: "preview-suppressed-deleted" },
  { key: "skippedNoApn", label: "No parcel number (APN) — not saved", testId: "preview-skipped-no-apn" },
  { key: "skippedDuplicateApn", label: "Repeat a parcel number in this pull — saved once", testId: "preview-skipped-duplicate-apn" },
];

function matchesPhrase(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "parcel matches" : "parcels match"}`;
}

/** What Save will save, in the server's figures; without both, just "Save list". */
function saveLabel(p: ListBuilderPreview): string {
  if (p.newLeads === null || p.alreadyLeads === null) return "Save list";
  return `Save list (${formatCount(p.newLeads)} new, ${formatCount(p.alreadyLeads)} already yours)`;
}

function PreviewResult({ preview }: { preview: ListBuilderPreview }) {
  return (
    <div className="space-y-3" data-testid="list-preview">
      <div className="rounded-card border bg-card p-3">
        <p className="text-lg font-semibold tabular-nums" data-testid="preview-count">
          {matchesPhrase(preview.count)}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm" data-testid="preview-breakdown">
          {BREAKDOWN_PARTS.map((part) => (
            <div key={part.key}>
              <dt className="text-muted-foreground">{part.label}</dt>
              <dd className="font-medium tabular-nums" data-testid={part.testId}>
                {formatCount(preview[part.key])}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* County GIS records carry the PARCEL's situs address, not where its
          owner gets mail. Saying the list is mail-ready would be a claim the
          data can't back. */}
      <p className="text-sm text-muted-foreground" data-testid="preview-mailing-address-note">
        County records carry the parcel's address, not the owner's mailing address. These leads need a mailing
        address (for example, from a skip trace) before they can be mailed.
      </p>

      {preview.sample.length > 0 && (
        <div className="overflow-x-auto rounded-card border" data-testid="preview-sample">
          <table className="w-full text-xs">
            <caption className="sr-only">Sample of matching parcels</caption>
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium">APN</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Owner</th>
                <th scope="col" className="px-2 py-1.5 font-medium text-right">Acres</th>
                <th scope="col" className="px-2 py-1.5 font-medium">Address</th>
              </tr>
            </thead>
            <tbody>
              {preview.sample.map((row, i) => (
                <tr key={`${row.apn ?? "no-apn"}-${i}`} className="border-t" data-testid="preview-sample-row">
                  <td className="px-2 py-1.5 font-mono">{row.apn ?? "—"}</td>
                  <td className="px-2 py-1.5">{row.owner ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{row.acres ?? "—"}</td>
                  <td className="px-2 py-1.5">{row.address ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-sm text-muted-foreground" data-testid="preview-cost">
        <p data-testid="preview-pull-cost">Pull: free, from {preview.cost.source}</p>
        <MailCostLine preview={preview} />
        {preview.attribution && <p data-testid="preview-attribution">{preview.attribution}</p>}
      </div>

      {preview.tooLarge && (
        <Alert variant="destructive" data-testid="preview-too-large">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>
            {formatCount(preview.count)} parcels match; a list holds up to {formatCount(preview.maxPerList)} — narrow
            the filters.
          </AlertDescription>
        </Alert>
      )}
      {!preview.saveable && (
        <Alert variant="destructive" data-testid="preview-save-refusal">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{preview.saveRefusal ?? "This list can't be saved."}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

// ── County picker ───────────────────────────────────────────────────

function CountyPicker({
  state,
  selected,
  onSelect,
}: {
  state: string;
  selected: string | null;
  onSelect: (county: ListBuilderCounty) => void;
}) {
  const counties = useListBuilderCounties(state);
  const [requesting, setRequesting] = useState<string | null>(null);

  useEffect(() => setRequesting(null), [state]);

  if (counties.isLoading) {
    return (
      <div className="space-y-2" data-testid="counties-loading" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (counties.isError) {
    return (
      <QueryErrorState
        compact
        error={counties.error instanceof Error ? counties.error : null}
        onRetry={() => void counties.refetch()}
        isRetrying={counties.isFetching}
        title="Couldn't load counties"
        description="We couldn't read which counties have a source. Nothing is assumed — try again."
        testId="counties-error"
      />
    );
  }
  const list = counties.data?.counties ?? [];
  if (list.length === 0) {
    return (
      <div className="space-y-3">
        <EmptyState
          icon={MapPinned}
          headline={`No county sources in ${state} yet`}
          subtitle="Request your county and we'll look for its free public parcel records."
          cta={{ label: "Request a county", onClick: () => setRequesting(""), "data-testid": "button-request-any-county" }}
          testId="counties-empty"
        />
        {requesting !== null && <RequestCountyCTA compact defaultState={state} defaultCounty={requesting} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label={`Counties in ${state}`} className="space-y-2" data-testid="county-options">
        {list.map((c) => {
          const choosable = isChoosableCounty(c);
          const isSelected = selected === c.county;
          return (
            <div
              key={`${c.state}-${c.county}`}
              className={cn(
                "rounded-card border p-2.5",
                isSelected && "border-primary ring-1 ring-primary",
                !choosable && "bg-muted/40",
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={!choosable}
                onClick={() => choosable && onSelect(c)}
                data-testid={`county-option-${c.county}`}
                data-status={c.status}
                className="flex w-full min-h-11 items-start justify-between gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
              >
                <span className="min-w-0">
                  <span className={cn("block text-sm font-medium", !choosable && "text-muted-foreground")}>
                    {c.county}
                  </span>
                  <span className="block text-xs text-muted-foreground" data-testid={`county-message-${c.county}`}>
                    {c.message}
                  </span>
                </span>
                <Badge
                  variant={c.status === "covered" ? "default" : "secondary"}
                  className="shrink-0"
                  data-testid={`county-status-${c.county}`}
                >
                  {c.label}
                </Badge>
              </button>
              {(isRequestableCounty(c) || isReRequestableCounty(c)) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto min-h-11 px-0 text-primary underline-offset-4 hover:underline pointer-fine:sm:min-h-0"
                  onClick={() => setRequesting(c.county)}
                  aria-label={isReRequestableCounty(c) ? `Request ${c.county} again` : undefined}
                  data-testid={`button-request-county-${c.county}`}
                >
                  {isReRequestableCounty(c) ? "Request it again" : `Request ${c.county}`}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {requesting !== null && (
        <RequestCountyCTA key={requesting} compact defaultState={state} defaultCounty={requesting} />
      )}
    </div>
  );
}

// ── Your lists ──────────────────────────────────────────────────────

function YourLists({ onStart }: { onStart: () => void }) {
  const lists = useListBuilderLists();
  return (
    <section aria-labelledby="list-builder-your-lists" className="space-y-2" data-testid="your-lists">
      <h3 id="list-builder-your-lists" className="text-sm font-semibold">
        Your lists
      </h3>
      {lists.isLoading ? (
        <div className="space-y-2" data-testid="lists-loading" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : lists.isError ? (
        <QueryErrorState
          compact
          error={lists.error instanceof Error ? lists.error : null}
          onRetry={() => void lists.refetch()}
          isRetrying={lists.isFetching}
          title="Couldn't load your lists"
          description="Your saved lists are untouched — we just couldn't read them. Try again."
          testId="lists-error"
        />
      ) : (lists.data?.lists ?? []).length === 0 ? (
        <EmptyState
          icon={ListPlus}
          headline="No saved lists yet"
          subtitle="Count a county above and save it — its parcels land in your leads, deduped against the ones you have."
          cta={{ label: "Start a list", onClick: onStart, "data-testid": "button-start-list" }}
          testId="lists-empty"
        />
      ) : (
        <>
          <ul className="space-y-2" data-testid="lists-rows">
            {lists.data!.lists.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded-card border p-2.5" data-testid="list-row">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{l.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.county}, {l.state} · <span className="tabular-nums">{formatCount(l.total)}</span> leads ·{" "}
                    {formatDate(l.createdAt)}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="shrink-0 min-h-11 pointer-fine:sm:min-h-9">
                  <Link href={leadsHrefForList(l.id)} aria-label={`View leads in ${l.name}`}>
                    View leads
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
          {typeof lists.data!.total === "number" && lists.data!.total > lists.data!.lists.length && (
            <p className="text-xs text-muted-foreground" data-testid="lists-bounded">
              Showing the newest {formatCount(lists.data!.lists.length)} of {formatCount(lists.data!.total)} lists.
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ── Panel ───────────────────────────────────────────────────────────

export interface ListBuilderPanelProps {
  /** Two-letter state code to start on (tests; a future map-county prefill). */
  initialState?: string;
}

export function ListBuilderPanel({ initialState }: ListBuilderPanelProps) {
  const stateSelectId = useId();
  const acreMinId = useId();
  const acreMaxId = useId();
  const yearsId = useId();
  const nameId = useId();
  const ownerTypeIdBase = useId();
  const stateTriggerRef = useRef<HTMLButtonElement>(null);

  const [stateCode, setStateCode] = useState<string>(initialState?.toUpperCase() ?? "");
  const [county, setCounty] = useState<ListBuilderCounty | null>(null);
  const [acreageMin, setAcreageMin] = useState("");
  const [acreageMax, setAcreageMax] = useState("");
  const [ownerTypes, setOwnerTypes] = useState<ListOwnerType[]>([]);
  const [yearsOwnedMin, setYearsOwnedMin] = useState("");
  const [listName, setListName] = useState("");

  const preview = useListBuilderPreview();
  const commit = useListBuilderCommit();

  // Only filters this county can answer are ever sent. A disabled filter is
  // not "applied with no effect" — it is not part of the request at all.
  const request: ListBuilderRequest | null = useMemo(() => {
    if (!stateCode || !county) return null;
    const body: ListBuilderRequest = { state: stateCode, county: county.county };
    if (county.filters.acreage) {
      const min = parseNumberInput(acreageMin);
      const max = parseNumberInput(acreageMax);
      if (min !== undefined) body.acreageMin = min;
      if (max !== undefined) body.acreageMax = max;
    }
    if (county.filters.ownerType && ownerTypes.length > 0) body.ownerTypes = [...ownerTypes];
    if (county.filters.yearsOwned) {
      const y = parseNumberInput(yearsOwnedMin);
      if (y !== undefined) body.yearsOwnedMin = y;
    }
    return body;
  }, [stateCode, county, acreageMin, acreageMax, ownerTypes, yearsOwnedMin]);

  // A preview describes exactly the request that produced it. Change anything
  // and the old numbers no longer apply — clear them so Save can never commit
  // against a count the customer did not see for these filters.
  const requestKey = request ? JSON.stringify(request) : "";
  const { reset: resetPreview } = preview;
  const { reset: resetCommit } = commit;
  useEffect(() => {
    resetPreview();
    resetCommit();
  }, [requestKey, resetPreview, resetCommit]);

  const selectCounty = (c: ListBuilderCounty) => {
    setCounty(c);
    setAcreageMin("");
    setAcreageMax("");
    setOwnerTypes([]);
    setYearsOwnedMin("");
  };

  const runPreview = () => {
    if (!request) return;
    commit.reset();
    preview.mutate(request);
  };

  const p = preview.data ?? null;
  const previewedRequest = preview.variables ?? null;
  const conflictCount = conflictCountOf(commit.error);
  const isConflict = statusOf(commit.error) === 409;
  const saveBlocked = !p || p.tooLarge || !p.saveable;
  const canSave = !saveBlocked && !!listName.trim() && !commit.isPending && !commit.isSuccess && !isConflict;

  const save = () => {
    if (!canSave || !p || !previewedRequest) return;
    commit.mutate({
      body: { ...previewedRequest, name: listName.trim(), expectedCount: p.count },
      previewNonce: previewNonceOf(p),
    });
  };

  const filters = county?.filters;

  return (
    <div className="space-y-6" data-testid="list-builder-panel">
      {/* Step 1 — county */}
      <section aria-labelledby="list-builder-step-1" className="space-y-3">
        <h3 id="list-builder-step-1" className="text-sm font-semibold">
          1. Pick a county
        </h3>
        <div className="space-y-1.5">
          <Label htmlFor={stateSelectId} className="text-xs font-medium">
            State
          </Label>
          <Select
            value={stateCode}
            onValueChange={(v) => {
              setStateCode(v);
              setCounty(null);
            }}
          >
            <SelectTrigger id={stateSelectId} ref={stateTriggerRef} className="min-h-11 pointer-fine:sm:min-h-9" data-testid="select-list-state">
              <SelectValue placeholder="Choose a state" />
            </SelectTrigger>
            <SelectContent>
              {US_STATES.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {stateCode && <CountyPicker state={stateCode} selected={county?.county ?? null} onSelect={selectCounty} />}
      </section>

      {/* Step 2 — filters */}
      {county && filters && (
        <section aria-labelledby="list-builder-step-2" className="space-y-4" data-testid="list-filters">
          <h3 id="list-builder-step-2" className="text-sm font-semibold">
            2. Filter {county.county}
          </h3>

          <fieldset className="space-y-1.5" disabled={!filters.acreage} data-testid="filter-acreage">
            <legend className="text-xs font-medium">Acreage</legend>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor={acreMinId} className="text-micro text-muted-foreground">
                  Minimum acres
                </Label>
                <Input
                  id={acreMinId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={acreageMin}
                  onChange={(e) => setAcreageMin(e.target.value)}
                  disabled={!filters.acreage}
                  className="min-h-11 pointer-fine:sm:min-h-9"
                  data-testid="input-acreage-min"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={acreMaxId} className="text-micro text-muted-foreground">
                  Maximum acres
                </Label>
                <Input
                  id={acreMaxId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={acreageMax}
                  onChange={(e) => setAcreageMax(e.target.value)}
                  disabled={!filters.acreage}
                  className="min-h-11 pointer-fine:sm:min-h-9"
                  data-testid="input-acreage-max"
                />
              </div>
            </div>
            {!filters.acreage && (
              <p className="text-xs text-muted-foreground" data-testid="filter-reason-acreage">
                {FILTER_UNAVAILABLE_REASON.acreage}
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-1.5" disabled={!filters.ownerType} data-testid="filter-owner-type">
            <legend className="text-xs font-medium">Owner type</legend>
            <div className="grid grid-cols-2 gap-2">
              {LIST_OWNER_TYPES.map((o) => {
                const id = `${ownerTypeIdBase}-${o.value}`;
                const checked = ownerTypes.includes(o.value);
                return (
                  <div key={o.value} className="flex min-h-11 items-center gap-2 pointer-fine:sm:min-h-9">
                    <Checkbox
                      id={id}
                      checked={checked}
                      disabled={!filters.ownerType}
                      onCheckedChange={(next) =>
                        setOwnerTypes((cur) =>
                          next === true ? [...cur.filter((v) => v !== o.value), o.value] : cur.filter((v) => v !== o.value),
                        )
                      }
                      data-testid={`checkbox-owner-${o.value}`}
                    />
                    <Label htmlFor={id} className="text-sm font-normal">
                      {o.label}
                    </Label>
                  </div>
                );
              })}
            </div>
            {!filters.ownerType && (
              <p className="text-xs text-muted-foreground" data-testid="filter-reason-ownerType">
                {FILTER_UNAVAILABLE_REASON.ownerType}
              </p>
            )}
          </fieldset>

          <fieldset className="space-y-1.5" disabled={!filters.yearsOwned} data-testid="filter-years-owned">
            <legend className="sr-only">Years owned</legend>
            <Label htmlFor={yearsId} className="text-xs font-medium">
              Owned at least (years)
            </Label>
            <Input
              id={yearsId}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={yearsOwnedMin}
              onChange={(e) => setYearsOwnedMin(e.target.value)}
              disabled={!filters.yearsOwned}
              className="min-h-11 pointer-fine:sm:min-h-9"
              data-testid="input-years-owned-min"
            />
            {!filters.yearsOwned && (
              <p className="text-xs text-muted-foreground" data-testid="filter-reason-yearsOwned">
                {FILTER_UNAVAILABLE_REASON.yearsOwned}
              </p>
            )}
          </fieldset>
        </section>
      )}

      {/* Step 3 — count, then save */}
      {county && (
        <section aria-labelledby="list-builder-step-3" className="space-y-3">
          <h3 id="list-builder-step-3" className="text-sm font-semibold">
            3. Count, then save
          </h3>
          <Button
            type="button"
            onClick={runPreview}
            disabled={!request || preview.isPending}
            className="w-full min-h-11 pointer-fine:sm:min-h-9"
            data-testid="button-list-count"
          >
            {preview.isPending ? "Counting…" : "Count matching parcels"}
          </Button>

          {/* A 4xx is the server REFUSING, in its own words (a filter this
              county can't answer, a county that isn't covered, bad input) —
              shown inline. Only a 5xx / network failure is "try again". */}
          {preview.isError &&
            (isRefusal(statusOf(preview.error)) ? (
              <Alert variant="destructive" data-testid="preview-bad-request">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Can't count this</AlertTitle>
                <AlertDescription>{serverMessageOf(preview.error) ?? "The request was refused."}</AlertDescription>
              </Alert>
            ) : (
              <QueryErrorState
                compact
                error={preview.error instanceof Error ? preview.error : null}
                onRetry={runPreview}
                isRetrying={preview.isPending}
                title="Couldn't count this county"
                description={
                  // "Try again" only where it is honest: the county source
                  // failed (502) or no answer came back. A 500 is our fault,
                  // and a retry is not promised to fix it.
                  isTransientListBuilderFailure(preview.error)
                    ? "The county's records source didn't answer, so there is no count. Try again in a moment."
                    : "Something went wrong on our side while counting, so there is no count."
                }
                testId="preview-error"
              />
            ))}

          {/* Present before any count, so its first update is announced. */}
          <div role="status" aria-live="polite" className="sr-only" data-testid="preview-live">
            {p
              ? `${matchesPhrase(p.count)}${
                  p.newLeads !== null && p.alreadyLeads !== null
                    ? `: ${formatCount(p.newLeads)} new, ${formatCount(p.alreadyLeads)} already yours.`
                    : "."
                }`
              : ""}
          </div>

          {p && <PreviewResult preview={p} />}

          {p && (
            <div className="space-y-2" data-testid="list-save">
              <Label htmlFor={nameId} className="text-xs font-medium">
                List name
              </Label>
              <Input
                id={nameId}
                value={listName}
                onChange={(e) => setListName(e.target.value)}
                placeholder={`${county.county} ${stateCode}`}
                disabled={saveBlocked}
                className="min-h-11 pointer-fine:sm:min-h-9"
                data-testid="input-list-name"
              />
              <Button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="w-full min-h-11 pointer-fine:sm:min-h-9"
                data-testid="button-list-save"
              >
                {commit.isPending ? "Saving…" : saveLabel(p)}
              </Button>

              {isConflict && (
                <Alert variant="destructive" data-testid="commit-conflict">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>The county's records changed</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>
                      {conflictCount !== null ? (
                        <>
                          <span className="tabular-nums" data-testid="commit-conflict-count">
                            {formatCount(conflictCount)}
                          </span>{" "}
                          parcels match now, not the {formatCount(p.count)} you counted. Nothing was saved — review the
                          new count before saving.
                        </>
                      ) : (
                        <>The count changed since you previewed it. Nothing was saved — review the new count before saving.</>
                      )}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={runPreview}
                      className="min-h-11 pointer-fine:sm:min-h-9"
                      data-testid="button-review-new-count"
                    >
                      <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                      Review the new count
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {commit.isError && !isConflict && commitDefinitelyNotSaved(commit.error) && (
                <Alert variant="destructive" data-testid="commit-error">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>Nothing was saved</AlertTitle>
                  <AlertDescription className="space-y-1">
                    <p>{serverMessageOf(commit.error) ?? "The list couldn't be saved."}</p>
                    {/* A 4xx is a refusal — repeating it changes nothing. Only
                        the county source failing (502) is worth a retry. */}
                    {isTransientListBuilderFailure(commit.error) && <p>Try again in a moment.</p>}
                  </AlertDescription>
                </Alert>
              )}
              {commit.isError && !isConflict && !commitDefinitelyNotSaved(commit.error) && (
                <Alert variant="destructive" data-testid="commit-unconfirmed">
                  <AlertCircle className="h-4 w-4" aria-hidden="true" />
                  <AlertTitle>We couldn't confirm the save</AlertTitle>
                  <AlertDescription>
                    The save may or may not have gone through. Check Your lists below before saving again — saving
                    again from this count won't create a second copy.
                  </AlertDescription>
                </Alert>
              )}
              {commit.isSuccess && commit.data && (
                <Alert data-testid="commit-success">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  <AlertDescription className="space-y-1">
                    <p>
                      Saved {formatCount(commit.data.total)} leads ({formatCount(commit.data.created)} new,{" "}
                      {formatCount(commit.data.linkedExisting)} already yours).
                    </p>
                    {commit.data.attribution && (
                      <p className="text-xs text-muted-foreground" data-testid="commit-attribution">
                        {commit.data.attribution}
                      </p>
                    )}
                    <Link
                      href={leadsHrefForList(commit.data.listId)}
                      className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      data-testid="link-saved-list-leads"
                    >
                      View these leads
                    </Link>
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </section>
      )}

      <YourLists onStart={() => stateTriggerRef.current?.focus()} />
    </div>
  );
}

// ── Sheet ───────────────────────────────────────────────────────────

export interface ListBuilderSheetProps extends ListBuilderPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ListBuilderSheet({ open, onOpenChange, initialState }: ListBuilderSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" data-testid="list-builder-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <ListPlus className="h-4 w-4" aria-hidden="true" />
            Build a list
          </SheetTitle>
          <SheetDescription>
            From a county's own public parcel records. You see the exact count, who's already in your leads, and what
            will be saved before anything is.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-5">{open && <ListBuilderPanel initialState={initialState} />}</div>
      </SheetContent>
    </Sheet>
  );
}
