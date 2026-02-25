import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Users, Play, Pause, StopCircle, Eye, Loader2 } from "lucide-react";
import { SequenceBuilder, type SequenceStepData } from "@/components/sequence-builder";
import type { CampaignSequence, SequenceStep, SequenceEnrollment, Lead } from "@shared/schema";

type SequenceWithSteps = CampaignSequence & { steps: SequenceStep[] };
type EnrollmentWithDetails = SequenceEnrollment & { sequence: CampaignSequence; lead: Lead };

export function SequencesContent() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<SequenceWithSteps | null>(null);
  const [viewingSequence, setViewingSequence] = useState<SequenceWithSteps | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    enrollmentTrigger: "manual" as "manual" | "new_lead" | "stage_change",
    isActive: true,
  });
  const [steps, setSteps] = useState<SequenceStepData[]>([]);

  const { data: sequences, isLoading } = useQuery<CampaignSequence[]>({
    queryKey: ["/api/sequences"],
  });

  const { data: stats } = useQuery<{ sequenceId: number; name: string; totalEnrollments: number; activeEnrollments: number; completedEnrollments: number }[]>({
    queryKey: ["/api/sequences/stats"],
  });

  const { data: activeEnrollments } = useQuery<EnrollmentWithDetails[]>({
    queryKey: ["/api/enrollments/active"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { sequence: typeof formData; steps: SequenceStepData[] }) => {
      const res = await apiRequest("POST", "/api/sequences", data.sequence);
      const sequence = await res.json();
      for (const step of data.steps) {
        await apiRequest("POST", `/api/sequences/${sequence.id}/steps`, {
            delayDays: step.delayDays,
            channel: step.channel,
            subject: step.subject,
            content: step.content,
            conditionType: step.conditionType,
            conditionDays: step.conditionDays,
        });
      }
      return sequence;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sequences/stats"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Sequence created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create sequence", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: number; sequence: typeof formData; steps: SequenceStepData[] }) => {
      await apiRequest("PUT", `/api/sequences/${data.id}`, data.sequence);
      const stepsRes = await apiRequest("GET", `/api/sequences/${data.id}/steps`);
      const existingSteps: any[] = await stepsRes.json();
      for (const step of existingSteps) {
        await apiRequest("DELETE", `/api/sequences/${data.id}/steps/${step.id}`);
      }
      for (const step of data.steps) {
        await apiRequest("POST", `/api/sequences/${data.id}/steps`, {
            delayDays: step.delayDays,
            channel: step.channel,
            subject: step.subject,
            content: step.content,
            conditionType: step.conditionType,
            conditionDays: step.conditionDays,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sequences/stats"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Sequence updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update sequence", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/sequences/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sequences"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sequences/stats"] });
      toast({ title: "Sequence deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete sequence", variant: "destructive" });
    },
  });

  const pauseEnrollmentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/enrollments/${id}/pause`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrollments/active"] });
      toast({ title: "Enrollment paused" });
    },
  });

  const resumeEnrollmentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/enrollments/${id}/resume`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrollments/active"] });
      toast({ title: "Enrollment resumed" });
    },
  });

  const cancelEnrollmentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/enrollments/${id}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/enrollments/active"] });
      toast({ title: "Enrollment cancelled" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", description: "", enrollmentTrigger: "manual", isActive: true });
    setSteps([]);
    setSelectedSequence(null);
  };

  const handleEdit = async (sequence: CampaignSequence) => {
    const res = await apiRequest("GET", `/api/sequences/${sequence.id}`);
    const fullSequence: SequenceWithSteps = await res.json();
    setSelectedSequence(fullSequence);
    setFormData({
      name: fullSequence.name,
      description: fullSequence.description || "",
      enrollmentTrigger: fullSequence.enrollmentTrigger as any,
      isActive: fullSequence.isActive ?? true,
    });
    setSteps(
      fullSequence.steps.map((s: SequenceStep) => ({
        id: s.id,
        stepNumber: s.stepNumber,
        delayDays: s.delayDays,
        channel: s.channel as any,
        templateId: s.templateId ?? undefined,
        subject: s.subject ?? undefined,
        content: s.content,
        conditionType: s.conditionType as any,
        conditionDays: s.conditionDays ?? undefined,
      }))
    );
    setIsDialogOpen(true);
  };

  const handleView = async (sequence: CampaignSequence) => {
    const res = await apiRequest("GET", `/api/sequences/${sequence.id}`);
    const fullSequence: SequenceWithSteps = await res.json();
    setViewingSequence(fullSequence);
  };

  const handleSubmit = () => {
    if (!formData.name) {
      toast({ title: "Please enter a sequence name", variant: "destructive" });
      return;
    }
    if (steps.length === 0) {
      toast({ title: "Please add at least one step", variant: "destructive" });
      return;
    }
    if (selectedSequence) {
      updateMutation.mutate({ id: selectedSequence.id, sequence: formData, steps });
    } else {
      createMutation.mutate({ sequence: formData, steps });
    }
  };

  const getStats = (sequenceId: number) => {
    return stats?.find((s) => s.sequenceId === sequenceId);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="sequences-content">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-sequences-title">Drip Campaign Sequences</h2>
          <p className="text-muted-foreground">
            Create multi-touch automated follow-up sequences
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-sequence">
              <Plus className="w-4 h-4 mr-2" />
              Create Sequence
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedSequence ? "Edit Sequence" : "Create New Sequence"}</DialogTitle>
              <DialogDescription>
                Build a multi-step automated follow-up sequence
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Sequence Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., New Lead Welcome Series"
                    data-testid="input-sequence-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="trigger">Enrollment Trigger</Label>
                  <Select
                    value={formData.enrollmentTrigger}
                    onValueChange={(value) => setFormData({ ...formData, enrollmentTrigger: value as any })}
                  >
                    <SelectTrigger data-testid="select-enrollment-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual enrollment</SelectItem>
                      <SelectItem value="new_lead">When new lead is created</SelectItem>
                      <SelectItem value="stage_change">When lead stage changes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe the purpose of this sequence..."
                  data-testid="textarea-sequence-description"
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.isActive}
                  onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                  data-testid="switch-is-active"
                />
                <Label>Active (new enrollments allowed)</Label>
              </div>

              <div className="border-t pt-6">
                <h3 className="text-lg font-medium mb-4">Sequence Steps</h3>
                <SequenceBuilder steps={steps} onStepsChange={setSteps} />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-sequence"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                {selectedSequence ? "Update Sequence" : "Create Sequence"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="sequences">
        <TabsList>
          <TabsTrigger value="sequences" data-testid="tab-sequences">Sequences</TabsTrigger>
          <TabsTrigger value="enrollments" data-testid="tab-enrollments">Active Enrollments</TabsTrigger>
        </TabsList>

        <TabsContent value="sequences" className="space-y-4">
          {sequences?.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <p className="mb-4">No sequences created yet</p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Sequence
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {sequences?.map((sequence) => {
                const sequenceStats = getStats(sequence.id);
                return (
                  <Card key={sequence.id} data-testid={`card-sequence-${sequence.id}`}>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-lg">{sequence.name}</CardTitle>
                          <CardDescription className="line-clamp-2">
                            {sequence.description || "No description"}
                          </CardDescription>
                        </div>
                        <Badge variant={sequence.isActive ? "default" : "secondary"}>
                          {sequence.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                        <div className="flex items-center gap-1">
                          <Users className="w-4 h-4" />
                          <span>{sequenceStats?.totalEnrollments || 0} enrolled</span>
                        </div>
                        <Badge variant="outline">{sequence.enrollmentTrigger}</Badge>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleView(sequence)}
                          data-testid={`button-view-sequence-${sequence.id}`}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(sequence)}
                          data-testid={`button-edit-sequence-${sequence.id}`}
                        >
                          <Edit className="w-4 h-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(sequence.id)}
                          data-testid={`button-delete-sequence-${sequence.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="enrollments">
          <Card>
            <CardHeader>
              <CardTitle>Active Enrollments</CardTitle>
              <CardDescription>
                Leads currently going through sequences
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeEnrollments?.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No active enrollments
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lead</TableHead>
                      <TableHead>Sequence</TableHead>
                      <TableHead>Current Step</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Enrolled</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeEnrollments?.map((enrollment) => (
                      <TableRow key={enrollment.id} data-testid={`row-enrollment-${enrollment.id}`}>
                        <TableCell>
                          {enrollment.lead?.firstName} {enrollment.lead?.lastName}
                          <br />
                          <span className="text-sm text-muted-foreground">{enrollment.lead?.email}</span>
                        </TableCell>
                        <TableCell>{enrollment.sequence?.name}</TableCell>
                        <TableCell>Step {enrollment.currentStep + 1}</TableCell>
                        <TableCell>
                          <Badge variant={enrollment.status === "active" ? "default" : "secondary"}>
                            {enrollment.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {enrollment.enrolledAt ? new Date(enrollment.enrolledAt).toLocaleDateString() : "N/A"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {enrollment.status === "active" ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => pauseEnrollmentMutation.mutate(enrollment.id)}
                                data-testid={`button-pause-enrollment-${enrollment.id}`}
                              >
                                <Pause className="w-4 h-4" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => resumeEnrollmentMutation.mutate(enrollment.id)}
                                data-testid={`button-resume-enrollment-${enrollment.id}`}
                              >
                                <Play className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => cancelEnrollmentMutation.mutate(enrollment.id)}
                              data-testid={`button-cancel-enrollment-${enrollment.id}`}
                            >
                              <StopCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!viewingSequence} onOpenChange={() => setViewingSequence(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewingSequence?.name}</DialogTitle>
            <DialogDescription>
              {viewingSequence?.description || "No description"}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {viewingSequence && (
              <SequenceBuilder
                steps={viewingSequence.steps.map((s) => ({
                  id: s.id,
                  stepNumber: s.stepNumber,
                  delayDays: s.delayDays,
                  channel: s.channel as any,
                  templateId: s.templateId ?? undefined,
                  subject: s.subject ?? undefined,
                  content: s.content,
                  conditionType: s.conditionType as any,
                  conditionDays: s.conditionDays ?? undefined,
                }))}
                onStepsChange={() => {}}
                readOnly
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
