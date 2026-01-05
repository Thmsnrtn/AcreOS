import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Sidebar } from "@/components/layout-sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Mail,
  Plus,
  Trash2,
  Star,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  MoreHorizontal,
  Pencil,
  Send,
  MapPin,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface MailIdentity {
  id: number;
  organizationId: number;
  name: string;
  companyName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  status: "draft" | "pending_verification" | "verified" | "failed";
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const mailIdentityFormSchema = z.object({
  name: z.string().min(1, "Identity name is required"),
  companyName: z.string().min(1, "Company name is required"),
  addressLine1: z.string().min(1, "Address is required"),
  addressLine2: z.string().optional(),
  city: z.string().min(1, "City is required"),
  state: z.string().min(2, "State is required").max(2, "Use 2-letter state code"),
  zipCode: z.string().min(5, "ZIP code is required"),
  country: z.string().default("US"),
});

type MailIdentityFormValues = z.infer<typeof mailIdentityFormSchema>;

const US_STATES = [
  { value: "AL", label: "Alabama" },
  { value: "AK", label: "Alaska" },
  { value: "AZ", label: "Arizona" },
  { value: "AR", label: "Arkansas" },
  { value: "CA", label: "California" },
  { value: "CO", label: "Colorado" },
  { value: "CT", label: "Connecticut" },
  { value: "DE", label: "Delaware" },
  { value: "FL", label: "Florida" },
  { value: "GA", label: "Georgia" },
  { value: "HI", label: "Hawaii" },
  { value: "ID", label: "Idaho" },
  { value: "IL", label: "Illinois" },
  { value: "IN", label: "Indiana" },
  { value: "IA", label: "Iowa" },
  { value: "KS", label: "Kansas" },
  { value: "KY", label: "Kentucky" },
  { value: "LA", label: "Louisiana" },
  { value: "ME", label: "Maine" },
  { value: "MD", label: "Maryland" },
  { value: "MA", label: "Massachusetts" },
  { value: "MI", label: "Michigan" },
  { value: "MN", label: "Minnesota" },
  { value: "MS", label: "Mississippi" },
  { value: "MO", label: "Missouri" },
  { value: "MT", label: "Montana" },
  { value: "NE", label: "Nebraska" },
  { value: "NV", label: "Nevada" },
  { value: "NH", label: "New Hampshire" },
  { value: "NJ", label: "New Jersey" },
  { value: "NM", label: "New Mexico" },
  { value: "NY", label: "New York" },
  { value: "NC", label: "North Carolina" },
  { value: "ND", label: "North Dakota" },
  { value: "OH", label: "Ohio" },
  { value: "OK", label: "Oklahoma" },
  { value: "OR", label: "Oregon" },
  { value: "PA", label: "Pennsylvania" },
  { value: "RI", label: "Rhode Island" },
  { value: "SC", label: "South Carolina" },
  { value: "SD", label: "South Dakota" },
  { value: "TN", label: "Tennessee" },
  { value: "TX", label: "Texas" },
  { value: "UT", label: "Utah" },
  { value: "VT", label: "Vermont" },
  { value: "VA", label: "Virginia" },
  { value: "WA", label: "Washington" },
  { value: "WV", label: "West Virginia" },
  { value: "WI", label: "Wisconsin" },
  { value: "WY", label: "Wyoming" },
];

export default function MailSettings() {
  const { toast } = useToast();
  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState<MailIdentity | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [identityToDelete, setIdentityToDelete] = useState<MailIdentity | null>(null);

  const form = useForm<MailIdentityFormValues>({
    resolver: zodResolver(mailIdentityFormSchema),
    defaultValues: {
      name: "",
      companyName: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      zipCode: "",
      country: "US",
    },
  });

  const { data: identities = [], isLoading } = useQuery<MailIdentity[]>({
    queryKey: ["/api/mail-identities"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: MailIdentityFormValues) => {
      const res = await apiRequest("POST", "/api/mail-identities", data);
      if (!res.ok) {
        const responseData = await res.json();
        throw new Error(responseData.message || "Failed to create mail identity");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-identities"] });
      closeFormDialog();
      toast({
        title: "Return Address Created",
        description: "Your new mail sender identity has been added.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Create",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: MailIdentityFormValues }) => {
      const res = await apiRequest("PATCH", `/api/mail-identities/${id}`, data);
      if (!res.ok) {
        const responseData = await res.json();
        throw new Error(responseData.message || "Failed to update mail identity");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-identities"] });
      closeFormDialog();
      toast({ title: "Return address updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Update",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/mail-identities/${id}`);
      if (!res.ok) {
        const responseData = await res.json();
        throw new Error(responseData.message || "Failed to delete mail identity");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-identities"] });
      setDeleteDialogOpen(false);
      setIdentityToDelete(null);
      toast({ title: "Return address removed" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Delete",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/mail-identities/${id}/set-default`, {});
      if (!res.ok) {
        const responseData = await res.json();
        throw new Error(responseData.message || "Failed to set default");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-identities"] });
      toast({ title: "Default return address updated" });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to Update",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/mail-identities/${id}/verify`, {});
      if (!res.ok) {
        const responseData = await res.json();
        throw new Error(responseData.message || "Failed to verify address");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mail-identities"] });
      toast({
        title: "Verification Initiated",
        description: "Address verification has been submitted.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Verification Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const openAddDialog = () => {
    setEditingIdentity(null);
    form.reset({
      name: "",
      companyName: "",
      addressLine1: "",
      addressLine2: "",
      city: "",
      state: "",
      zipCode: "",
      country: "US",
    });
    setIsFormDialogOpen(true);
  };

  const openEditDialog = (identity: MailIdentity) => {
    setEditingIdentity(identity);
    form.reset({
      name: identity.name,
      companyName: identity.companyName,
      addressLine1: identity.addressLine1,
      addressLine2: identity.addressLine2 || "",
      city: identity.city,
      state: identity.state,
      zipCode: identity.zipCode,
      country: identity.country,
    });
    setIsFormDialogOpen(true);
  };

  const closeFormDialog = () => {
    setIsFormDialogOpen(false);
    setEditingIdentity(null);
    form.reset();
  };

  const openDeleteDialog = (identity: MailIdentity) => {
    setIdentityToDelete(identity);
    setDeleteDialogOpen(true);
  };

  const handleFormSubmit = (data: MailIdentityFormValues) => {
    if (editingIdentity) {
      updateMutation.mutate({ id: editingIdentity.id, data });
    } else {
      createMutation.mutate(data);
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
      case "pending_verification":
        return (
          <Badge variant="secondary" data-testid="badge-status-pending">
            <Clock className="w-3 h-3 mr-1" /> Pending
          </Badge>
        );
      case "draft":
        return (
          <Badge variant="outline" data-testid="badge-status-draft">
            <Pencil className="w-3 h-3 mr-1" /> Draft
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

  const formatAddress = (identity: MailIdentity) => {
    const parts = [identity.addressLine1];
    if (identity.addressLine2) parts.push(identity.addressLine2);
    parts.push(`${identity.city}, ${identity.state} ${identity.zipCode}`);
    return parts.join(", ");
  };

  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-4xl mx-auto space-y-6 md:ml-64">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Mail Settings</h1>
            <p className="text-muted-foreground">
              Configure your return addresses for direct mail campaigns.
            </p>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="w-5 h-5" />
                    Return Addresses
                  </CardTitle>
                  <CardDescription>
                    Manage sender identities for your direct mail campaigns.
                  </CardDescription>
                </div>
                <Button onClick={openAddDialog} data-testid="button-add-address">
                  <Plus className="w-4 h-4 mr-1" /> Add Address
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : identities.length === 0 ? (
                <div className="text-center py-8" data-testid="text-no-addresses">
                  <Mail className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">
                    No return addresses configured yet. Add one to start sending direct mail.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {identities.map((identity) => (
                    <Card key={identity.id} data-testid={`card-mail-identity-${identity.id}`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className="font-medium" data-testid={`text-identity-name-${identity.id}`}>
                                {identity.name}
                              </span>
                              {getStatusBadge(identity.status)}
                              {identity.isDefault && (
                                <Badge variant="outline" className="text-xs" data-testid={`badge-default-${identity.id}`}>
                                  <Star className="w-3 h-3 mr-1" /> Default
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground" data-testid={`text-company-name-${identity.id}`}>
                              {identity.companyName}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1" data-testid={`text-address-${identity.id}`}>
                              {formatAddress(identity)}
                            </p>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button size="icon" variant="ghost" data-testid={`button-actions-${identity.id}`}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {!identity.isDefault && identity.status === "verified" && (
                                <DropdownMenuItem
                                  onClick={() => setDefaultMutation.mutate(identity.id)}
                                  disabled={setDefaultMutation.isPending}
                                  data-testid={`menu-set-default-${identity.id}`}
                                >
                                  <Star className="w-4 h-4 mr-2" />
                                  Set as Default
                                </DropdownMenuItem>
                              )}
                              {(identity.status === "draft" || identity.status === "failed") && (
                                <DropdownMenuItem
                                  onClick={() => verifyMutation.mutate(identity.id)}
                                  disabled={verifyMutation.isPending}
                                  data-testid={`menu-verify-${identity.id}`}
                                >
                                  <Send className="w-4 h-4 mr-2" />
                                  Verify Address
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => openEditDialog(identity)}
                                data-testid={`menu-edit-${identity.id}`}
                              >
                                <Pencil className="w-4 h-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => openDeleteDialog(identity)}
                                className="text-destructive focus:text-destructive"
                                data-testid={`menu-delete-${identity.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Dialog open={isFormDialogOpen} onOpenChange={setIsFormDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingIdentity ? "Edit Return Address" : "Add Return Address"}
                </DialogTitle>
                <DialogDescription>
                  {editingIdentity
                    ? "Update your mail sender identity details."
                    : "Add a new return address for your direct mail campaigns."}
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Identity Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="e.g., Main Office, Marketing Dept"
                            {...field}
                            data-testid="input-identity-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company Name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Your Company LLC"
                            {...field}
                            data-testid="input-company-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressLine1"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="123 Main Street"
                            {...field}
                            data-testid="input-address-line1"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="addressLine2"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Address Line 2 (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Suite 100"
                            {...field}
                            data-testid="input-address-line2"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input placeholder="Los Angeles" {...field} data-testid="input-city" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="state"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>State</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-state">
                                <SelectValue placeholder="Select state" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {US_STATES.map((state) => (
                                <SelectItem key={state.value} value={state.value}>
                                  {state.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="zipCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ZIP Code</FormLabel>
                          <FormControl>
                            <Input placeholder="90001" {...field} data-testid="input-zip-code" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="country"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Country</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-country">
                                <SelectValue placeholder="Select country" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="US">United States</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <DialogFooter className="gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={closeFormDialog}
                      data-testid="button-cancel-form"
                    >
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isMutating} data-testid="button-save-form">
                      {isMutating ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          {editingIdentity ? "Saving..." : "Creating..."}
                        </>
                      ) : editingIdentity ? (
                        "Save Changes"
                      ) : (
                        "Add Address"
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            title="Delete Return Address"
            description={`Are you sure you want to delete "${identityToDelete?.name}"? This action cannot be undone.`}
            confirmLabel="Delete"
            onConfirm={() => {
              if (identityToDelete) {
                deleteMutation.mutate(identityToDelete.id);
              }
            }}
            isLoading={deleteMutation.isPending}
            variant="destructive"
          />
        </div>
      </main>
    </div>
  );
}
