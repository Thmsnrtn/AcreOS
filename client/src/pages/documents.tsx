import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import DOMPurify from "isomorphic-dompurify";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import type { DocumentTemplate, GeneratedDocument, Deal, Property, DocumentPackage } from "@shared/schema";
import { PageShell } from "@/components/page-shell";
import { ListSkeleton } from "@/components/list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { TemplateEditor } from "@/components/template-editor";
import { RequestSignaturesDialog } from "@/components/request-signatures-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";

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

// Status → semantic --acr-* tone (Tier 1 pattern).
const STATUS_BADGES: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  draft: { color: "bg-acr-surface-2 text-acr-ink-3 border-transparent", icon: FilePenLine, label: "Draft" },
  pending_signature: { color: "bg-acr-warn-soft text-acr-warn border-transparent", icon: Clock, label: "Pending signature" },
  partially_signed: { color: "bg-acr-brand-soft text-acr-brand border-transparent", icon: FilePenLine, label: "Partially signed" },
  signed: { color: "bg-acr-pos-soft text-acr-pos border-transparent", icon: FileCheck, label: "Signed" },
  completed: { color: "bg-acr-pos-soft text-acr-pos border-transparent", icon: CheckCircle, label: "Completed" },
  cancelled: { color: "bg-acr-neg-soft text-acr-neg border-transparent", icon: XCircle, label: "Cancelled" },
};

const capitalizeFirst = (s: string) => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));
const humanizeType = (s: string) => capitalizeFirst(s.replace(/_/g, " "));

const templateFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  category: z.string().default("closing"),
  content: z.string().min(1, "Content is required"),
});

type TemplateFormValues = z.infer<typeof templateFormSchema>;

const generateDocFormSchema = z.object({
  templateId: z.number({ error: "Please select a template" }),
  dealId: z.number().optional(),
  propertyId: z.number().optional(),
  name: z.string().optional(),
});

type GenerateDocFormValues = z.infer<typeof generateDocFormSchema>;

