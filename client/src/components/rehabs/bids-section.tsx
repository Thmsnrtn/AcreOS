/**
 * Bids comparison section on /rehabs/:id (FF-5).
 *
 * Devon §2.2: "I want to put them side-by-side: line by line, where does
 * Marcus go cheaper than Tony on flooring; where does Carlos pad the
 * demolition. That's the bid-management workflow I do today on a yellow
 * legal pad and I hate it."
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, PlusCircle, Sparkles, AlertTriangle, Upload } from "lucide-react";
import { useRef } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

const CATEGORIES = [
  "demolition", "framing", "roof", "siding", "windows",
  "exterior_paint", "interior_paint", "flooring", "kitchen", "bathroom",
  "hvac", "plumbing", "electrical", "drywall", "trim_doors",
  "appliances", "landscaping", "permits", "dumpster", "cleaning",
  "punch_list", "contingency", "other",
] as const;

interface Bid {
  id: string;
  contractorId: string;
  contractorName: string;
  totalCents: number;
  submittedAt: string | null;
  validUntil: string | null;
  categoryBreakdown: Record<string, number>;
  isAccepted: boolean;
  rejectedAt: string | null;
}

interface MatrixRow {
  category: string;
  cells: Array<{ bidId: string; contractorName: string; cents: number | null }>;
  minCents: number | null;
  maxCents: number | null;
  spreadCents: number | null;
}

interface BidsResponse {
  bids: Bid[];
  categories: string[];
  matrix: MatrixRow[];
}

interface Contractor {
  id: string;
  name: string;
  businessName: string | null;
  ytdPaidCents: number;
}

function fmtUsd(c: number | null): string {
  if (c === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

function csrf(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export function BidsSection({ rehabId }: { rehabId: string }) {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [contractorId, setContractorId] = useState("");
  const [breakdown, setBreakdown] = useState<Record<string, string>>({});
  const [extractText, setExtractText] = useState("");
  const [extractWarnings, setExtractWarnings] = useState<string[]>([]);
  const [extractConfidence, setExtractConfidence] = useState<number | null>(null);
  const [extractNotes, setExtractNotes] = useState<string | null>(null);

  const bidsQuery = useQuery<BidsResponse>({
    queryKey: ["/api/rehabs", rehabId, "bids"],
    queryFn: async () => {
      const res = await fetch(`/api/rehabs/${rehabId}/bids`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const contractorsQuery = useQuery<{ contractors: Contractor[] }>({
    queryKey: ["/api/contractors"],
    queryFn: async () => {
      const res = await fetch("/api/contractors", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const total = Object.values(breakdown).reduce((s, v) => s + (parseFloat(v) || 0) * 100, 0);

  const addBid = useMutation({
    mutationFn: async () => {
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(breakdown)) {
        const n = parseFloat(v);
        if (Number.isFinite(n) && n > 0) cleaned[k] = Math.round(n * 100);
      }
      const res = await fetch(`/api/rehabs/${rehabId}/bids`, {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({
          contractorId,
          totalCents: Math.round(total),
          categoryBreakdown: cleaned,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid added" });
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", rehabId, "bids"] });
      setShowAdd(false); setContractorId(""); setBreakdown({});
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // allow-no-invalidation: extraction fills the add-bid form's local state — nothing persisted yet
  const extractPdf = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("pdf", file);
      const csrfHeaderOnly: Record<string, string> = {};
      const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
      if (m) csrfHeaderOnly["x-csrf-token"] = decodeURIComponent(m[1]);
      const res = await fetch(`/api/rehabs/${rehabId}/bids/extract-pdf`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaderOnly,
        body: fd,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r: any) => {
      const e = r.extracted;
      const dollarBreakdown: Record<string, string> = {};
      for (const [k, cents] of Object.entries(e.categoryBreakdown ?? {})) {
        dollarBreakdown[k] = String(Math.round((cents as number) / 100));
      }
      setBreakdown(dollarBreakdown);
      setExtractWarnings(e.warnings ?? []);
      setExtractConfidence(e.confidence ?? null);
      setExtractNotes(e.notes ?? null);
      setExtractText(r.sourceText ?? "");
      toast({
        title: "PDF parsed",
        description: `${r.filename} · ${r.sourceCharCount} chars · ${Math.round((e.confidence ?? 0) * 100)}% confidence`,
      });
    },
    onError: (err: any) => toast({ title: "PDF extraction failed", description: err.message, variant: "destructive" }),
  });

  // allow-no-invalidation: extraction fills the add-bid form's local state — nothing persisted yet
  const extract = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rehabs/${rehabId}/bids/extract`, {
        method: "POST", credentials: "include", headers: csrf(),
        body: JSON.stringify({ text: extractText }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r: any) => {
      const e = r.extracted;
      // Pre-fill the breakdown form (cents → dollars).
      const dollarBreakdown: Record<string, string> = {};
      for (const [k, cents] of Object.entries(e.categoryBreakdown ?? {})) {
        dollarBreakdown[k] = String(Math.round((cents as number) / 100));
      }
      setBreakdown(dollarBreakdown);
      setExtractWarnings(e.warnings ?? []);
      setExtractConfidence(e.confidence ?? null);
      setExtractNotes(e.notes ?? null);
      toast({ title: "Estimate parsed", description: `Confidence: ${Math.round((e.confidence ?? 0) * 100)}%` });
    },
    onError: (err: any) => toast({ title: "Extraction failed", description: err.message, variant: "destructive" }),
  });

  const accept = useMutation({
    mutationFn: async (bidId: string) => {
      const res = await fetch(`/api/bids/${bidId}/accept`, { method: "POST", credentials: "include", headers: csrf() });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Bid accepted (others marked rejected)" });
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", rehabId, "bids"] });
    },
  });

  if (bidsQuery.isLoading) return <Skeleton className="h-32" />;
  const data = bidsQuery.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Contractor bids</CardTitle>
          <CardDescription>
            Side-by-side comparison. Cells highlight cheapest & most expensive per category.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
          <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" />
          {showAdd ? "Cancel" : "Add bid"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAdd && (
          <div className="border border-dashed rounded p-3 space-y-3">
            {/* CT-3: paste-and-extract */}
            <div className="space-y-2 pb-3 border-b border-border/40">
              <Label className="text-xs flex items-center gap-1" htmlFor="bid-extract-text">
                <Sparkles className="w-3 h-3 text-primary" aria-hidden="true" />
                Paste contractor estimate text (PDF body, email, OCR…)
              </Label>
              <Textarea
                id="bid-extract-text"
                value={extractText}
                onChange={(e) => setExtractText(e.target.value)}
                placeholder="Paste the contractor's full estimate here. The LLM will extract a category breakdown that you can review and edit before saving."
                className="text-xs h-32 font-mono"
              />
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={extractText.trim().length < 30 || extract.isPending}
                    onClick={() => extract.mutate()}
                  >
                    <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" />
                    {extract.isPending ? "Extracting…" : "Extract from text"}
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) extractPdf.mutate(file);
                      // Reset input so re-uploading the same file works.
                      if (e.target) e.target.value = "";
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    disabled={extractPdf.isPending}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-3 h-3 mr-1" aria-hidden="true" />
                    {extractPdf.isPending ? "Parsing PDF…" : "Upload PDF"}
                  </Button>
                </div>
                {extractConfidence !== null && (
                  <Badge variant={extractConfidence >= 0.7 ? "default" : "outline"} className="text-xs">
                    {Math.round(extractConfidence * 100)}% confidence
                  </Badge>
                )}
              </div>
              {extractNotes && (
                <p className="text-xs text-muted-foreground italic">{extractNotes}</p>
              )}
              {extractWarnings.length > 0 && (
                <ul className="space-y-1">
                  {extractWarnings.map((w, i) => (
                    <li key={i} className="text-xs text-acr-warning flex items-start gap-1">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <Label className="text-xs">Contractor</Label>
              <Select value={contractorId} onValueChange={setContractorId}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick contractor…" /></SelectTrigger>
                <SelectContent>
                  {contractorsQuery.data?.contractors.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.businessName ?? c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Per-category amounts ($, leave blank to skip)</Label>
              <div className="grid grid-cols-3 md:grid-cols-4 gap-2 mt-1">
                {CATEGORIES.map((cat) => (
                  <div key={cat}>
                    <span className="text-xs text-muted-foreground">{cat.replace(/_/g, " ")}</span>
                    <Input
                      aria-label={`${cat.replace(/_/g, " ")} amount`}
                      type="number"
                      value={breakdown[cat] ?? ""}
                      onChange={(e) => setBreakdown({ ...breakdown, [cat]: e.target.value })}
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">Total: {fmtUsd(total)}</p>
            </div>
            <Button size="sm" disabled={!contractorId || total === 0 || addBid.isPending} onClick={() => addBid.mutate()}>
              Save bid
            </Button>
          </div>
        )}

        {!data || data.bids.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3">No bids yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="px-2 py-2 text-left font-medium">Category</th>
                  {data.bids.map((b) => (
                    <th key={b.id} className="px-2 py-2 text-right font-medium">
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-xs">{b.contractorName}</span>
                        {b.isAccepted ? (
                          <Badge variant="default" className="text-xs"><CheckCircle2 className="w-3 h-3 mr-1" /> accepted</Badge>
                        ) : b.rejectedAt ? (
                          <Badge variant="outline" className="text-xs">rejected</Badge>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => accept.mutate(b.id)}>Accept</Button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-medium">Spread</th>
                </tr>
              </thead>
              <tbody>
                {data.matrix.map((row) => (
                  <tr key={row.category} className="border-b border-border/40">
                    <td className="px-2 py-1 font-medium">{row.category.replace(/_/g, " ")}</td>
                    {row.cells.map((c) => {
                      const isMin = c.cents !== null && c.cents === row.minCents;
                      const isMax = c.cents !== null && c.cents === row.maxCents && row.minCents !== row.maxCents;
                      return (
                        <td key={c.bidId} className={`px-2 py-1 text-right ${isMin ? "text-acr-pos font-semibold" : isMax ? "text-acr-warning" : ""}`}>
                          {fmtUsd(c.cents)}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1 text-right text-muted-foreground">{fmtUsd(row.spreadCents)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold">
                  <td className="px-2 py-2">Total</td>
                  {data.bids.map((b) => (
                    <td key={b.id} className="px-2 py-2 text-right">{fmtUsd(b.totalCents)}</td>
                  ))}
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
