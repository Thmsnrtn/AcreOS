/**
 * QuickAddSheet — the FAB action sheet for the mobile shell.
 *
 * Persona-aware: the same FAB does different work per investor type.
 *   land_investor / fix_flipper / tax_delinquent / subdivider / wholesaler
 *     → Quick add lead (name + phone + source)
 *   note_investor / note_originator / note_servicer
 *     → Log payment received (note + amount + date)
 *   landlord
 *     → Log maintenance issue (property + summary + severity)
 *
 * Voice capture: each text field has a mic button that uses Web Speech
 * (SpeechRecognition) to dictate into the input. Falls back silently
 * if the browser doesn't support it — desktop Chrome and iOS Safari
 * both have it.
 *
 * Optimistic + minimal: keep field count tiny. Real editing happens
 * on desktop. This sheet is for "I just took a call, capture this
 * before I forget."
 */

import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Mic, MicOff, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest, fetchJsonArray } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Persona } from "@shared/models/auth";

interface QuickAddSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  persona: Persona | undefined;
}

type FlowKind = "lead" | "payment" | "maintenance";

function flowForPersona(persona: Persona | undefined): FlowKind {
  if (
    persona === "note_investor" ||
    persona === "note_originator" ||
    persona === "note_servicer"
  ) {
    return "payment";
  }
  if (persona === "landlord") return "maintenance";
  return "lead";
}

/**
 * Tiny wrapper around the Web Speech API. Returns a tuple of
 * [supported, listening, start, stop]. Each call to start opens a
 * one-shot recognition session and resolves onResult with the
 * recognized text. Falls back to "unsupported" on browsers without
 * webkitSpeechRecognition.
 */
function useSpeechToText(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);

  const supported =
    typeof window !== "undefined" &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    if (!supported) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const transcript = e?.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) onResult(transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    return () => {
      try { rec.stop(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  const start = () => {
    if (!recRef.current || listening) return;
    try {
      setListening(true);
      recRef.current.start();
    } catch {
      setListening(false);
    }
  };
  const stop = () => {
    if (!recRef.current) return;
    try {
      recRef.current.stop();
    } catch { /* ignore */ }
  };

  return { supported: !!supported, listening, start, stop };
}

/** Per-input mic button. Click to dictate; click again to stop. */
function MicButton({
  setValue,
  ariaLabel,
}: {
  setValue: (v: string | ((prev: string) => string)) => void;
  ariaLabel: string;
}) {
  const { supported, listening, start, stop } = useSpeechToText((text) => {
    setValue((prev) => (prev ? `${prev} ${text}` : text));
  });
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      aria-label={ariaLabel + (listening ? " — recording" : "")}
      className={`absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full flex items-center justify-center transition-colors ${
        listening
          ? "bg-rose-500/15 text-rose-600 dark:text-rose-400 animate-pulse"
          : "text-muted-foreground hover:bg-muted active:bg-muted"
      }`}
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </button>
  );
}

// ─── Lead capture ────────────────────────────────────────────────────────────

function LeadForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("inbound_call");
  const [notes, setNotes] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/leads", {
        firstName: firstName.trim() || "Unknown",
        lastName: lastName.trim() || "",
        phone: phone.trim() || undefined,
        source,
        notes: notes.trim() || undefined,
        type: "seller",
        status: "new",
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
      qc.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Lead saved", description: "Open Leads to enrich the record." });
      onDone();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't save lead",
        description: err?.message ?? "Network issue — try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!firstName.trim() && !phone.trim()) {
          toast({
            title: "Need a name or phone",
            description: "Capture at least one identifier so the lead is reachable.",
            variant: "destructive",
          });
          return;
        }
        mut.mutate();
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="qa-first">First name</Label>
          <div className="relative">
            <Input
              id="qa-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoFocus
              autoComplete="off"
              className="pr-10"
              data-testid="qa-first"
            />
            <MicButton setValue={setFirstName as any} ariaLabel="Dictate first name" />
          </div>
        </div>
        <div>
          <Label htmlFor="qa-last">Last name</Label>
          <Input
            id="qa-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="off"
            data-testid="qa-last"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="qa-phone">Phone</Label>
        <Input
          id="qa-phone"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 555-5555"
          autoComplete="tel"
          data-testid="qa-phone"
        />
      </div>
      <div>
        <Label htmlFor="qa-source">Source</Label>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger id="qa-source" data-testid="qa-source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inbound_call">Inbound call</SelectItem>
            <SelectItem value="mailer_reply">Mailer reply</SelectItem>
            <SelectItem value="sms_reply">SMS reply</SelectItem>
            <SelectItem value="referral">Referral</SelectItem>
            <SelectItem value="website">Website</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="qa-notes">Notes</Label>
        <div className="relative">
          <Textarea
            id="qa-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What did they say?"
            rows={3}
            className="pr-10"
            data-testid="qa-notes"
          />
          <MicButton setValue={setNotes as any} ariaLabel="Dictate notes" />
        </div>
      </div>
      <Button
        type="submit"
        className="w-full h-12"
        disabled={mut.isPending}
        data-testid="qa-submit"
      >
        {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save lead"}
      </Button>
    </form>
  );
}

