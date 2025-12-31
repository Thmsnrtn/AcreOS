import { Sidebar } from "@/components/layout-sidebar";
import { useLeads, useCreateLead, useUpdateLead } from "@/hooks/use-leads";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLeadSchema } from "@shared/schema";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Mail, Phone, MoreHorizontal } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function LeadsPage() {
  const { data: leads, isLoading } = useLeads();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredLeads = leads?.filter(l => 
    l.lastName.toLowerCase().includes(search.toLowerCase()) || 
    l.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Leads CRM</h1>
              <p className="text-muted-foreground">Manage your potential buyers and sellers.</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-lg hover:shadow-primary/25">
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
                  {filteredLeads?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center h-32 text-muted-foreground">
                        No leads found. Create one to get started.
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredLeads?.map((lead) => (
                    <TableRow key={lead.id} className="group">
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
                        <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </main>
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

function LeadForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateLead();
  const form = useForm<z.infer<typeof insertLeadSchema>>({
    resolver: zodResolver(insertLeadSchema),
    defaultValues: {
      status: "new",
    }
  });

  const onSubmit = (data: z.infer<typeof insertLeadSchema>) => {
    mutate(data, {
      onSuccess: () => onSuccess(),
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">First Name</label>
          <Input {...form.register("firstName")} placeholder="John" />
          {form.formState.errors.firstName && <p className="text-xs text-red-500">{form.formState.errors.firstName.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Last Name</label>
          <Input {...form.register("lastName")} placeholder="Doe" />
          {form.formState.errors.lastName && <p className="text-xs text-red-500">{form.formState.errors.lastName.message}</p>}
        </div>
      </div>
      
      <div className="space-y-2">
        <label className="text-sm font-medium">Email</label>
        <Input {...form.register("email")} placeholder="john@example.com" type="email" />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Phone</label>
        <Input {...form.register("phone")} placeholder="(555) 123-4567" />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Status</label>
        <Select onValueChange={(val) => form.setValue("status", val)} defaultValue="new">
          <SelectTrigger>
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacting">Contacting</SelectItem>
            <SelectItem value="negotiation">Negotiation</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="dead">Dead</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="pt-2">
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "Creating..." : "Create Lead"}
        </Button>
      </div>
    </form>
  );
}
