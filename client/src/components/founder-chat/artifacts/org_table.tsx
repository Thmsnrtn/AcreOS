/**
 * org_table artifact — sortable table of orgs with margin.
 */
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrgMarginRow } from "@shared/founder-chat/artifacts";

interface OrgTableProps {
  rows: OrgMarginRow[];
  sortBy?: keyof OrgMarginRow;
}

type SortKey = "orgName" | "mrrCents" | "costsCents" | "marginCents";

function fmt(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round((cents ?? 0) / 100));
}

export function OrgTableArtifact({ rows, sortBy }: OrgTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>(
    (sortBy as SortKey) ?? "marginCents",
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const arr = [...(rows ?? [])];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const an = Number(av ?? 0);
      const bn = Number(bv ?? 0);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const toggle = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "orgName" ? "asc" : "asc");
    }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (k !== sortKey) return <ChevronsUpDown className="w-3 h-3 inline ml-1" aria-hidden="true" />;
    return sortDir === "asc" ? (
      <ArrowUp className="w-3 h-3 inline ml-1" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3 h-3 inline ml-1" aria-hidden="true" />
    );
  };

  return (
    <Card data-testid="artifact-org-table">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">
          Per-org margin
          <span className="ml-2 text-xs text-muted-foreground font-normal">
            {sorted.length} {sorted.length === 1 ? "org" : "orgs"}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground border-b border-border">
              <tr>
                <Th onClick={() => toggle("orgName")} testId="org-table-th-name">
                  Org <SortIcon k="orgName" />
                </Th>
                <Th>Tier</Th>
                <Th align="right" onClick={() => toggle("mrrCents")} testId="org-table-th-mrr">
                  MRR <SortIcon k="mrrCents" />
                </Th>
                <Th align="right" onClick={() => toggle("costsCents")} testId="org-table-th-costs">
                  Costs <SortIcon k="costsCents" />
                </Th>
                <Th align="right" onClick={() => toggle("marginCents")} testId="org-table-th-margin">
                  Margin <SortIcon k="marginCents" />
                </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No orgs match.
                  </td>
                </tr>
              ) : (
                sorted.map((row) => (
                  <tr
                    key={row.orgId}
                    className="border-b border-border last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-4 py-2 font-medium">{row.orgName}</td>
                    <td className="px-4 py-2">
                      {row.tier ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {row.tier}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.mrrCents)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(row.costsCents)}</td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right tabular-nums font-medium",
                        row.marginCents < 0 ? "text-acr-neg" : "text-acr-pos",
                      )}
                    >
                      {fmt(row.marginCents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Th({
  children,
  align = "left",
  onClick,
  testId,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  onClick?: () => void;
  testId?: string;
}) {
  const cls = cn(
    "px-4 py-2 font-medium",
    align === "right" && "text-right",
    onClick && "cursor-pointer select-none hover:text-foreground",
  );
  if (!onClick) {
    return <th className={cls}>{children}</th>;
  }
  return (
    <th className={cls}>
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 font-medium"
        data-testid={testId}
      >
        {children}
      </button>
    </th>
  );
}

export default OrgTableArtifact;
