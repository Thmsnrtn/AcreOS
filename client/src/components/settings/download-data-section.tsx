import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * DownloadDataSection — settings section for full data export.
 * Triggers POST /api/export/full and auto-downloads the JSON result.
 */
export function DownloadDataSection() {
  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/export/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Export failed" }));
        throw new Error(err.message || "Export failed");
      }
      return res.json();
    },
    onSuccess: (result) => {
      // Auto-download the JSON data
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `acreos-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Download All My Data</CardTitle>
        <CardDescription>
          Export all your leads, deals, properties, notes, and activity history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {exportMutation.isPending && (
          <div className="space-y-2">
            <Alert>
              <AlertDescription>
                Preparing your data export — this may take 1-2 minutes for large portfolios.
              </AlertDescription>
            </Alert>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}

        {exportMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {exportMutation.error?.message || "Failed to generate export. Please try again."}
            </AlertDescription>
          </Alert>
        )}

        {exportMutation.isSuccess && !exportMutation.isPending && (
          <Alert>
            <AlertDescription>
              Your data export has been downloaded successfully.
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
          aria-label="Download My Data"
        >
          <Download className="mr-2 h-4 w-4" />
          {exportMutation.isPending ? "Exporting..." : "Download My Data"}
        </Button>
      </CardContent>
    </Card>
  );
}
