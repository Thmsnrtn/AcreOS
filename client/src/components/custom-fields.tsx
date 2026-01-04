import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, MoreVertical, GripVertical, Type, Hash, Calendar, List, CheckSquare } from "lucide-react";
import type { CustomFieldDefinition, CustomFieldValue, CustomFieldEntityType, CustomFieldType } from "@shared/schema";

const FIELD_TYPE_ICONS: Record<CustomFieldType, typeof Type> = {
  text: Type,
  number: Hash,
  date: Calendar,
  select: List,
  checkbox: CheckSquare,
};

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  select: "Select",
  checkbox: "Checkbox",
};

const ENTITY_TYPE_LABELS: Record<CustomFieldEntityType, string> = {
  lead: "Leads",
  property: "Properties",
  deal: "Deals",
};

interface CustomFieldDefinitionFormData {
  fieldName: string;
  fieldLabel: string;
  fieldType: CustomFieldType;
  entityType: CustomFieldEntityType;
  options: string[];
  isRequired: boolean;
  placeholder: string;
  helpText: string;
}

const defaultFormData: CustomFieldDefinitionFormData = {
  fieldName: "",
  fieldLabel: "",
  fieldType: "text",
  entityType: "lead",
  options: [],
  isRequired: false,
  placeholder: "",
  helpText: "",
};

