// @ts-nocheck
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, Download, FileText, TrendingUp, AlertCircle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DisclaimerBanner } from "@/components/disclaimer-banner";

interface BulkResult {
  address: string;
  county: string;
  state: string;
  acreage: number;
  avmValue: number;
  pricePerAcre: number;
  confidence: number;
  confidenceLow: number;
  confidenceHigh: number;
  status: "success" | "error";
  error?: string;
}

export default function AvmBulk() {
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sortField, setSortField] = useState<keyof BulkResult>("avmValue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && (f.name.endsWith(".csv") || f.name.endsWith(".xlsx"))) {
      setFile(f);
    } else {
      toast({ title: "Invalid file", description: "Please upload a CSV file.", variant: "destructive" });
    }
  };

  const handleUploadAndProcess = async () => {
    if (!file) return;
    setIsProcessing(true);
    setProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 5, 90));
      }, 500);

      const res = await fetch("/api/avm/bulk", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (!res.ok) throw new Error("Bulk valuation failed");
      const data = await res.json();
      setResults(data.results || []);
      toast({ title: "Bulk valuation complete", description: `Processed ${data.results.length} properties.` });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExport = () => {
    if (!results.length) return;
    const header = "Address,County,State,Acreage,AVM Value,Price/Acre,Confidence %,Low Estimate,High Estimate\n";
    const rows = results.map(r =>
      `"${r.address}","${r.county}","${r.state}",${r.acreage},${r.avmValue},${r.pricePerAcre},${r.confidence},${r.confidenceLow},${r.confidenceHigh}`
    ).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-valuations-${Date.now()}.csv`;
    a.click();
  };

  const sortedResults = [...results].sort((a, b) => {
    const av = a[sortField] as any;
    const bv = b[sortField] as any;
    return sortDir === "asc" ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  const toggleSort = (field: keyof BulkResult) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const successCount = results.filter(r => r.status === "success").length;
  const errorCount = results.filter(r => r.status === "error").length;
  const avgValue = results.length ? results.filter(r => r.status === "success").reduce((s, r) => s + r.avmValue, 0) / successCount : 0;

  return (
    <div className="p-6 space-y-6">
      <DisclaimerBanner type="avm" />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Bulk AVM Valuation</h1>
          <p className="text-muted-foreground">Upload a CSV of properties to get instant valuations</p>
        </div>
        {results.length > 0 && (
          <Button onClick={handleExport} variant="outline">
            <Download className="h-4 w-4 mr-2" /> Export CSV
          </Button>
        )}
      </div>

      {/* Upload Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Upload Properties
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">{file ? file.name : "Click to upload CSV"}</p>
            <p className="text-sm text-muted-foreground mt-1">
              Required columns: address, county, state, acreage
            </p>
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
          </div>

          {file && (
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{file.name}</Badge>
              <span className="text-sm text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
              <Button onClick={handleUploadAndProcess} disabled={isProcessing}>
                {isProcessing ? "Processing..." : "Run Bulk Valuation"}
              </Button>
            </div>
          )}

          {isProcessing && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Processing properties...</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary Cards */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{results.length}</div>
              <div className="text-sm text-muted-foreground">Total Properties</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600 flex items-center gap-1">
                <CheckCircle className="h-5 w-5" /> {successCount}
              </div>
              <div className="text-sm text-muted-foreground">Successful</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600 flex items-center gap-1">
                <AlertCircle className="h-5 w-5" /> {errorCount}
              </div>
              <div className="text-sm text-muted-foreground">Failed</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">${(avgValue / 1000).toFixed(0)}K</div>
              <div className="text-sm text-muted-foreground">Avg AVM Value</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> Valuation Results
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Address</TableHead>
                  <TableHead>County/State</TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("acreage")}>
                    Acreage {sortField === "acreage" && (sortDir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("avmValue")}>
                    AVM Value {sortField === "avmValue" && (sortDir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("pricePerAcre")}>
                    $/Acre {sortField === "pricePerAcre" && (sortDir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead className="cursor-pointer" onClick={() => toggleSort("confidence")}>
                    Confidence {sortField === "confidence" && (sortDir === "asc" ? "↑" : "↓")}
                  </TableHead>
                  <TableHead>Range</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedResults.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium max-w-[200px] truncate">{r.address}</TableCell>
                    <TableCell>{r.county}, {r.state}</TableCell>
                    <TableCell>{r.acreage?.toFixed(1)}</TableCell>
                    <TableCell>{r.status === "success" ? `$${r.avmValue?.toLocaleString()}` : "—"}</TableCell>
                    <TableCell>{r.status === "success" ? `$${r.pricePerAcre?.toLocaleString()}` : "—"}</TableCell>
                    <TableCell>
                      {r.status === "success" && (
                        <Badge variant={r.confidence >= 80 ? "default" : r.confidence >= 60 ? "secondary" : "destructive"}>
                          {r.confidence}%
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.status === "success" ? `$${(r.confidenceLow/1000).toFixed(0)}K – $${(r.confidenceHigh/1000).toFixed(0)}K` : "—"}
                    </TableCell>
                    <TableCell>
                      {r.status === "success"
                        ? <CheckCircle className="h-4 w-4 text-green-500" />
                        : <span className="text-xs text-red-500">{r.error || "Failed"}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* CSV Format Guide */}
      {!results.length && (
        <Card>
          <CardHeader><CardTitle>CSV Format Guide</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">Your CSV should have these columns (header row required):</p>
            <div className="bg-muted rounded p-3 font-mono text-sm">
              address,county,state,acreage<br />
              "123 Rural Rd","Smith County","TX",45.5<br />
              "456 Farm Lane","Johnson County","OK",120.0
            </div>
            <p className="text-xs text-muted-foreground mt-2">Optional columns: apn, property_type, zoning</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
