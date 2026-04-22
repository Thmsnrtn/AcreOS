import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Entity = "leads" | "properties" | "deals" | "notes";

interface ExportButtonProps extends Omit<ButtonProps, "onClick" | "children"> {
  entity: Entity;
  format?: "csv" | "json";
  label?: string;
  /** Query parameters to pass (status, startDate, endDate, etc.) */
  filters?: Record<string, string | number | undefined>;
}

/**
 * Canonical export-to-CSV/JSON button for list views. Hits the
 * existing /api/export/:entity endpoint (already serves leads,
 * properties, deals, notes) and triggers a browser download.
 *
 *   <ExportButton entity="leads" format="csv" />
 *
 * Roadmap #101 — every list view should have one.
 */
export function ExportButton({
  entity,
  format = "csv",
  label,
  filters,
  variant = "outline",
  size = "sm",
  ...rest
}: ExportButtonProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ format });
      if (filters) {
        for (const [k, v] of Object.entries(filters)) {
          if (v != null && v !== "") qs.set(k, String(v));
        }
      }
      const res = await fetch(`/api/export/${entity}?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${entity}_export_${date}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch (err: any) {
      toast({
        title: "Export failed",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant={variant} size={size} onClick={handleClick} disabled={loading || rest.disabled} {...rest}>
      {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
      {label ?? `Export ${format.toUpperCase()}`}
    </Button>
  );
}