export function CustomFieldsManager() {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<CustomFieldDefinition | null>(null);
  const [formData, setFormData] = useState<CustomFieldDefinitionFormData>(defaultFormData);
  const [newOption, setNewOption] = useState("");
  const [filterEntityType, setFilterEntityType] = useState<CustomFieldEntityType | "all">("all");

  const { data: definitions = [], isLoading } = useQuery<CustomFieldDefinition[]>({
    queryKey: ["/api/custom-fields/definitions"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<CustomFieldDefinitionFormData, "options"> & { options?: string[] }) => {
      return apiRequest("POST", "/api/custom-fields/definitions", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-fields/definitions"] });
      toast({ title: "Custom field created successfully" });
      handleCloseDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create custom field", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<CustomFieldDefinitionFormData> }) => {
      return apiRequest("PATCH", `/api/custom-fields/definitions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-fields/definitions"] });
      toast({ title: "Custom field updated successfully" });
      handleCloseDialog();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update custom field", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/custom-fields/definitions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-fields/definitions"] });
      toast({ title: "Custom field deleted successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete custom field", description: err.message, variant: "destructive" });
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingField(null);
    setFormData(defaultFormData);
    setNewOption("");
  };

  const handleEditField = (field: CustomFieldDefinition) => {
    setEditingField(field);
    setFormData({
      fieldName: field.fieldName,
      fieldLabel: field.fieldLabel,
      fieldType: field.fieldType as CustomFieldType,
      entityType: field.entityType as CustomFieldEntityType,
      options: (field.options as string[]) || [],
      isRequired: field.isRequired || false,
      placeholder: field.placeholder || "",
      helpText: field.helpText || "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const fieldName = formData.fieldLabel
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    
    const submitData = {
      ...formData,
      fieldName: formData.fieldName || fieldName,
      options: formData.fieldType === "select" ? formData.options : undefined,
    };

    if (editingField) {
      updateMutation.mutate({ id: editingField.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const addOption = () => {
    if (newOption.trim() && !formData.options.includes(newOption.trim())) {
      setFormData({ ...formData, options: [...formData.options, newOption.trim()] });
      setNewOption("");
    }
  };

  const removeOption = (option: string) => {
    setFormData({ ...formData, options: formData.options.filter((o) => o !== option) });
  };

  const filteredDefinitions = filterEntityType === "all" 
    ? definitions 
    : definitions.filter((d) => d.entityType === filterEntityType);

  const groupedDefinitions = filteredDefinitions.reduce((acc, def) => {
    const type = def.entityType as CustomFieldEntityType;
    if (!acc[type]) acc[type] = [];
    acc[type].push(def);
    return acc;
  }, {} as Record<CustomFieldEntityType, CustomFieldDefinition[]>);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle data-testid="text-custom-fields-title">Custom Fields</CardTitle>
          <CardDescription>
            Define custom fields for leads, properties, and deals to capture additional information.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={filterEntityType} onValueChange={(v) => setFilterEntityType(v as CustomFieldEntityType | "all")}>
            <SelectTrigger className="w-[150px]" data-testid="select-filter-entity-type">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="lead">Leads</SelectItem>
              <SelectItem value="property">Properties</SelectItem>
              <SelectItem value="deal">Deals</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { setEditingField(null); setFormData(defaultFormData); }} data-testid="button-add-custom-field">
                <Plus className="w-4 h-4 mr-2" />
                Add Field
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>{editingField ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle>
                <DialogDescription>
                  {editingField 
                    ? "Update the custom field configuration." 
                    : "Create a new custom field for your entities."}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fieldLabel">Field Label</Label>
                  <Input
                    id="fieldLabel"
                    value={formData.fieldLabel}
                    onChange={(e) => setFormData({ ...formData, fieldLabel: e.target.value })}
                    placeholder="e.g., Property Source"
                    required
                    data-testid="input-field-label"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="entityType">Entity Type</Label>
                    <Select 
                      value={formData.entityType} 
                      onValueChange={(v) => setFormData({ ...formData, entityType: v as CustomFieldEntityType })}
                      disabled={!!editingField}
                    >
                      <SelectTrigger data-testid="select-entity-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lead">Lead</SelectItem>
                        <SelectItem value="property">Property</SelectItem>
                        <SelectItem value="deal">Deal</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fieldType">Field Type</Label>
                    <Select 
                      value={formData.fieldType} 
                      onValueChange={(v) => setFormData({ ...formData, fieldType: v as CustomFieldType })}
                      disabled={!!editingField}
                    >
                      <SelectTrigger data-testid="select-field-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => (
                          <SelectItem key={type} value={type}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {formData.fieldType === "select" && (
                  <div className="space-y-2">
                    <Label>Options</Label>
                    <div className="flex gap-2">
                      <Input
                        value={newOption}
                        onChange={(e) => setNewOption(e.target.value)}
                        placeholder="Add option"
                        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOption())}
                        data-testid="input-new-option"
                      />
                      <Button type="button" variant="outline" onClick={addOption} data-testid="button-add-option">
                        Add
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {formData.options.map((option) => (
                        <Badge key={option} variant="secondary" className="gap-1">
                          {option}
                          <button
                            type="button"
                            onClick={() => removeOption(option)}
                            className="ml-1 hover:text-destructive"
                            data-testid={`button-remove-option-${option}`}
                          >
                            x
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="placeholder">Placeholder Text</Label>
                  <Input
                    id="placeholder"
                    value={formData.placeholder}
                    onChange={(e) => setFormData({ ...formData, placeholder: e.target.value })}
                    placeholder="e.g., Enter the property source"
                    data-testid="input-placeholder"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="helpText">Help Text</Label>
                  <Input
                    id="helpText"
                    value={formData.helpText}
                    onChange={(e) => setFormData({ ...formData, helpText: e.target.value })}
                    placeholder="e.g., Where did you find this property?"
                    data-testid="input-help-text"
                  />
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="isRequired"
                    checked={formData.isRequired}
                    onCheckedChange={(checked) => setFormData({ ...formData, isRequired: !!checked })}
                    data-testid="checkbox-is-required"
                  />
                  <Label htmlFor="isRequired" className="text-sm font-normal">
                    Required field
                  </Label>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={handleCloseDialog} data-testid="button-cancel">
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} data-testid="button-save-field">
                    {editingField ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading custom fields...</div>
        ) : filteredDefinitions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No custom fields defined yet. Click "Add Field" to create one.
          </div>
        ) : (
          <div className="space-y-6">
            {(Object.entries(groupedDefinitions) as [CustomFieldEntityType, CustomFieldDefinition[]][]).map(([entityType, fields]) => (
              <div key={entityType}>
                <h3 className="text-sm font-medium text-muted-foreground mb-2">{ENTITY_TYPE_LABELS[entityType]}</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Label</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead className="w-[100px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fields.map((field) => {
                      const Icon = FIELD_TYPE_ICONS[field.fieldType as CustomFieldType] || Type;
                      return (
                        <TableRow key={field.id} data-testid={`row-custom-field-${field.id}`}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <GripVertical className="w-4 h-4 text-muted-foreground" />
                              {field.fieldLabel}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4 text-muted-foreground" />
                              {FIELD_TYPE_LABELS[field.fieldType as CustomFieldType]}
                              {field.fieldType === "select" && field.options && (
                                <span className="text-xs text-muted-foreground">
                                  ({(field.options as string[]).length} options)
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {field.isRequired ? <Badge variant="secondary">Required</Badge> : "-"}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" data-testid={`button-field-actions-${field.id}`}>
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEditField(field)} data-testid={`button-edit-field-${field.id}`}>
                                  <Pencil className="w-4 h-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  className="text-destructive" 
                                  onClick={() => deleteMutation.mutate(field.id)}
                                  data-testid={`button-delete-field-${field.id}`}
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface CustomFieldValuesEditorProps {
  entityType: CustomFieldEntityType;
  entityId: number;
  compact?: boolean;
}

export function CustomFieldValuesEditor({ entityType, entityId, compact = false }: CustomFieldValuesEditorProps) {
  const { toast } = useToast();
  const [editingValues, setEditingValues] = useState<Record<number, string>>({});

  const { data: definitions = [] } = useQuery<CustomFieldDefinition[]>({
    queryKey: ["/api/custom-fields/definitions", entityType],
    queryFn: async () => {
      const res = await fetch(`/api/custom-fields/definitions?entityType=${entityType}`);
      if (!res.ok) throw new Error("Failed to load custom field definitions");
      return res.json();
    },
  });

  const { data: values = [], refetch: refetchValues } = useQuery<(CustomFieldValue & { definition: CustomFieldDefinition })[]>({
    queryKey: ["/api/custom-fields/values", entityType, entityId],
    queryFn: async () => {
      const res = await fetch(`/api/custom-fields/values/${entityType}/${entityId}`);
      if (!res.ok) throw new Error("Failed to load custom field values");
      return res.json();
    },
    enabled: entityId > 0,
  });

  const saveMutation = useMutation({
    mutationFn: async ({ definitionId, value }: { definitionId: number; value: string | null }) => {
      return apiRequest("POST", "/api/custom-fields/values", {
        definitionId,
        entityId,
        value,
      });
    },
    onSuccess: () => {
      refetchValues();
      toast({ title: "Custom field saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save custom field", description: err.message, variant: "destructive" });
    },
  });

  const handleValueChange = (definitionId: number, value: string) => {
    setEditingValues({ ...editingValues, [definitionId]: value });
  };

  const handleSaveValue = (definitionId: number) => {
    const value = editingValues[definitionId] ?? "";
    saveMutation.mutate({ definitionId, value: value || null });
    setEditingValues({ ...editingValues, [definitionId]: "" });
  };

  const getValueForField = (definitionId: number) => {
    if (editingValues[definitionId] !== undefined) {
      return editingValues[definitionId];
    }
    const fieldValue = values.find((v) => v.definitionId === definitionId);
    return fieldValue?.value || "";
  };

  if (definitions.length === 0) {
    return null;
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <h3 className="text-sm font-medium text-muted-foreground">Custom Fields</h3>
      {definitions.map((def) => {
        const currentValue = getValueForField(def.id);
        const hasChanged = editingValues[def.id] !== undefined && editingValues[def.id] !== (values.find((v) => v.definitionId === def.id)?.value || "");

        return (
          <div key={def.id} className="space-y-1">
            <Label htmlFor={`custom-field-${def.id}`} className="text-sm">
              {def.fieldLabel}
              {def.isRequired && <span className="text-destructive ml-1">*</span>}
            </Label>
            
            {def.fieldType === "text" && (
              <div className="flex gap-2">
                <Input
                  id={`custom-field-${def.id}`}
                  value={currentValue}
                  onChange={(e) => handleValueChange(def.id, e.target.value)}
                  placeholder={def.placeholder || undefined}
                  className="flex-1"
                  data-testid={`input-custom-field-${def.id}`}
                />
                {hasChanged && (
                  <Button 
                    size="sm" 
                    onClick={() => handleSaveValue(def.id)}
                    disabled={saveMutation.isPending}
                    data-testid={`button-save-custom-field-${def.id}`}
                  >
                    Save
                  </Button>
                )}
              </div>
            )}

            {def.fieldType === "number" && (
              <div className="flex gap-2">
                <Input
                  id={`custom-field-${def.id}`}
                  type="number"
                  value={currentValue}
                  onChange={(e) => handleValueChange(def.id, e.target.value)}
                  placeholder={def.placeholder || undefined}
                  className="flex-1"
                  data-testid={`input-custom-field-${def.id}`}
                />
                {hasChanged && (
                  <Button 
                    size="sm" 
                    onClick={() => handleSaveValue(def.id)}
                    disabled={saveMutation.isPending}
                    data-testid={`button-save-custom-field-${def.id}`}
                  >
                    Save
                  </Button>
                )}
              </div>
            )}

            {def.fieldType === "date" && (
              <div className="flex gap-2">
                <Input
                  id={`custom-field-${def.id}`}
                  type="date"
                  value={currentValue}
                  onChange={(e) => handleValueChange(def.id, e.target.value)}
                  className="flex-1"
                  data-testid={`input-custom-field-${def.id}`}
                />
                {hasChanged && (
                  <Button 
                    size="sm" 
                    onClick={() => handleSaveValue(def.id)}
                    disabled={saveMutation.isPending}
                    data-testid={`button-save-custom-field-${def.id}`}
                  >
                    Save
                  </Button>
                )}
              </div>
            )}

            {def.fieldType === "select" && (
              <div className="flex gap-2">
                <Select 
                  value={currentValue || ""}
                  onValueChange={(v) => {
                    handleValueChange(def.id, v);
                    saveMutation.mutate({ definitionId: def.id, value: v || null });
                  }}
                >
                  <SelectTrigger className="flex-1" data-testid={`select-custom-field-${def.id}`}>
                    <SelectValue placeholder={def.placeholder || "Select..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {(def.options as string[] || []).map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {def.fieldType === "checkbox" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`custom-field-${def.id}`}
                  checked={currentValue === "true"}
                  onCheckedChange={(checked) => {
                    saveMutation.mutate({ definitionId: def.id, value: checked ? "true" : "false" });
                  }}
                  data-testid={`checkbox-custom-field-${def.id}`}
                />
                <Label htmlFor={`custom-field-${def.id}`} className="text-sm font-normal">
                  {def.placeholder || "Yes"}
                </Label>
              </div>
            )}

            {def.helpText && (
              <p className="text-xs text-muted-foreground">{def.helpText}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
