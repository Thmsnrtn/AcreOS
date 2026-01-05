import { useState } from "react";
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

interface EmailIdentity {
  id: number;
  type: "platform" | "custom";
  email: string;
  domain?: string;
  status: "pending" | "verified" | "failed";
  isDefault: boolean;
  dnsRecords?: DnsRecord[];
  createdAt: string;
}

interface DnsRecord {
  type: string;
  host: string;
  data: string;
  valid: boolean;
}

interface ReplySettings {
  routing: "in_app" | "forward" | "both";
  forwardingEmail?: string;
}

export default function EmailSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isAddDomainDialogOpen, setIsAddDomainDialogOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [expandedIdentity, setExpandedIdentity] = useState<number | null>(null);

  const { data: identities = [], isLoading: identitiesLoading } = useQuery<EmailIdentity[]>({
    queryKey: ["/api/email-identities"],
  });

  const { data: replySettings, isLoading: replySettingsLoading } = useQuery<ReplySettings>({
    queryKey: ["/api/email-identities", "reply-settings"],
  });

  const [localReplySettings, setLocalReplySettings] = useState<ReplySettings>({
    routing: "in_app",
    forwardingEmail: "",
  });

  const platformEmail = user?.firstName && user?.lastName
    ? `${user.firstName.toLowerCase()}.${user.lastName.toLowerCase()}@acreage.pro`
    : user?.email?.split("@")[0] + "@acreage.pro" || "your.name@acreage.pro";

  const existingPlatformIdentity = identities.find((i) => i.type === "platform");
  const customIdentities = identities.filter((i) => i.type === "custom");

  const activatePlatformMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/email-identities", {
        type: "platform",
        email: platformEmail,
      });
      if (!res.ok) throw new Error("Failed to activate platform email");
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
    mutationFn: async (domain: string) => {
      const res = await apiRequest("POST", "/api/email-identities", {
        type: "custom",
        domain,
      });
      if (!res.ok) throw new Error("Failed to add custom domain");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-identities"] });
      setIsAddDomainDialogOpen(false);
      setNewDomain("");
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
      const res = await apiRequest("PATCH", `/api/email-identities/${identityId}`, {
        isDefault: true,
      });
      if (!res.ok) throw new Error("Failed to set default");
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
      if (!res.ok) throw new Error("Failed to delete identity");
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

  const updateReplySettingsMutation = useMutation({
    mutationFn: async (settings: ReplySettings) => {
      const res = await apiRequest("PUT", "/api/email-identities/reply-settings", settings);
      if (!res.ok) throw new Error("Failed to update reply settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/email-identities", "reply-settings"] });
      toast({ title: "Reply settings updated" });
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
          <Badge variant="default" className="bg-green-600">
            <CheckCircle className="w-3 h-3 mr-1" /> Verified
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="secondary">
            <Clock className="w-3 h-3 mr-1" /> Pending
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive">
            <AlertCircle className="w-3 h-3 mr-1" /> Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const currentRouting = replySettings?.routing || localReplySettings.routing;
  const currentForwardingEmail = replySettings?.forwardingEmail || localReplySettings.forwardingEmail;

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
                    {platformEmail}
                  </p>
                </div>
                {existingPlatformIdentity ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    {getStatusBadge(existingPlatformIdentity.status)}
                    {existingPlatformIdentity.isDefault && (
                      <Badge variant="outline" className="text-xs">
                        <Star className="w-3 h-3 mr-1" /> Default
                      </Badge>
                    )}
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    Custom Domain
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
                        Enter your domain to begin the verification process. You'll need to add DNS records to verify ownership.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="domain">Domain Name</Label>
                        <Input
                          id="domain"
                          placeholder="yourdomain.com"
                          value={newDomain}
                          onChange={(e) => setNewDomain(e.target.value)}
                          data-testid="input-domain"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddDomainDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={() => addCustomDomainMutation.mutate(newDomain)}
                        disabled={!newDomain || addCustomDomainMutation.isPending}
                        data-testid="button-confirm-add-domain"
                      >
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
                <div className="text-sm text-muted-foreground py-4 text-center">
                  No custom domains added yet. Add a domain to send from your own email address.
                </div>
              ) : (
                <div className="space-y-3">
                  {customIdentities.map((identity) => (
                    <div key={identity.id} className="border rounded-md p-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium" data-testid={`text-domain-${identity.id}`}>
                            {identity.domain || identity.email}
                          </span>
                          {getStatusBadge(identity.status)}
                          {identity.isDefault && (
                            <Badge variant="outline" className="text-xs">
                              <Star className="w-3 h-3 mr-1" /> Default
                            </Badge>
                          )}
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
                          {identity.status === "verified" && !identity.isDefault && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDefaultMutation.mutate(identity.id)}
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
                            data-testid={`button-delete-identity-${identity.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>

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
                                  <TableRow key={idx}>
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
                                      _dmarc.{identity.domain}
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
                                      s1._domainkey.{identity.domain}
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
                                    <TableCell className="font-mono text-xs">{identity.domain}</TableCell>
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Forward className="w-5 h-5" />
                Reply Routing Settings
              </CardTitle>
              <CardDescription>
                Configure how incoming email replies are handled.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {replySettingsLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <RadioGroup
                    value={currentRouting}
                    onValueChange={(value) => {
                      const newSettings = {
                        ...localReplySettings,
                        routing: value as ReplySettings["routing"],
                      };
                      setLocalReplySettings(newSettings);
                      updateReplySettingsMutation.mutate(newSettings);
                    }}
                    className="space-y-3"
                  >
                    <div className="flex items-start gap-3 p-3 border rounded-md hover-elevate">
                      <RadioGroupItem value="in_app" id="in_app" data-testid="radio-in-app" />
                      <div className="flex-1">
                        <Label htmlFor="in_app" className="flex items-center gap-2 cursor-pointer">
                          <Inbox className="w-4 h-4 text-muted-foreground" />
                          In-App Only
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Replies are only visible in your app inbox.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 border rounded-md hover-elevate">
                      <RadioGroupItem value="forward" id="forward" data-testid="radio-forward" />
                      <div className="flex-1">
                        <Label htmlFor="forward" className="flex items-center gap-2 cursor-pointer">
                          <Forward className="w-4 h-4 text-muted-foreground" />
                          Forward to Email
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Replies are forwarded to your personal email address.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3 p-3 border rounded-md hover-elevate">
                      <RadioGroupItem value="both" id="both" data-testid="radio-both" />
                      <div className="flex-1">
                        <Label htmlFor="both" className="flex items-center gap-2 cursor-pointer">
                          <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
                          Both
                        </Label>
                        <p className="text-sm text-muted-foreground mt-1">
                          Replies appear in app inbox AND are forwarded to your email.
                        </p>
                      </div>
                    </div>
                  </RadioGroup>

                  {(currentRouting === "forward" || currentRouting === "both") && (
                    <div className="space-y-2 pt-2">
                      <Label htmlFor="forwarding-email">Forwarding Email Address</Label>
                      <div className="flex gap-2">
                        <Input
                          id="forwarding-email"
                          type="email"
                          placeholder="you@example.com"
                          value={currentForwardingEmail || ""}
                          onChange={(e) =>
                            setLocalReplySettings({
                              ...localReplySettings,
                              forwardingEmail: e.target.value,
                            })
                          }
                          data-testid="input-forwarding-email"
                        />
                        <Button
                          onClick={() =>
                            updateReplySettingsMutation.mutate({
                              routing: currentRouting,
                              forwardingEmail: localReplySettings.forwardingEmail,
                            })
                          }
                          disabled={updateReplySettingsMutation.isPending}
                          data-testid="button-save-forwarding"
                        >
                          {updateReplySettingsMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Save"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {identities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mail className="w-5 h-5" />
                  Active Identities
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
                      className="flex items-center justify-between gap-4 p-3 border rounded-md flex-wrap"
                      data-testid={`card-identity-${identity.id}`}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        {identity.type === "platform" ? (
                          <Mail className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <Globe className="w-5 h-5 text-muted-foreground" />
                        )}
                        <div>
                          <p className="font-medium" data-testid={`text-identity-email-${identity.id}`}>
                            {identity.email || identity.domain}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {identity.type === "platform" ? "Platform Email" : "Custom Domain"}
                          </p>
                        </div>
                        {getStatusBadge(identity.status)}
                        {identity.isDefault && (
                          <Badge variant="outline" className="text-xs">
                            <Star className="w-3 h-3 mr-1" /> Default
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {identity.status === "verified" && !identity.isDefault && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDefaultMutation.mutate(identity.id)}
                            disabled={setDefaultMutation.isPending}
                            data-testid={`button-set-default-active-${identity.id}`}
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
                          data-testid={`button-delete-active-${identity.id}`}
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
