/**
 * T116 — Data Export Center
 *
 * Lets users export their data in bulk:
 *   - Leads (CSV, JSON)
 *   - Properties (CSV, JSON)
 *   - Deals (CSV)
 *   - Campaigns (CSV)
 *   - Finance/Notes (CSV)
 *   - Activity Log (CSV)
 *   - Full account archive (ZIP)
 *
 * All exports go through the existing /api/export/* endpoints.
 */
import { useState } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Download,
  FileText,
  Users,
  Map,
  Briefcase,
  Megaphone,
  Banknote,
  Activity,
  Package,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ExportOption {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  endpoint: string;
  formats: string[];
  estimatedRows?: string;
}

const EXPORT_OPTIONS: ExportOption[] = [
  {
    id: "leads",
    label: "Leads",
    description: "All lead records with contact info, status, and scores",
    icon: Users,
    endpoint: "/api/export/leads",
    formats: ["csv", "json"],
  },
  {
    id: "properties",
    label: "Properties",
    description: "All property/parcel records with APN, address, valuation",
    icon: Map,
    endpoint: "/api/export/properties",
    formats: ["csv", "json"],
  },
  {
    id: "deals",
    label: "Deals",
    description: "All deal records with offer amounts, status, and dates",
    icon: Briefcase,
    endpoint: "/api/export/deals",
    formats: ["csv"],
  },
  {
    id: "campaigns",
    label: "Campaigns",
    description: "Campaign settings and performance metrics",
    icon: Megaphone,
    endpoint: "/api/export/campaigns",
    formats: ["csv"],
  },
  {
    id: "notes",
    label: "Seller-Financed Notes",
    description: "All note records with payment schedules and balances",
    icon: Banknote,
    endpoint: "/api/export/notes",
    formats: ["csv"],
  },
  {
    id: "activities",
    label: "Activity Log",
    description: "Full audit trail of all user actions",
    icon: Activity,
    endpoint: "/api/export/activities",
    formats: ["csv"],
  },
];

export default function DataExportPage() {
  const { toast } = useToast();
  const [formats, setFormats] = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState<Set<string>>(new Set());
  const [downloaded, setDownloaded] = useState<Set<string>>(new Set());

  const getFormat = (id: string, opts: string[]) => formats[id] ?? opts[0];

  const handleExport = async (option: ExportOption) => {
    const fmt = getFormat(option.id, option.formats);
    const url = `${option.endpoint}?format=${fmt}`;

    setDownloading(prev => new Set(prev).add(option.id));
    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message);
      }
      const blob = await res.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `${option.id}-export.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);

      setDownloaded(prev => new Set(prev).add(option.id));
      toast({ title: `${option.label} exported as ${fmt.toUpperCase()}` });
    } catch (err: any) {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(prev => {
        const next = new Set(prev);
        next.delete(option.id);
        return next;
      });
    }
  };

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Data Export</h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Download your AcreOS data in bulk. All exports are scoped to your organization.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {EXPORT_OPTIONS.map((option) => {
          const Icon = option.icon;
          const fmt = getFormat(option.id, option.formats);
          const isDownloading = downloading.has(option.id);
          const isDone = downloaded.has(option.id);

          return (
            <Card key={option.id}>
              <CardContent className="pt-4 pb-4 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-muted shrink-0">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{option.label}</span>
                    {option.formats.map(f => (
                      <Badge key={f} variant="outline" className="text-xs uppercase">{f}</Badge>
                    ))}
                    {isDone && <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{option.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    {option.formats.length > 1 && (
                      <Select
                        value={fmt}
                        onValueChange={(v) => setFormats(prev => ({ ...prev, [option.id]: v }))}
                      >
                        <SelectTrigger className="h-7 w-20 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {option.formats.map(f => (
                            <SelectItem key={f} value={f} className="text-xs uppercase">{f}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => handleExport(option)}
                      disabled={isDownloading}
                    >
                      {isDownloading ? (
                        <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Exporting</>
                      ) : (
                        <><Download className="w-3 h-3 mr-1" /> Export {fmt.toUpperCase()}</>
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Full Archive */}
      <Card className="border-dashed">
        <CardContent className="pt-4 pb-4 flex items-center gap-4">
          <div className="p-3 rounded-lg bg-muted">
            <Package className="w-5 h-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">Full Account Archive</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Download all your data as a single ZIP file. Includes leads, properties, deals, campaigns, notes, documents, and activity log.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => handleExport({
              id: "archive",
              label: "Archive",
              description: "",
              icon: Package,
              endpoint: "/api/export/archive",
              formats: ["zip"],
            })}
            disabled={downloading.has("archive")}
          >
            {downloading.has("archive") ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Preparing...</>
            ) : (
              <><Download className="w-4 h-4 mr-2" /> Download Archive</>
            )}
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Exports are processed in real-time and limited to your organization's data. Large exports may take a few seconds.
        For GDPR data deletion requests, contact support.
      </p>
    </PageShell>
  );
}
