import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { DocumentTemplate, GeneratedDocument, Deal, Property, DocumentPackage } from "@shared/schema";
import { Sidebar } from "@/components/layout-sidebar";
import { ListSkeleton } from "@/components/list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { TemplateEditor } from "@/components/template-editor";

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
  FileCheck, FilePenLine, Clock, CheckCircle, XCircle, Shield, History, RotateCcw,
  Package, FolderPlus, GripVertical, X, Play
} from "lucide-react";
import type { DocumentVersion } from "@shared/schema";

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
  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);
  const [versionHistoryTarget, setVersionHistoryTarget] = useState<{ id: number; type: "template" | "generated"; name: string } | null>(null);
  const [isCreatePackageOpen, setIsCreatePackageOpen] = useState(false);
  const [isPackageDetailOpen, setIsPackageDetailOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<DocumentPackage | null>(null);
  const [packageName, setPackageName] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageDealId, setPackageDealId] = useState<number | undefined>();
  const [packagePropertyId, setPackagePropertyId] = useState<number | undefined>();
  const [selectedTemplatesForPackage, setSelectedTemplatesForPackage] = useState<number[]>([]);

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

  const { data: packages, isLoading: packagesLoading } = useQuery<DocumentPackage[]>({
    queryKey: ["/api/document-packages"],
  });

  const { data: versions, isLoading: versionsLoading, refetch: refetchVersions } = useQuery<DocumentVersion[]>({
    queryKey: versionHistoryTarget 
      ? [versionHistoryTarget.type === "template" ? "/api/document-templates" : "/api/generated-documents", versionHistoryTarget.id, "versions"]
      : ["/api/versions-placeholder"],
    queryFn: async () => {
      if (!versionHistoryTarget) return [];
      const endpoint = versionHistoryTarget.type === "template" 
        ? `/api/document-templates/${versionHistoryTarget.id}/versions`
        : `/api/generated-documents/${versionHistoryTarget.id}/versions`;
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch versions");
      return response.json();
    },
    enabled: !!versionHistoryTarget && isVersionHistoryOpen,
  });

  const restoreVersionMutation = useMutation({
    mutationFn: async (versionId: number) => {
      return apiRequest("POST", `/api/documents/versions/${versionId}/restore`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-templates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-documents"] });
      refetchVersions();
      toast({ title: "Version restored successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to restore version", description: error.message, variant: "destructive" });
    },
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

  const createPackageMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string; dealId?: number; propertyId?: number; documents: { templateId: number; order: number; status: string }[] }) => {
      return apiRequest("POST", "/api/document-packages", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-packages"] });
      setIsCreatePackageOpen(false);
      resetPackageForm();
      toast({ title: "Package created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create package", description: error.message, variant: "destructive" });
    },
  });

  const updatePackageMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return apiRequest("PUT", `/api/document-packages/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-packages"] });
      toast({ title: "Package updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update package", description: error.message, variant: "destructive" });
    },
  });

  const deletePackageMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/document-packages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-packages"] });
      setIsPackageDetailOpen(false);
      setSelectedPackage(null);
      toast({ title: "Package deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete package", description: error.message, variant: "destructive" });
    },
  });

  const generateAllDocsMutation = useMutation({
    mutationFn: async ({ id, variables }: { id: number; variables?: Record<string, any> }) => {
      return apiRequest("POST", `/api/document-packages/${id}/generate-all`, { variables });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-packages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-documents"] });
      toast({ title: "Documents generated successfully", description: data.message });
    },
    onError: (error: any) => {
      toast({ title: "Failed to generate documents", description: error.message, variant: "destructive" });
    },
  });

  const resetPackageForm = () => {
    setPackageName("");
    setPackageDescription("");
    setPackageDealId(undefined);
    setPackagePropertyId(undefined);
    setSelectedTemplatesForPackage([]);
  };

  const handleCreatePackage = () => {
    if (!packageName.trim()) {
      toast({ title: "Package name is required", variant: "destructive" });
      return;
    }
    
    const documents = selectedTemplatesForPackage.map((templateId, index) => ({
      templateId,
      order: index + 1,
      status: "pending",
    }));
    
    createPackageMutation.mutate({
      name: packageName,
      description: packageDescription || undefined,
      dealId: packageDealId,
      propertyId: packagePropertyId,
      documents,
    });
  };

  const handleViewPackage = (pkg: DocumentPackage) => {
    setSelectedPackage(pkg);
    setIsPackageDetailOpen(true);
  };

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

  const handleOpenVersionHistory = (id: number, type: "template" | "generated", name: string) => {
    setVersionHistoryTarget({ id, type, name });
    setIsVersionHistoryOpen(true);
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
            <Button 
              variant="outline" 
              size="icon"
              onClick={() => handleOpenVersionHistory(template.id, "template", template.name)}
              data-testid={`button-version-history-template-${template.id}`}
            >
              <History className="w-4 h-4" />
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
                  <Button 
                    variant="outline" 
                    size="icon"
                    onClick={() => handleOpenVersionHistory(doc.id, "generated", doc.name)}
                    data-testid={`button-version-history-document-${doc.id}`}
                  >
                    <History className="w-4 h-4" />
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

  const PACKAGE_STATUS_BADGES: Record<string, { color: string; icon: typeof Clock; label: string }> = {
    draft: { color: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300", icon: FilePenLine, label: "Draft" },
    complete: { color: "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300", icon: CheckCircle, label: "Complete" },
    sent: { color: "bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300", icon: Send, label: "Sent" },
    signed: { color: "bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300", icon: FileCheck, label: "Signed" },
  };

  const renderPackagesTab = () => {
    if (packagesLoading) {
      return <ListSkeleton count={3} />;
    }

    if (!packages || packages.length === 0) {
      return (
        <EmptyState
          icon={Package}
          title="No document packages"
          description="Create a package to bundle multiple documents together"
          actionLabel="Create Package"
          onAction={() => setIsCreatePackageOpen(true)}
        />
      );
    }

    return (
      <div className="space-y-4">
        {packages.map(pkg => {
          const statusInfo = PACKAGE_STATUS_BADGES[pkg.status] || PACKAGE_STATUS_BADGES.draft;
          const StatusIcon = statusInfo.icon;
          const docsCount = (pkg.documents as any[] || []).length;
          const generatedCount = (pkg.documents as any[] || []).filter((d: any) => d.documentId).length;
          
          return (
            <Card key={pkg.id} data-testid={`card-package-${pkg.id}`} className="hover-elevate cursor-pointer" onClick={() => handleViewPackage(pkg)}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="p-2 rounded-lg bg-muted">
                    <Package className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate" data-testid={`text-package-name-${pkg.id}`}>
                      {pkg.name}
                    </h4>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge 
                        variant="outline" 
                        className={`text-xs ${statusInfo.color}`}
                        data-testid={`badge-package-status-${pkg.id}`}
                      >
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {statusInfo.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {docsCount} document{docsCount !== 1 ? "s" : ""} ({generatedCount} generated)
                      </span>
                      {pkg.dealId && (
                        <Badge variant="secondary" className="text-xs">
                          Deal #{pkg.dealId}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {pkg.createdAt && new Date(pkg.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {pkg.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{pkg.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); handleViewPackage(pkg); }}
                    data-testid={`button-view-package-${pkg.id}`}
                  >
                    <Eye className="w-3 h-3 mr-1" />
                    View
                  </Button>
                  {pkg.status === "draft" && docsCount > 0 && (
                    <Button 
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); generateAllDocsMutation.mutate({ id: pkg.id }); }}
                      disabled={generateAllDocsMutation.isPending}
                      data-testid={`button-generate-all-${pkg.id}`}
                    >
                      {generateAllDocsMutation.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3 mr-1" />
                      )}
                      Generate All
                    </Button>
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
              <p className="text-muted-foreground">Manage document templates, packages, and generated documents</p>
            </div>
            <div className="flex gap-2">
              {activeTab === "templates" && (
                <Button onClick={() => setIsCreateTemplateOpen(true)} data-testid="button-create-template">
                  <Plus className="w-4 h-4 mr-2" />
                  New Template
                </Button>
              )}
              {activeTab === "packages" && (
                <Button onClick={() => setIsCreatePackageOpen(true)} data-testid="button-create-package">
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Create Package
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
              <TabsTrigger value="packages" data-testid="tab-packages">
                <Package className="w-4 h-4 mr-2" />
                Packages
              </TabsTrigger>
            </TabsList>

            <TabsContent value="templates" className="mt-6">
              {renderTemplatesTab()}
            </TabsContent>

            <TabsContent value="documents" className="mt-6">
              {renderDocumentsTab()}
            </TabsContent>

            <TabsContent value="packages" className="mt-6">
              {renderPackagesTab()}
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <Dialog open={isCreateTemplateOpen} onOpenChange={setIsCreateTemplateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Create New Template</DialogTitle>
            <DialogDescription>
              Create a custom document template with variable placeholders and custom fields.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            <TemplateEditor
              mode="create"
              onSave={() => {
                setIsCreateTemplateOpen(false);
                templateForm.reset();
              }}
              onCancel={() => setIsCreateTemplateOpen(false)}
            />
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditTemplateOpen} onOpenChange={(open) => {
        setIsEditTemplateOpen(open);
        if (!open) setEditingTemplate(null);
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Update your document template. Version will increment automatically.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            <TemplateEditor
              template={editingTemplate}
              mode="edit"
              onSave={() => {
                setIsEditTemplateOpen(false);
                setEditingTemplate(null);
                editTemplateForm.reset();
              }}
              onCancel={() => {
                setIsEditTemplateOpen(false);
                setEditingTemplate(null);
              }}
            />
          </ScrollArea>
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

      <Dialog open={isVersionHistoryOpen} onOpenChange={(open) => {
        setIsVersionHistoryOpen(open);
        if (!open) setVersionHistoryTarget(null);
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle data-testid="text-version-history-title">
              Version History: {versionHistoryTarget?.name}
            </DialogTitle>
            <DialogDescription>
              View and restore previous versions of this {versionHistoryTarget?.type === "template" ? "template" : "document"}.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1">
            {versionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : !versions || versions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-versions">
                <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No version history available</p>
                <p className="text-sm mt-1">Versions are created when documents are saved or updated</p>
              </div>
            ) : (
              <div className="space-y-3">
                {versions.map((version) => (
                  <Card key={version.id} data-testid={`card-version-${version.id}`}>
                    <CardContent className="flex items-center justify-between gap-4 p-4">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="p-2 rounded-lg bg-muted">
                          <History className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium" data-testid={`text-version-number-${version.id}`}>
                              Version {version.version}
                            </h4>
                            {version.version === Math.max(...(versions?.map(v => v.version) || [0])) && (
                              <Badge variant="outline" className="text-xs">Latest</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                            <span data-testid={`text-version-date-${version.id}`}>
                              {version.createdAt && new Date(version.createdAt).toLocaleString()}
                            </span>
                            {version.createdBy && (
                              <>
                                <span>by</span>
                                <span data-testid={`text-version-author-${version.id}`}>{version.createdBy}</span>
                              </>
                            )}
                          </div>
                          {version.changes && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-1" data-testid={`text-version-changes-${version.id}`}>
                              {version.changes}
                            </p>
                          )}
                        </div>
                      </div>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => restoreVersionMutation.mutate(version.id)}
                        disabled={restoreVersionMutation.isPending || version.version === Math.max(...(versions?.map(v => v.version) || [0]))}
                        data-testid={`button-restore-version-${version.id}`}
                      >
                        {restoreVersionMutation.isPending ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3 h-3 mr-1" />
                        )}
                        Restore
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" onClick={() => setIsVersionHistoryOpen(false)} data-testid="button-close-version-history">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isCreatePackageOpen} onOpenChange={(open) => {
        setIsCreatePackageOpen(open);
        if (!open) resetPackageForm();
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle data-testid="text-create-package-title">Create Document Package</DialogTitle>
            <DialogDescription>
              Bundle multiple document templates together for a deal or property.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4 pb-4">
              <div className="space-y-2">
                <Label htmlFor="package-name">Package Name</Label>
                <Input
                  id="package-name"
                  placeholder="e.g., Closing Package, Offer Package"
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  data-testid="input-package-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="package-description">Description (optional)</Label>
                <Textarea
                  id="package-description"
                  placeholder="Describe this package..."
                  value={packageDescription}
                  onChange={(e) => setPackageDescription(e.target.value)}
                  data-testid="input-package-description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Link to Deal (optional)</Label>
                  <Select 
                    value={packageDealId?.toString() || ""} 
                    onValueChange={(v) => setPackageDealId(v ? parseInt(v) : undefined)}
                  >
                    <SelectTrigger data-testid="select-package-deal">
                      <SelectValue placeholder="Select deal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No deal</SelectItem>
                      {deals?.map(deal => (
                        <SelectItem key={deal.id} value={deal.id.toString()}>
                          Deal #{deal.id} - {deal.name || deal.type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Link to Property (optional)</Label>
                  <Select 
                    value={packagePropertyId?.toString() || ""} 
                    onValueChange={(v) => setPackagePropertyId(v ? parseInt(v) : undefined)}
                  >
                    <SelectTrigger data-testid="select-package-property">
                      <SelectValue placeholder="Select property" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No property</SelectItem>
                      {properties?.map(prop => (
                        <SelectItem key={prop.id} value={prop.id.toString()}>
                          {prop.address || prop.apn || `Property #${prop.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Select Templates to Include</Label>
                <div className="border rounded-md p-3 max-h-60 overflow-y-auto space-y-2">
                  {templates?.filter(t => t.isActive).map(template => (
                    <label 
                      key={template.id}
                      className="flex items-center gap-3 p-2 rounded-md hover-elevate cursor-pointer"
                      data-testid={`checkbox-template-${template.id}`}
                    >
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={selectedTemplatesForPackage.includes(template.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedTemplatesForPackage(prev => [...prev, template.id]);
                          } else {
                            setSelectedTemplatesForPackage(prev => prev.filter(id => id !== template.id));
                          }
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{template.name}</p>
                        <p className="text-xs text-muted-foreground">{template.type.replace(/_/g, " ")}</p>
                      </div>
                      {template.isSystemTemplate && (
                        <Badge variant="secondary" className="text-xs">System</Badge>
                      )}
                    </label>
                  ))}
                </div>
                {selectedTemplatesForPackage.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedTemplatesForPackage.length} template{selectedTemplatesForPackage.length !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
            </div>
          </ScrollArea>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={() => setIsCreatePackageOpen(false)} data-testid="button-cancel-create-package">
              Cancel
            </Button>
            <Button 
              onClick={handleCreatePackage} 
              disabled={createPackageMutation.isPending || !packageName.trim()}
              data-testid="button-save-package"
            >
              {createPackageMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Package
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isPackageDetailOpen} onOpenChange={(open) => {
        setIsPackageDetailOpen(open);
        if (!open) setSelectedPackage(null);
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" data-testid="text-package-detail-title">
              <Package className="w-5 h-5" />
              {selectedPackage?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedPackage?.description || "View and manage documents in this package"}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            {selectedPackage && (
              <div className="space-y-4 pb-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <Badge 
                    variant="outline" 
                    className={PACKAGE_STATUS_BADGES[selectedPackage.status]?.color || ""}
                    data-testid="badge-selected-package-status"
                  >
                    {PACKAGE_STATUS_BADGES[selectedPackage.status]?.label || selectedPackage.status}
                  </Badge>
                  {selectedPackage.dealId && (
                    <Badge variant="secondary">Deal #{selectedPackage.dealId}</Badge>
                  )}
                  {selectedPackage.propertyId && (
                    <Badge variant="secondary">Property #{selectedPackage.propertyId}</Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Created {selectedPackage.createdAt && new Date(selectedPackage.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Documents in Package ({(selectedPackage.documents as any[] || []).length})
                  </Label>
                  <div className="border rounded-md divide-y">
                    {(selectedPackage.documents as any[] || []).length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        <p>No documents in this package</p>
                        <p className="text-xs mt-1">Add templates when creating the package</p>
                      </div>
                    ) : (
                      (selectedPackage.documents as any[]).map((doc, index) => {
                        const template = templates?.find(t => t.id === doc.templateId);
                        const generatedDoc = doc.documentId ? documents?.find(d => d.id === doc.documentId) : null;
                        
                        return (
                          <div 
                            key={index}
                            className="flex items-center gap-3 p-3"
                            data-testid={`package-doc-item-${index}`}
                          >
                            <div className="p-1.5 rounded bg-muted">
                              <GripVertical className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <span className="text-sm font-medium text-muted-foreground w-6">
                              {doc.order}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">
                                {doc.name || template?.name || `Template #${doc.templateId}`}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {template?.type.replace(/_/g, " ") || "Unknown type"}
                              </p>
                            </div>
                            <Badge 
                              variant="outline" 
                              className={doc.status === "generated" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}
                            >
                              {doc.status === "generated" ? (
                                <CheckCircle className="w-3 h-3 mr-1" />
                              ) : (
                                <Clock className="w-3 h-3 mr-1" />
                              )}
                              {doc.status}
                            </Badge>
                            {generatedDoc && (
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => handlePreviewDocument(generatedDoc)}
                                data-testid={`button-view-generated-doc-${index}`}
                              >
                                <Eye className="w-3 h-3 mr-1" />
                                View
                              </Button>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}
          </ScrollArea>
          <div className="flex justify-between gap-2 pt-4 border-t">
            <Button 
              variant="destructive" 
              size="sm"
              onClick={() => selectedPackage && deletePackageMutation.mutate(selectedPackage.id)}
              disabled={deletePackageMutation.isPending}
              data-testid="button-delete-package"
            >
              {deletePackageMutation.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3 mr-1" />
              )}
              Delete
            </Button>
            <div className="flex gap-2">
              {selectedPackage?.status === "draft" && (selectedPackage.documents as any[] || []).length > 0 && (
                <Button 
                  onClick={() => selectedPackage && generateAllDocsMutation.mutate({ id: selectedPackage.id })}
                  disabled={generateAllDocsMutation.isPending}
                  data-testid="button-generate-all-detail"
                >
                  {generateAllDocsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" />
                  )}
                  Generate All Documents
                </Button>
              )}
              <Button variant="outline" onClick={() => setIsPackageDetailOpen(false)} data-testid="button-close-package-detail">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
