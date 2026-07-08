/**
 * /ccr-templates — covenant template library (SD-8).
 *
 * Brigid §6: "A template engine with merge fields, period. […] No AI here,
 * please. I do not want a generative model writing CC&Rs that get recorded
 * in perpetuity against my buyers' titles."
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { FileText, Eye, Download } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";

interface MergeField {
  key: string;
  label: string;
  type: "string" | "number" | "currency_cents" | "date" | "boolean";
  required: boolean;
  placeholder?: string;
}

interface Template {
  id: string;
  organizationId: number | null;
  kind: string;
  name: string;
  state: string | null;
  mergeFields: MergeField[];
  attorneyReviewedAt: string | null;
  attorneyReviewedBy: string | null;
  notes: string | null;
}

interface TemplateDetail extends Template {
  bodyMarkdown: string;
}

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

export default function CcrTemplatesPage() {
  useDocumentTitle("CC&R templates — AcreOS");
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [renderedOutput, setRenderedOutput] = useState<string>("");

  const list = useQuery<{ templates: Template[] }>({
    queryKey: ["/api/ccr-templates"],
    queryFn: async () => {
      const res = await fetch("/api/ccr-templates", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const detail = useQuery<{ template: TemplateDetail }>({
    queryKey: ["/api/ccr-templates", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const res = await fetch(`/api/ccr-templates/${selectedId}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  // allow-no-invalidation: rendered document displays from mutation.data — nothing cached changes
  const render = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/ccr-templates/${selectedId}/render`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeader(),
        body: JSON.stringify({ values }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message ?? `Failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (r: any) => {
      setRenderedOutput(r.rendered);
      toast({ title: "Rendered", description: r.name });
    },
    onError: (err: any) => toast({ title: "Render failed", description: err.message, variant: "destructive" }),
  });

  return (
    <PageShell label="CC&R templates">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileText className="w-6 h-6 text-primary" aria-hidden="true" />
          CC&R templates
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Restrictive covenants, road maintenance agreements, HOA bylaws,
          architectural review standards. Merge-field engine — no AI generation.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Library</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {list.isLoading ? <Skeleton className="h-32" /> : list.data?.templates.map((t) => (
              <button
                key={t.id}
                className={`w-full text-left p-2 rounded text-sm border ${selectedId === t.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                onClick={() => { setSelectedId(t.id); setValues({}); setRenderedOutput(""); }}
              >
                <p className="font-medium">{t.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">{t.kind.replace(/_/g, " ")}</Badge>
                  {t.organizationId === null && <Badge variant="secondary" className="text-xs">global</Badge>}
                  {t.state && <Badge variant="outline" className="text-xs">{t.state}</Badge>}
                </div>
              </button>
            ))}
            {list.data?.templates.length === 0 && (
              <p className="text-sm text-muted-foreground py-3">
                No templates yet.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-4">
          {!selectedId ? (
            <Card><CardContent className="py-8 text-sm text-muted-foreground">Pick a template.</CardContent></Card>
          ) : detail.isLoading ? (
            <Skeleton className="h-48" />
          ) : detail.data ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{detail.data.template.name}</CardTitle>
                  <CardDescription>{detail.data.template.notes ?? ""}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {detail.data.template.mergeFields.map((f) => (
                    <div key={f.key}>
                      <Label className="text-xs">
                        {f.label}{f.required && <span className="text-acr-warn"> *</span>}
                      </Label>
                      <Input
                        value={values[f.key] ?? ""}
                        onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                        placeholder={f.placeholder ?? `${f.type}`}
                        className="h-9"
                      />
                    </div>
                  ))}
                  <Button onClick={() => render.mutate()} disabled={render.isPending}>
                    <Eye className="w-4 h-4 mr-1" aria-hidden="true" /> Render preview
                  </Button>
                </CardContent>
              </Card>

              {renderedOutput && (
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Rendered output</CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const blob = new Blob([renderedOutput], { type: "text/markdown" });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `${detail.data.template.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`;
                        a.click();
                      }}
                    >
                      <Download className="w-4 h-4 mr-1" aria-hidden="true" /> Download .md
                    </Button>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      readOnly
                      value={renderedOutput}
                      className="font-mono text-xs h-96"
                    />
                  </CardContent>
                </Card>
              )}
            </>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
