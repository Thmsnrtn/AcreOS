import { useState, useEffect, useRef } from "react";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Sun, Users, Building, BarChart2, Mail, FileText, Search,
  TrendingUp, DollarSign, Phone, Star, AlertCircle, Calendar,
} from "lucide-react";

export interface SlashCommand {
  name: string;
  description: string;
  prompt: string;
  icon: typeof Sun;
  tags?: string[];
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "/briefing",
    description: "Morning briefing — leads, deals, tasks",
    prompt: "Give me a quick morning briefing: hot leads, deals needing attention, overdue tasks, and top priorities for today.",
    icon: Sun,
    tags: ["daily", "overview"],
  },
  {
    name: "/stale-leads",
    description: "Find leads with no contact in 14+ days",
    prompt: "Which leads haven't been contacted in 14 or more days? List them and suggest a follow-up action for each.",
    icon: Users,
    tags: ["leads"],
  },
  {
    name: "/pipeline",
    description: "Pipeline velocity and stuck deals",
    prompt: "How is my deal pipeline moving? Identify any deals that are stuck at the same stage for too long and recommend next steps.",
    icon: Building,
    tags: ["deals"],
  },
  {
    name: "/roi",
    description: "Quick ROI analysis for a deal",
    prompt: "Run a quick ROI analysis for the deal I'm working on. Include purchase price, estimated rehab, ARV, and projected return.",
    icon: BarChart2,
    tags: ["deals", "finance"],
  },
  {
    name: "/comps",
    description: "Pull comparable sales for a property",
    prompt: "Pull comparable sales for the property I'm looking at. Show me sold prices, days on market, and how my deal stacks up.",
    icon: Search,
    tags: ["property"],
  },
  {
    name: "/email",
    description: "Draft a follow-up email for a lead",
    prompt: "Draft a short, personalized follow-up email for the lead I'm working with. Keep it warm and action-oriented.",
    icon: Mail,
    tags: ["leads", "outreach"],
  },
  {
    name: "/offer",
    description: "Draft an offer letter",
    prompt: "Help me draft a competitive offer letter for the deal I'm considering. Include standard terms and a compelling opener.",
    icon: FileText,
    tags: ["deals"],
  },
  {
    name: "/analyze",
    description: "Deep analysis of current deal",
    prompt: "Do a deep analysis of my current deal: market conditions, risk factors, upside potential, and my recommended next action.",
    icon: TrendingUp,
    tags: ["deals", "analysis"],
  },
  {
    name: "/cashflow",
    description: "Cash flow and payment snapshot",
    prompt: "Give me a cash flow snapshot: expected incoming payments this month, overdue notes, and any red flags.",
    icon: DollarSign,
    tags: ["finance"],
  },
  {
    name: "/followup",
    description: "Schedule and plan follow-ups",
    prompt: "Who should I follow up with today? Give me a prioritized list with suggested talking points for each.",
    icon: Phone,
    tags: ["leads", "tasks"],
  },
  {
    name: "/score",
    description: "Score and rank my active leads",
    prompt: "Score and rank my active leads based on engagement, signals, and potential. Identify the top 5 I should focus on this week.",
    icon: Star,
    tags: ["leads"],
  },
  {
    name: "/risks",
    description: "Flag risks across portfolio",
    prompt: "Flag any risks across my portfolio and pipeline: stale deals, payment issues, underperforming assets, or market exposure.",
    icon: AlertCircle,
    tags: ["analysis"],
  },
  {
    name: "/tasks",
    description: "What are my open tasks?",
    prompt: "What are my open tasks and deadlines? Organize them by priority and flag anything overdue.",
    icon: Calendar,
    tags: ["tasks"],
  },
];

// ── Inline picker (shown when "/" typed in textarea) ──────────────────────────

interface InlinePickerProps {
  query: string;
  onSelect: (cmd: SlashCommand) => void;
  onClose: () => void;
}

export function PaxSlashPicker({ query, onSelect, onClose }: InlinePickerProps) {
  const filtered = SLASH_COMMANDS.filter((c) =>
    c.name.toLowerCase().includes(query.toLowerCase()) ||
    c.description.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 6);

  const listRef = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => { setHighlighted(0); }, [query]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); if (filtered[highlighted]) onSelect(filtered[highlighted]); }
      if (e.key === "Escape")    { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [filtered, highlighted, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-card shadow-lg z-50 overflow-hidden"
    >
      {filtered.map((cmd, i) => {
        const Icon = cmd.icon;
        return (
          <button
            key={cmd.name}
            onClick={() => onSelect(cmd)}
            className={`w-full text-left flex items-start gap-2 px-3 py-2 text-xs transition-colors ${
              i === highlighted ? "bg-primary/10 text-primary" : "hover:bg-muted/50"
            }`}
          >
            <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <span className="font-mono font-medium">{cmd.name}</span>
              <span className="text-muted-foreground ml-2">{cmd.description}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Full command palette (Cmd+K) ─────────────────────────────────────────────

interface PaletteProps {
  open: boolean;
  onClose: () => void;
  onSelect: (cmd: SlashCommand) => void;
}

export function PaxCommandPalette({ open, onClose, onSelect }: PaletteProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="p-0 max-w-sm overflow-hidden">
        <Command>
          <div className="border-b px-3 py-2 text-caption text-muted-foreground font-medium uppercase tracking-wide">
            Pax Commands — select to insert
          </div>
          <CommandList>
            <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">No commands found.</CommandEmpty>
            <CommandGroup>
              {SLASH_COMMANDS.map((cmd) => {
                const Icon = cmd.icon;
                return (
                  <CommandItem
                    key={cmd.name}
                    value={cmd.name + " " + cmd.description}
                    onSelect={() => { onSelect(cmd); onClose(); }}
                    className="flex items-start gap-2 px-3 py-2 cursor-pointer"
                  >
                    <Icon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">{cmd.name}</span>
                        {cmd.tags?.map((t) => (
                          <Badge key={t} variant="secondary" className="text-[9px] px-1 py-0 h-4">{t}</Badge>
                        ))}
                      </div>
                      <p className="text-caption text-muted-foreground">{cmd.description}</p>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
