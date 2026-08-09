/**
 * EXPENSES — the operating-cost ledger, as a surface an operator can use.
 * Rendered as the "Expenses" tab of `/leases` (see client/src/pages/leases.tsx).
 *
 * WHERE THIS LIVES, AND WHY THERE
 * ───────────────────────────────
 * A TAB on `/leases`, behind the Rentals module. It adds no route and no nav entry
 * — the customer nav is exactly five doors and "no new top-level nav entries
 * EVER" is a standing founder hard-stop, so a new surface hangs off an existing
 * page. `/leases` is the right host: it is the rentals surface an operator is
 * already on when they think about a building's money.
 *
 * WHAT IT IS FOR
 * ──────────────
 * NOI needs an expense axis and the product had none, so NOI was ASSUMED (a flat
 * ~40%-of-rent guess). This panel is where the operator records what they
 * ACTUALLY spent — Schedule-E-shaped categories, the vocabulary they keep their
 * books in — so the number can be built from facts. Two categories
 * (mortgage_interest, depreciation) are stored for tax completeness but are
 * NON-operating; the server decides that, and the panel labels it.
 *
 * MONEY POSTURE (founder ruling "be the rail, not the provider")
 * ──────────────────────────────────────────────────────────────
 * This is a LEDGER of money already spent, on the operator's own account,
 * elsewhere. Nothing here moves, holds or collects a cent — every verb is
 * "record", never "pay". The amount is a recorded fact.
 *
 * REFUSE, DON'T FABRICATE
 * ───────────────────────
 * Vendor, description and unit are optional and render as "—" when unset. The
 * maintenance roll-in reports created-vs-existed so a re-run reads as "0 new"
 * and an operator never comes to believe a repair was spent twice.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Building2, Receipt, Plus, DownloadCloud } from "lucide-react";

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
  PROPERTY_EXPENSE_CATEGORIES,
  PROPERTY_EXPENSE_CATEGORY_LABELS,
  isOperatingCategory,
  type PropertyExpenseCategory,
  type PropertyExpenseSource,
} from "@shared/rental/propertyExpense";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

interface ExpenseRow {
  id: string;
  propertyId: number;
  unitId: string | null;
  category: PropertyExpenseCategory;
  amountCents: number;
  incurredOn: string;
  isOperating: boolean;
  source: PropertyExpenseSource;
  sourceRef: string | null;
  vendor: string | null;
  description: string | null;
  notes: string | null;
}

interface PropertySummary {
  id: number;
  address: string | null;
  city: string | null;
  state: string | null;
  apn: string | null;
}

interface BulkReport {
  attemptedCount: number;
  createdCount: number;
  existedCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

/** Integer cents → "$1,234.56". Never a float — this is a money figure. */
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

