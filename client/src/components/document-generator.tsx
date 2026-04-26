import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useProperties } from "@/hooks/use-properties";
import { useLeads } from "@/hooks/use-leads";
import type { Property, Lead, Note } from "@shared/schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Download,
  Loader2,
  FileSignature,
  Receipt,
  Mail,
  Image as ImageIcon,
  ScrollText,
} from "lucide-react";

type DocumentType =
  | "promissory-note"
  | "warranty-deed"
  | "settlement-statement"
  | "offer-letter"
  | "property-flyer";

const documentTypes: {
  value: DocumentType;
  label: string;
  category: "legal" | "closing" | "marketing";
  icon: typeof FileText;
  description: string;
  requiresProperty?: boolean;
  requiresNote?: boolean;
  requiresLead?: boolean;
}[] = [
  {
    value: "promissory-note",
    label: "Promissory note",
    category: "legal",
    icon: ScrollText,
    description: "Generate a promissory note for seller financing",
    requiresNote: true,
  },
  {
    value: "warranty-deed",
    label: "Warranty deed",
    category: "closing",
    icon: FileSignature,
    description: "Generate a warranty deed for property transfer",
    requiresProperty: true,
  },
  {
    value: "settlement-statement",
    label: "Settlement statement (HUD-1)",
    category: "closing",
    icon: Receipt,
    description: "Generate a closing settlement statement",
    requiresProperty: true,
  },
  {
    value: "offer-letter",
    label: "Offer letter",
    category: "marketing",
    icon: Mail,
    description: "Generate an offer letter for a property",
    requiresProperty: true,
    requiresLead: true,
  },
  {
    value: "property-flyer",
    label: "Property flyer",
    category: "marketing",
    icon: ImageIcon,
    description: "Generate a marketing flyer for a property",
    requiresProperty: true,
  },
];

const promissoryNoteSchema = z.object({
  noteId: z.number().min(1, "Note is required"),
});

const warrantyDeedSchema = z.object({
  propertyId: z.number().min(1, "Property is required"),
});

const settlementStatementSchema = z.object({
  propertyId: z.number().min(1, "Property is required"),
  purchasePrice: z.number().min(0).optional(),
  closingDate: z.string().optional(),
  buyerName: z.string().optional(),
  sellerName: z.string().optional(),
  earnestMoney: z.number().min(0).optional(),
  titleInsurance: z.number().min(0).optional(),
  recordingFees: z.number().min(0).optional(),
  escrowFees: z.number().min(0).optional(),
  transferTax: z.number().min(0).optional(),
});

const offerLetterSchema = z.object({
  propertyId: z.number().min(1, "Property is required"),
  leadId: z.number().min(1, "Lead is required"),
  offerAmount: z.number().min(0).optional(),
  earnestMoney: z.number().min(0).optional(),
  closingDate: z.string().optional(),
  additionalTerms: z.string().optional(),
});

const propertyFlyerSchema = z.object({
  propertyId: z.number().min(1, "Property is required"),
  headline: z.string().optional(),
  price: z.number().min(0).optional(),
  priceLabel: z.string().optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().optional(),
});

interface DocumentGeneratorProps {
  property?: Property;
  lead?: Lead;
  note?: Note;
  trigger?: React.ReactNode;
  defaultType?: DocumentType;
}

