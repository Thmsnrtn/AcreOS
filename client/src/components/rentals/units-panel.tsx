/**
 * UNITS — the rentable-slot inventory, as a surface an operator can actually
 * use. Rendered as the "Units" tab of `/leases` (see client/src/pages/leases.tsx).
 *
 * WHERE THIS LIVES, AND WHY THERE
 * ───────────────────────────────
 * Behind the EXISTING Rentals surface set, as a TAB on
 * `/leases`. It adds no route and no nav entry. The customer nav is exactly five
 * doors (Today · Map · Deals · Finance · Pax) and "no new top-level nav entries
 * EVER" is a standing founder hard-stop — the Rentals module is an existing
 * `businessTypeOnly` module, and a new surface has to hang off one of its pages
 * as a child/section/tab. `/leases` is the right host: it is the page that
 * already speaks in unit labels, already reads
 * `GET /api/rentals/properties/:id/units` for its label suggestions, and is the
 * page an operator is on when they discover their inventory is not modelled.
 *
 * WHAT WAS BROKEN
 * ───────────────
 * `rental_units` shipped with full CRUD, a `kind` discriminator enumerating
 * unit | pad | suite, and NO client that could reach any of it. The only
 * client-side use of the units endpoint anywhere in the repo was a `<datalist>`
 * of label suggestions. Consequently:
 *
 *   - Nothing in the product ever wrote `kind: 'pad'`. All three insert paths
 *     took the 'unit' default, so a mobile-home park's ground leases were
 *     modelled as apartments. shared/business-types.ts said it exactly: "A
 *     column that can hold a value is not an inventory an operator has."
 *   - `computeOccupancySnapshot` answers `measurable: false, reason:
 *     "no_units_modelled"` and tells the operator to "add units to a property".
 *     There was no screen on which to do that.
 *
 * VOCABULARY IS NOT DECORATION
 * ────────────────────────────
 * A park operator manages PADS (or lots) — the resident owns the home and rents
 * the ground. A commercial operator manages SUITES. Every noun on this panel
 * comes from `unitVocabulary(kind)` in @shared/rental/unitInventory, so the
 * discriminator reaches the words on the screen instead of stopping at the
 * column. Calling a park's lots "units" tells the operator this product was not
 * built for them.
 *
 * REFUSE, DON'T FABRICATE
 * ───────────────────────
 * Bedrooms, baths, square feet and asking rent are nullable and render as "—"
 * when unset. Bulk create deliberately accepts NO physical facts: 60 pads do
 * not share a bedroom count, and stamping one on all of them would be
 * fabrication at scale. `kind` is never inferred from a property's structure
 * type or from label text.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Building2, LayoutGrid, Plus, Layers, Upload } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { queryClient, fetchJsonArray } from "@/lib/queryClient";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { Verbs } from "@/lib/labels";

import {
  expandUnitLabels,
  unitVocabulary,
  dominantUnitVocabulary,
  describeBulkCreateReport,
  countUnits,
  UNIT_KIND_OPTIONS,
  UNIT_BULK_MAX_LABELS,
  parseRentRollPaste,
  type UnitBulkCreateReport,
} from "@shared/rental/unitInventory";
import { RENTAL_UNIT_STATUSES, type RentalUnitKind, type RentalUnitStatus } from "@shared/constants/rental";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

interface UnitRow {
  id: string;
  label: string;
  kind: RentalUnitKind;
  status: RentalUnitStatus;
  bedrooms: number | null;
  bathrooms: string | null;
  squareFeet: number | null;
  marketRentCents: number | null;
  notes: string | null;
  leaseCount: number;
  activeLeaseCount: number;
}

interface PropertySummary {
  id: number;
  address: string | null;
  city: string | null;
  state: string | null;
  apn: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

/** Integer cents → "$1,234.56". Never a float — this is a rent figure. */
function centsExact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  return `${cents < 0 ? "−" : ""}$${whole}.${String(abs % 100).padStart(2, "0")}`;
}

/** Dollars typed by a human → integer cents, or undefined when left blank. */
function dollarsToCents(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100);
}

