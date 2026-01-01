import { Sidebar } from "@/components/layout-sidebar";
import { useLeads, useCreateLead, useUpdateLead, useDeleteLead } from "@/hooks/use-leads";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLeadSchema, type Lead } from "@shared/schema";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Mail, Phone, Trash2, Edit, Loader2, Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

export default function LeadsPage() {
  const { data: leads, isLoading } = useLeads();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [deletingLead, setDeletingLead] = useState<Lead | null>(null);
  const [search, setSearch] = useState("");
  const { mutate: deleteLead, isPending: isDeleting } = useDeleteLead();

  const filteredLeads = leads?.filter(l => 
    l.lastName.toLowerCase().includes(search.toLowerCase()) || 
    l.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = () => {
    if (deletingLead) {
      deleteLead(deletingLead.id, {
        onSuccess: () => setDeletingLead(null),
      });
    }
  };

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Leads CRM</h1>
              <p className="text-muted-foreground">Manage your potential buyers and sellers.</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-lg hover:shadow-primary/25" data-testid="button-add-lead">
                  <Plus className="w-4 h-4 mr-2" /> Add New Lead
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Create New Lead</DialogTitle>
                </DialogHeader>
                <LeadForm onSuccess={() => setIsCreateOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>

          <div className="bg-white dark:bg-card rounded-2xl shadow-sm border overflow-hidden">
            <div className="p-4 border-b flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input 
                  placeholder="Search leads..." 
                  className="pl-9 bg-slate-50 dark:bg-slate-900 border-none"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="input-search-leads"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading leads...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/50 dark:bg-slate-900/50">
                    <TableHead>Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLeads?.length === 0 && leads?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="p-0">
                        <EmptyState
                          icon={Users}
                          title="No leads yet"
                          description="Start by adding your first lead. Track potential buyers and sellers through your sales pipeline."
                          actionLabel="Add Your First Lead"
                          onAction={() => setIsCreateOpen(true)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredLeads?.length === 0 && leads && leads.length > 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center h-32 text-muted-foreground">
                        No leads found matching your search.
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredLeads?.map((lead) => (
                    <TableRow key={lead.id} className="group" data-testid={`row-lead-${lead.id}`}>
                      <TableCell className="font-medium">
                        {lead.firstName} {lead.lastName}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                          {lead.email && <div className="flex items-center gap-2"><Mail className="w-3 h-3" /> {lead.email}</div>}
                          {lead.phone && <div className="flex items-center gap-2"><Phone className="w-3 h-3" /> {lead.phone}</div>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <LeadStatusBadge status={lead.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" data-testid={`button-actions-lead-${lead.id}`}>
                              Actions
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setEditingLead(lead)} data-testid={`button-edit-lead-${lead.id}`}>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => setDeletingLead(lead)} 
                              className="text-destructive"
                              data-testid={`button-delete-lead-${lead.id}`}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </main>

      <Dialog open={!!editingLead} onOpenChange={(open) => !open && setEditingLead(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Lead</DialogTitle>
          </DialogHeader>
          {editingLead && (
            <LeadForm 
              lead={editingLead} 
              onSuccess={() => setEditingLead(null)} 
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingLead}
        onOpenChange={(open) => !open && setDeletingLead(null)}
        title="Delete Lead"
        description={`Are you sure you want to delete ${deletingLead?.firstName} ${deletingLead?.lastName}? This action cannot be undone and will permanently remove this lead from your CRM.`}
        confirmLabel="Delete Lead"
        onConfirm={handleDelete}
        isLoading={isDeleting}
        variant="destructive"
      />
    </div>
  );
}

function LeadStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    contacting: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    negotiation: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    closed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    dead: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  
  return (
    <Badge variant="outline" className={`capitalize font-medium border-0 ${styles[status] || styles.new}`}>
      {status}
    </Badge>
  );
}

function LeadForm({ lead, onSuccess }: { lead?: Lead; onSuccess: () => void }) {
  const { mutate: createLead, isPending: isCreating } = useCreateLead();
  const { mutate: updateLead, isPending: isUpdating } = useUpdateLead();
  const isPending = isCreating || isUpdating;

  const form = useForm<z.infer<typeof insertLeadSchema>>({
    resolver: zodResolver(insertLeadSchema),
    defaultValues: {
      firstName: lead?.firstName || "",
      lastName: lead?.lastName || "",
      email: lead?.email || "",
      phone: lead?.phone || "",
      status: lead?.status || "new",
    }
  });

  const onSubmit = (data: z.infer<typeof insertLeadSchema>) => {
    if (lead) {
      updateLead({ id: lead.id, ...data }, {
        onSuccess: () => onSuccess(),
      });
    } else {
      createLead(data, {
        onSuccess: () => onSuccess(),
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="John" data-testid="input-first-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Last Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Doe" data-testid="input-last-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input {...field} placeholder="john@example.com" type="email" data-testid="input-email" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input {...field} placeholder="(555) 123-4567" data-testid="input-phone" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || "new"}>
                <FormControl>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacting">Contacting</SelectItem>
                  <SelectItem value="negotiation">Negotiation</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="dead">Dead</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-2">
          <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit-lead">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {lead ? "Saving..." : "Creating..."}
              </>
            ) : (
              lead ? "Save Changes" : "Create Lead"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