export function DocumentGenerator({
  property,
  lead,
  note,
  trigger,
  defaultType,
}: DocumentGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<DocumentType | null>(
    defaultType || null
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();
  const { data: properties } = useProperties();
  const { data: leads } = useLeads();

  const downloadPdf = async (endpoint: string, data: any, filename: string) => {
    setIsGenerating(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to generate document");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Document generated",
        description: `${filename} has been downloaded.`,
      });
    } catch (error: any) {
      toast({
        title: "Couldn't generate document",
        description: error.message || "Generation failed. Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button type="button" variant="outline" data-testid="button-open-document-generator" aria-label="Open document generator">
            <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
            Generate document
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Document generator</DialogTitle>
          <DialogDescription>
            Generate legal, closing, and marketing documents
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="select" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="select" data-testid="tab-select-document">
              Select document
            </TabsTrigger>
            <TabsTrigger
              value="form"
              disabled={!selectedType}
              data-testid="tab-document-form"
            >
              Fill details
            </TabsTrigger>
          </TabsList>

          <TabsContent value="select" className="space-y-4 mt-4">
            <section aria-labelledby="doc-cat-legal-heading" className="space-y-3">
              <h4 id="doc-cat-legal-heading" className="text-sm font-medium text-muted-foreground m-0">
                Legal documents
              </h4>
              <ul aria-labelledby="doc-cat-legal-heading" className="grid gap-2 list-none p-0 m-0">
                {documentTypes
                  .filter((d) => d.category === "legal")
                  .map((docType) => (
                    <li key={docType.value} className="list-none">
                      <DocumentTypeCard
                        docType={docType}
                        selected={selectedType === docType.value}
                        onSelect={() => setSelectedType(docType.value)}
                      />
                    </li>
                  ))}
              </ul>
            </section>

            <section aria-labelledby="doc-cat-closing-heading" className="space-y-3">
              <h4 id="doc-cat-closing-heading" className="text-sm font-medium text-muted-foreground m-0">
                Closing documents
              </h4>
              <ul aria-labelledby="doc-cat-closing-heading" className="grid gap-2 list-none p-0 m-0">
                {documentTypes
                  .filter((d) => d.category === "closing")
                  .map((docType) => (
                    <li key={docType.value} className="list-none">
                      <DocumentTypeCard
                        docType={docType}
                        selected={selectedType === docType.value}
                        onSelect={() => setSelectedType(docType.value)}
                      />
                    </li>
                  ))}
              </ul>
            </section>

            <section aria-labelledby="doc-cat-marketing-heading" className="space-y-3">
              <h4 id="doc-cat-marketing-heading" className="text-sm font-medium text-muted-foreground m-0">
                Marketing materials
              </h4>
              <ul aria-labelledby="doc-cat-marketing-heading" className="grid gap-2 list-none p-0 m-0">
                {documentTypes
                  .filter((d) => d.category === "marketing")
                  .map((docType) => (
                    <li key={docType.value} className="list-none">
                      <DocumentTypeCard
                        docType={docType}
                        selected={selectedType === docType.value}
                        onSelect={() => setSelectedType(docType.value)}
                      />
                    </li>
                  ))}
              </ul>
            </section>
          </TabsContent>

          <TabsContent value="form" className="mt-4">
            {selectedType === "promissory-note" && (
              <PromissoryNoteForm
                note={note}
                onGenerate={downloadPdf}
                isGenerating={isGenerating}
              />
            )}
            {selectedType === "warranty-deed" && (
              <WarrantyDeedForm
                property={property}
                properties={properties}
                onGenerate={downloadPdf}
                isGenerating={isGenerating}
              />
            )}
            {selectedType === "settlement-statement" && (
              <SettlementStatementForm
                property={property}
                properties={properties}
                onGenerate={downloadPdf}
                isGenerating={isGenerating}
              />
            )}
            {selectedType === "offer-letter" && (
              <OfferLetterForm
                property={property}
                lead={lead}
                properties={properties}
                leads={leads}
                onGenerate={downloadPdf}
                isGenerating={isGenerating}
              />
            )}
            {selectedType === "property-flyer" && (
              <PropertyFlyerForm
                property={property}
                properties={properties}
                onGenerate={downloadPdf}
                isGenerating={isGenerating}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DocumentTypeCard({
  docType,
  selected,
  onSelect,
}: {
  docType: (typeof documentTypes)[0];
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = docType.icon;
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${docType.label}: ${docType.description}${selected ? " (selected)" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        selected
          ? "border-primary bg-primary/5"
          : "hover-elevate"
      }`}
      data-testid={`card-document-type-${docType.value}`}
    >
      <CardContent className="flex items-center gap-3 p-4">
        <div
          aria-hidden="true"
          className={`p-2 rounded-md ${
            selected ? "bg-primary/10" : "bg-muted"
          }`}
        >
          <Icon
            aria-hidden="true"
            className={`w-5 h-5 ${selected ? "text-primary" : "text-muted-foreground"}`}
          />
        </div>
        <div className="flex-1">
          <p className="font-medium m-0" aria-hidden="true">{docType.label}</p>
          <p className="text-sm text-muted-foreground m-0" aria-hidden="true">{docType.description}</p>
        </div>
        {selected && (
          <div aria-hidden="true" className="w-2 h-2 rounded-full bg-primary" />
        )}
      </CardContent>
    </Card>
  );
}

function PromissoryNoteForm({
  note,
  onGenerate,
  isGenerating,
}: {
  note?: Note;
  onGenerate: (endpoint: string, data: any, filename: string) => Promise<void>;
  isGenerating: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(promissoryNoteSchema),
    defaultValues: {
      noteId: note?.id || 0,
    },
  });

  const onSubmit = (data: z.infer<typeof promissoryNoteSchema>) => {
    onGenerate(
      "/api/documents/generate/promissory-note",
      data,
      `promissory-note-${data.noteId}.pdf`
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="noteId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Note ID</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="Enter note ID"
                  {...field}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                  data-testid="input-note-id"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isGenerating} aria-busy={isGenerating} aria-label={isGenerating ? "Generating promissory note" : "Generate promissory note"} className="w-full" data-testid="button-generate-promissory-note">
          {isGenerating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          Generate promissory note
        </Button>
      </form>
    </Form>
  );
}

function WarrantyDeedForm({
  property,
  properties,
  onGenerate,
  isGenerating,
}: {
  property?: Property;
  properties?: Property[];
  onGenerate: (endpoint: string, data: any, filename: string) => Promise<void>;
  isGenerating: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(warrantyDeedSchema),
    defaultValues: {
      propertyId: property?.id || 0,
    },
  });

  const onSubmit = (data: z.infer<typeof warrantyDeedSchema>) => {
    onGenerate(
      "/api/documents/generate/warranty-deed",
      data,
      `warranty-deed-${data.propertyId}.pdf`
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="propertyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Property</FormLabel>
              <Select
                value={field.value ? String(field.value) : ""}
                onValueChange={(val) => field.onChange(Number(val))}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-warranty-deed-property">
                    <SelectValue placeholder="Select a property" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {properties?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.county}, {p.state} - {p.apn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isGenerating} aria-busy={isGenerating} aria-label={isGenerating ? "Generating warranty deed" : "Generate warranty deed"} className="w-full" data-testid="button-generate-warranty-deed">
          {isGenerating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          Generate warranty deed
        </Button>
      </form>
    </Form>
  );
}

function SettlementStatementForm({
  property,
  properties,
  onGenerate,
  isGenerating,
}: {
  property?: Property;
  properties?: Property[];
  onGenerate: (endpoint: string, data: any, filename: string) => Promise<void>;
  isGenerating: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(settlementStatementSchema),
    defaultValues: {
      propertyId: property?.id || 0,
      purchasePrice: property?.purchasePrice ? Number(property.purchasePrice) : undefined,
      closingDate: "",
      buyerName: "",
      sellerName: "",
      earnestMoney: 0,
      titleInsurance: 0,
      recordingFees: 75,
      escrowFees: 250,
      transferTax: 0,
    },
  });

  const onSubmit = (data: z.infer<typeof settlementStatementSchema>) => {
    onGenerate(
      "/api/documents/generate/settlement-statement",
      data,
      `settlement-statement-${data.propertyId}.pdf`
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="propertyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Property</FormLabel>
              <Select
                value={field.value ? String(field.value) : ""}
                onValueChange={(val) => field.onChange(Number(val))}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-settlement-property">
                    <SelectValue placeholder="Select a property" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {properties?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.county}, {p.state} - {p.apn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="purchasePrice"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase price</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || undefined)}
                    data-testid="input-settlement-purchase-price"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="closingDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Closing date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-settlement-closing-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="buyerName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Buyer name</FormLabel>
                <FormControl>
                  <Input placeholder="Buyer name" autoCapitalize="words" {...field} data-testid="input-settlement-buyer-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="sellerName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Seller name</FormLabel>
                <FormControl>
                  <Input placeholder="Seller name" autoCapitalize="words" {...field} data-testid="input-settlement-seller-name" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="earnestMoney"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Earnest money</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                    data-testid="input-settlement-earnest-money"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="titleInsurance"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title insurance</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                    data-testid="input-settlement-title-insurance"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <FormField
            control={form.control}
            name="recordingFees"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Recording fees</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="75"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                    data-testid="input-settlement-recording-fees"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="escrowFees"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Escrow fees</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="250"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                    data-testid="input-settlement-escrow-fees"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="transferTax"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Transfer tax</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                    data-testid="input-settlement-transfer-tax"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" disabled={isGenerating} aria-busy={isGenerating} aria-label={isGenerating ? "Generating settlement statement" : "Generate settlement statement"} className="w-full" data-testid="button-generate-settlement-statement">
          {isGenerating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          Generate settlement statement
        </Button>
      </form>
    </Form>
  );
}

function OfferLetterForm({
  property,
  lead,
  properties,
  leads,
  onGenerate,
  isGenerating,
}: {
  property?: Property;
  lead?: Lead;
  properties?: Property[];
  leads?: Lead[];
  onGenerate: (endpoint: string, data: any, filename: string) => Promise<void>;
  isGenerating: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(offerLetterSchema),
    defaultValues: {
      propertyId: property?.id || 0,
      leadId: lead?.id || 0,
      offerAmount: property?.assessedValue ? Number(property.assessedValue) * 0.3 : undefined,
      earnestMoney: 0,
      closingDate: "",
      additionalTerms: "",
    },
  });

  const onSubmit = (data: z.infer<typeof offerLetterSchema>) => {
    onGenerate(
      "/api/documents/offer-letter",
      data,
      `offer-letter-${data.leadId}-${data.propertyId}.pdf`
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="propertyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Property</FormLabel>
              <Select
                value={field.value ? String(field.value) : ""}
                onValueChange={(val) => field.onChange(Number(val))}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-offer-property">
                    <SelectValue placeholder="Select a property" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {properties?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.county}, {p.state} - {p.apn}
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
          name="leadId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Lead (seller)</FormLabel>
              <Select
                value={field.value ? String(field.value) : ""}
                onValueChange={(val) => field.onChange(Number(val))}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-offer-lead">
                    <SelectValue placeholder="Select a lead" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {leads?.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.firstName} {l.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="offerAmount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Offer amount</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || undefined)}
                    data-testid="input-offer-amount"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="earnestMoney"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Earnest money</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || 0)}
                    data-testid="input-offer-earnest-money"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="closingDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Target closing date</FormLabel>
              <FormControl>
                <Input type="date" {...field} data-testid="input-offer-closing-date" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="additionalTerms"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Additional terms</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Any additional terms or conditions…"
                  {...field}
                  data-testid="input-offer-additional-terms"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isGenerating} aria-busy={isGenerating} aria-label={isGenerating ? "Generating offer letter" : "Generate offer letter"} className="w-full" data-testid="button-generate-offer-letter">
          {isGenerating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          Generate offer letter
        </Button>
      </form>
    </Form>
  );
}

function PropertyFlyerForm({
  property,
  properties,
  onGenerate,
  isGenerating,
}: {
  property?: Property;
  properties?: Property[];
  onGenerate: (endpoint: string, data: any, filename: string) => Promise<void>;
  isGenerating: boolean;
}) {
  const form = useForm({
    resolver: zodResolver(propertyFlyerSchema),
    defaultValues: {
      propertyId: property?.id || 0,
      headline: "LAND FOR SALE",
      price: property?.listPrice ? Number(property.listPrice) : undefined,
      priceLabel: "Asking Price",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
    },
  });

  const onSubmit = (data: z.infer<typeof propertyFlyerSchema>) => {
    onGenerate(
      "/api/documents/generate/property-flyer",
      data,
      `property-flyer-${data.propertyId}.pdf`
    );
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="propertyId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Property</FormLabel>
              <Select
                value={field.value ? String(field.value) : ""}
                onValueChange={(val) => field.onChange(Number(val))}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-flyer-property">
                    <SelectValue placeholder="Select a property" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {properties?.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.county}, {p.state} - {p.apn}
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
          name="headline"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Headline</FormLabel>
              <FormControl>
                <Input placeholder="LAND FOR SALE" {...field} data-testid="input-flyer-headline" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="price"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Price</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value) || undefined)}
                    data-testid="input-flyer-price"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="priceLabel"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Price label</FormLabel>
                <FormControl>
                  <Input placeholder="Asking Price" {...field} data-testid="input-flyer-price-label" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="contactName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contact name</FormLabel>
              <FormControl>
                <Input placeholder="Your name or company" autoComplete="name" autoCapitalize="words" {...field} data-testid="input-flyer-contact-name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="contactPhone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact phone</FormLabel>
                <FormControl>
                  <Input placeholder="(555) 123-4567" type="tel" inputMode="tel" autoComplete="tel" {...field} data-testid="input-flyer-contact-phone" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contactEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Contact email</FormLabel>
                <FormControl>
                  <Input placeholder="email@example.com" type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="email" {...field} data-testid="input-flyer-contact-email" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <Button type="submit" disabled={isGenerating} aria-busy={isGenerating} aria-label={isGenerating ? "Generating property flyer" : "Generate property flyer"} className="w-full" data-testid="button-generate-property-flyer">
          {isGenerating ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          Generate property flyer
        </Button>
      </form>
    </Form>
  );
}
