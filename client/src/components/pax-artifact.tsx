import { useState } from "react";
import { X, Download, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface PaxArtifactData {
  artifactType: "table" | "document" | "card";
  title: string;
  data: any;
}

interface PaxArtifactProps extends PaxArtifactData {
  onDismiss?: () => void;
}

function formatValue(key: string, value: any): string {
  if (value === null || value === undefined) return "—";
  const k = key.toLowerCase();
  if (
    k.includes("price") || k.includes("cost") || k.includes("profit") ||
    k.includes("value") || k.includes("payment") || k.includes("amount") ||
    k.includes("balance") || k.includes("principal") || k.includes("income") ||
    k.includes("expense") || k.includes("cashflow") || k.includes("flow")
  ) {
    const n = Number(value);
    if (!isNaN(n)) return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  }
  if (k.includes("rate") || k.includes("percent") || k.includes("return") || k.includes("yield") || k.includes("roi")) {
    const n = Number(value);
    if (!isNaN(n)) return `${n.toFixed(2)}%`;
  }
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/^\s/, "")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Card variant ─────────────────────────────────────────────────────────────

function ArtifactCard({ data }: { data: any }) {
  const entries = Object.entries(data ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== "object"
  );
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs py-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide leading-none">
            {humanizeKey(key)}
          </span>
          <span className="font-medium text-foreground leading-tight">
            {formatValue(key, value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Table variant ─────────────────────────────────────────────────────────────

function ArtifactTable({ data }: { data: any }) {
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  let rows: Record<string, any>[] = [];
  let headers: string[] = [];

  if (Array.isArray(data)) {
    rows = data;
    headers = rows[0] ? Object.keys(rows[0]) : [];
  } else if (data?.rows && Array.isArray(data.rows)) {
    rows = data.rows;
    headers = data.headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  } else if (data && typeof data === "object") {
    // Single object — convert to key/value rows
    rows = Object.entries(data)
      .filter(([, v]) => typeof v !== "object")
      .map(([k, v]) => ({ Field: humanizeKey(k), Value: formatValue(k, v) }));
    headers = ["Field", "Value"];
  }

  if (sortKey) {
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? "";
      const bv = b[sortKey] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  const visible = showAll ? rows : rows.slice(0, 10);

  const toggleSort = (h: string) => {
    if (sortKey === h) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(h);
      setSortDir("asc");
    }
  };

  if (headers.length === 0) return <p className="text-xs text-muted-foreground py-1">No data</p>;

  return (
    <div className="text-xs">
      <p className="text-[10px] text-muted-foreground mb-1">{rows.length} row{rows.length !== 1 ? "s" : ""}</p>
      <div className="overflow-x-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((h) => (
                <TableHead
                  key={h}
                  className="text-[10px] py-1 px-2 cursor-pointer select-none hover:text-foreground whitespace-nowrap"
                  onClick={() => toggleSort(h)}
                >
                  {humanizeKey(h)}
                  {sortKey === h && (sortDir === "asc" ? " ↑" : " ↓")}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row, i) => (
              <TableRow key={i}>
                {headers.map((h) => (
                  <TableCell key={h} className="py-1 px-2 text-[11px] whitespace-nowrap">
                    {formatValue(h, row[h])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > 10 && (
        <button
          className="text-[10px] text-primary hover:underline mt-1"
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? "Show less" : `Show all ${rows.length} rows`}
        </button>
      )}
    </div>
  );
}

// ── Document variant ─────────────────────────────────────────────────────────

function ArtifactDocument({ data }: { data: any }) {
  const text: string =
    data?.letter ?? data?.content ?? data?.text ?? data?.body ??
    (typeof data === "string" ? data : JSON.stringify(data, null, 2));

  return (
    <div
      className="font-serif text-xs leading-relaxed text-foreground whitespace-pre-wrap min-h-[80px] focus:outline-none"
      contentEditable
      suppressContentEditableWarning
      data-placeholder="Pax drafted · Click to edit"
    >
      {text}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function PaxArtifact({ artifactType, title, data, onDismiss }: PaxArtifactProps) {
  const [collapsed, setCollapsed] = useState(false);

  const handlePrint = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`<html><head><title>${title}</title></head><body><pre style="font-family:sans-serif;font-size:12px;">${
      typeof data === "string" ? data : JSON.stringify(data, null, 2)
    }</pre></body></html>`);
    win.document.close();
    win.print();
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden my-1.5">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <span className="flex-1 text-xs font-semibold text-foreground truncate">{title}</span>
        <span className={cn(
          "text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full font-medium border",
          artifactType === "card" && "text-acr-accent bg-acr-accent border-acr-accent dark:bg-acr-accent dark:text-acr-accent dark:border-acr-accent",
          artifactType === "table" && "text-acr-brand bg-acr-brand-soft border-acr-brand-soft dark:bg-acr-brand-soft dark:text-acr-brand dark:border-acr-brand-soft",
          artifactType === "document" && "text-acr-warn bg-acr-warn-soft border-acr-warn-soft dark:bg-acr-warn-soft dark:text-acr-warn dark:border-acr-warn-soft",
        )}>
          {artifactType}
        </span>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="px-3 py-2">
          {artifactType === "card" && <ArtifactCard data={data} />}
          {artifactType === "table" && <ArtifactTable data={data} />}
          {artifactType === "document" && <ArtifactDocument data={data} />}
        </div>
      )}

      {/* Action bar */}
      {!collapsed && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-t bg-muted/20">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-2 gap-1 text-muted-foreground"
            onClick={handlePrint}
          >
            <Download className="w-2.5 h-2.5" />
            Export
          </Button>
        </div>
      )}
    </div>
  );
}
