import { useState, useId } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Shield, Download, Trash2, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface PrivacyStatus {
  deleted: boolean;
  userId: number;
}

export default function PrivacySettingsPage() {
  useDocumentTitle("Privacy & data");
  const { toast } = useToast();
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const confirmInputId = useId();

  const { data: status } = useQuery<PrivacyStatus>({
    queryKey: ["/api/privacy/status"],
    queryFn: () => fetch("/api/privacy/status").then(r => r.json()),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/privacy/export", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `acreOS-data-export-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast({ title: "Data export downloaded." }),
    onError: () =>
      toast({
        title: "Couldn't export data",
        description: "Your data is unchanged. Check your connection and try again.",
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/privacy/delete", { confirm: "DELETE MY DATA" }),
    onSuccess: () => {
      toast({
        title: "Account anonymized",
        description: "Your personal data has been deleted. You will be logged out shortly.",
      });
      setShowDeleteForm(false);
      setTimeout(() => {
        window.location.href = "/auth";
      }, 3000);
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't delete data",
        description: `${err.message || "The request failed."} — your account is unchanged and no personal data was removed. You can try again or contact support.`,
        variant: "destructive",
      }),
  });

  if (status?.deleted) {
    return (
      <PageShell>
        <div
          className="flex flex-col items-center gap-4 py-16 text-center"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="w-12 h-12 text-green-500" aria-hidden="true" />
          <h1 className="text-xl font-semibold">Data deletion complete</h1>
          <p className="text-muted-foreground text-sm">Your personal data has already been anonymized.</p>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-privacy-title">
          Privacy &amp; data
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          Manage your personal data rights under GDPR/CCPA.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Data Export */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5 text-primary" aria-hidden="true" />
              <CardTitle className="text-base">Export your data</CardTitle>
            </div>
            <CardDescription>
              Download a complete copy of all personal data AcreOS holds about you (GDPR Article 15).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Your export includes:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>Account information</li>
                <li>Leads assigned to you</li>
                <li>Deals and properties</li>
                <li>Tasks and messages</li>
                <li>Support tickets</li>
              </ul>
            </div>
            <Button
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              className="w-full min-h-11"
            >
              {exportMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Preparing export…</>
              ) : (
                <><Download className="w-4 h-4 mr-2" aria-hidden="true" />Download my data</>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Data Deletion */}
        <Card className="border-red-200 dark:border-red-800">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" aria-hidden="true" />
              <CardTitle className="text-base text-red-700 dark:text-red-400">Delete personal data</CardTitle>
            </div>
            <CardDescription>
              Permanently anonymize your personal data (GDPR Article 17 — Right to Erasure).
              Business records required for legal compliance are retained in anonymized form.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800"
              role="alert"
            >
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-medium">This action can't be undone.</p>
                <p>Your email, name, and contact details will be replaced with anonymized values. Deals and business records are retained for legal compliance.</p>
              </div>
            </div>

            {!showDeleteForm ? (
              <Button
                variant="destructive"
                className="w-full min-h-11"
                onClick={() => setShowDeleteForm(true)}
              >
                <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" />
                Request data deletion
              </Button>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label htmlFor={confirmInputId} className="text-xs text-muted-foreground mb-2 block font-normal">
                    Type <strong className="font-mono">DELETE MY DATA</strong> to confirm:
                  </Label>
                  <Input
                    id={confirmInputId}
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder="Type DELETE MY DATA here"
                    className="text-sm font-mono"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Button
                    variant="destructive"
                    className="flex-1 min-h-11"
                    disabled={deleteConfirm !== "DELETE MY DATA" || deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate()}
                  >
                    {deleteMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />Deleting…</>
                    ) : (
                      "Confirm deletion"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    onClick={() => { setShowDeleteForm(false); setDeleteConfirm(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-base">Your data rights</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="Your GDPR data rights">
            {[
              { right: "Right of access (Art. 15)", desc: "Download all data we hold about you", status: "available" },
              { right: "Right to erasure (Art. 17)", desc: "Request anonymization of personal data", status: "available" },
              { right: "Right to rectification (Art. 16)", desc: "Correct inaccurate data via Settings", status: "available" },
              { right: "Right to portability (Art. 20)", desc: "Export your data in JSON format", status: "available" },
              { right: "Right to object (Art. 21)", desc: "Contact support to object to processing", status: "contact" },
              { right: "Right to restriction (Art. 18)", desc: "Contact support to restrict processing", status: "contact" },
            ].map(({ right, desc, status }) => (
              <li key={right} className="flex items-start gap-2 p-3 rounded-lg border bg-muted/20">
                <Badge
                  variant={status === "available" ? "default" : "outline"}
                  className="text-xs shrink-0 mt-0.5"
                  aria-label={status === "available" ? "available" : "contact support"}
                >
                  {status === "available" ? "Available" : "Via support"}
                </Badge>
                <div>
                  <p className="text-xs font-medium">{right}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </PageShell>
  );
}