// ─── Payment log (Note Investor) ─────────────────────────────────────────────

interface Note {
  id: string | number;
  borrowerName?: string | null;
  monthlyPayment?: string | number | null;
}

function PaymentForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: notes = [], isLoading: notesLoading } = useQuery<Note[]>({
    queryKey: ["/api/notes"],
    queryFn: () => fetchJsonArray<Note>("/api/notes"),
    staleTime: 60_000,
  });

  const [noteId, setNoteId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [notesText, setNotesText] = useState("");

  // Auto-fill amount from the note's monthly payment when a note is picked.
  useEffect(() => {
    if (!noteId) return;
    const n = notes.find((nn) => String(nn.id) === noteId);
    if (n?.monthlyPayment != null && !amount) {
      setAmount(String(n.monthlyPayment));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const mut = useMutation({
    mutationFn: async () => {
      // Mobile capture deliberately deposits to the "unapplied" bucket —
      // the desktop ledger view splits principal/interest/escrow/late
      // fee. This keeps the phone form to one number while honoring the
      // server's per-bucket cents schema.
      const cents = Math.round(Number(amount) * 100);
      const res = await apiRequest("POST", `/api/notes/${noteId}/payments`, {
        paymentDate: paidOn,
        unappliedCents: cents,
        paymentMethod: "other",
        notes: notesText.trim() || undefined,
      }, { idempotent: true });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/notes"] });
      toast({
        title: "Payment logged",
        description: "Held as unapplied — allocate on desktop.",
      });
      onDone();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't log payment",
        description: err?.message ?? "Network issue — try again.",
        variant: "destructive",
      });
    },
  });

  // No notes in the inventory yet — the payment form has nothing to
  // attach to. Show a clear explanation + jump-to-notes CTA instead of
  // an empty dropdown the user can't interact with.
  if (!notesLoading && notes.length === 0) {
    return (
      <div className="text-center py-8 px-2">
        <p className="text-sm font-medium">No notes to log against</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
          Add a note first, then log payments from this sheet.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            onDone();
            window.location.href = "/notes";
          }}
        >
          Open Notes
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!noteId || !amount) {
          toast({
            title: "Pick a note and enter the amount.",
            variant: "destructive",
          });
          return;
        }
        mut.mutate();
      }}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="pay-note">Note</Label>
        <Select value={noteId} onValueChange={setNoteId}>
          <SelectTrigger id="pay-note">
            <SelectValue placeholder="Pick a note…" />
          </SelectTrigger>
          <SelectContent>
            {notes.map((n) => (
              <SelectItem key={n.id} value={String(n.id)}>
                {n.borrowerName ?? `Note #${n.id}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="pay-amount">Amount</Label>
          <Input
            id="pay-amount"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="pay-date">Paid on</Label>
          <Input
            id="pay-date"
            type="date"
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="pay-notes">Notes</Label>
        <div className="relative">
          <Textarea
            id="pay-notes"
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Wire / ACH / late fee waived?"
            rows={2}
            className="pr-10"
          />
          <MicButton setValue={setNotesText as any} ariaLabel="Dictate notes" />
        </div>
      </div>
      <Button type="submit" className="w-full h-12" disabled={mut.isPending}>
        {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log payment"}
      </Button>
    </form>
  );
}

// ─── Maintenance log (Landlord) ──────────────────────────────────────────────

interface Property {
  id: number;
  apn?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
}

function MaintenanceForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: properties = [], isLoading: propsLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    queryFn: () => fetchJsonArray<Property>("/api/properties?pageSize=100"),
    staleTime: 60_000,
  });

  const [propertyId, setPropertyId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState<"emergency" | "urgent" | "standard" | "cosmetic">("standard");

  const mut = useMutation({
    mutationFn: async () => {
      // BH-6 ticket schema lives at /api/maintenance-tickets (not /maintenance);
      // requires title (1-200), optional description, severity from the
      // shared TICKET_SEVERITIES enum.
      const res = await apiRequest("POST", "/api/maintenance-tickets", {
        propertyId: Number(propertyId),
        title: title.trim().slice(0, 200),
        severity,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/maintenance-tickets"] });
      toast({ title: "Ticket opened" });
      onDone();
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't log ticket",
        description: err?.message ?? "Network issue — try again.",
        variant: "destructive",
      });
    },
  });

  // No properties — can't open a ticket against nothing. Same pattern
  // as the payment form: clear pointer at where to start.
  if (!propsLoading && properties.length === 0) {
    return (
      <div className="text-center py-8 px-2">
        <p className="text-sm font-medium">No properties yet</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
          Add a rental property before logging maintenance issues.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            onDone();
            window.location.href = "/properties";
          }}
        >
          Open Properties
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!propertyId || !title.trim()) {
          toast({
            title: "Pick a property and describe the issue.",
            variant: "destructive",
          });
          return;
        }
        mut.mutate();
      }}
      className="space-y-4"
    >
      <div>
        <Label htmlFor="m-property">Property</Label>
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger id="m-property">
            <SelectValue placeholder="Pick a property…" />
          </SelectTrigger>
          <SelectContent>
            {properties.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.address ?? p.apn ?? `Property #${p.id}`}
                {p.city ? ` — ${p.city}` : ""}
                {p.state ? `, ${p.state}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="m-title">Issue</Label>
        <div className="relative">
          <Textarea
            id="m-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What happened?"
            rows={3}
            className="pr-10"
            maxLength={200}
          />
          <MicButton setValue={setTitle as any} ariaLabel="Dictate issue" />
        </div>
      </div>
      <div>
        <Label htmlFor="m-sev">Severity</Label>
        <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
          <SelectTrigger id="m-sev">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="emergency">Emergency</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="cosmetic">Cosmetic</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" className="w-full h-12" disabled={mut.isPending}>
        {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Open ticket"}
      </Button>
    </form>
  );
}

// ─── Top-level sheet ────────────────────────────────────────────────────────

export function QuickAddSheet({ open, onOpenChange, persona }: QuickAddSheetProps) {
  const flow = flowForPersona(persona);
  const title =
    flow === "payment" ? "Log payment received"
    : flow === "maintenance" ? "Log maintenance issue"
    : "Quick add lead";
  const description =
    flow === "payment" ? "Borrower text confirmation? Capture it before you forget."
    : flow === "maintenance" ? "Tenant call about the heater? Open a ticket in seconds."
    : "Take the call. Save the rest later from desktop.";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85dvh] overflow-y-auto px-4 pb-8">
        <SheetHeader className="text-left">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          {flow === "lead" && <LeadForm onDone={() => onOpenChange(false)} />}
          {flow === "payment" && <PaymentForm onDone={() => onOpenChange(false)} />}
          {flow === "maintenance" && <MaintenanceForm onDone={() => onOpenChange(false)} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default QuickAddSheet;