function intOrUndefined(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function floatOrUndefined(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function propertyName(p: PropertySummary): string {
  const line = [p.address, p.city, p.state].filter(Boolean).join(", ");
  return line !== "" ? `#${p.id} · ${line}` : `#${p.id} · APN ${p.apn ?? "—"}`;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: csrf(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // The server's refusals here are sentences an operator has to READ — a
    // duplicate label, a range that ends before it starts, a unit that still
    // has a tenant on it. "Failed (400)" throws all of that away.
    const parsedBody = await res.json().catch(() => null);
    throw new Error(parsedBody?.message || parsedBody?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function sendJson<T>(url: string, method: "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: csrf(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const parsedBody = await res.json().catch(() => null);
    throw new Error(parsedBody?.message || parsedBody?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

const STATUS_COPY: Record<RentalUnitStatus, { label: string; help: string }> = {
  active: { label: "Active", help: "Rentable today — counts in both occupancy denominators." },
  offline: {
    label: "Offline",
    help: "Exists but cannot be rented right now (fire, mid-renovation). Out of “could have leased”, still owned.",
  },
  retired: {
    label: "Retired",
    help: "No longer a rentable slot (combined into another, demolished). Keeps its history.",
  },
};

function statusTone(s: RentalUnitStatus): "default" | "secondary" | "outline" {
  if (s === "active") return "secondary";
  if (s === "offline") return "default";
  return "outline";
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function UnitsPanel() {
  const { toast } = useToast();
  const [propertyId, setPropertyId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);

  const propsQuery = useQuery<PropertySummary[]>({
    queryKey: ["/api/properties", "units-panel"],
    queryFn: () => fetchJsonArray<PropertySummary>("/api/properties?pageSize=200"),
  });

  const propertyIdNum = Number.parseInt(propertyId, 10);
  const hasProperty = Number.isFinite(propertyIdNum) && propertyIdNum > 0;

  const unitsQuery = useQuery<{ units: UnitRow[]; count: number }>({
    queryKey: ["/api/rentals/properties", propertyIdNum, "units"],
    enabled: hasProperty,
    queryFn: async () => {
      const res = await fetch(`/api/rentals/properties/${propertyIdNum}/units`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const units = unitsQuery.data?.units ?? [];
  // The words this property is spoken about in. A property whose rows are all
  // pads is a park; a mixed property falls back to the neutral noun rather than
  // mislabelling the minority.
  const vocab = useMemo(() => dominantUnitVocabulary(units.map((u) => u.kind)), [units]);

  const occupied = units.filter((u) => u.activeLeaseCount > 0).length;
  const rentable = units.filter((u) => u.status === "active").length;

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/rentals/properties", propertyIdNum, "units"] });
    // Occupancy is computed over these rows, so it is stale the moment one changes.
    queryClient.invalidateQueries({ queryKey: ["/api/rent-roll/occupancy"] });
  }

  // allow-no-invalidation: onSuccess calls refresh(), which invalidates both
  // this property's unit list and the occupancy snapshot computed over it.
  const retire = useMutation({
    mutationFn: (unit: UnitRow) =>
      sendJson<{ unit: UnitRow }>(`/api/rentals/units/${unit.id}`, "PATCH", { status: "retired" }),
    onSuccess: () => {
      toast({ title: `${vocab.titleSingular} retired`, description: "It keeps its lease history and leaves the occupancy denominator." });
      refresh();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  // allow-no-invalidation: onSuccess calls refresh() — see above.
  const remove = useMutation({
    mutationFn: (unit: UnitRow) => sendJson<{ deleted: boolean }>(`/api/rentals/units/${unit.id}`, "DELETE"),
    onSuccess: () => {
      toast({ title: `${vocab.titleSingular} deleted` });
      refresh();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6" data-testid="units-panel">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-primary" aria-hidden="true" />
            Rentable slots
          </CardTitle>
          <CardDescription>
            One row per thing you can rent. Occupancy is computed over these rows, so a
            {" "}{vocab.singular} nobody has ever leased still has to exist here — that is exactly
            the vacancy a lease-derived count could never see.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <Label htmlFor="units-property" className="text-xs">Property</Label>
              {propsQuery.isLoading ? (
                <Skeleton className="h-9 mt-1" />
              ) : (
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger id="units-property" className="h-9 mt-1" aria-label="Choose a property">
                    <SelectValue placeholder="Choose a property…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(propsQuery.data ?? []).map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{propertyName(p)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!hasProperty} onClick={() => setCreateOpen(true)} data-testid="button-add-unit">
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                Add one
              </Button>
              <Button size="sm" variant="outline" disabled={!hasProperty} onClick={() => setBulkOpen(true)} data-testid="button-bulk-add-units">
                <Layers className="w-4 h-4 mr-1" aria-hidden="true" />
                Add in bulk
              </Button>
              <Button size="sm" variant="outline" disabled={!hasProperty} onClick={() => setImportOpen(true)} data-testid="button-import-rent-roll">
                <Upload className="w-4 h-4 mr-1" aria-hidden="true" />
                Import rent roll
              </Button>
            </div>
          </div>

          {!hasProperty ? (
            <EmptyState
              icon={Building2}
              headline="Pick a property"
              subtitle="Slots belong to a building, and the building is the property record — there is no separate building table. Choose one to see, add or retire its rentable slots."
              framed
              /* TODO(cta): the action IS the property select directly above; a
                 second button would just re-point at it. */
              cta={{ label: "", _noOp: true }}
              testId="units-no-property"
            />
          ) : unitsQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : unitsQuery.isError ? (
            <QueryErrorState
              error={unitsQuery.error instanceof Error ? unitsQuery.error : null}
              onRetry={() => unitsQuery.refetch()}
              isRetrying={unitsQuery.isRefetching}
              compact
              title="Couldn't load this property's slots"
              description="We hit a snag reading the unit list. Your data is safe — try again."
              testId="units-query-error"
            />
          ) : units.length === 0 ? (
            <EmptyState
              icon={LayoutGrid}
              headline="Nothing modelled on this property yet"
              subtitle={`Until a slot exists here, occupancy for this building cannot be computed at all — an empty ${vocab.singular} has no lease, so a lease-derived count cannot see it. Add them one at a time, or paste the whole list.`}
              framed
              cta={{ label: `Add ${vocab.plural} in bulk`, onClick: () => setBulkOpen(true), "data-testid": "units-empty-cta" }}
              secondaryCta={{ label: `Add one ${vocab.singular}`, onClick: () => setCreateOpen(true) }}
              testId="units-empty"
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span><strong className="text-foreground tabular-nums">{units.length}</strong> modelled</span>
                <span><strong className="text-foreground tabular-nums">{rentable}</strong> rentable</span>
                <span><strong className="text-foreground tabular-nums">{occupied}</strong> occupied</span>
                <span><strong className="text-foreground tabular-nums">{Math.max(0, rentable - occupied)}</strong> vacant</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{vocab.titlePlural} on this property</caption>
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                      <th scope="col" className="px-3 py-2 text-left font-medium">Label</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Kind</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Occupancy</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Beds</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Baths</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Sq ft</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Asking rent</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <motion.tbody variants={staggerContainer} initial="hidden" animate="visible">
                    {units.map((u) => {
                      const uv = unitVocabulary(u.kind);
                      return (
                        <motion.tr key={u.id} variants={staggerItem} className="border-b border-border/40" data-testid={`row-unit-${u.id}`}>
                          <td className="px-3 py-2 font-medium">{u.label}</td>
                          <td className="px-3 py-2 text-muted-foreground">{uv.titleSingular}</td>
                          <td className="px-3 py-2">
                            <Badge variant={statusTone(u.status)} className="text-xs">{STATUS_COPY[u.status].label}</Badge>
                          </td>
                          <td className="px-3 py-2">
                            {u.activeLeaseCount > 0 ? (
                              <span className="text-xs">Occupied</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">Vacant</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{u.bedrooms ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{u.bathrooms ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{u.squareFeet?.toLocaleString("en-US") ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{centsExact(u.marketRentCents)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              onClick={() => setEditing(u)}
                              aria-label={`Edit ${uv.singular} ${u.label}`}
                            >
                              {Verbs.EDIT}
                            </Button>
                            {u.status !== "retired" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                disabled={retire.isPending}
                                onClick={() => retire.mutate(u)}
                                aria-label={`Retire ${uv.singular} ${u.label}`}
                              >
                                Retire
                              </Button>
                            )}
                            {u.leaseCount === 0 && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-destructive"
                                disabled={remove.isPending}
                                onClick={() => remove.mutate(u)}
                                aria-label={`Delete ${uv.singular} ${u.label}`}
                              >
                                {Verbs.DELETE}
                              </Button>
                            )}
                          </td>
                        </motion.tr>
                      );
                    })}
                  </motion.tbody>
                </table>
              </div>

              <p className="text-micro text-muted-foreground">
                Retiring keeps a slot's lease history and takes it out of the occupancy denominator.
                Delete only appears while a slot has never been leased — deleting a leased one would
                unlink a live tenancy and the {vocab.singular} would read vacant with somebody living in it.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {hasProperty && (
        <>
          <CreateUnitDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            propertyId={propertyIdNum}
            onDone={refresh}
          />
          <BulkCreateDialog
            open={bulkOpen}
            onOpenChange={setBulkOpen}
            propertyId={propertyIdNum}
            onDone={refresh}
          />
          <RentRollImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            propertyId={propertyIdNum}
            onDone={refresh}
          />
          <EditUnitDialog
            unit={editing}
            onOpenChange={(open) => { if (!open) setEditing(null); }}
            onDone={refresh}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kind picker — shared by every writer on this panel.
// ---------------------------------------------------------------------------

function KindSelect({
  id, value, onChange, disabled,
}: {
  id: string;
  value: RentalUnitKind;
  onChange: (v: RentalUnitKind) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">Kind</Label>
      <Select value={value} onValueChange={(v) => onChange(v as RentalUnitKind)} disabled={disabled}>
        <SelectTrigger id={id} className="h-9 mt-1" aria-label="What kind of rentable slot this is">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNIT_KIND_OPTIONS.map((k) => (
            <SelectItem key={k.kind} value={k.kind}>
              {k.titleSingular} — {k.description}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StatusSelect({
  id, value, onChange,
}: {
  id: string;
  value: RentalUnitStatus;
  onChange: (v: RentalUnitStatus) => void;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">Status</Label>
      <Select value={value} onValueChange={(v) => onChange(v as RentalUnitStatus)}>
        <SelectTrigger id={id} className="h-9 mt-1" aria-label="Rentable status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RENTAL_UNIT_STATUSES.map((s) => (
            <SelectItem key={s} value={s}>{STATUS_COPY[s].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-micro text-muted-foreground mt-1">{STATUS_COPY[value].help}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create one
// ---------------------------------------------------------------------------

function CreateUnitDialog({
  open, onOpenChange, propertyId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<RentalUnitKind>("unit");
  const [status, setStatus] = useState<RentalUnitStatus>("active");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [squareFeet, setSquareFeet] = useState("");
  const [rent, setRent] = useState("");
  const vocab = unitVocabulary(kind);

  // allow-no-invalidation: onSuccess calls the panel's onDone(), which
  // invalidates the unit list and the occupancy snapshot.
  const create = useMutation({
    mutationFn: () =>
      postJson<{ unit: UnitRow }>(`/api/rentals/properties/${propertyId}/units`, {
        label,
        kind,
        status,
        bedrooms: intOrUndefined(bedrooms),
        bathrooms: floatOrUndefined(bathrooms),
        squareFeet: intOrUndefined(squareFeet),
        marketRentCents: dollarsToCents(rent),
      }),
    onSuccess: () => {
      toast({ title: `${vocab.titleSingular} "${label.trim()}" added` });
      setLabel(""); setBedrooms(""); setBathrooms(""); setSquareFeet(""); setRent("");
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a {vocab.singular}</DialogTitle>
          <DialogDescription>
            The label is the slot's identity — it has to match the lease, the mailbox and the work
            order, so it is stored exactly as you type it (trimmed) and never re-punctuated.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="unit-label" className="text-xs">Label *</Label>
            <Input
              id="unit-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-9 mt-1"
              placeholder={vocab.labelExample}
              autoComplete="off"
            />
          </div>
          <KindSelect id="unit-kind" value={kind} onChange={setKind} />
          <div className="sm:col-span-2">
            <StatusSelect id="unit-status" value={status} onChange={setStatus} />
          </div>
          <div>
            <Label htmlFor="unit-bedrooms" className="text-xs">Bedrooms</Label>
            <Input id="unit-bedrooms" type="number" min={0} value={bedrooms} onChange={(e) => setBedrooms(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label htmlFor="unit-bathrooms" className="text-xs">Bathrooms</Label>
            <Input id="unit-bathrooms" type="number" min={0} step="0.5" value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label htmlFor="unit-sqft" className="text-xs">Square feet</Label>
            <Input id="unit-sqft" type="number" min={0} value={squareFeet} onChange={(e) => setSquareFeet(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label htmlFor="unit-rent" className="text-xs">Asking rent ($/mo)</Label>
            <Input id="unit-rent" type="number" min={0} value={rent} onChange={(e) => setRent(e.target.value)} className="h-9 mt-1" />
          </div>
          <p className="sm:col-span-2 text-micro text-muted-foreground">
            Leave anything you have not measured blank. It renders as “—”, never as a number
            inferred from the building — quoting the structure's square footage on a
            {" "}{vocab.singular} listing is a misrepresentation to an applicant. Asking rent is what
            makes loss-to-lease and the dollar cost of a vacant day computable.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{Verbs.CANCEL}</Button>
          <Button disabled={label.trim() === "" || create.isPending} onClick={() => create.mutate()} data-testid="button-create-unit-submit">
            Add {vocab.singular}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit one
// ---------------------------------------------------------------------------

function EditUnitDialog({
  unit, onOpenChange, onDone,
}: {
  unit: UnitRow | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  // Keyed remount (see the `key` on the caller-side element below) is avoided
  // by deriving initial state from the unit each time it changes.
  const [draft, setDraft] = useState<UnitRow | null>(null);
  const active = unit !== null;
  const current = draft && unit && draft.id === unit.id ? draft : unit;
  const vocab = unitVocabulary(current?.kind);

  // allow-no-invalidation: onSuccess calls the panel's onDone(), which
  // invalidates the unit list and the occupancy snapshot.
  const save = useMutation({
    mutationFn: () => {
      if (!current) throw new Error("Nothing to save");
      return sendJson<{ unit: UnitRow }>(`/api/rentals/units/${current.id}`, "PATCH", {
        label: current.label,
        kind: current.kind,
        status: current.status,
        bedrooms: current.bedrooms ?? undefined,
        bathrooms: current.bathrooms !== null ? Number.parseFloat(current.bathrooms) : undefined,
        squareFeet: current.squareFeet ?? undefined,
        marketRentCents: current.marketRentCents ?? undefined,
      });
    },
    onSuccess: () => {
      toast({ title: `${vocab.titleSingular} saved`, description: "Any lease pointing at it shows the new label too." });
      setDraft(null);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  function patch(next: Partial<UnitRow>) {
    if (!current) return;
    setDraft({ ...current, ...next });
  }

  return (
    <Dialog open={active} onOpenChange={(o) => { if (!o) setDraft(null); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {current ? `“${current.label}”` : vocab.singular}</DialogTitle>
          <DialogDescription>
            Renaming updates the display label on every lease pointing at this {vocab.singular},
            so a work order can't be dispatched to the old door number.
          </DialogDescription>
        </DialogHeader>

        {current && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="edit-unit-label" className="text-xs">Label *</Label>
              <Input id="edit-unit-label" value={current.label} onChange={(e) => patch({ label: e.target.value })} className="h-9 mt-1" autoComplete="off" />
            </div>
            <KindSelect id="edit-unit-kind" value={current.kind} onChange={(k) => patch({ kind: k })} />
            <div className="sm:col-span-2">
              <StatusSelect id="edit-unit-status" value={current.status} onChange={(s) => patch({ status: s })} />
            </div>
            <div>
              <Label htmlFor="edit-unit-bedrooms" className="text-xs">Bedrooms</Label>
              <Input
                id="edit-unit-bedrooms" type="number" min={0}
                value={current.bedrooms ?? ""}
                onChange={(e) => patch({ bedrooms: intOrUndefined(e.target.value) ?? null })}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-unit-bathrooms" className="text-xs">Bathrooms</Label>
              <Input
                id="edit-unit-bathrooms" type="number" min={0} step="0.5"
                value={current.bathrooms ?? ""}
                onChange={(e) => patch({ bathrooms: e.target.value.trim() === "" ? null : e.target.value })}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-unit-sqft" className="text-xs">Square feet</Label>
              <Input
                id="edit-unit-sqft" type="number" min={0}
                value={current.squareFeet ?? ""}
                onChange={(e) => patch({ squareFeet: intOrUndefined(e.target.value) ?? null })}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-unit-rent" className="text-xs">Asking rent ($/mo)</Label>
              <Input
                id="edit-unit-rent" type="number" min={0}
                value={current.marketRentCents !== null ? String(current.marketRentCents / 100) : ""}
                onChange={(e) => patch({ marketRentCents: dollarsToCents(e.target.value) ?? null })}
                className="h-9 mt-1"
              />
            </div>
            {current.activeLeaseCount > 0 && (
              <p className="sm:col-span-2 text-micro text-muted-foreground">
                Somebody lives here right now ({countUnits(current.activeLeaseCount, vocab)} active
                lease{current.activeLeaseCount === 1 ? "" : "s"}). Asking rent is what you would
                quote today — it is not what the sitting tenant pays, and changing it does not touch
                their lease.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { setDraft(null); onOpenChange(false); }}>{Verbs.CANCEL}</Button>
          <Button
            disabled={!current || current.label.trim() === "" || save.isPending}
            onClick={() => save.mutate()}
            data-testid="button-edit-unit-submit"
          >
            {Verbs.SAVE}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bulk create
// ---------------------------------------------------------------------------

function BulkCreateDialog({
  open, onOpenChange, propertyId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"range" | "list">("range");
  const [kind, setKind] = useState<RentalUnitKind>("unit");
  const [status, setStatus] = useState<RentalUnitStatus>("active");
  const [prefix, setPrefix] = useState("Lot ");
  const [suffix, setSuffix] = useState("");
  const [start, setStart] = useState("1");
  const [end, setEnd] = useState("60");
  const [padTo, setPadTo] = useState("0");
  const [text, setText] = useState("");
  const [report, setReport] = useState<UnitBulkCreateReport | null>(null);

  const vocab = unitVocabulary(kind);

  const spec = useMemo(() => (
    mode === "range"
      ? {
          mode: "range" as const,
          prefix,
          suffix,
          start: Number.parseInt(start, 10),
          end: Number.parseInt(end, 10),
          padTo: Number.parseInt(padTo, 10) || 0,
        }
      : { mode: "list" as const, text }
  ), [mode, prefix, suffix, start, end, padTo, text]);

  // PREVIEW, from the same pure function the server expands with. The operator
  // sees the exact labels before anything is written; the server re-expands the
  // SPEC rather than trusting a client-sent array, so preview and write cannot
  // diverge.
  const preview = useMemo(() => expandUnitLabels(spec), [spec]);

  // allow-no-invalidation: onSuccess calls the panel's onDone(), which
  // invalidates the unit list and the occupancy snapshot.
  const create = useMutation({
    mutationFn: () =>
      postJson<UnitBulkCreateReport & { propertyId: number; kind: RentalUnitKind }>(
        `/api/rentals/properties/${propertyId}/units/bulk`,
        { spec, kind, status },
      ),
    onSuccess: (result) => {
      setReport(result);
      toast({ title: "Bulk create finished", description: describeBulkCreateReport(result, vocab) });
      onDone();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setReport(null); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add {vocab.plural} in bulk</DialogTitle>
          <DialogDescription>
            Safe to run twice. Labels are unique per property, so a re-run creates only what is
            missing and reports what was already there — it never duplicates a slot and never
            overwrites one you have edited.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <KindSelect id="bulk-kind" value={kind} onChange={setKind} />
          <StatusSelect id="bulk-status" value={status} onChange={setStatus} />

          <div className="sm:col-span-2">
            <Label htmlFor="bulk-mode" className="text-xs">How</Label>
            <Select value={mode} onValueChange={(v) => { setMode(v as "range" | "list"); setReport(null); }}>
              <SelectTrigger id="bulk-mode" className="h-9 mt-1" aria-label="Bulk entry method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="range">A numbered range — “{vocab.rangePrefixExample}1” to “{vocab.rangePrefixExample}60”</SelectItem>
                <SelectItem value="list">A pasted list of labels</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === "range" ? (
            <>
              <div>
                <Label htmlFor="bulk-prefix" className="text-xs">Prefix</Label>
                <Input id="bulk-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} className="h-9 mt-1" placeholder={vocab.rangePrefixExample} />
              </div>
              <div>
                <Label htmlFor="bulk-suffix" className="text-xs">Suffix</Label>
                <Input id="bulk-suffix" value={suffix} onChange={(e) => setSuffix(e.target.value)} className="h-9 mt-1" placeholder="(none)" />
              </div>
              <div>
                <Label htmlFor="bulk-start" className="text-xs">From</Label>
                <Input id="bulk-start" type="number" min={0} value={start} onChange={(e) => setStart(e.target.value)} className="h-9 mt-1" />
              </div>
              <div>
                <Label htmlFor="bulk-end" className="text-xs">To</Label>
                <Input id="bulk-end" type="number" min={0} value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 mt-1" />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="bulk-pad" className="text-xs">Zero-pad numbers to</Label>
                <Input id="bulk-pad" type="number" min={0} max={8} value={padTo} onChange={(e) => setPadTo(e.target.value)} className="h-9 mt-1" />
                <p className="text-micro text-muted-foreground mt-1">
                  0 for none. Pad to 3 and “{vocab.rangePrefixExample}7” becomes
                  “{vocab.rangePrefixExample}007”, so it sorts next to 008 instead of after 70.
                </p>
              </div>
            </>
          ) : (
            <div className="sm:col-span-2">
              <Label htmlFor="bulk-list" className="text-xs">Labels</Label>
              <Textarea
                id="bulk-list"
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="mt-1 font-mono text-xs"
                rows={7}
                placeholder={`${vocab.labelExample}\n…one per line (commas and semicolons also split)`}
                aria-describedby="bulk-list-help"
              />
              <p id="bulk-list-help" className="text-micro text-muted-foreground mt-1">
                Up to {UNIT_BULK_MAX_LABELS} at a time. Blank lines are ignored; a label repeated in
                the paste is attempted once and called out below.
              </p>
            </div>
          )}

          <div className="sm:col-span-2 rounded-md border border-border bg-muted/30 p-3" aria-live="polite">
            {!preview.ok ? (
              <p className="text-xs text-acr-warning" data-testid="bulk-preview-error">{preview.error}</p>
            ) : (
              <div className="text-xs space-y-1" data-testid="bulk-preview">
                <p>
                  <strong className="tabular-nums">{preview.expansion.labels.length}</strong>{" "}
                  {preview.expansion.labels.length === 1 ? vocab.singular : vocab.plural} will be attempted:{" "}
                  <span className="font-mono">
                    {preview.expansion.labels.slice(0, 4).join(", ")}
                    {preview.expansion.labels.length > 4
                      ? ` … ${preview.expansion.labels[preview.expansion.labels.length - 1]}`
                      : ""}
                  </span>
                </p>
                {preview.expansion.duplicateLabels.length > 0 && (
                  <p className="text-muted-foreground">
                    Repeated in your input (attempted once):{" "}
                    <span className="font-mono">{preview.expansion.duplicateLabels.join(", ")}</span>
                  </p>
                )}
              </div>
            )}
          </div>

          {report && (
            <div className="sm:col-span-2 rounded-md border border-border p-3 text-xs space-y-1" data-testid="bulk-result">
              <p className="font-medium">{describeBulkCreateReport(report, vocab)}</p>
              {report.existedCount > 0 && (
                <p className="text-muted-foreground">
                  Already there:{" "}
                  <span className="font-mono">{report.existed.slice(0, 12).join(", ")}{report.existed.length > 12 ? " …" : ""}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setReport(null); onOpenChange(false); }}>Close</Button>
          <Button
            disabled={!preview.ok || create.isPending}
            onClick={() => create.mutate()}
            data-testid="button-bulk-create-submit"
          >
            {Verbs.CREATE} {preview.ok ? countUnits(preview.expansion.labels.length, vocab) : vocab.plural}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Rent-roll import
// ---------------------------------------------------------------------------
//
// `POST /api/parcels/:id/rent-roll/preview` and `.../import` have existed since
// BH-3 and had ZERO callers anywhere in the repo — the classic "built but
// unwired" defect. Its payload already carries `unitKind`, which is the only
// path in the product by which a whole park's worth of PADS can be created in
// one action. Unwired, that was a column that could hold a value rather than an
// inventory an operator has.
//
// The parser below is deliberately dumb: comma-separated columns in a fixed
// order, previewed row-by-row before anything is sent. It does not sniff
// headers or guess column meanings — a mis-guessed column here would silently
// write the wrong rent onto somebody's tenancy.

function RentRollImportDialog({
  open, onOpenChange, propertyId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [kind, setKind] = useState<RentalUnitKind>("unit");
  const [state, setState] = useState("TX");
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const vocab = unitVocabulary(kind);
  const parsed = useMemo(() => parseRentRollPaste(text), [text]);

  // allow-no-invalidation: onSuccess calls the panel's onDone(), which
  // invalidates the unit list and the occupancy snapshot.
  const run = useMutation({
    mutationFn: () =>
      postJson<Record<string, unknown>>(`/api/parcels/${propertyId}/rent-roll/import`, {
        state: state.toUpperCase(),
        // The roll-level default for every row that does not carry its own
        // kind. This is the field that finally lets a park be imported AS a
        // park instead of as 60 apartments.
        unitKind: kind,
        units: parsed.rows,
      }),
    onSuccess: (result) => {
      setSummary(result);
      toast({
        title: "Rent roll imported",
        description: `${result.createdUnits ?? 0} new ${vocab.plural}, ${result.existingUnits ?? 0} already there.`,
      });
      onDone();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setSummary(null); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a seller's rent roll</DialogTitle>
          <DialogDescription>
            Creates the slots, the tenants and their leases in one pass. Vacant rows are kept —
            they are exactly the rows occupancy needs and the ones a lease-only model throws away.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <KindSelect id="import-kind" value={kind} onChange={setKind} />
          <div>
            <Label htmlFor="import-state" className="text-xs">State *</Label>
            <Input
              id="import-state"
              value={state}
              onChange={(e) => setState(e.target.value.slice(0, 2))}
              className="h-9 mt-1"
              maxLength={2}
              aria-describedby="import-state-help"
            />
            <p id="import-state-help" className="text-micro text-muted-foreground mt-1">
              Two letters. Drives the statutory late-fee rule on every lease created here.
            </p>
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="import-rows" className="text-xs">Rows</Label>
            <Textarea
              id="import-rows"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="mt-1 font-mono text-xs"
              rows={8}
              placeholder={`${vocab.labelExample}, Maria, Lopez, 1400\n${vocab.labelExample.replace(/\d+$/, "15")}, , , 1350`}
              aria-describedby="import-rows-help"
            />
            <p id="import-rows-help" className="text-micro text-muted-foreground mt-1">
              One row per {vocab.singular}: <span className="font-mono">label, tenant first, tenant last, monthly rent</span>.
              Leave both name columns empty for a vacant {vocab.singular} — its rent is then read as
              the ASKING rent. On an occupied row the rent is what the sitting tenant pays, and it is
              never copied to asking rent. Write rent without a thousands separator (1400, not
              1,400) — the comma is the column separator, and a row that splits into five columns is
              refused rather than read as $1.
            </p>
          </div>

          <div className="sm:col-span-2 rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1" aria-live="polite">
            {parsed.errors.length > 0 && (
              <p className="text-acr-warning" data-testid="import-parse-errors">{parsed.errors.join(" ")}</p>
            )}
            <p data-testid="import-preview">
              <strong className="tabular-nums">{parsed.rows.length}</strong> rows ·{" "}
              <strong className="tabular-nums">{parsed.rows.filter((r) => r.isVacant).length}</strong> vacant
            </p>
          </div>

          {summary && (
            <div className="sm:col-span-2 rounded-md border border-border p-3 text-xs" data-testid="import-result">
              <p>
                {String(summary.createdUnits ?? 0)} new {vocab.plural}, {String(summary.existingUnits ?? 0)} already there,{" "}
                {String(summary.createdLeases ?? 0)} leases, {String(summary.createdTenants ?? 0)} tenants.
              </p>
              {Array.isArray(summary.skippedRows) && summary.skippedRows.length > 0 && (
                <p className="text-muted-foreground mt-1">
                  {summary.skippedRows.length} rows produced no tenancy — the server names each reason
                  rather than swallowing them.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setSummary(null); onOpenChange(false); }}>Close</Button>
          <Button
            // A refused row is DROPPED, so importing with errors present would
            // quietly bring in fewer tenancies than the operator pasted. Fix
            // the named lines first.
            disabled={parsed.rows.length === 0 || parsed.errors.length > 0 || state.trim().length !== 2 || run.isPending}
            onClick={() => run.mutate()}
            data-testid="button-import-rent-roll-submit"
          >
            {Verbs.IMPORT} {parsed.rows.length} rows
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
