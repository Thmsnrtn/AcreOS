import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { FileSearch, Upload, AlertTriangle, CheckCircle, Tag, Search, BookOpen, GitCompare } from "lucide-react";

function RiskBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-yellow-100 text-yellow-800",
    low: "bg-blue-100 text-blue-800",
  };
  return <Badge className={map[severity] ?? "bg-gray-100 text-gray-600"}>{severity}</Badge>;
}

export default function DocumentIntelligencePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [uploadForm, setUploadForm] = useState({ name: "", fileUrl: "", fileType: "deed", propertyId: "", dealId: "" });
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [analysisResults, setAnalysisResults] = useState<any>(null);

  // Upload mutation
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
      toast({ title: "Document uploaded", description: `ID: ${data.document?.id}` });
      setSelectedDocId(data.document?.id);
      setUploadForm({ name: "", fileUrl: "", fileType: "deed", propertyId: "", dealId: "" });
    },
    onError: (e: any) => toast({ title: "Upload failed", description: e.message, variant: "destructive" }),
  });

  // Process mutation
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
    onError: (e: any) => toast({ title: "Analysis failed", description: e.message, variant: "destructive" }),
  });

  // Key terms query
  const { data: termsData } = useQuery({
    queryKey: ["/api/document-intelligence/key-terms", selectedDocId],
    enabled: !!selectedDocId,
    queryFn: async () => {
      const res = await fetch(`/api/document-intelligence/documents/${selectedDocId}/key-terms`, { credentials: "include" });
      return res.json();
    },
  });

  // Risks query
  const { data: risksData } = useQuery({
    queryKey: ["/api/document-intelligence/risks", selectedDocId],
    enabled: !!selectedDocId,
    queryFn: async () => {
      const res = await fetch(`/api/document-intelligence/documents/${selectedDocId}/risks`, { credentials: "include" });
      return res.json();
    },
  });

  // Summary query
  const { data: summaryData } = useQuery({
    queryKey: ["/api/document-intelligence/summary", selectedDocId],
    enabled: !!selectedDocId,
    queryFn: async () => {
      const res = await fetch(`/api/document-intelligence/documents/${selectedDocId}/summary`, { credentials: "include" });
      return res.json();
    },
  });

  // Search mutation
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
  });

  const keyTerms = termsData?.terms ?? [];
  const risks = risksData?.risks ?? [];
  const summary = summaryData?.summary;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileSearch className="w-7 h-7 text-primary" /> Document Intelligence
        </h1>
        <p className="text-muted-foreground mt-1">
          AI-powered contract parsing, clause extraction, risk analysis, and semantic search
        </p>
      </div>

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload & Analyze</TabsTrigger>
          <TabsTrigger value="results" disabled={!selectedDocId}>Analysis Results</TabsTrigger>
          <TabsTrigger value="search">Semantic Search</TabsTrigger>
        </TabsList>

        {/* Upload */}
        <TabsContent value="upload" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-sm">Add Document</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Document Name</Label>
                  <Input placeholder="Purchase Agreement — Smith Property" value={uploadForm.name}
                    onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <Label>File URL</Label>
                  <Input placeholder="https://…/document.pdf" value={uploadForm.fileUrl}
                    onChange={e => setUploadForm(f => ({ ...f, fileUrl: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>File Type</Label>
                    <select className="w-full h-9 border rounded px-2 text-sm bg-background"
                      value={uploadForm.fileType}
                      onChange={e => setUploadForm(f => ({ ...f, fileType: e.target.value }))}>
                      <option value="deed">Deed</option>
                      <option value="purchase_agreement">Purchase Agreement</option>
                      <option value="title_commitment">Title Commitment</option>
                      <option value="survey">Survey</option>
                      <option value="note">Promissory Note</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <Label>Property ID (opt)</Label>
                    <Input placeholder="123" value={uploadForm.propertyId}
                      onChange={e => setUploadForm(f => ({ ...f, propertyId: e.target.value }))} />
                  </div>
                </div>
                <Button className="w-full" onClick={() => uploadMutation.mutate()}
                  disabled={uploadMutation.isPending || !uploadForm.name || !uploadForm.fileUrl}>
                  <Upload className="w-4 h-4 mr-1" />
                  {uploadMutation.isPending ? "Uploading…" : "Upload Document"}
                </Button>
              </CardContent>
            </Card>

            {selectedDocId && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Analyze Document #{selectedDocId}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Run the full AI pipeline: text extraction, key term identification, risk analysis, and summary generation.
                  </p>
                  <Button className="w-full" onClick={() => processMutation.mutate(selectedDocId)}
                    disabled={processMutation.isPending}>
                    <FileSearch className="w-4 h-4 mr-1" />
                    {processMutation.isPending ? "Analyzing…" : "Run AI Analysis"}
                  </Button>
                  {analysisResults && (
                    <div className="mt-2 p-3 bg-green-50 dark:bg-green-950/20 rounded text-sm">
                      <CheckCircle className="w-4 h-4 text-green-600 inline mr-1" />
                      Analysis complete — view results in the Analysis Results tab.
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Results */}
        <TabsContent value="results" className="mt-4 space-y-4">
          {/* Summary */}
          {summary && (
            <Card>
              <CardHeader><CardTitle className="text-sm flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" /> AI Summary</CardTitle></CardHeader>
              <CardContent className="p-4 pt-0">
                <p className="text-sm leading-relaxed">{summary}</p>
              </CardContent>
            </Card>
          )}

          {/* Risk Flags */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-500" /> Risk Flags
                {risks.length > 0 && <Badge variant="destructive" className="ml-auto">{risks.length}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {risks.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="w-4 h-4" /> No significant risks detected.
                </div>
              ) : (
                <div className="space-y-3">
                  {risks.map((risk: any, i: number) => (
                    <div key={i} className="border-l-4 border-orange-400 pl-3 py-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm">{risk.clause ?? risk.type ?? "Risk"}</span>
                        <RiskBadge severity={risk.severity ?? "medium"} />
                      </div>
                      <p className="text-xs text-muted-foreground">{risk.description ?? risk.explanation}</p>
                      {risk.recommendation && (
                        <p className="text-xs text-primary mt-1">→ {risk.recommendation}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Key Terms */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Tag className="w-4 h-4 text-blue-500" /> Key Terms & Clauses
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {keyTerms.length === 0 ? (
                <p className="text-sm text-muted-foreground">No key terms extracted yet. Run the analysis first.</p>
              ) : (
                <div className="space-y-2">
                  {keyTerms.map((term: any, i: number) => (
                    <div key={i} className="flex items-start justify-between py-2 border-b last:border-0">
                      <div>
                        <p className="text-sm font-medium">{term.name ?? term.term}</p>
                        {term.value && <p className="text-xs text-muted-foreground">{term.value}</p>}
                      </div>
                      <Badge variant="outline" className="text-xs shrink-0 ml-2">{term.category ?? "clause"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Search */}
        <TabsContent value="search" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex gap-3">
                <Input placeholder='Search documents… e.g. "properties with right of way easements"'
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchMutation.mutate()} />
                <Button onClick={() => searchMutation.mutate()} disabled={searchMutation.isPending || !searchQuery}>
                  <Search className="w-4 h-4" />
                </Button>
              </div>

              {searchMutation.isPending && (
                <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />)}</div>
              )}

              {searchMutation.data?.results?.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No documents matched your search.</p>
              )}

              {(searchMutation.data?.results ?? []).map((result: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-medium text-sm">{result.name}</p>
                      <Badge variant="secondary">{result.fileType?.replace(/_/g, " ")}</Badge>
                    </div>
                    {result.excerpt && <p className="text-xs text-muted-foreground">{result.excerpt}</p>}
                    <Button size="sm" variant="ghost" className="mt-2 h-6 text-xs"
                      onClick={() => setSelectedDocId(result.id)}>
                      Select for analysis →
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
