import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { DocumentTemplate } from "@shared/schema";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, Trash2, Loader2, Save, X, Eye, Variable, 
  FileText, ChevronDown, GripVertical, Settings2
} from "lucide-react";

const DOCUMENT_TYPES = [
  { value: "promissory_note", label: "Promissory Note" },
  { value: "warranty_deed", label: "Warranty Deed" },
  { value: "offer_letter", label: "Offer Letter" },
  { value: "contract", label: "Contract" },
  { value: "purchase_agreement", label: "Purchase Agreement" },
  { value: "quit_claim_deed", label: "Quit Claim Deed" },
  { value: "assignment", label: "Assignment Contract" },
  { value: "custom", label: "Custom Document" },
];

const DOCUMENT_CATEGORIES = [
  { value: "legal", label: "Legal" },
  { value: "finance", label: "Finance" },
  { value: "marketing", label: "Marketing" },
  { value: "other", label: "Other" },
];

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "textarea", label: "Long Text" },
];

const AVAILABLE_VARIABLES = [
  {
    category: "Property",
    variables: [
      { name: "property.address", description: "Property street address" },
      { name: "property.apn", description: "Assessor's Parcel Number" },
      { name: "property.county", description: "County name" },
      { name: "property.state", description: "State" },
      { name: "property.sizeAcres", description: "Property size in acres" },
      { name: "property.purchasePrice", description: "Purchase price" },
      { name: "property.assessedValue", description: "Assessed value" },
      { name: "property.legalDescription", description: "Legal description" },
    ],
  },
  {
    category: "Lead/Contact",
    variables: [
      { name: "lead.firstName", description: "First name" },
      { name: "lead.lastName", description: "Last name" },
      { name: "lead.fullName", description: "Full name" },
      { name: "lead.email", description: "Email address" },
      { name: "lead.phone", description: "Phone number" },
      { name: "lead.address", description: "Mailing address" },
    ],
  },
  {
    category: "Organization",
    variables: [
      { name: "organization.name", description: "Company name" },
      { name: "organization.email", description: "Company email" },
      { name: "organization.phone", description: "Company phone" },
      { name: "organization.address", description: "Company address" },
    ],
  },
  {
    category: "Deal",
    variables: [
      { name: "deal.title", description: "Deal title" },
      { name: "deal.offerAmount", description: "Offer amount" },
      { name: "deal.earnestMoney", description: "Earnest money deposit" },
      { name: "deal.closingDate", description: "Expected closing date" },
    ],
  },
  {
    category: "Note/Finance",
    variables: [
      { name: "note.principal", description: "Loan principal amount" },
      { name: "note.interestRate", description: "Interest rate" },
      { name: "note.termMonths", description: "Loan term in months" },
      { name: "note.monthlyPayment", description: "Monthly payment amount" },
      { name: "note.downPayment", description: "Down payment amount" },
    ],
  },
  {
    category: "Date",
    variables: [
      { name: "date.today", description: "Today's date (short format)" },
      { name: "date.current", description: "Today's date (long format)" },
    ],
  },
];

interface CustomField {
  id: string;
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
}

const templateFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  type: z.string().min(1, "Type is required"),
  category: z.string().min(1, "Category is required"),
  content: z.string().min(1, "Content is required"),
  isActive: z.boolean().default(true),
});

type TemplateFormValues = z.infer<typeof templateFormSchema>;

interface TemplateEditorProps {
  template?: DocumentTemplate | null;
  onSave?: (template: DocumentTemplate) => void;
  onCancel?: () => void;
  mode?: "create" | "edit";
}

