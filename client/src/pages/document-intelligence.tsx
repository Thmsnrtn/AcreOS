import { useState, useId } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { FileSearch, Upload, AlertTriangle, CheckCircle, Tag, Search, BookOpen } from "lucide-react";

const SEVERITY_LABEL: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function RiskBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-blue-100 text-blue-800",
  };
  const label = SEVERITY_LABEL[severity] ?? severity;
  return (
    <Badge className={map[severity] ?? "bg-gray-100 text-gray-600"} aria-label={`Severity: ${label}`}>
      {label}
    </Badge>
  );
}

export default function DocumentIntelligencePage() {
  useDocumentTitle("Document intelligence");
  const { toast } = useToast();
  const nameId = useId();
  const fileUrlId = useId();
  const fileTypeId = useId();
  const propertyIdInput = useId();
  const searchInputId = useId();

  const [searchQuery, setSearchQuery] = useState("");
  const [uploadForm, setUploadForm] = useState({ name: "", fileUrl: "", fileType: "deed", propertyId: "", dealId: "" });
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [analysisResults, setAnalysisResults] = useState<any>(null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/document-intelligence/upload", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...uploadForm,
          propertyId: uploadForm.propertyId || undefined,
          dealId: uploadForm.dealId || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Document uploaded", description: `Document ID: ${data.document?.id}.` });
      setSelectedDocId(data.document?.id);
      setUploadForm({ name: "", fileUrl: "", fileType: "deed", propertyId: "", dealId: "" });
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't upload document",
        description: `${e.message}. The document wasn't saved — try again, or check that the file URL is reachable.`,
        variant: "destructive",
      }),
  });

  const processMutation = useMutation({
    mutationFn: async (docId: number) => {
      const res = await fetch(`/api/document-intelligence/documents/${docId}/process`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onSuccess: (data) => {
      setAnalysisResults(data.analysis);
      toast({ title: "Analysis complete" });
    },
    onError: (e: any) =>
      toast({
        title: "Couldn't analyze document",
        description: `${e.message}. The document is unchanged — try again. AI analysis may temporarily fail on very long PDFs.`,
        variant: "destructive",
      }),
  });

  const { data: termsData } = useQuery({
    queryKey: ["/api/document-intelligence/key-terms", selectedDocId],
    enabled: !!selectedDocId,
    queryFn: async () => {
      const res = await fetch(`/api/document-intelligence/documents/${selectedDocId}/key-terms`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: risksData } = useQuery({
    queryKey: ["/api/document-intelligence/risks", selectedDocId],
    enabled: !!selectedDocId,
    queryFn: async () => {
      const res = await fetch(`/api/document-intelligence/documents/${selectedDocId}/risks`, { credentials: "include" });
      return res.json();
    },
  });

  const { data: summaryData } = useQuery({
    queryKey: ["/api/document-intelligence/summary", selectedDocId],
    enabled: !!selectedDocId,
    queryFn: async () => {
      const res = await fetch(`/api/document-intelligence/documents/${selectedDocId}/summary`, { credentials: "include" });
      return res.json();
    },
  });

  const searchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/document-intelligence/search", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      return res.json();
    },
    onError: (e: any) =>
      toast({
        title: "Search didn't run",
        description: `${e.message}. Your search query is unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const keyTerms = termsData?.terms ?? [];
  const risks = risksData?.risks ?? [];
  const summary = summaryData?.summary;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSearch className="w-7 h-7 text-primary" aria-hidden="true" /> Document intelligence
        </h1>
        <p className="text-muted-foreground mt-1">
          AI-powered contract parsing, clause extraction, risk analysis, and semantic search.
        </p>
      </div>

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload &amp; analyze</TabsTrigger>
          <TabsTrigger value="results" disabled={!selectedDocId}>Analysis results</TabsTrigger>
          <TabsTrigger value="search">Semantic search</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-sm">Add document</CardTitle></CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => { e.preventDefault(); uploadMutation.mutate(); }}
                  className="space-y-4"
                >
                  <div>
                    <Label htmlFor={nameId}>Document name</Label>
                    <Input
                      id={nameId}
                      placeholder="Purchase agreement — Smith property"
                      value={uploadForm.name}
                      onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))}
                      autoCapitalize="words"
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor={fileUrlId}>File URL</Label>
                    <Input
                      id={fileUrlId}
                      type="url"
                      placeholder="https://…/document.pdf"
                      value={uploadForm.fileUrl}
                      onChange={e => setUploadForm(f => ({ ...f, fileUrl: e.target.value }))}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      inputMode="url"
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={fileTypeId}>File type</Label>
                      <Select
                        value={uploadForm.fileType}
                        onValueChange={(v) => setUploadForm(f => ({ ...f, fileType: v }))}
                      >
                        <SelectTrigger id={fileTypeId} aria-label="File type"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="deed">Deed</SelectItem>
                          <SelectItem value="purchase_agreement">Purchase agreement</SelectItem>
                          <SelectItem value="title_commitment">Title commitment</SelectItem>
                          <SelectItem value="survey">Survey</SelectItem>
                          <SelectItem value="note">Promissory note</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={propertyIdInput}>Property ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input
                        id={propertyIdInput}
                        type="number"
                        placeholder="123"
                        value={uploadForm.propertyId}
                        onChange={e => setUploadForm(f => ({ ...f, propertyId: e.target.value }))}
                        className="tabular-nums"
                        inputMode="numeric"
                        min={1}
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={uploadMutation.isPending || !uploadForm.name || !uploadForm.fileUrl}
                  >
                    <Upload className="w-4 h-4 mr-1" aria-hidden="true" />
                    {uploadMutation.isPending ? "Uploading…" : "Upload document"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            {selectedDocId && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Analyze document #<span className="tabular-nums">{selectedDocId}</span></CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Run the full AI pipeline: text extraction, key term identification, risk analysis, and summary generation.
                  </p>
                  <Button
                    className="w-full"
                    onClick={() => processMutation.mutate(selectedDocId)}
                    disabled={processMutation.isPending}
                    aria-label={`Run AI analysis on document ${selectedDocId}`}
                  >
                    <FileSearch className="w-4 h-4 mr-1" aria-hidden="true" />
                    {processMutation.isPending ? "Analyzing…" : "Run AI analysis"}
                  </Button>
                  {analysisResults && (
                    <div className="mt-2 p-3 bg-green-50 dark:bg-green-950/20 rounded text-sm" role="status">
                      <CheckCircle className="w-4 h-4 text-green-600 inline mr-1" aria-hidden="true" />
                      Analysis complete — view results in the Analysis results tab.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="results" className="mt-4 space-y-4">
          {summary && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-primary" aria-hidden="true" /> AI summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-sm leading-relaxed">{summary}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" aria-hidden="true" /> Risk flags
                {risks.length > 0 && <Badge variant="destructive" className="ml-auto tabular-nums">{risks.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {risks.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" aria-hidden="true" /> No significant risks detected.
                </div>
              ) : (
                <ul className="space-y-3" aria-label="Risk flags">
                  {risks.map((risk: any, i: number) => {
                    const isCritical = risk.severity === "critical" || risk.severity === "high";
                    return (
                      <li
                        key={i}
                        className="border-l-4 border-orange-400 pl-3 py-1"
                        role={isCritical ? "alert" : undefined}
                      >
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-medium text-sm">{risk.clause ?? risk.type ?? "Risk"}</span>
                          <RiskBadge severity={risk.severity ?? "medium"} />
                        </div>
                        <p className="text-xs text-muted-foreground">{risk.description ?? risk.explanation}</p>
                        {risk.recommendation && (
                          <p className="text-xs text-primary mt-1">→ {risk.recommendation}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Tag className="w-4 h-4 text-blue-500" aria-hidden="true" /> Key terms &amp; clauses
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {keyTerms.length === 0 ? (
                <p className="text-sm text-muted-foreground">No key terms extracted yet. Run the analysis first.</p>
              ) : (
                <ul className="space-y-2" aria-label="Extracted key terms">
                  {keyTerms.map((term: any, i: number) => (
                    <li key={i} className="flex items-start justify-between py-2 border-b last:border-0 gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{term.name ?? term.term}</p>
                        {term.value && <p className="text-xs text-muted-foreground">{term.value}</p>}
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0">{term.category ?? "clause"}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <form
                onSubmit={(e) => { e.preventDefault(); if (searchQuery) searchMutation.mutate(); }}
                className="flex gap-3"
              >
                <Label htmlFor={searchInputId} className="sr-only">Search documents</Label>
                <Input
                  id={searchInputId}
                  type="search"
                  placeholder='Search documents… e.g. "properties with right of way easements"'
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                <Button
                  type="submit"
                  disabled={searchMutation.isPending || !searchQuery}
                  aria-label="Search documents"
                >
                  <Search className="w-4 h-4" aria-hidden="true" />
                </Button>
              </form>

              {searchMutation.isPending && (
                <div className="space-y-2" role="status" aria-live="polite">
                  <span className="sr-only">Searching documents…</span>
                  {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />)}
                </div>
              )}

              {searchMutation.data?.results?.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No documents matched your search.</p>
              )}

              {(searchMutation.data?.results ?? []).length > 0 && (
                <ul className="space-y-2" aria-label="Search results">
                  {(searchMutation.data?.results ?? []).map((result: any, i: number) => (
                    <li key={i}>
                      <Card>
                        <CardContent className="p-3">
                          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                            <p className="font-medium text-sm">{result.name}</p>
                            <Badge variant="secondary" className="capitalize">{result.fileType?.replace(/_/g, " ")}</Badge>
                          </div>
                          {result.excerpt && <p className="text-xs text-muted-foreground">{result.excerpt}</p>}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2 h-6 text-xs"
                            onClick={() => setSelectedDocId(result.id)}
                            aria-label={`Select "${result.name}" for analysis`}
                          >
                            Select for analysis →
                          </Button>
                        </CardContent>
                      </Card>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
