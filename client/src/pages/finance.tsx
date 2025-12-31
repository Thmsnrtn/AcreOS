import { Sidebar } from "@/components/layout-sidebar";
import { useNotes, useCreateNote } from "@/hooks/use-notes";
import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertNoteSchema } from "@shared/schema";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, DollarSign, Calendar } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

export default function FinancePage() {
  const { data: notes, isLoading } = useNotes();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <main className="flex-1 md:ml-64 p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Finance</h1>
              <p className="text-muted-foreground">Manage active notes and payments.</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-lg hover:shadow-primary/25 bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-4 h-4 mr-2" /> Create Note
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[600px]">
                <DialogHeader>
                  <DialogTitle>Create Promissory Note</DialogTitle>
                </DialogHeader>
                <NoteForm onSuccess={() => setIsCreateOpen(false)} />
              </DialogContent>
            </Dialog>
          </div>

          <div className="bg-white dark:bg-card rounded-2xl shadow-sm border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 dark:bg-slate-900/50">
                  <TableHead>Borrower ID</TableHead>
                  <TableHead>Property ID</TableHead>
                  <TableHead>Terms</TableHead>
                  <TableHead>Monthly</TableHead>
                  <TableHead>Start Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center h-24">Loading...</TableCell></TableRow>
                ) : notes?.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center h-24 text-muted-foreground">No active notes found.</TableCell></TableRow>
                ) : (
                  notes?.map((note) => (
                    <TableRow key={note.id}>
                      <TableCell>#{note.borrowerId}</TableCell>
                      <TableCell>#{note.propertyId}</TableCell>
                      <TableCell>{note.termMonths}mo @ {note.interestRate}%</TableCell>
                      <TableCell className="font-bold font-mono text-emerald-600">
                        ${note.monthlyPayment}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(note.startDate), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={note.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ''}>
                          {note.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </main>
    </div>
  );
}

function NoteForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateNote();
  const { data: leads } = useLeads();
  const { data: properties } = useProperties();

  // Filter properties to only show those not sold (simplified logic)
  const availableProperties = properties?.filter(p => p.status !== 'sold') || [];

  const form = useForm<z.infer<typeof insertNoteSchema>>({
    resolver: zodResolver(insertNoteSchema),
    defaultValues: {
      status: "active",
      startDate: new Date(),
    }
  });

  const onSubmit = (data: z.infer<typeof insertNoteSchema>) => {
    mutate(data, { onSuccess });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Borrower</label>
          <Select onValueChange={(val) => form.setValue("borrowerId", parseInt(val))}>
            <SelectTrigger>
              <SelectValue placeholder="Select Lead" />
            </SelectTrigger>
            <SelectContent>
              {leads?.map(lead => (
                <SelectItem key={lead.id} value={lead.id.toString()}>
                  {lead.firstName} {lead.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.borrowerId && <p className="text-xs text-red-500">Required</p>}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Property</label>
          <Select onValueChange={(val) => form.setValue("propertyId", parseInt(val))}>
            <SelectTrigger>
              <SelectValue placeholder="Select Property" />
            </SelectTrigger>
            <SelectContent>
              {availableProperties?.map(prop => (
                <SelectItem key={prop.id} value={prop.id.toString()}>
                  {prop.county}, {prop.state} (APN: {prop.apn})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.formState.errors.propertyId && <p className="text-xs text-red-500">Required</p>}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Principal ($)</label>
          <Input {...form.register("originalPrincipal")} type="number" placeholder="10000" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Interest (%)</label>
          <Input {...form.register("interestRate")} type="number" placeholder="9.9" step="0.1" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Term (Mo)</label>
          <Input {...form.register("termMonths", { valueAsNumber: true })} type="number" placeholder="60" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Monthly Payment ($)</label>
          <Input {...form.register("monthlyPayment")} type="number" placeholder="250" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Start Date</label>
          <Input type="date" onChange={(e) => form.setValue("startDate", new Date(e.target.value))} />
        </div>
      </div>

      <div className="pt-2">
        <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={isPending}>
          {isPending ? "Creating..." : "Create Note"}
        </Button>
      </div>
    </form>
  );
}
