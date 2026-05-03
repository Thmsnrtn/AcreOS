import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle,
  Clock,
  AlertCircle,
  Star
} from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface DnsRecord {
  type: string;
  host: string;
  data: string;
  valid: boolean;
}

interface EmailDomain {
  id: number;
  organizationId: number;
  domain: string;
  sendgridDomainId: string | null;
  status: string;
  dnsRecords: DnsRecord[] | null;
  fromEmail: string | null;
  fromName: string | null;
  isDefault: boolean | null;
  verifiedAt: string | null;
  createdAt: string;
}

export function EmailDomainsSettings() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newFromEmail, setNewFromEmail] = useState("");
  const [newFromName, setNewFromName] = useState("");
  const [expandedDomain, setExpandedDomain] = useState<number | null>(null);

  const { data: domains = [], isLoading } = useQuery<EmailDomain[]>({
    queryKey: ["/api/email-domains"],
  });

  const addDomainMutation = useMutation({
    mutationFn: async (data: { domain: string; fromEmail?: string; fromName?: string }) => {
      const res = await apiRequest("POST", "/api/email-domains", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-domains"] });
      setIsAddDialogOpen(false);
      setNewDomain("");
      setNewFromEmail("");
      setNewFromName("");
      toast({ title: "Domain added", description: "Add the DNS records shown below to verify your domain." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't add domain", description: `${err.message} — your draft is preserved.`, variant: "destructive" });
    },
  });

  const verifyDomainMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await apiRequest("POST", `/api/email-domains/${domainId}/verify`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-domains"] });
      if (data.verified) {
        toast({ title: "Domain verified", description: "Your domain is now verified and ready to use." });
      } else {
        toast({ title: "Verification pending", description: "DNS records not yet propagated. Try again in a few minutes." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Couldn't verify domain", description: `${err.message} — the domain is still pending verification.`, variant: "destructive" });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await apiRequest("PATCH", `/api/email-domains/${domainId}`, { isDefault: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-domains"] });
      toast({ title: "Default domain updated" });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't update default", description: `${err.message} — the previous default is unchanged.`, variant: "destructive" });
    },
  });

  const deleteDomainMutation = useMutation({
    mutationFn: async (domainId: number) => {
      const res = await apiRequest("DELETE", `/api/email-domains/${domainId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-domains"] });
      toast({ title: "Domain removed" });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't remove domain", description: `${err.message} — the domain is still on your account.`, variant: "destructive" });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "verified":
        return <Badge variant="default" className="bg-acr-pos"><CheckCircle className="w-3 h-3 mr-1" /> Verified</Badge>;
      case "pending":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case "failed":
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5" />
              Email Domains
            </CardTitle>
            <CardDescription>
              Verify your email domains to send from your own addresses
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" data-testid="button-add-domain">
                <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Add domain
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add email domain</DialogTitle>
                <DialogDescription>
                  Enter your domain to begin the verification process. You'll need to add DNS records to verify ownership.
                </DialogDescription>
              </DialogHeader>
              <form
                id="add-domain-form"
                className="space-y-4 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newDomain || addDomainMutation.isPending) return;
                  addDomainMutation.mutate({
                    domain: newDomain,
                    fromEmail: newFromEmail || undefined,
                    fromName: newFromName || undefined,
                  });
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="domain">Domain</Label>
                  <Input
                    id="domain"
                    placeholder="example.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="off"
                    required
                    data-testid="input-domain"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fromEmail">From email <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="fromEmail"
                    type="email"
                    inputMode="email"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="email"
                    placeholder="noreply@example.com"
                    value={newFromEmail}
                    onChange={(e) => setNewFromEmail(e.target.value)}
                    data-testid="input-from-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fromName">From name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id="fromName"
                    placeholder="My Company"
                    value={newFromName}
                    onChange={(e) => setNewFromName(e.target.value)}
                    autoCapitalize="words"
                    autoComplete="organization"
                    data-testid="input-from-name"
                  />
                </div>
              </form>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  form="add-domain-form"
                  disabled={!newDomain || addDomainMutation.isPending}
                  data-testid="button-confirm-add-domain"
                >
                  {addDomainMutation.isPending ? "Adding…" : "Add domain"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div role="status" aria-busy="true" aria-live="polite" className="text-sm text-muted-foreground">Loading domains…</div>
        ) : domains.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            No domains added yet. Add a domain to send emails from your own address.
          </div>
        ) : (
          <div className="space-y-3">
            {domains.map((domain) => (
              <Collapsible
                key={domain.id}
                open={expandedDomain === domain.id}
                onOpenChange={(open) => setExpandedDomain(open ? domain.id : null)}
              >
                <div className="border rounded-md p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium" data-testid={`text-domain-${domain.id}`}>{domain.domain}</span>
                      {getStatusBadge(domain.status)}
                      {domain.isDefault && (
                        <Badge variant="outline" className="text-xs">
                          <Star className="w-3 h-3 mr-1" /> Default
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {domain.status === "pending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => verifyDomainMutation.mutate(domain.id)}
                          disabled={verifyDomainMutation.isPending}
                          data-testid={`button-verify-domain-${domain.id}`}
                        >
                          <RefreshCw className={`w-4 h-4 mr-1 ${verifyDomainMutation.isPending ? 'animate-spin' : ''}`} />
                          Verify
                        </Button>
                      )}
                      {domain.status === "verified" && !domain.isDefault && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDefaultMutation.mutate(domain.id)}
                          data-testid={`button-set-default-${domain.id}`}
                        >
                          <Star className="w-4 h-4 mr-1" aria-hidden="true" />
                          Set default
                        </Button>
                      )}
                      <CollapsibleTrigger asChild>
                        <Button size="sm" variant="ghost" data-testid={`button-toggle-dns-${domain.id}`}>
                          {expandedDomain === domain.id ? "Hide DNS" : "Show DNS"}
                        </Button>
                      </CollapsibleTrigger>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteDomainMutation.mutate(domain.id)}
                        aria-label={`Delete domain ${domain.domain}`}
                        data-testid={`button-delete-domain-${domain.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  
                  {domain.fromEmail && (
                    <div className="text-sm text-muted-foreground mt-1">
                      From: {domain.fromName ? `${domain.fromName} <${domain.fromEmail}>` : domain.fromEmail}
                    </div>
                  )}

                  <CollapsibleContent className="mt-3">
                    {domain.dnsRecords && domain.dnsRecords.length > 0 ? (
                      <div className="border rounded-md overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-20">Type</TableHead>
                              <TableHead>Host</TableHead>
                              <TableHead>Value</TableHead>
                              <TableHead className="w-20">Status</TableHead>
                              <TableHead className="w-10"></TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {domain.dnsRecords.map((record, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="font-mono text-xs">{record.type}</TableCell>
                                <TableCell className="font-mono text-xs break-all">{record.host}</TableCell>
                                <TableCell className="font-mono text-xs break-all max-w-xs truncate">{record.data}</TableCell>
                                <TableCell>
                                  {record.valid ? (
                                    <CheckCircle className="w-4 h-4 text-acr-pos" />
                                  ) : (
                                    <Clock className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </TableCell>
                                <TableCell>
                                  <CopyButton
                                    value={record.data}
                                    srLabel="Copy DNS record"
                                    successMessage="DNS record copied"
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        No DNS records available. Make sure your SendGrid API key is configured.
                      </div>
                    )}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