export function TemplateEditor({ template, onSave, onCancel, mode = "create" }: TemplateEditorProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"editor" | "fields" | "preview">("editor");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<number>(0);

  const form = useForm<TemplateFormValues>({
    resolver: zodResolver(templateFormSchema),
    defaultValues: {
      name: template?.name || "",
      type: template?.type || "custom",
      category: template?.category || "other",
      content: template?.content || "",
      isActive: template?.isActive ?? true,
    },
  });

  useEffect(() => {
    if (template) {
      form.reset({
        name: template.name,
        type: template.type,
        category: template.category,
        content: template.content,
        isActive: template.isActive ?? true,
      });
      if (template.variables && Array.isArray(template.variables)) {
        setCustomFields(
          template.variables.map((v: any, idx: number) => ({
            id: `field-${idx}`,
            name: v.name,
            type: v.type || "text",
            required: v.required ?? true,
            defaultValue: v.defaultValue || "",
            description: v.description || "",
          }))
        );
      }
    }
  }, [template, form]);

  const createMutation = useMutation({
    mutationFn: async (data: TemplateFormValues & { variables: any[] }) => {
      return apiRequest("POST", "/api/document-templates", data);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-templates"] });
      toast({ title: "Template created successfully" });
      onSave?.(response as DocumentTemplate);
    },
    onError: (error: any) => {
      toast({ title: "Failed to create template", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: TemplateFormValues & { variables: any[] }) => {
      if (!template?.id) throw new Error("Template ID is required");
      return apiRequest("PATCH", `/api/document-templates/${template.id}`, data);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["/api/document-templates"] });
      toast({ title: "Template updated successfully" });
      onSave?.(response as DocumentTemplate);
    },
    onError: (error: any) => {
      toast({ title: "Failed to update template", description: error.message, variant: "destructive" });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (templateId: number) => {
      return apiRequest("POST", `/api/document-templates/${templateId}/preview`, {});
    },
    onSuccess: (response: any) => {
      setPreviewContent(response.previewContent);
    },
    onError: (error: any) => {
      toast({ title: "Failed to load preview", description: error.message, variant: "destructive" });
    },
  });

  const handleInsertVariable = (variableName: string) => {
    const content = form.getValues("content");
    const insertText = `{{${variableName}}}`;
    const newContent = 
      content.substring(0, cursorPosition) + 
      insertText + 
      content.substring(cursorPosition);
    form.setValue("content", newContent);
  };

  const handleAddField = () => {
    const newField: CustomField = {
      id: `field-${Date.now()}`,
      name: "",
      type: "text",
      required: false,
      defaultValue: "",
      description: "",
    };
    setCustomFields([...customFields, newField]);
  };

  const handleRemoveField = (id: string) => {
    setCustomFields(customFields.filter(f => f.id !== id));
  };

  const handleFieldChange = (id: string, field: string, value: any) => {
    setCustomFields(customFields.map(f => 
      f.id === id ? { ...f, [field]: value } : f
    ));
  };

  const extractVariablesFromContent = (content: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const variables: string[] = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      if (!variables.includes(match[1])) {
        variables.push(match[1]);
      }
    }
    return variables;
  };

  const handlePreview = async () => {
    setIsPreviewLoading(true);
    setActiveTab("preview");
    
    const content = form.getValues("content");
    
    const defaultSampleData: Record<string, string> = {
      "property.address": "123 Oak Lane, Austin, TX 78701",
      "property.apn": "APN-12345-678",
      "property.county": "Travis",
      "property.state": "Texas",
      "property.sizeAcres": "5.5",
      "property.purchasePrice": "$45,000",
      "property.assessedValue": "$52,000",
      "property.legalDescription": "Lot 42, Block 3, Oak Ridge Subdivision",
      "lead.firstName": "John",
      "lead.lastName": "Smith",
      "lead.fullName": "John Smith",
      "lead.email": "john.smith@example.com",
      "lead.phone": "(555) 123-4567",
      "lead.address": "456 Maple Street, Dallas, TX 75201",
      "organization.name": "AcreOS Land Co.",
      "organization.email": "contact@acreos.com",
      "organization.phone": "(555) 999-0000",
      "organization.address": "789 Business Ave, Suite 100",
      "deal.title": "Oak Lane Property Acquisition",
      "deal.offerAmount": "$40,000",
      "deal.earnestMoney": "$1,000",
      "deal.closingDate": new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
      "date.today": new Date().toLocaleDateString(),
      "date.current": new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      "note.principal": "$35,000",
      "note.interestRate": "9.9%",
      "note.termMonths": "60",
      "note.monthlyPayment": "$741.52",
      "note.downPayment": "$5,000",
    };

    for (const field of customFields) {
      if (field.name && field.defaultValue) {
        defaultSampleData[field.name] = field.defaultValue;
      }
    }

    let preview = content;
    for (const [key, value] of Object.entries(defaultSampleData)) {
      const regex = new RegExp(`\\{\\{${key.replace('.', '\\.')}\\}\\}`, 'g');
      preview = preview.replace(regex, value);
    }

    preview = preview.replace(/\{\{([^}]+)\}\}/g, '[$1]');
    
    setPreviewContent(preview);
    setIsPreviewLoading(false);
  };

  const handleSubmit = (values: TemplateFormValues) => {
    const contentVariables = extractVariablesFromContent(values.content);
    
    const allVariables = [
      ...customFields.filter(f => f.name).map(f => ({
        name: f.name,
        description: f.description || f.name.replace(/_/g, " "),
        type: f.type,
        required: f.required,
        defaultValue: f.defaultValue,
      })),
      ...contentVariables
        .filter(v => !customFields.some(f => f.name === v))
        .map(name => ({
          name,
          description: name.replace(/\./g, " ").replace(/_/g, " "),
          type: name.includes("price") || name.includes("amount") || name.includes("payment") ? "currency" : 
                name.includes("date") ? "date" : "text",
          required: true,
        })),
    ];

    const payload = {
      ...values,
      variables: allVariables,
    };

    if (mode === "edit" && template?.id) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Template Name</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="e.g., Standard Offer Letter" 
                      {...field} 
                      data-testid="input-template-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
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
              control={form.control}
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

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <TabsList data-testid="tabs-template-editor">
                <TabsTrigger value="editor" data-testid="tab-editor">
                  <FileText className="w-4 h-4 mr-2" />
                  Content
                </TabsTrigger>
                <TabsTrigger value="fields" data-testid="tab-fields">
                  <Settings2 className="w-4 h-4 mr-2" />
                  Custom Fields
                </TabsTrigger>
                <TabsTrigger value="preview" data-testid="tab-preview" onClick={handlePreview}>
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </TabsTrigger>
              </TabsList>

              {activeTab === "editor" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" data-testid="button-insert-variable">
                      <Variable className="w-4 h-4 mr-2" />
                      Insert Variable
                      <ChevronDown className="w-4 h-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-auto">
                    {AVAILABLE_VARIABLES.map(group => (
                      <div key={group.category}>
                        <DropdownMenuLabel>{group.category}</DropdownMenuLabel>
                        {group.variables.map(v => (
                          <DropdownMenuItem
                            key={v.name}
                            onClick={() => handleInsertVariable(v.name)}
                            data-testid={`menu-item-variable-${v.name.replace('.', '-')}`}
                          >
                            <div className="flex flex-col">
                              <span className="font-mono text-xs">{`{{${v.name}}}`}</span>
                              <span className="text-xs text-muted-foreground">{v.description}</span>
                            </div>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </div>
                    ))}
                    {customFields.length > 0 && (
                      <>
                        <DropdownMenuLabel>Custom Fields</DropdownMenuLabel>
                        {customFields.filter(f => f.name).map(f => (
                          <DropdownMenuItem
                            key={f.id}
                            onClick={() => handleInsertVariable(f.name)}
                            data-testid={`menu-item-custom-field-${f.name}`}
                          >
                            <span className="font-mono text-xs">{`{{${f.name}}}`}</span>
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            <TabsContent value="editor" className="mt-4">
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Content</FormLabel>
                    <FormDescription>
                      Use {"{{variable.name}}"} syntax for merge fields. Click "Insert Variable" to add common placeholders.
                    </FormDescription>
                    <FormControl>
                      <Textarea 
                        placeholder={`Enter your document template content here...

Example:
Dear {{lead.firstName}} {{lead.lastName}},

We are pleased to present this offer to purchase your property located at {{property.address}} in {{property.county}} County, {{property.state}}.

Our offer price is {{deal.offerAmount}}.

Sincerely,
{{organization.name}}`}
                        className="min-h-[400px] font-mono text-sm"
                        {...field}
                        onSelect={(e) => setCursorPosition((e.target as HTMLTextAreaElement).selectionStart)}
                        onClick={(e) => setCursorPosition((e.target as HTMLTextAreaElement).selectionStart)}
                        onKeyUp={(e) => setCursorPosition((e.target as HTMLTextAreaElement).selectionStart)}
                        data-testid="textarea-template-content"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </TabsContent>

            <TabsContent value="fields" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base">Custom Field Definitions</CardTitle>
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      onClick={handleAddField}
                      data-testid="button-add-custom-field"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Field
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Define custom fields that users can fill in when generating documents from this template.
                  </p>
                </CardHeader>
                <CardContent>
                  {customFields.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Variable className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No custom fields defined yet.</p>
                      <p className="text-xs">Click "Add Field" to create custom input fields for this template.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {customFields.map((field, index) => (
                        <div 
                          key={field.id} 
                          className="flex items-start gap-3 p-3 border rounded-lg"
                          data-testid={`custom-field-${index}`}
                        >
                          <div className="pt-2">
                            <GripVertical className="w-4 h-4 text-muted-foreground" />
                          </div>
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-3">
                            <div>
                              <Label className="text-xs">Field Name</Label>
                              <Input
                                placeholder="field_name"
                                value={field.name}
                                onChange={(e) => handleFieldChange(field.id, "name", e.target.value)}
                                className="font-mono text-sm"
                                data-testid={`input-field-name-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Type</Label>
                              <Select 
                                value={field.type} 
                                onValueChange={(v) => handleFieldChange(field.id, "type", v)}
                              >
                                <SelectTrigger data-testid={`select-field-type-${index}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {FIELD_TYPES.map(t => (
                                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Default Value</Label>
                              <Input
                                placeholder="Optional default"
                                value={field.defaultValue || ""}
                                onChange={(e) => handleFieldChange(field.id, "defaultValue", e.target.value)}
                                data-testid={`input-field-default-${index}`}
                              />
                            </div>
                            <div>
                              <Label className="text-xs">Description</Label>
                              <Input
                                placeholder="Field description"
                                value={field.description || ""}
                                onChange={(e) => handleFieldChange(field.id, "description", e.target.value)}
                                data-testid={`input-field-description-${index}`}
                              />
                            </div>
                            <div className="flex items-end gap-2">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={field.required}
                                  onCheckedChange={(v) => handleFieldChange(field.id, "required", v)}
                                  data-testid={`switch-field-required-${index}`}
                                />
                                <Label className="text-xs">Required</Label>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveField(field.id)}
                                data-testid={`button-remove-field-${index}`}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="preview" className="mt-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Eye className="w-4 h-4" />
                    Template Preview
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Preview shows how the template looks with sample data. Unresolved variables appear in [brackets].
                  </p>
                </CardHeader>
                <CardContent>
                  {isPreviewLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : previewContent ? (
                    <ScrollArea className="h-[400px] border rounded-lg p-4">
                      <div 
                        className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap"
                        data-testid="preview-content"
                      >
                        {previewContent}
                      </div>
                    </ScrollArea>
                  ) : (
                    <div className="text-center py-12 text-muted-foreground">
                      <Eye className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Click the Preview tab to see how your template looks with sample data.</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <Separator />

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="switch-template-active"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">Active</FormLabel>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex gap-2">
              {onCancel && (
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={onCancel}
                  data-testid="button-cancel"
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              )}
              <Button 
                type="submit" 
                disabled={isPending}
                data-testid="button-save-template"
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-2" />
                )}
                {mode === "edit" ? "Update Template" : "Create Template"}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}

export default TemplateEditor;