function propertyName(p: PropertySummary): string {
  const line = [p.address, p.city, p.state].filter(Boolean).join(", ");
  return line !== "" ? `#${p.id} · ${line}` : `#${p.id} · APN ${p.apn ?? "—"}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: csrf(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
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

function CategorySelect({
  id, value, onChange,
}: {
  id: string;
  value: PropertyExpenseCategory;
  onChange: (v: PropertyExpenseCategory) => void;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">Category *</Label>
      <Select value={value} onValueChange={(v) => onChange(v as PropertyExpenseCategory)}>
        <SelectTrigger id={id} className="h-9 mt-1" aria-label="Expense category (Schedule E line)">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROPERTY_EXPENSE_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {PROPERTY_EXPENSE_CATEGORY_LABELS[c]}
              {!isOperatingCategory(c) ? " (not in NOI)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isOperatingCategory(value) && (
        <p className="text-micro text-muted-foreground mt-1">
          Stored for your Schedule E, but a financing/non-cash line — it is kept OUT of net
          operating income.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function ExpensesPanel() {
  const { toast } = useToast();
  const [propertyId, setPropertyId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);

  const propsQuery = useQuery<PropertySummary[]>({
    queryKey: ["/api/properties", "expenses-panel"],
    queryFn: () => fetchJsonArray<PropertySummary>("/api/properties?pageSize=200"),
  });

  const propertyIdNum = Number.parseInt(propertyId, 10);
  const hasProperty = Number.isFinite(propertyIdNum) && propertyIdNum > 0;

  const expensesQuery = useQuery<{ expenses: ExpenseRow[]; count: number }>({
    queryKey: ["/api/properties", propertyIdNum, "expenses"],
    enabled: hasProperty,
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyIdNum}/expenses`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const expenses = expensesQuery.data?.expenses ?? [];

  // Operating total is the number that reaches NOI — the two non-operating
  // categories are summed separately so the operator can see both without one
  // silently inflating the other.
  const operatingCents = useMemo(
    () => expenses.filter((e) => e.isOperating).reduce((s, e) => s + e.amountCents, 0),
    [expenses],
  );
  const nonOperatingCents = useMemo(
    () => expenses.filter((e) => !e.isOperating).reduce((s, e) => s + e.amountCents, 0),
    [expenses],
  );

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/properties", propertyIdNum, "expenses"] });
  }

  // allow-no-invalidation: onSuccess calls refresh(), which invalidates this
  // property's expense list.
  const remove = useMutation({
    mutationFn: (expense: ExpenseRow) => sendJson<{ deleted: boolean }>(`/api/rentals/expenses/${expense.id}`, "DELETE"),
    onSuccess: () => {
      toast({ title: "Expense deleted" });
      refresh();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  return (
    <div className="space-y-6" data-testid="expenses-panel">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" aria-hidden="true" />
            Operating expenses
          </CardTitle>
          <CardDescription>
            What you actually spent on this building, in the same categories as your Schedule E.
            This is a ledger of money already spent on your own account — nothing here moves or
            collects a cent. Net operating income is built from the operating lines; mortgage
            interest and depreciation are stored but kept out of it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <Label htmlFor="expenses-property" className="text-xs">Property</Label>
              {propsQuery.isLoading ? (
                <Skeleton className="h-9 mt-1" />
              ) : (
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger id="expenses-property" className="h-9 mt-1" aria-label="Choose a property">
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
              <Button size="sm" disabled={!hasProperty} onClick={() => setCreateOpen(true)} data-testid="button-add-expense">
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
                Record one
              </Button>
              <Button size="sm" variant="outline" disabled={!hasProperty} onClick={() => setImportOpen(true)} data-testid="button-import-maintenance">
                <DownloadCloud className="w-4 h-4 mr-1" aria-hidden="true" />
                Roll in maintenance
              </Button>
            </div>
          </div>

          {!hasProperty ? (
            <EmptyState
              icon={Building2}
              headline="Pick a property"
              subtitle="Expenses are recorded against a building. Choose one to see, record or roll in its operating costs."
              framed
              cta={{ label: "", _noOp: true }}
              testId="expenses-no-property"
            />
          ) : expensesQuery.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : expensesQuery.isError ? (
            <QueryErrorState
              error={expensesQuery.error instanceof Error ? expensesQuery.error : null}
              onRetry={() => expensesQuery.refetch()}
              isRetrying={expensesQuery.isRefetching}
              compact
              title="Couldn't load this property's expenses"
              description="We hit a snag reading the expense ledger. Your data is safe — try again."
              testId="expenses-query-error"
            />
          ) : expenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              headline="No expenses recorded on this property yet"
              subtitle="Until you record what you spend, net operating income for this building is a guess. Record a cost, or roll in completed maintenance invoices."
              framed
              cta={{ label: "Record an expense", onClick: () => setCreateOpen(true), "data-testid": "expenses-empty-cta" }}
              secondaryCta={{ label: "Roll in maintenance", onClick: () => setImportOpen(true) }}
              testId="expenses-empty"
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span><strong className="text-foreground tabular-nums">{expenses.length}</strong> recorded</span>
                <span><strong className="text-foreground tabular-nums">{centsExact(operatingCents)}</strong> operating (in NOI)</span>
                <span><strong className="text-foreground tabular-nums">{centsExact(nonOperatingCents)}</strong> not in NOI</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Recorded expenses on this property</caption>
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                      <th scope="col" className="px-3 py-2 text-left font-medium">Date</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Category</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Vendor</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Description</th>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Source</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <motion.tbody variants={staggerContainer} initial="hidden" animate="visible">
                    {expenses.map((e) => (
                      <motion.tr key={e.id} variants={staggerItem} className="border-b border-border/40" data-testid={`row-expense-${e.id}`}>
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">{e.incurredOn}</td>
                        <td className="px-3 py-2">
                          <span>{PROPERTY_EXPENSE_CATEGORY_LABELS[e.category]}</span>
                          {!e.isOperating && (
                            <Badge variant="outline" className="ml-2 text-micro">not in NOI</Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{e.vendor ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{e.description ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {e.source === "maintenance_invoice" ? "Maintenance" : "Manual"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{centsExact(e.amountCents)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setEditing(e)}
                            aria-label={`Edit expense from ${e.incurredOn}`}
                          >
                            {Verbs.EDIT}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive"
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(e)}
                            aria-label={`Delete expense from ${e.incurredOn}`}
                          >
                            {Verbs.DELETE}
                          </Button>
                        </td>
                      </motion.tr>
                    ))}
                  </motion.tbody>
                </table>
              </div>

              <p className="text-micro text-muted-foreground">
                A maintenance-sourced row came from a completed ticket's invoice. Rolling maintenance
                in again is safe — it only adds tickets it hasn't already recorded, never the same one
                twice.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {hasProperty && (
        <>
          <RecordExpenseDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            propertyId={propertyIdNum}
            onDone={refresh}
          />
          <ImportMaintenanceDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            propertyId={propertyIdNum}
            onDone={refresh}
          />
          <EditExpenseDialog
            expense={editing}
            onOpenChange={(open) => { if (!open) setEditing(null); }}
            onDone={refresh}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record one
// ---------------------------------------------------------------------------

function RecordExpenseDialog({
  open, onOpenChange, propertyId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [category, setCategory] = useState<PropertyExpenseCategory>("repairs");
  const [amount, setAmount] = useState("");
  const [incurredOn, setIncurredOn] = useState(todayIso());
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");

  // allow-no-invalidation: onSuccess calls the panel's onDone(), which
  // invalidates this property's expense list.
  const create = useMutation({
    mutationFn: () =>
      postJson<{ expense: ExpenseRow }>(`/api/properties/${propertyId}/expenses`, {
        category,
        amountCents: dollarsToCents(amount),
        incurredOn,
        vendor: vendor.trim() || undefined,
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: "Expense recorded" });
      setAmount(""); setVendor(""); setDescription(""); setNotes("");
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  const amountValid = dollarsToCents(amount) !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
          <DialogDescription>
            Money you already spent on this building. It is recorded, not paid — nothing here moves
            funds.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <CategorySelect id="expense-category" value={category} onChange={setCategory} />
          </div>
          <div>
            <Label htmlFor="expense-amount" className="text-xs">Amount ($) *</Label>
            <Input id="expense-amount" type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label htmlFor="expense-date" className="text-xs">Incurred on *</Label>
            <Input id="expense-date" type="date" value={incurredOn} onChange={(e) => setIncurredOn(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label htmlFor="expense-vendor" className="text-xs">Vendor</Label>
            <Input id="expense-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} className="h-9 mt-1" placeholder="Optional" />
          </div>
          <div>
            <Label htmlFor="expense-description" className="text-xs">Description</Label>
            <Input id="expense-description" value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 mt-1" placeholder="Optional" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="expense-notes" className="text-xs">Notes</Label>
            <Textarea id="expense-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" rows={2} placeholder="Optional" />
          </div>
          <p className="sm:col-span-2 text-micro text-muted-foreground">
            Leave anything you don't have blank — it renders as “—”, never a guessed number.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{Verbs.CANCEL}</Button>
          <Button disabled={!amountValid || incurredOn.trim() === "" || create.isPending} onClick={() => create.mutate()} data-testid="button-record-expense-submit">
            Record expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit one
// ---------------------------------------------------------------------------

function EditExpenseDialog({
  expense, onOpenChange, onDone,
}: {
  expense: ExpenseRow | null;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<ExpenseRow | null>(null);
  const active = expense !== null;
  const current = draft && expense && draft.id === expense.id ? draft : expense;

  // allow-no-invalidation: onSuccess calls the panel's onDone(), which
  // invalidates this property's expense list.
  const save = useMutation({
    mutationFn: () => {
      if (!current) throw new Error("Nothing to save");
      return sendJson<{ expense: ExpenseRow }>(`/api/rentals/expenses/${current.id}`, "PATCH", {
        category: current.category,
        amountCents: current.amountCents,
        incurredOn: current.incurredOn,
        vendor: current.vendor,
        description: current.description,
        notes: current.notes,
      });
    },
    onSuccess: () => {
      toast({ title: "Expense saved" });
      setDraft(null);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  function patch(next: Partial<ExpenseRow>) {
    if (!current) return;
    setDraft({ ...current, ...next });
  }

  return (
    <Dialog open={active} onOpenChange={(o) => { if (!o) setDraft(null); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
          <DialogDescription>
            Changing the category moves whether this line counts toward net operating income — the
            server re-derives that from the category, it is never set on its own.
          </DialogDescription>
        </DialogHeader>

        {current && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <CategorySelect id="edit-expense-category" value={current.category} onChange={(c) => patch({ category: c })} />
            </div>
            <div>
              <Label htmlFor="edit-expense-amount" className="text-xs">Amount ($) *</Label>
              <Input
                id="edit-expense-amount" type="number" min={0} step="0.01"
                value={current.amountCents / 100}
                onChange={(e) => patch({ amountCents: dollarsToCents(e.target.value) ?? current.amountCents })}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-expense-date" className="text-xs">Incurred on *</Label>
              <Input
                id="edit-expense-date" type="date"
                value={current.incurredOn}
                onChange={(e) => patch({ incurredOn: e.target.value })}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-expense-vendor" className="text-xs">Vendor</Label>
              <Input
                id="edit-expense-vendor"
                value={current.vendor ?? ""}
                onChange={(e) => patch({ vendor: e.target.value.trim() === "" ? null : e.target.value })}
                className="h-9 mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-expense-description" className="text-xs">Description</Label>
              <Input
                id="edit-expense-description"
                value={current.description ?? ""}
                onChange={(e) => patch({ description: e.target.value.trim() === "" ? null : e.target.value })}
                className="h-9 mt-1"
              />
            </div>
            {current.source === "maintenance_invoice" && (
              <p className="sm:col-span-2 text-micro text-muted-foreground">
                This row came from a maintenance ticket's invoice. Editing it here does not change the
                ticket.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { setDraft(null); onOpenChange(false); }}>{Verbs.CANCEL}</Button>
          <Button
            disabled={!current || current.amountCents < 0 || current.incurredOn.trim() === "" || save.isPending}
            onClick={() => save.mutate()}
            data-testid="button-edit-expense-submit"
          >
            {Verbs.SAVE}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Roll in maintenance
// ---------------------------------------------------------------------------

function ImportMaintenanceDialog({
  open, onOpenChange, propertyId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  propertyId: number;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<BulkReport | null>(null);

  // allow-no-invalidation: onSuccess calls the panel's onDone(), which
  // invalidates this property's expense list.
  const run = useMutation({
    mutationFn: () =>
      postJson<BulkReport & { propertyId: number }>(`/api/properties/${propertyId}/expenses/import-maintenance`, {
        from: from.trim() || undefined,
        to: to.trim() || undefined,
      }),
    onSuccess: (result) => {
      setReport(result);
      toast({
        title: "Maintenance rolled in",
        description: `${result.createdCount} new, ${result.existedCount} already recorded.`,
      });
      onDone();
    },
    onError: (e) => toast({ title: getErrorTitle(e), description: getErrorMessage(e), variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setReport(null); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Roll in maintenance invoices</DialogTitle>
          <DialogDescription>
            Records the invoice on every completed maintenance ticket for this property as a repairs
            expense. Safe to run twice — a ticket already recorded is skipped, never added again.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="import-from" className="text-xs">From (optional)</Label>
            <Input id="import-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 mt-1" />
          </div>
          <div>
            <Label htmlFor="import-to" className="text-xs">To (optional)</Label>
            <Input id="import-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 mt-1" />
          </div>
          <p className="sm:col-span-2 text-micro text-muted-foreground">
            Filters by completion date. Leave both blank to roll in every completed, invoiced ticket.
          </p>

          {report && (
            <div className="sm:col-span-2 rounded-md border border-border p-3 text-xs space-y-1" data-testid="import-maintenance-result">
              <p className="font-medium">
                {report.createdCount === 0
                  ? `Nothing new. All ${report.attemptedCount} completed invoice(s) were already recorded.`
                  : `Recorded ${report.createdCount} new expense(s). ${report.existedCount} already there and left untouched.`}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { setReport(null); onOpenChange(false); }}>Close</Button>
          <Button disabled={run.isPending} onClick={() => run.mutate()} data-testid="button-import-maintenance-submit">
            Roll in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