export default function DocumentsPage() {
  useDocumentTitle("Documents");
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("templates");
  const [templateFilter, setTemplateFilter] = useState<"all" | "my" | "system">("all");
  // /documents?action=new opens the create-template dialog — wires the
  // global FAB / new-item-menu's "New Document" entry to a real action
  // instead of a no-op landing.
  const searchString = useSearch();
  const actionFromUrl = new URLSearchParams(searchString).get("action");
  const [isCreateTemplateOpen, setIsCreateTemplateOpen] = useState(actionFromUrl === "new");
  useEffect(() => {
    if (actionFromUrl === "new") {
      const params = new URLSearchParams(searchString);
      params.delete("action");
      const next = params.toString();
      window.history.replaceState(null, "", next ? `/documents?${next}` : "/documents");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
  const [signaturesFor, setSignaturesFor] = useState<GeneratedDocument | null>(null);
  const [isCreatePackageOpen, setIsCreatePackageOpen] = useState(false);
  const [isPackageDetailOpen, setIsPackageDetailOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<DocumentPackage | null>(null);
  const [packageName, setPackageName] = useState("");
  const [packageDescription, setPackageDescription] = useState("");
  const [packageDealId, setPackageDealId] = useState<number | undefined>();
  const [packagePropertyId, setPackagePropertyId] = useState<number | undefined>();
  const [selectedTemplatesForPackage, setSelectedTemplatesForPackage] = useState<number[]>([]);
  const [templateToDelete, setTemplateToDelete] = useState<DocumentTemplate | null>(null);
  const [packageToDelete, setPackageToDelete] = useState<DocumentPackage | null>(null);
  const [versionToRestore, setVersionToRestore] = useState<DocumentVersion | null>(null);

  const strictFetch = async (path: string) => {
    const res = await fetch(path, { credentials: "include" });
    if (!res.ok) {
      throw new Error(`Request failed (${res.status})`);
    }
    const json = await res.json();
    return Array.isArray(json) ? json : Array.isArray(json.data) ? json.data : [];
  };

  // F-D11: react-query's `data: x = []` default ONLY kicks in when data is
  // undefined. If a query landed with non-array data (e.g. a 200 response
  // with an unexpected shape), every downstream `.map`/`.filter` would
  // crash the whole tab and trip ErrorBoundary. Belt-and-suspenders: clamp
  // every consumed value to an array at component-top via toArray().
  const toArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const { data: rawTemplates, isLoading: templatesLoading, isError: templatesError, refetch: refetchTemplates } = useQuery<DocumentTemplate[]>({
    queryKey: ["/api/document-templates"],
    queryFn: () => strictFetch("/api/document-templates"),
    retry: false,
  });
  const templates = toArray<DocumentTemplate>(rawTemplates);

  const { data: rawDocuments, isLoading: documentsLoading, isError: documentsError, refetch: refetchDocuments } = useQuery<GeneratedDocument[]>({
    queryKey: ["/api/generated-documents"],
    queryFn: () => strictFetch("/api/generated-documents"),
    retry: false,
  });
  const documents = toArray<GeneratedDocument>(rawDocuments);

  const { data: rawDeals, isError: dealsError } = useQuery<Deal[]>({
    queryKey: ["/api/deals"],
    queryFn: () => strictFetch("/api/deals?page=1&pageSize=100"),
    retry: false,
  });
  const deals = toArray<Deal>(rawDeals);

  const { data: rawProperties, isError: propertiesError } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    queryFn: () => strictFetch("/api/properties?page=1&pageSize=100"),
    retry: false,
  });
  const properties = toArray<Property>(rawProperties);

  const { data: rawPackages, isLoading: packagesLoading, isError: packagesError, refetch: refetchPackages } = useQuery<DocumentPackage[]>({
    queryKey: ["/api/document-packages"],
    queryFn: () => strictFetch("/api/document-packages"),
    retry: false,
  });
  const packages = toArray<DocumentPackage>(rawPackages);

  useEffect(() => {
    if (templatesError) toast({ title: "Couldn't load templates", description: "Check your connection and try again.", variant: "destructive" });
  }, [templatesError, toast]);
  useEffect(() => {
    if (documentsError) toast({ title: "Couldn't load generated documents", description: "Check your connection and try again.", variant: "destructive" });
  }, [documentsError, toast]);
  useEffect(() => {
    if (packagesError) toast({ title: "Couldn't load packages", description: "Check your connection and try again.", variant: "destructive" });
  }, [packagesError, toast]);
  useEffect(() => {
    if (dealsError) toast({ title: "Couldn't load deals", description: "Linking to a deal is unavailable right now.", variant: "destructive" });
  }, [dealsError, toast]);
  useEffect(() => {
    if (propertiesError) toast({ title: "Couldn't load properties", description: "Linking to a property is unavailable right now.", variant: "destructive" });
  }, [propertiesError, toast]);

  const { data: versions, isLoading: versionsLoading, refetch: refetchVersions } = useQuery<DocumentVersion[]>({
    queryKey: versionHistoryTarget
      ? [versionHistoryTarget.type === "template" ? "/api/document-templates" : "/api/generated-documents", versionHistoryTarget.id, "versions"]
      : ["__disabled__"],
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
      toast({ title: "Couldn't restore version", description: `${error.message} — the current version is unchanged.`, variant: "destructive" });
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
      toast({ title: "Couldn't create template", description: `${error.message} — your draft is preserved.`, variant: "destructive" });
    },
  });

  const updateTemplateMutation = useOptimisticUpdate<{ id: number; data: TemplateFormValues }>(
    {
      mutationFn: async ({ id, data }) => {
        const variables = extractVariables(data.content);
        return apiRequest("PATCH", `/api/document-templates/${id}`, {
          ...data,
          variables,
        });
      },
      listKeys: [["/api/document-templates"]],
      getId: ({ id }) => id,
      buildPatch: ({ data }) => ({ ...data, variables: extractVariables(data.content) }),
      successToast: { title: "Template updated successfully" },
    },
    {
      onSuccess: () => {
        setIsEditTemplateOpen(false);
        setEditingTemplate(null);
        editTemplateForm.reset();
      },
    },
  );

  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/document-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't delete template", description: `${error.message} — the template still exists.`, variant: "destructive" });
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
      toast({ title: "Couldn't generate document", description: `${error.message} — your variable values are preserved. Try again.`, variant: "destructive" });
    },
  });

  // The legacy sendForSignatureMutation hit /send-for-signature which
  // didn't collect signer info. Replaced by <RequestSignaturesDialog />
  // which calls /request-signature (native) with explicit signers.

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
      toast({ title: "Couldn't create package", description: `${error.message} — your draft is preserved.`, variant: "destructive" });
    },
  });

  const updatePackageMutation = useOptimisticUpdate<{ id: number; data: any }>({
    mutationFn: async ({ id, data }) => {
      return apiRequest("PUT", `/api/document-packages/${id}`, data);
    },
    listKeys: [["/api/document-packages"]],
    getId: ({ id }) => id,
    buildPatch: ({ data }) => data as Record<string, unknown>,
    successToast: { title: "Package updated successfully" },
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
      toast({ title: "Couldn't delete package", description: `${error.message} — the package still exists.`, variant: "destructive" });
    },
  });

  const generateAllDocsMutation = useMutation({
    mutationFn: async ({ id, variables }: { id: number; variables?: Record<string, any> }) => {
      return apiRequest("POST", `/api/document-packages/${id}/generate-all`, { variables });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-packages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/generated-documents"] });
      toast({ title: "Documents generated successfully", description: data?.message });
    },
    onError: (error: any) => {
      toast({ title: "Couldn't generate documents", description: `${error.message} — no documents were generated.`, variant: "destructive" });
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
    resolver: zodResolver(templateFormSchema) as any,
    defaultValues: {
      name: "",
      type: "custom",
      category: "closing",
      content: "",
    },
  });

  const generateDocForm = useForm<GenerateDocFormValues>({
    resolver: zodResolver(generateDocFormSchema) as any,
    defaultValues: {},
  });

  const editTemplateForm = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema) as any,
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

    if (templatesError) {
      return (
        <QueryErrorState
          error={new Error("Failed to load templates")}
          onRetry={() => refetchTemplates()}
          title="Couldn't load templates"
          description="We couldn't reach the documents service. Try again in a moment."
          testId="error-templates"
        />
      );
    }

    if (!templates || templates.length === 0) {
      return (
        <EmptyState
          icon={FileText}
          title="No templates yet"
          description="Create your first document template to get started."
          actionLabel="Create template"
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
                    {humanizeType(template.type)}
                  </Badge>
                  <Badge variant="outline" className="text-xs capitalize">
                    {template.category}
                  </Badge>
                  {isSystem && (
                    <Badge variant="secondary" className="text-xs">
                      <Shield className="w-3 h-3 mr-1" aria-hidden="true" />
                      System
                    </Badge>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums" data-testid={`text-template-version-${template.id}`}>
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
              <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
              Preview
            </Button>
            <Button
              size="sm"
              onClick={() => handleOpenGenerate(template)}
              data-testid={`button-generate-from-template-${template.id}`}
            >
              <Plus className="w-3 h-3 mr-1" aria-hidden="true" />
              Generate
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleOpenVersionHistory(template.id, "template", template.name)}
              aria-label={`Version history for ${template.name}`}
              data-testid={`button-version-history-template-${template.id}`}
            >
              <History className="w-4 h-4" aria-hidden="true" />
            </Button>
            {!isSystem && (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleEditTemplate(template)}
                  aria-label={`Edit ${template.name}`}
                  data-testid={`button-edit-template-${template.id}`}
                >
                  <Edit className="w-4 h-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTemplateToDelete(template)}
                  disabled={deleteTemplateMutation.isPending}
                  aria-label={`Delete ${template.name}`}
                  data-testid={`button-delete-template-${template.id}`}
                >
                  <Trash2 className="w-4 h-4 text-destructive" aria-hidden="true" />
                </Button>
              </>
            )}
          </CardFooter>
        </Card>
      );
    };

    return (
      <div className="space-y-4">
        <div
          className="flex items-center gap-2 flex-wrap"
          role="group"
          aria-label="Filter templates"
        >
          <Button
            variant={templateFilter === "all" ? "default" : "outline"}
            size="sm"
            className="min-h-11 sm:min-h-9"
            aria-pressed={templateFilter === "all"}
            onClick={() => setTemplateFilter("all")}
            data-testid="button-filter-all"
          >
            All templates (<span className="tabular-nums">{templates.length}</span>)
          </Button>
          <Button
            variant={templateFilter === "my" ? "default" : "outline"}
            size="sm"
            className="min-h-11 sm:min-h-9"
            aria-pressed={templateFilter === "my"}
            onClick={() => setTemplateFilter("my")}
            data-testid="button-filter-my"
          >
            My templates (<span className="tabular-nums">{customTemplates.length}</span>)
          </Button>
          <Button
            variant={templateFilter === "system" ? "default" : "outline"}
            size="sm"
            className="min-h-11 sm:min-h-9"
            aria-pressed={templateFilter === "system"}
            onClick={() => setTemplateFilter("system")}
            data-testid="button-filter-system"
          >
            <Shield className="w-3 h-3 mr-1" aria-hidden="true" />
            System (<span className="tabular-nums">{systemTemplates.length}</span>)
          </Button>
        </div>

        {filteredTemplates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={templateFilter === "my" ? "No custom templates" : "No templates found"}
            description={templateFilter === "my" ? "Create your own custom template to speed up future deals." : "No templates match the current filter."}
            actionLabel={templateFilter === "my" ? "Create template" : undefined}
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

    if (documentsError) {
      return (
        <QueryErrorState
          error={new Error("Failed to load generated documents")}
          onRetry={() => refetchDocuments()}
          title="Couldn't load generated documents"
          description="We couldn't reach the documents service. Try again in a moment."
          testId="error-documents"
        />
      );
    }

    if (!documents || documents.length === 0) {
      return (
        <EmptyState
          icon={FileCheck}
          title="No documents generated"
          description="Generate your first document from a template."
          actionLabel="View templates"
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
              <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="p-2 rounded-card bg-muted shrink-0">
                    <FileText className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
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
                        <StatusIcon className="w-3 h-3 mr-1" aria-hidden="true" />
                        {statusInfo.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {humanizeType(doc.type)}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {doc.createdAt && new Date(doc.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => handlePreviewDocument(doc)}
                    data-testid={`button-view-document-${doc.id}`}
                  >
                    <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
                    View
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
                    onClick={() => handleOpenVersionHistory(doc.id, "generated", doc.name)}
                    aria-label={`Version history for ${doc.name}`}
                    data-testid={`button-version-history-document-${doc.id}`}
                  >
                    <History className="w-4 h-4" aria-hidden="true" />
                  </Button>
                  {doc.status === "draft" && (
                    <Button
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      onClick={() => setSignaturesFor(doc)}
                      data-testid={`button-send-for-signature-${doc.id}`}
                    >
                      <Send className="w-3 h-3 mr-1" aria-hidden="true" />
                      Request signatures
                    </Button>
                  )}
                  {doc.status === "pending_signature" && (
                    <Badge variant="outline" className="text-acr-warn dark:text-acr-warn">
                      <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                      Awaiting signatures
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
    draft: { color: "bg-muted text-muted-foreground", icon: FilePenLine, label: "Draft" },
    complete: { color: "bg-acr-brand-soft text-acr-brand border-transparent", icon: CheckCircle, label: "Complete" },
    sent: { color: "bg-acr-warn-soft text-acr-warn border-transparent", icon: Send, label: "Sent" },
    signed: { color: "bg-acr-pos-soft text-acr-pos border-transparent", icon: FileCheck, label: "Signed" },
  };

  const renderPackagesTab = () => {
    if (packagesLoading) {
      return <ListSkeleton count={3} />;
    }

    if (packagesError) {
      return (
        <QueryErrorState
          error={new Error("Failed to load packages")}
          onRetry={() => refetchPackages()}
          title="Couldn't load packages"
          description="We couldn't reach the documents service. Try again in a moment."
          testId="error-packages"
        />
      );
    }

    if (!packages || packages.length === 0) {
      return (
        <EmptyState
          icon={Package}
          title="No document packages"
          description="Bundle multiple documents together — like a closing packet — to save time on every deal."
          actionLabel="Create package"
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
            <Card
              key={pkg.id}
              data-testid={`card-package-${pkg.id}`}
              className="hover-elevate cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              role="button"
              tabIndex={0}
              aria-label={`View package ${pkg.name}`}
              onClick={() => handleViewPackage(pkg)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleViewPackage(pkg);
                }
              }}
            >
              <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="p-2 rounded-card bg-muted shrink-0">
                    <Package className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
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
                        <StatusIcon className="w-3 h-3 mr-1" aria-hidden="true" />
                        {statusInfo.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        <span className="tabular-nums">{docsCount}</span> document{docsCount !== 1 ? "s" : ""}
                        {" "}(<span className="tabular-nums">{generatedCount}</span> generated)
                      </span>
                      {pkg.dealId && (
                        <Badge variant="secondary" className="text-xs tabular-nums">
                          Deal #{pkg.dealId}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {pkg.createdAt && new Date(pkg.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    {pkg.description && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{pkg.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    onClick={(e) => { e.stopPropagation(); handleViewPackage(pkg); }}
                    data-testid={`button-view-package-${pkg.id}`}
                  >
                    <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
                    View
                  </Button>
                  {pkg.status === "draft" && docsCount > 0 && (
                    <Button
                      size="sm"
                      className="min-h-11 sm:min-h-9"
                      onClick={(e) => { e.stopPropagation(); generateAllDocsMutation.mutate({ id: pkg.id }); }}
                      disabled={generateAllDocsMutation.isPending}
                      data-testid={`button-generate-all-${pkg.id}`}
                    >
                      {generateAllDocsMutation.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" aria-hidden="true" />
                      ) : (
                        <Play className="w-3 h-3 mr-1" aria-hidden="true" />
                      )}
                      Generate all
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
    <PageShell label="Documents">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">Documents</h1>
              <p className="text-muted-foreground">Build reusable templates, generate deal-ready documents, and bundle them into packages.</p>
            </div>
            <div className="flex gap-2">
              {activeTab === "templates" && (
                <Button onClick={() => setIsCreateTemplateOpen(true)} data-testid="button-create-template">
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  New template
                </Button>
              )}
              {activeTab === "packages" && (
                <Button onClick={() => setIsCreatePackageOpen(true)} data-testid="button-create-package">
                  <FolderPlus className="w-4 h-4 mr-2" aria-hidden="true" />
                  Create package
                </Button>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList data-testid="tabs-documents">
              <TabsTrigger value="templates" data-testid="tab-templates">
                <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
                Templates
              </TabsTrigger>
              <TabsTrigger value="documents" data-testid="tab-documents">
                <FileCheck className="w-4 h-4 mr-2" aria-hidden="true" />
                Generated documents
              </TabsTrigger>
              <TabsTrigger value="packages" data-testid="tab-packages">
                <Package className="w-4 h-4 mr-2" aria-hidden="true" />
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

      <Dialog open={isCreateTemplateOpen} onOpenChange={setIsCreateTemplateOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Create template</DialogTitle>
            <DialogDescription>
              Create a reusable document template with variable placeholders and custom fields.
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
            <DialogTitle>Edit template</DialogTitle>
            <DialogDescription>
              Update your document template. The version increments automatically on save.
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
            <DialogTitle>Generate document</DialogTitle>
            <DialogDescription>
              Fill in the required variables to generate a document from &ldquo;{selectedTemplateForGenerate?.name}&rdquo;.
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
                        <FormLabel>Document name (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="Leave blank to auto-generate" {...field} data-testid="input-document-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FormField
                      control={generateDocForm.control}
                      name="dealId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Link to deal (optional)</FormLabel>
                          <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString() ?? ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-deal">
                                <SelectValue placeholder={dealsError ? "Deals unavailable" : deals.length === 0 ? "No deals yet" : "Select deal"} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {deals.map(deal => (
                                <SelectItem key={deal.id} value={deal.id.toString()}>
                                  {`${humanizeType(deal.type)} deal #${deal.id} (${deal.status})`}
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
                          <FormLabel>Link to property (optional)</FormLabel>
                          <Select onValueChange={(v) => field.onChange(v ? parseInt(v) : undefined)} value={field.value?.toString() ?? ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-property">
                                <SelectValue placeholder={propertiesError ? "Properties unavailable" : properties.length === 0 ? "No properties yet" : "Select property"} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {properties.map(prop => (
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
                  <Label className="text-sm font-medium">Fill in variables</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {selectedTemplateForGenerate.variables.map((variable: any) => (
                      <div key={variable.name} className="space-y-1">
                        <Label htmlFor={`input-variable-${variable.name}`} className="text-xs capitalize">
                          {variable.name.replace(/_/g, " ")}
                          {variable.required && <span className="text-destructive ml-1" aria-label="required">*</span>}
                        </Label>
                        <Input
                          id={`input-variable-${variable.name}`}
                          type={variable.type === "date" ? "date" : "text"}
                          inputMode={variable.type === "currency" ? "decimal" : undefined}
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
              {generateDocMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              Generate document
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
            <DialogDescription>
              Preview the document content and available variables.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1">
            <div
              className="prose dark:prose-invert max-w-none p-4 bg-background rounded-card"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(previewTemplate?.content || previewDocument?.content || "")
              }}
            />
          </ScrollArea>
          {previewTemplate && previewTemplate.variables && Array.isArray(previewTemplate.variables) && previewTemplate.variables.length > 0 && (
            <div className="pt-4 border-t">
              <Label className="text-sm font-medium">Variables in this template</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {previewTemplate.variables.map((v: any) => (
                  <Badge key={v.name} variant="secondary" className="font-mono text-xs">
                    {`{{${v.name}}}`}
                    {v.required && <span className="text-destructive ml-1" aria-label="required">*</span>}
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
              Version history: {versionHistoryTarget?.name}
            </DialogTitle>
            <DialogDescription>
              View and restore previous versions of this {versionHistoryTarget?.type === "template" ? "template" : "document"}.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1">
            {versionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Loading version history</span>
              </div>
            ) : !versions || versions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground" data-testid="text-no-versions">
                <History className="w-12 h-12 mx-auto mb-3 opacity-50" aria-hidden="true" />
                <p>No version history available</p>
                <p className="text-sm mt-1">Versions are created when this {versionHistoryTarget?.type === "template" ? "template" : "document"} is saved or updated.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {(() => {
                  const latestVersion = Math.max(...versions.map(v => v.version));
                  return versions.map((version) => {
                    const isLatest = version.version === latestVersion;
                    return (
                      <Card key={version.id} data-testid={`card-version-${version.id}`}>
                        <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4">
                          <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className="p-2 rounded-card bg-muted shrink-0">
                              <History className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className="font-medium tabular-nums" data-testid={`text-version-number-${version.id}`}>
                                  Version {version.version}
                                </h4>
                                {isLatest && (
                                  <Badge variant="outline" className="text-xs">Latest</Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-muted-foreground">
                                <span className="tabular-nums" data-testid={`text-version-date-${version.id}`}>
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
                            className="min-h-11 sm:min-h-9"
                            onClick={() => setVersionToRestore(version)}
                            disabled={restoreVersionMutation.isPending || isLatest}
                            aria-label={isLatest ? "This is the latest version" : `Restore version ${version.version}`}
                            data-testid={`button-restore-version-${version.id}`}
                          >
                            {restoreVersionMutation.isPending ? (
                              <Loader2 className="w-3 h-3 mr-1 animate-spin" aria-hidden="true" />
                            ) : (
                              <RotateCcw className="w-3 h-3 mr-1" aria-hidden="true" />
                            )}
                            Restore
                          </Button>
                        </CardContent>
                      </Card>
                    );
                  });
                })()}
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
            <DialogTitle data-testid="text-create-package-title">Create document package</DialogTitle>
            <DialogDescription>
              Bundle multiple document templates together for a deal or property.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-4 pb-4">
              <div className="space-y-2">
                <Label htmlFor="package-name">
                  Package name <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id="package-name"
                  placeholder="e.g., Closing packet, Offer packet"
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  data-testid="input-package-name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="package-description">Description (optional)</Label>
                <Textarea
                  id="package-description"
                  placeholder="Describe this package…"
                  value={packageDescription}
                  onChange={(e) => setPackageDescription(e.target.value)}
                  data-testid="input-package-description"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="select-package-deal">Link to deal (optional)</Label>
                  <Select
                    value={packageDealId?.toString() || "none"}
                    onValueChange={(v) => setPackageDealId(v && v !== "none" ? parseInt(v) : undefined)}
                  >
                    <SelectTrigger id="select-package-deal" data-testid="select-package-deal">
                      <SelectValue placeholder={dealsError ? "Deals unavailable" : deals.length === 0 ? "No deals yet" : "Select deal"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No deal</SelectItem>
                      {deals.map((deal: any) => (
                        <SelectItem key={deal.id} value={deal.id.toString()}>
                          Deal #{deal.id} — {deal.name || humanizeType(deal.type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="select-package-property">Link to property (optional)</Label>
                  <Select
                    value={packagePropertyId?.toString() || "none"}
                    onValueChange={(v) => setPackagePropertyId(v && v !== "none" ? parseInt(v) : undefined)}
                  >
                    <SelectTrigger id="select-package-property" data-testid="select-package-property">
                      <SelectValue placeholder={propertiesError ? "Properties unavailable" : properties.length === 0 ? "No properties yet" : "Select property"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No property</SelectItem>
                      {properties.map(prop => (
                        <SelectItem key={prop.id} value={prop.id.toString()}>
                          {prop.address || prop.apn || `Property #${prop.id}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2" role="group" aria-labelledby="package-templates-label">
                <Label id="package-templates-label">Select templates to include</Label>
                <div className="border rounded-md p-3 max-h-60 overflow-y-auto space-y-2">
                  {templates.filter(t => t.isActive).length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No active templates yet. Create one first.
                    </p>
                  ) : (
                    templates.filter(t => t.isActive).map(template => (
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
                          <p className="text-xs text-muted-foreground">{humanizeType(template.type)}</p>
                        </div>
                        {template.isSystemTemplate && (
                          <Badge variant="secondary" className="text-xs">System</Badge>
                        )}
                      </label>
                    ))
                  )}
                </div>
                {selectedTemplatesForPackage.length > 0 && (
                  <p className="text-xs text-muted-foreground" aria-live="polite">
                    <span className="tabular-nums">{selectedTemplatesForPackage.length}</span> template{selectedTemplatesForPackage.length !== 1 ? "s" : ""} selected
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
              {createPackageMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
              Create package
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
              <Package className="w-5 h-5" aria-hidden="true" />
              {selectedPackage?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedPackage?.description || "View and manage documents in this package."}
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
                    {PACKAGE_STATUS_BADGES[selectedPackage.status]?.label || capitalizeFirst(selectedPackage.status)}
                  </Badge>
                  {selectedPackage.dealId && (
                    <Badge variant="secondary" className="tabular-nums">Deal #{selectedPackage.dealId}</Badge>
                  )}
                  {selectedPackage.propertyId && (
                    <Badge variant="secondary" className="tabular-nums">Property #{selectedPackage.propertyId}</Badge>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Created {selectedPackage.createdAt && new Date(selectedPackage.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <FileText className="w-4 h-4" aria-hidden="true" />
                    Documents in package (<span className="tabular-nums">{(selectedPackage.documents as any[] || []).length}</span>)
                  </Label>
                  <div className="border rounded-md divide-y">
                    {(selectedPackage.documents as any[] || []).length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        <p>No documents in this package</p>
                        <p className="text-xs mt-1">Add templates when creating the package.</p>
                      </div>
                    ) : (
                      (selectedPackage.documents as any[]).map((doc, index) => {
                        const template = templates.find(t => t.id === doc.templateId);
                        const generatedDoc = doc.documentId ? documents.find(d => d.id === doc.documentId) : null;
                        const isGenerated = doc.status === "generated";

                        return (
                          <div
                            key={index}
                            className="flex items-center gap-3 p-3"
                            data-testid={`package-doc-item-${index}`}
                          >
                            <div className="p-1.5 rounded bg-muted shrink-0">
                              <GripVertical className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            </div>
                            <span className="text-sm font-medium text-muted-foreground w-6 tabular-nums">
                              {doc.order}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">
                                {doc.name || template?.name || `Template #${doc.templateId}`}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {template ? humanizeType(template.type) : "Unknown type"}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className={isGenerated ? "text-acr-pos dark:text-acr-pos" : "text-muted-foreground"}
                            >
                              {isGenerated ? (
                                <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                              ) : (
                                <Clock className="w-3 h-3 mr-1" aria-hidden="true" />
                              )}
                              {capitalizeFirst(doc.status)}
                            </Badge>
                            {generatedDoc && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handlePreviewDocument(generatedDoc)}
                                data-testid={`button-view-generated-doc-${index}`}
                              >
                                <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
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
          <div className="flex flex-col sm:flex-row sm:justify-between gap-2 pt-4 border-t">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => selectedPackage && setPackageToDelete(selectedPackage)}
              disabled={deletePackageMutation.isPending}
              data-testid="button-delete-package"
            >
              {deletePackageMutation.isPending ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="w-3 h-3 mr-1" aria-hidden="true" />
              )}
              Delete
            </Button>
            <div className="flex flex-col sm:flex-row gap-2">
              {selectedPackage?.status === "draft" && (selectedPackage.documents as any[] || []).length > 0 && (
                <Button
                  onClick={() => selectedPackage && generateAllDocsMutation.mutate({ id: selectedPackage.id })}
                  disabled={generateAllDocsMutation.isPending}
                  data-testid="button-generate-all-detail"
                >
                  {generateAllDocsMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="w-4 h-4 mr-2" aria-hidden="true" />
                  )}
                  Generate all documents
                </Button>
              )}
              <Button variant="outline" onClick={() => setIsPackageDetailOpen(false)} data-testid="button-close-package-detail">
                Close
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {signaturesFor && (
        <RequestSignaturesDialog
          open={!!signaturesFor}
          onOpenChange={(v) => { if (!v) setSignaturesFor(null); }}
          documentId={signaturesFor.id}
          documentName={signaturesFor.name}
          defaultSigners={
            (signaturesFor.signers ?? []).map((s: any) => ({
              name: s.name ?? "",
              email: s.email ?? "",
              role: s.role ?? "signer",
            }))
          }
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["/api/generated-documents"] })}
        />
      )}

      <ConfirmDialog
        open={!!templateToDelete}
        onOpenChange={(v) => { if (!v) setTemplateToDelete(null); }}
        title="Delete this template?"
        description={templateToDelete ? `"${templateToDelete.name}" will be permanently removed. Documents already generated from this template will not be affected. This cannot be undone.` : ""}
        confirmLabel="Delete template"
        variant="destructive"
        isLoading={deleteTemplateMutation.isPending}
        onConfirm={() => {
          if (!templateToDelete) return;
          deleteTemplateMutation.mutate(templateToDelete.id, {
            onSettled: () => setTemplateToDelete(null),
          });
        }}
      />

      <ConfirmDialog
        open={!!packageToDelete}
        onOpenChange={(v) => { if (!v) setPackageToDelete(null); }}
        title="Delete this package?"
        description={packageToDelete ? `"${packageToDelete.name}" will be permanently removed. Documents already generated from this package will not be affected. This cannot be undone.` : ""}
        confirmLabel="Delete package"
        variant="destructive"
        isLoading={deletePackageMutation.isPending}
        onConfirm={() => {
          if (!packageToDelete) return;
          deletePackageMutation.mutate(packageToDelete.id, {
            onSettled: () => setPackageToDelete(null),
          });
        }}
      />

      <ConfirmDialog
        open={!!versionToRestore}
        onOpenChange={(v) => { if (!v) setVersionToRestore(null); }}
        title={versionToRestore ? `Restore version ${versionToRestore.version}?` : ""}
        description="The current content will be replaced with this older version. Your current version will be preserved in history so you can restore it again later."
        confirmLabel="Restore this version"
        variant="default"
        isLoading={restoreVersionMutation.isPending}
        onConfirm={() => {
          if (!versionToRestore) return;
          restoreVersionMutation.mutate(versionToRestore.id, {
            onSettled: () => setVersionToRestore(null),
          });
        }}
      />
    </PageShell>
  );
}
