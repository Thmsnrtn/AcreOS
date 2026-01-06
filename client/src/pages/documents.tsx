import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { DocumentTemplate, GeneratedDocument, Deal, Property } from "@shared/schema";
import { Sidebar } from "@/components/layout-sidebar";
import { ListSkeleton } from "@/components/list-skeleton";
import { EmptyState } from "@/components/empty-state";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, FileText, Eye, Trash2, Loader2, Send, Download, Edit,
  FileCheck, FilePenLine, Clock, CheckCircle, XCircle, Shield
} from "lucide-react";

const DOCUMENT_TYPES = [
  { value: "purchase_agreement", label: "Purchase Agreement" },
  { value: "quit_claim_deed", label: "Quit Claim Deed" },
  { value: "warranty_deed", label: "Warranty Deed" },
  { value: "assignment", label: "Assignment Contract" },
  { value: "promissory_note", label: "Promissory Note" },
  { value: "offer_letter", label: "Offer Letter" },
  { value: "custom", label: "Custom Document" },
];

const DOCUMENT_CATEGORIES = [
  { value: "acquisition", label: "Acquisition" },
  { value: "closing", label: "Closing" },
  { value: "financing", label: "Financing" },
];

const STATUS_BADGES: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  draft: { color: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300", icon: FilePenLine, label: "Draft" },
  pending_signature: { color: "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300", icon: Clock, label: "Pending Signature" },
  partially_signed: { color: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300", icon: FilePenLine, label: "Partially Signed" },
  signed: { color: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300", icon: FileCheck, label: "Signed" },
  completed: { color: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300", icon: CheckCircle, label: "Completed" },
  cancelled: { color: "bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300", icon: XCircle, label: "Cancelled" },
};

const templateFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  category: z.string().default("closing"),
  content: z.string().min(1, "Content is required"),
});

type TemplateFormValues = z.infer<typeof templateFormSchema>;

const generateDocFormSchema = z.object({
  templateId: z.number({ required_error: "Please select a template" }),
  dealId: z.number().optional(),
  propertyId: z.number().optional(),
  name: z.string().optional(),
});

type GenerateDocFormValues = z.infer<typeof generateDocFormSchema>;

export default function DocumentsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("templates");
  const [templateFilter, setTemplateFilter] = useState<"all" | "my" | "system">("all");
  const [isCreateTemplateOpen, setIsCreateTemplateOpen] = useState(false);
  const [isEditTemplateOpen, setIsEditTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DocumentTemplate | null>(null);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewTemplate, setPreviewTemplate] = useState<DocumentTemplate | null>(null);
  const [previewDocument, setPreviewDocument] = useState<GeneratedDocument | null>(null);
  const [selectedTemplateForGenerate, setSelectedTemplateForGenerate] = useState<DocumentTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  const { data: templates, isLoading: templatesLoading } = useQuery<DocumentTemplate[]>({
    queryKey: ["/api/document-templates"],
  });

  const { data: documents, isLoading: documentsLoading } = useQuery<GeneratedDocument[]>({
    queryKey: ["/api/generated-documents"],
  });

  const { data: deals } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
  });

  const { data: properties } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const createTemplateMutation = useMutation({
    mutationFn: async (data: TemplateFormValues) => {
      const variables = extractVariables(data.content);
      return apiRequest("POST", "/api/document-templates", {
        ...data,
        variables,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-templates"] });
      setIsCreateTemplateOpen(false);
      templateForm.reset();
      toast({ title: "Template created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create template", description: error.message, variant: "destructive" });
    },
  });

  const updateTemplateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: TemplateFormValues }) => {
      const variables = extractVariables(data.content);
      return apiRequest("PATCH", `/api/document-templates/${id}`, {
        ...data,
        variables,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-templates"] });
      setIsEditTemplateOpen(false);
      setEditingTemplate(null);
      editTemplateForm.reset();
      toast({ title: "Template updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update template", description: error.message, variant: "destructive" });
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/document-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete template", description: error.message, variant: "destructive" });
    },
  });

  const generateDocMutation = useMutation({
    mutationFn: async (data: { templateId: number; dealId?: number; propertyId?: number; name?: string; variables: Record<string, string> }) => {
      return apiRequest("POST", "/api/generated-documents", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-documents"] });
      setIsGenerateOpen(false);
      setSelectedTemplateForGenerate(null);
      setVariableValues({});
      generateDocForm.reset();
      toast({ title: "Document generated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to generate document", description: error.message, variant: "destructive" });
    },
  });

  const sendForSignatureMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("POST", `/api/generated-documents/${id}/send-for-signature`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/generated-documents"] });
      toast({ title: "Document sent for signature", description: "E-signature request has been sent (placeholder)" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to send for signature", description: error.message, variant: "destructive" });
    },
  });

  const templateForm = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      name: "",
      type: "custom",
      category: "closing",
      content: "",
    },
  });

  const generateDocForm = useForm<GenerateDocFormValues>({
    resolver: zodResolver(generateDocFormSchema),
    defaultValues: {},
  });

  const editTemplateForm = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      name: "",
      type: "custom",
      category: "closing",
      content: "",
    },
  });

  function extractVariables(content: string): Array<{ name: string; description: string; type: string; required: boolean }> {
    const regex = /\{\{(\w+)\}\}/g;
    const foundVars: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (!foundVars.includes(match[1])) {
        foundVars.push(match[1]);
      }
    }
    return foundVars.map(name => ({
      name,
      description: name.replace(/_/g, " "),
      type: name.includes("price") || name.includes("amount") || name.includes("payment") ? "currency" : 
            name.includes("date") ? "date" : "text",
      required: true,
    }));
  }

  const onSubmitTemplate = (values: TemplateFormValues) => {
    createTemplateMutation.mutate(values);
  };

  const onSubmitEditTemplate = (values: TemplateFormValues) => {
    if (!editingTemplate) return;
    updateTemplateMutation.mutate({ id: editingTemplate.id, data: values });
  };

  const handleEditTemplate = (template: DocumentTemplate) => {
    setEditingTemplate(template);
    editTemplateForm.reset({
      name: template.name,
      type: template.type,
      category: template.category,
      content: template.content,
    });
    setIsEditTemplateOpen(true);
  };

  const handleOpenGenerate = (template: DocumentTemplate) => {
    setSelectedTemplateForGenerate(template);
    setVariableValues({});
    generateDocForm.setValue("templateId", template.id);
    setIsGenerateOpen(true);
  };

  const handleGenerateDocument = () => {
    if (!selectedTemplateForGenerate) return;
    
    const formData = generateDocForm.getValues();
    generateDocMutation.mutate({
      templateId: selectedTemplateForGenerate.id,
      dealId: formData.dealId,
      propertyId: formData.propertyId,
      name: formData.name,
      variables: variableValues,
    });
  };

  const handlePreviewTemplate = (template: DocumentTemplate) => {
    setPreviewTemplate(template);
    setPreviewDocument(null);
    setIsPreviewOpen(true);
  };

  const handlePreviewDocument = (document: GeneratedDocument) => {
    setPreviewDocument(document);
    setPreviewTemplate(null);
    setIsPreviewOpen(true);
  };

  const renderTemplatesTab = () => {
    if (templatesLoading) {
      return <ListSkeleton count={3} />;
    }

    if (!templates || templates.length === 0) {
      return (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          description="Create your first document template to get started"
          actionLabel="Create Template"
          onAction={() => setIsCreateTemplateOpen(true)}
        />
      );
    }

    const systemTemplates = templates.filter(t => t.isSystemTemplate);
    const customTemplates = templates.filter(t => !t.isSystemTemplate);
    
    const filteredTemplates = templateFilter === "all" 
      ? templates 
      : templateFilter === "my" 
        ? customTemplates 
        : systemTemplates;

    const renderTemplateCard = (template: DocumentTemplate) => {
      const isSystem = template.isSystemTemplate;
      return (
        <Card key={template.id} data-testid={`card-template-${template.id}`}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base truncate">{template.name}</CardTitle>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <Badge variant={isSystem ? "secondary" : "outline"} className="text-xs">
                    {template.type.replace(/_/g, " ")}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {template.category}
                  </Badge>
                  {isSystem && (
                    <Badge variant="secondary" className="text-xs">
                      <Shield className="w-3 h-3 mr-1" />
                      System
                    </Badge>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground" data-testid={`text-template-version-${template.id}`}>
                v{template.version || 1}
              </span>
            </div>
          </CardHeader>
          <CardContent className="pb-2">
            <p className="text-sm text-muted-foreground line-clamp-2">
              {template.variables && Array.isArray(template.variables) 
                ? `${template.variables.length} variables: ${template.variables.slice(0, 3).map((v: any) => v.name).join(", ")}${template.variables.length > 3 ? "..." : ""}`
                : "No variables"}
            </p>
          </CardContent>
          <CardFooter className="flex gap-2 flex-wrap">
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => handlePreviewTemplate(template)}
              data-testid={`button-preview-template-${template.id}`}
            >
              <Eye className="w-3 h-3 mr-1" />
              Preview
            </Button>
            <Button 
              size="sm"
              onClick={() => handleOpenGenerate(template)}
              data-testid={`button-generate-from-template-${template.id}`}
            >
              <Plus className="w-3 h-3 mr-1" />
              Generate
            </Button>
            {!isSystem && (
              <>
                <Button 
                  variant="outline" 
                  size="icon"
                  onClick={() => handleEditTemplate(template)}
                  data-testid={`button-edit-template-${template.id}`}
                >
                  <Edit className="w-4 h-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => deleteTemplateMutation.mutate(template.id)}
                  disabled={deleteTemplateMutation.isPending}
                  data-testid={`button-delete-template-${template.id}`}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      );
    };

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Button 
            variant={templateFilter === "all" ? "default" : "outline"} 
            size="sm"
            onClick={() => setTemplateFilter("all")}
            data-testid="button-filter-all"
          >
            All Templates ({templates.length})
          </Button>
          <Button 
            variant={templateFilter === "my" ? "default" : "outline"} 
            size="sm"
            onClick={() => setTemplateFilter("my")}
            data-testid="button-filter-my"
          >
            My Templates ({customTemplates.length})
          </Button>
          <Button 
            variant={templateFilter === "system" ? "default" : "outline"} 
            size="sm"
            onClick={() => setTemplateFilter("system")}
            data-testid="button-filter-system"
          >
            <Shield className="w-3 h-3 mr-1" />
            System ({systemTemplates.length})
          </Button>
        </div>

        {filteredTemplates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={templateFilter === "my" ? "No custom templates" : "No templates found"}
            description={templateFilter === "my" ? "Create your own custom template" : "No templates match the current filter"}
            actionLabel={templateFilter === "my" ? "Create Template" : undefined}
            onAction={templateFilter === "my" ? () => setIsCreateTemplateOpen(true) : undefined}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map(renderTemplateCard)}
          </div>
        )}
      </div>
    );
  };

  const renderDocumentsTab = () => {
    if (documentsLoading) {
      return <ListSkeleton count={3} />;
    }

    if (!documents || documents.length === 0) {
      return (
        <EmptyState
          icon={FileCheck}
          title="No documents generated"
          description="Generate your first document from a template"
          actionLabel="View Templates"
          onAction={() => setActiveTab("templates")}
        />
      );
    }

    return (
      <div className="space-y-4">
        {documents.map(doc => {
          const statusInfo = STATUS_BADGES[doc.status] || STATUS_BADGES.draft;
          const StatusIcon = statusInfo.icon;
          
          return (
            <Card key={doc.id} data-testid={`card-document-${doc.id}`}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="p-2 rounded-lg bg-muted">
                    <FileText className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate" data-testid={`text-document-name-${doc.id}`}>
                      {doc.name}
                    </h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${statusInfo.color}`}
                        data-testid={`badge-document-status-${doc.id}`}
                      >
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusInfo.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {doc.type.replace(/_/g, " ")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {doc.createdAt && new Date(doc.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => handlePreviewDocument(doc)}
                    data-testid={`button-view-document-${doc.id}`}
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    View
                  </Button>
                  {doc.status === "draft" && (
                    <Button 
                      size="sm"
                      onClick={() => sendForSignatureMutation.mutate(doc.id)}
                      disabled={sendForSignatureMutation.isPending}
                      data-testid={`button-send-for-signature-${doc.id}`}
                    >
                      {sendForSignatureMutation.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3 mr-1" />
                      )}
                      Send for Signature
                    </Button>
                  )}
                  {doc.status === "pending_signature" && (
                    <Badge variant="outline" className="text-yellow-600 dark:text-yellow-400">
                      <Clock className="w-3 h-3 mr-1" />
                      Awaiting Signatures
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Documents</h1>
              <p className="text-muted-foreground">Manage document templates and generated documents</p>
            </div>
            <div className="flex gap-2">
              {activeTab === "templates" && (
                <Button onClick={() => setIsCreateTemplateOpen(true)} data-testid="button-create-template">
                  <Plus className="w-4 h-4 mr-2" />
                  New Template
                </Button>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList data-testid="tabs-documents">
              <TabsTrigger value="templates" data-testid="tab-templates">
                <FileText className="w-4 h-4 mr-2" />
                Templates
              </TabsTrigger>
              <TabsTrigger value="documents" data-testid="tab-documents">
                <FileCheck className="w-4 h-4 mr-2" />
                Generated Documents
              </TabsTrigger>
            </TabsList>

            <TabsContent value="templates" className="mt-6">
              {renderTemplatesTab()}
            </TabsContent>

            <TabsContent value="documents" className="mt-6">
              {renderDocumentsTab()}
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Dialog open={isCreateTemplateOpen} onOpenChange={setIsCreateTemplateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Template</DialogTitle>
            <DialogDescription>
              Create a custom document template. Use {"{{variable_name}}"} for merge fields.
            </DialogDescription>
          </DialogHeader>
          <Form {...templateForm}>
            <form onSubmit={templateForm.handleSubmit(onSubmitTemplate)} className="space-y-4">
              <FormField
                control={templateForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Custom Purchase Agreement" {...field} data-testid="input-template-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={templateForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Document Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-template-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DOCUMENT_TYPES.map(type => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={templateForm.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-template-category">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DOCUMENT_CATEGORIES.map(cat => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={templateForm.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Content</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Enter your document template here. Use {{variable_name}} for merge fields like {{buyer_name}}, {{property_address}}, etc."
                        className="min-h-[200px] font-mono text-sm"
                        {...field}
                        data-testid="textarea-template-content"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-sm font-medium mb-2">Available Variables Reference:</p>
                <div className="flex flex-wrap gap-2">
                  {["buyer_name", "seller_name", "property_address", "parcel_number", "purchase_price", "closing_date", "county", "state"].map(v => (
                    <Badge key={v} variant="outline" className="text-xs font-mono">
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsCreateTemplateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createTemplateMutation.isPending} data-testid="button-submit-template">
                  {createTemplateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create Template
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditTemplateOpen} onOpenChange={(open) => {
        setIsEditTemplateOpen(open);
        if (!open) setEditingTemplate(null);
      }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Update your document template. Version will increment automatically.
            </DialogDescription>
          </DialogHeader>
          <Form {...editTemplateForm}>
            <form onSubmit={editTemplateForm.handleSubmit(onSubmitEditTemplate)} className="space-y-4">
              <FormField
                control={editTemplateForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Custom Purchase Agreement" {...field} data-testid="input-edit-template-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editTemplateForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Document Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-template-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DOCUMENT_TYPES.map(type => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={editTemplateForm.control}
                  name="category"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-edit-template-category">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DOCUMENT_CATEGORIES.map(cat => (
                            <SelectItem key={cat.value} value={cat.value}>
                              {cat.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={editTemplateForm.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Content</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Enter your document template here. Use {{variable_name}} for merge fields."
                        className="min-h-[200px] font-mono text-sm"
                        {...field}
                        data-testid="textarea-edit-template-content"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-sm font-medium mb-2">Variables detected in content:</p>
                <div className="flex flex-wrap gap-2">
                  {extractVariables(editTemplateForm.watch("content") || "").map(v => (
                    <Badge key={v.name} variant="outline" className="text-xs font-mono">
                      {`{{${v.name}}}`}
                    </Badge>
                  ))}
                  {extractVariables(editTemplateForm.watch("content") || "").length === 0 && (
                    <span className="text-xs text-muted-foreground">No variables found. Use {"{{variable_name}}"} syntax.</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsEditTemplateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateTemplateMutation.isPending} data-testid="button-update-template">
                  {updateTemplateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Update Template
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Generate Document</DialogTitle>
            <DialogDescription>
              Fill in the required variables to generate a document from "{selectedTemplateForGenerate?.name}"
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4 pb-4">
              <Form {...generateDocForm}>
                <div className="space-y-4">
                  <FormField
                    control={generateDocForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Document Name (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Leave blank to auto-generate" {...field} data-testid="input-document-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={generateDocForm.control}
                      name="dealId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Link to Deal (optional)</FormLabel>
                          <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString()}>
                            <FormControl>
                              <SelectTrigger data-testid="select-deal">
                                <SelectValue placeholder="Select deal" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {deals?.map(deal => (
                                <SelectItem key={deal.id} value={deal.id.toString()}>
                                  {`${deal.type} Deal #${deal.id} (${deal.status})`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={generateDocForm.control}
                      name="propertyId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Link to Property (optional)</FormLabel>
                          <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString()}>
                            <FormControl>
                              <SelectTrigger data-testid="select-property">
                                <SelectValue placeholder="Select property" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {properties?.map(prop => (
                                <SelectItem key={prop.id} value={prop.id.toString()}>
                                  {prop.address || prop.apn || `Property #${prop.id}`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </Form>

              {selectedTemplateForGenerate?.variables && Array.isArray(selectedTemplateForGenerate.variables) && selectedTemplateForGenerate.variables.length > 0 && (
                <div className="space-y-4">
                  <Label className="text-sm font-medium">Fill in Variables</Label>
                  <div className="grid grid-cols-2 gap-4">
                    {selectedTemplateForGenerate.variables.map((variable: any) => (
                      <div key={variable.name} className="space-y-1">
                        <Label className="text-xs capitalize">
                          {variable.name.replace(/_/g, " ")}
                          {variable.required && <span className="text-destructive ml-1">*</span>}
                        </Label>
                        <Input
                          type={variable.type === "date" ? "date" : "text"}
                          placeholder={variable.defaultValue || `Enter ${variable.name.replace(/_/g, " ")}`}
                          value={variableValues[variable.name] || ""}
                          onChange={(e) => setVariableValues(prev => ({ ...prev, [variable.name]: e.target.value }))}
                          data-testid={`input-variable-${variable.name}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setIsGenerateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerateDocument} disabled={generateDocMutation.isPending} data-testid="button-generate-document">
              {generateDocMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Generate Document
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {previewTemplate ? `Preview: ${previewTemplate.name}` : previewDocument?.name}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1">
            <div 
              className="prose dark:prose-invert max-w-none p-4 bg-white dark:bg-gray-900 rounded-lg"
              dangerouslySetInnerHTML={{ 
                __html: previewTemplate?.content || previewDocument?.content || "" 
              }}
            />
          </ScrollArea>
          {previewTemplate && previewTemplate.variables && Array.isArray(previewTemplate.variables) && (
            <div className="pt-4 border-t">
              <Label className="text-sm font-medium">Variables in this template:</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {previewTemplate.variables.map((v: any) => (
                  <Badge key={v.name} variant="secondary" className="font-mono text-xs">
                    {`{{${v.name}}}`}
                    {v.required && <span className="text-destructive ml-1">*</span>}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
