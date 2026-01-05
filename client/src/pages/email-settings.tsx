import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout-sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Mail,
  Globe,
  Plus,
  Trash2,
  Star,
  CheckCircle,
  Clock,
  AlertCircle,
  Copy,
  Loader2,
  Inbox,
  Forward,
  ArrowLeftRight,
  Settings,
} from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DnsRecord {
  type: string;
  host: string;
  data: string;
  valid: boolean;
}

interface EmailIdentity {
  id: number;
  organizationId: number;
  teamMemberId?: number;
  type: "platform_alias" | "custom_domain";
  fromEmail: string;
  fromName: string;
  replyToEmail?: string;
  replyRoutingMode: "in_app" | "forward" | "both";
  status: "pending" | "verified" | "failed";
  isDefault: boolean;
  dnsRecords?: DnsRecord[];
  createdAt: string;
}

export default function EmailSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isAddDomainDialogOpen, setIsAddDomainDialogOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newFromEmail, setNewFromEmail] = useState("");
  const [newFromName, setNewFromName] = useState("");
  const [expandedIdentity, setExpandedIdentity] = useState<number | null>(null);
  const [editingRoutingId, setEditingRoutingId] = useState<number | null>(null);

  const { data: identities = [], isLoading: identitiesLoading } = useQuery<EmailIdentity[]>({
    queryKey: ["/api/email-identities"],
  });

  const displayName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user?.username || "User";

  const platformEmail = user?.firstName && user?.lastName
    ? `${user.firstName.toLowerCase()}.${user.lastName.toLowerCase()}@acreage.pro`
    : user?.email?.split("@")[0] + "@acreage.pro" || "your.name@acreage.pro";

  const existingPlatformIdentity = identities.find((i) => i.type === "platform_alias");
  const customIdentities = identities.filter((i) => i.type === "custom_domain");
  const defaultIdentity = identities.find((i) => i.isDefault);

  const activatePlatformMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/email-identities", {
        type: "platform_alias",
        fromName: displayName,
        replyRoutingMode: "in_app",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to activate platform email");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-identities"] });
      toast({
        title: "Platform Email Activated",
        description: `Your email address ${platformEmail} is now being configured.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Activation Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const addCustomDomainMutation = useMutation({
    mutationFn: async (data: { domain: string; fromEmail: string; fromName: string }) => {
      const res = await apiRequest("POST", "/api/email-identities", {
        type: "custom_domain",
        fromEmail: data.fromEmail,
        fromName: data.fromName,
        replyRoutingMode: "in_app",
      });
      if (!res.ok) {
        const responseData = await res.json();
        throw new Error(responseData.message || "Failed to add custom domain");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-identities"] });
      setIsAddDomainDialogOpen(false);
      setNewDomain("");
      setNewFromEmail("");
      setNewFromName("");
      toast({
        title: "Domain Added",
        description: "Configure the DNS records shown to verify your domain.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Add Domain",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (identityId: number) => {
      const res = await apiRequest("POST", `/api/email-identities/${identityId}/set-default`, {});
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to set default");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-identities"] });
      toast({ title: "Default identity updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Update",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteIdentityMutation = useMutation({
    mutationFn: async (identityId: number) => {
      const res = await apiRequest("DELETE", `/api/email-identities/${identityId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to delete identity");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-identities"] });
      toast({ title: "Identity removed" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Remove",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateRoutingMutation = useMutation({
    mutationFn: async ({ id, replyRoutingMode, replyToEmail }: { 
      id: number; 
      replyRoutingMode: "in_app" | "forward" | "both";
      replyToEmail?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/email-identities/${id}`, {
        replyRoutingMode,
        replyToEmail,
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update routing");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-identities"] });
      setEditingRoutingId(null);
      toast({ title: "Routing settings updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Update",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "verified":
        return (
          <Badge variant="default" className="bg-green-600" data-testid="badge-status-verified">
            <CheckCircle className="w-3 h-3 mr-1" /> Verified
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary" data-testid="badge-status-pending">
            <Clock className="w-3 h-3 mr-1" /> Pending
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" data-testid="badge-status-failed">
            <AlertCircle className="w-3 h-3 mr-1" /> Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRoutingIcon = (mode: string) => {
    switch (mode) {
      case "in_app":
        return <Inbox className="w-4 h-4" />;
      case "forward":
        return <Forward className="w-4 h-4" />;
      case "both":
        return <ArrowLeftRight className="w-4 h-4" />;
      default:
        return null;
    }
  };

  const getRoutingLabel = (mode: string) => {
    switch (mode) {
      case "in_app":
        return "In-App Only";
      case "forward":
        return "Forward";
      case "both":
        return "Both";
      default:
        return mode;
    }
  };

  const getDomainFromEmail = (email: string) => {
    const parts = email.split("@");
    return parts.length > 1 ? parts[1] : "";
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Email Settings</h1>
            <p className="text-muted-foreground">
              Configure your email sender identities and reply routing preferences.
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5" />
                Platform Email
              </CardTitle>
              <CardDescription>
                Use an auto-generated @acreage.pro email address for sending campaigns.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 flex-wrap p-4 border rounded-md bg-muted/30">
                <div className="space-y-1">
                  <Label className="text-sm text-muted-foreground">Your Platform Email</Label>
                  <p className="font-mono text-sm" data-testid="text-platform-email">
                    {existingPlatformIdentity?.fromEmail || platformEmail}
                  </p>
                </div>
                {existingPlatformIdentity ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {getStatusBadge(existingPlatformIdentity.status)}
                    {existingPlatformIdentity.isDefault && (
                      <Badge variant="outline" className="text-xs" data-testid="badge-default-platform">
                        <Star className="w-3 h-3 mr-1" /> Default
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs" data-testid="badge-routing-platform">
                      {getRoutingIcon(existingPlatformIdentity.replyRoutingMode)}
                      <span className="ml-1">{getRoutingLabel(existingPlatformIdentity.replyRoutingMode)}</span>
                    </Badge>
                  </div>
                ) : (
                  <Button
                    onClick={() => activatePlatformMutation.mutate()}
                    disabled={activatePlatformMutation.isPending}
                    data-testid="button-activate-platform"
                  >
                    {activatePlatformMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Mail className="w-4 h-4 mr-2" />
                    )}
                    Activate Platform Email
                  </Button>
                )}
              </div>

              {existingPlatformIdentity && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <Label className="text-sm">Reply Routing</Label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingRoutingId(
                        editingRoutingId === existingPlatformIdentity.id 
                          ? null 
                          : existingPlatformIdentity.id
                      )}
                      data-testid="button-edit-routing-platform"
                    >
                      <Settings className="w-4 h-4 mr-1" />
                      {editingRoutingId === existingPlatformIdentity.id ? "Cancel" : "Configure"}
                    </Button>
                  </div>

                  {editingRoutingId === existingPlatformIdentity.id && (
                    <RoutingEditor
                      identity={existingPlatformIdentity}
                      onSave={(mode, replyToEmail) => {
                        updateRoutingMutation.mutate({
                          id: existingPlatformIdentity.id,
                          replyRoutingMode: mode,
                          replyToEmail,
                        });
                      }}
                      isPending={updateRoutingMutation.isPending}
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    Custom Domains
                  </CardTitle>
                  <CardDescription>
                    Verify your own domain to send emails from your business address.
                  </CardDescription>
                </div>
                <Dialog open={isAddDomainDialogOpen} onOpenChange={setIsAddDomainDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" data-testid="button-add-domain">
                      <Plus className="w-4 h-4 mr-1" /> Add Domain
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Custom Domain</DialogTitle>
                      <DialogDescription>
                        Enter your domain and the email address you want to send from.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="fromName">Display Name</Label>
                        <Input
                          id="fromName"
                          placeholder="Your Name or Company"
                          value={newFromName}
                          onChange={(e) => setNewFromName(e.target.value)}
                          data-testid="input-from-name"
                        />
                        <p className="text-xs text-muted-foreground">
                          This name will appear as the sender in recipient inboxes.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="fromEmail">From Email Address</Label>
                        <Input
                          id="fromEmail"
                          placeholder="info@yourdomain.com"
                          value={newFromEmail}
                          onChange={(e) => {
                            setNewFromEmail(e.target.value);
                            const domain = getDomainFromEmail(e.target.value);
                            if (domain) setNewDomain(domain);
                          }}
                          data-testid="input-from-email"
                        />
                        <p className="text-xs text-muted-foreground">
                          The full email address you want to send from (e.g., info@yourdomain.com).
                        </p>
                      </div>
                      {newDomain && (
                        <div className="p-3 bg-muted/50 rounded-md">
                          <p className="text-sm">
                            <span className="text-muted-foreground">Domain to verify:</span>{" "}
                            <span className="font-mono font-medium" data-testid="text-detected-domain">{newDomain}</span>
                          </p>
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setIsAddDomainDialogOpen(false);
                          setNewDomain("");
                          setNewFromEmail("");
                          setNewFromName("");
                        }}
                        data-testid="button-cancel-add-domain"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={() => addCustomDomainMutation.mutate({
                          domain: newDomain,
                          fromEmail: newFromEmail,
                          fromName: newFromName,
                        })}
                        disabled={!newFromEmail || !newFromName || addCustomDomainMutation.isPending}
                        data-testid="button-confirm-add-domain"
                      >
                        {addCustomDomainMutation.isPending ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : null}
                        {addCustomDomainMutation.isPending ? "Adding..." : "Add Domain"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent>
              {identitiesLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : customIdentities.length === 0 ? (
                <div className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-custom-domains">
                  No custom domains added yet. Add a domain to send from your own email address.
                </div>
              ) : (
                <div className="space-y-3">
                  {customIdentities.map((identity) => (
                    <div key={identity.id} className="border rounded-md p-3" data-testid={`card-custom-domain-${identity.id}`}>
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div>
                            <span className="font-medium" data-testid={`text-identity-email-${identity.id}`}>
                              {identity.fromEmail}
                            </span>
                            {identity.fromName && (
                              <span className="text-muted-foreground text-sm ml-2" data-testid={`text-identity-name-${identity.id}`}>
                                ({identity.fromName})
                              </span>
                            )}
                          </div>
                          {getStatusBadge(identity.status)}
                          {identity.isDefault && (
                            <Badge variant="outline" className="text-xs" data-testid={`badge-default-${identity.id}`}>
                              <Star className="w-3 h-3 mr-1" /> Default
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs" data-testid={`badge-routing-${identity.id}`}>
                            {getRoutingIcon(identity.replyRoutingMode)}
                            <span className="ml-1">{getRoutingLabel(identity.replyRoutingMode)}</span>
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setExpandedIdentity(expandedIdentity === identity.id ? null : identity.id)
                            }
                            data-testid={`button-toggle-dns-${identity.id}`}
                          >
                            {expandedIdentity === identity.id ? "Hide DNS" : "Show DNS"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingRoutingId(
                              editingRoutingId === identity.id ? null : identity.id
                            )}
                            data-testid={`button-edit-routing-${identity.id}`}
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                          {identity.status === "verified" && !identity.isDefault && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDefaultMutation.mutate(identity.id)}
                              disabled={setDefaultMutation.isPending}
                              data-testid={`button-set-default-${identity.id}`}
                            >
                              <Star className="w-4 h-4 mr-1" />
                              Set Default
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteIdentityMutation.mutate(identity.id)}
                            disabled={deleteIdentityMutation.isPending}
                            data-testid={`button-delete-identity-${identity.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>

                      {editingRoutingId === identity.id && (
                        <div className="mt-3 pt-3 border-t">
                          <RoutingEditor
                            identity={identity}
                            onSave={(mode, replyToEmail) => {
                              updateRoutingMutation.mutate({
                                id: identity.id,
                                replyRoutingMode: mode,
                                replyToEmail,
                              });
                            }}
                            isPending={updateRoutingMutation.isPending}
                          />
                        </div>
                      )}

                      {expandedIdentity === identity.id && (
                        <div className="mt-3 border rounded-md overflow-hidden">
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
                              {identity.dnsRecords && identity.dnsRecords.length > 0 ? (
                                identity.dnsRecords.map((record, idx) => (
                                  <TableRow key={idx} data-testid={`row-dns-record-${identity.id}-${idx}`}>
                                    <TableCell className="font-mono text-xs">{record.type}</TableCell>
                                    <TableCell className="font-mono text-xs break-all">
                                      {record.host}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs break-all max-w-xs truncate">
                                      {record.data}
                                    </TableCell>
                                    <TableCell>
                                      {record.valid ? (
                                        <CheckCircle className="w-4 h-4 text-green-600" />
                                      ) : (
                                        <Clock className="w-4 h-4 text-muted-foreground" />
                                      )}
                                    </TableCell>
                                    <TableCell>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        onClick={() => copyToClipboard(record.data)}
                                        data-testid={`button-copy-dns-${identity.id}-${idx}`}
                                      >
                                        <Copy className="w-3 h-3" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <>
                                  <TableRow>
                                    <TableCell className="font-mono text-xs">TXT</TableCell>
                                    <TableCell className="font-mono text-xs">
                                      _dmarc.{getDomainFromEmail(identity.fromEmail)}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                      DMARC record will be provided after setup
                                    </TableCell>
                                    <TableCell>
                                      <Clock className="w-4 h-4 text-muted-foreground" />
                                    </TableCell>
                                    <TableCell></TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell className="font-mono text-xs">CNAME</TableCell>
                                    <TableCell className="font-mono text-xs">
                                      s1._domainkey.{getDomainFromEmail(identity.fromEmail)}
                                    </TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                      DKIM record will be provided after setup
                                    </TableCell>
                                    <TableCell>
                                      <Clock className="w-4 h-4 text-muted-foreground" />
                                    </TableCell>
                                    <TableCell></TableCell>
                                  </TableRow>
                                  <TableRow>
                                    <TableCell className="font-mono text-xs">TXT</TableCell>
                                    <TableCell className="font-mono text-xs">{getDomainFromEmail(identity.fromEmail)}</TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">
                                      SPF record will be provided after setup
                                    </TableCell>
                                    <TableCell>
                                      <Clock className="w-4 h-4 text-muted-foreground" />
                                    </TableCell>
                                    <TableCell></TableCell>
                                  </TableRow>
                                </>
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {identities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  All Identities
                </CardTitle>
                <CardDescription>
                  All configured email sender identities for your organization.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {identities.map((identity) => (
                    <div
                      key={identity.id}
                      className={`flex items-center justify-between gap-4 p-3 border rounded-md flex-wrap ${
                        identity.isDefault ? "border-primary/50 bg-primary/5" : ""
                      }`}
                      data-testid={`card-identity-${identity.id}`}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        {identity.type === "platform_alias" ? (
                          <Mail className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <Globe className="w-5 h-5 text-muted-foreground" />
                        )}
                        <div>
                          <p className="font-medium" data-testid={`text-all-identity-email-${identity.id}`}>
                            {identity.fromEmail}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {identity.type === "platform_alias" ? "Platform Email" : "Custom Domain"}
                            {identity.fromName && ` - ${identity.fromName}`}
                          </p>
                        </div>
                        {getStatusBadge(identity.status)}
                        {identity.isDefault && (
                          <Badge variant="outline" className="text-xs" data-testid={`badge-default-all-${identity.id}`}>
                            <Star className="w-3 h-3 mr-1" /> Default
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs" data-testid={`badge-routing-all-${identity.id}`}>
                          {getRoutingIcon(identity.replyRoutingMode)}
                          <span className="ml-1">{getRoutingLabel(identity.replyRoutingMode)}</span>
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        {identity.status === "verified" && !identity.isDefault && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDefaultMutation.mutate(identity.id)}
                            disabled={setDefaultMutation.isPending}
                            data-testid={`button-set-default-all-${identity.id}`}
                          >
                            <Star className="w-4 h-4 mr-1" />
                            Set Default
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteIdentityMutation.mutate(identity.id)}
                          disabled={deleteIdentityMutation.isPending}
                          data-testid={`button-delete-all-${identity.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

function RoutingEditor({ 
  identity, 
  onSave, 
  isPending 
}: { 
  identity: EmailIdentity;
  onSave: (mode: "in_app" | "forward" | "both", replyToEmail?: string) => void;
  isPending: boolean;
}) {
  const [mode, setMode] = useState<"in_app" | "forward" | "both">(identity.replyRoutingMode);
  const [replyToEmail, setReplyToEmail] = useState(identity.replyToEmail || "");

  return (
    <div className="space-y-4">
      <RadioGroup
        value={mode}
        onValueChange={(value) => setMode(value as "in_app" | "forward" | "both")}
        className="space-y-2"
      >
        <div className="flex items-start gap-3 p-3 border rounded-md">
          <RadioGroupItem value="in_app" id={`in_app_${identity.id}`} data-testid={`radio-in-app-${identity.id}`} />
          <div className="flex-1">
            <Label htmlFor={`in_app_${identity.id}`} className="flex items-center gap-2 cursor-pointer">
              <Inbox className="w-4 h-4 text-muted-foreground" />
              In-App Only
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              Replies are only visible in your app inbox.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 border rounded-md">
          <RadioGroupItem value="forward" id={`forward_${identity.id}`} data-testid={`radio-forward-${identity.id}`} />
          <div className="flex-1">
            <Label htmlFor={`forward_${identity.id}`} className="flex items-center gap-2 cursor-pointer">
              <Forward className="w-4 h-4 text-muted-foreground" />
              Forward to Email
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              Replies are forwarded to your personal email address.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 border rounded-md">
          <RadioGroupItem value="both" id={`both_${identity.id}`} data-testid={`radio-both-${identity.id}`} />
          <div className="flex-1">
            <Label htmlFor={`both_${identity.id}`} className="flex items-center gap-2 cursor-pointer">
              <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
              Both
            </Label>
            <p className="text-sm text-muted-foreground mt-1">
              Replies appear in app inbox AND are forwarded to your email.
            </p>
          </div>
        </div>
      </RadioGroup>

      {(mode === "forward" || mode === "both") && (
        <div className="space-y-2">
          <Label htmlFor={`forwarding-email-${identity.id}`}>Forwarding Email Address</Label>
          <Input
            id={`forwarding-email-${identity.id}`}
            type="email"
            placeholder="you@example.com"
            value={replyToEmail}
            onChange={(e) => setReplyToEmail(e.target.value)}
            data-testid={`input-forwarding-email-${identity.id}`}
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button
          onClick={() => onSave(mode, mode !== "in_app" ? replyToEmail : undefined)}
          disabled={isPending || ((mode === "forward" || mode === "both") && !replyToEmail)}
          data-testid={`button-save-routing-${identity.id}`}
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : null}
          Save Routing Settings
        </Button>
      </div>
    </div>
  );
}
