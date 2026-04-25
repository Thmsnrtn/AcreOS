import { useState, useRef, useEffect, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { telemetry } from "@/lib/telemetry";
import {
  Send,
  Loader2,
  MapPin,
  Ruler,
  DollarSign,
  Droplets,
  FileText,
  Calculator,
  Search,
  Bot,
  User,
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Target,
  BarChart3
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Property } from "@shared/schema";

// ─── Lightweight markdown renderer for analysis responses ─────────────────────
function AnalysisMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  const inlineFormat = (text: string): React.ReactNode => {
    const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__|_[^_]+_)/g);
    return parts.map((part, idx) => {
      if (part.startsWith("`") && part.endsWith("`")) return <code key={idx} className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">{part.slice(1, -1)}</code>;
      if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) return <strong key={idx}>{part.slice(2, -2)}</strong>;
      if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={idx}>{part.slice(1, -1)}</em>;
      return part;
    });
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} className="bg-muted rounded-md p-2.5 my-1.5 overflow-x-auto text-[11px] font-mono leading-relaxed">
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      i++;
      continue;
    }

    // Headings
    const h3 = line.match(/^### (.+)/);
    if (h3) { elements.push(<h3 key={`h3-${i}`} className="font-semibold text-sm mt-3 mb-1">{inlineFormat(h3[1])}</h3>); i++; continue; }
    const h2 = line.match(/^## (.+)/);
    if (h2) { elements.push(<h2 key={`h2-${i}`} className="font-bold text-sm mt-4 mb-1 text-primary">{inlineFormat(h2[1])}</h2>); i++; continue; }
    const h1 = line.match(/^# (.+)/);
    if (h1) { elements.push(<h1 key={`h1-${i}`} className="font-bold text-base mt-4 mb-1">{inlineFormat(h1[1])}</h1>); i++; continue; }

    // Unordered list
    if (line.match(/^[-*+] /)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*+] /)) {
        listItems.push(lines[i].replace(/^[-*+] /, ""));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="list-disc list-inside space-y-0.5 my-1 pl-1">
          {listItems.map((item, j) => <li key={j} className="text-sm">{inlineFormat(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (line.match(/^\d+\. /)) {
      const listItems: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        listItems.push(lines[i].replace(/^\d+\. /, ""));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="list-decimal list-inside space-y-0.5 my-1 pl-1">
          {listItems.map((item, j) => <li key={j} className="text-sm">{inlineFormat(item)}</li>)}
        </ol>
      );
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) { elements.push(<hr key={`hr-${i}`} className="border-border my-2" />); i++; continue; }

    // Blank line
    if (line.trim() === "") { elements.push(<div key={`sp-${i}`} className="h-1" />); i++; continue; }

    // Normal paragraph
    elements.push(<p key={`p-${i}`} className="text-sm leading-relaxed">{inlineFormat(line)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

// ─── Section icons for structured analysis ────────────────────────────────────
const SECTION_ICONS: Record<string, React.ReactNode> = {
  "property summary": <BarChart3 className="w-4 h-4 text-blue-500" aria-hidden="true" />,
  "market position": <TrendingUp className="w-4 h-4 text-green-500" aria-hidden="true" />,
  "key risks": <AlertTriangle className="w-4 h-4 text-amber-500" aria-hidden="true" />,
  "investment recommendation": <Target className="w-4 h-4 text-purple-500" aria-hidden="true" />,
  "suggested offer range": <DollarSign className="w-4 h-4 text-emerald-500" aria-hidden="true" />,
};

function getSectionIcon(heading: string): React.ReactNode {
  const lower = heading.toLowerCase();
  for (const [key, icon] of Object.entries(SECTION_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return <BarChart3 className="w-4 h-4 text-muted-foreground" aria-hidden="true" />;
}

// ─── Parse structured analysis into section cards ────────────────────────────
function StructuredAnalysis({ content }: { content: string }) {
  // Split content by ## headings into sections
  const sectionRegex = /^## (.+)$/gm;
  const sections: { title: string; body: string }[] = [];
  let lastIndex = 0;
  let lastTitle = "";
  let preamble = "";
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(content)) !== null) {
    const textBefore = content.slice(lastIndex, match.index).trim();
    if (lastTitle) {
      sections.push({ title: lastTitle, body: textBefore });
    } else if (textBefore) {
      preamble = textBefore;
    }
    lastTitle = match[1];
    lastIndex = match.index + match[0].length;
  }
  // Push the last section
  if (lastTitle) {
    sections.push({ title: lastTitle, body: content.slice(lastIndex).trim() });
  }

  // If we couldn't parse sections, fall back to plain markdown
  if (sections.length === 0) {
    return (
      <div className="bg-muted rounded-lg p-4">
        <AnalysisMarkdown content={content} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {preamble && (
        <div className="bg-muted/50 rounded-lg p-3">
          <AnalysisMarkdown content={preamble} />
        </div>
      )}
      {sections.map((section, idx) => (
        <Card key={idx} className="border shadow-sm">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              {getSectionIcon(section.title)}
              {section.title}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            <AnalysisMarkdown content={section.body} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  actions?: any[];
  suggestions?: string[];
}

interface PropertyAnalysisChatProps {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function buildQuickAnalysisPrompt(property: Property): string {
  const parts = [
    `Run a comprehensive structured analysis of this property.`,
    ``,
    `Property details:`,
    `- APN: ${property.apn}`,
    property.address ? `- Address: ${property.address}` : null,
    `- County: ${property.county}, State: ${property.state}`,
    property.sizeAcres ? `- Size: ${property.sizeAcres} acres` : null,
    property.marketValue ? `- Market Value: $${Number(property.marketValue).toLocaleString()}` : null,
    property.listPrice ? `- List Price: $${Number(property.listPrice).toLocaleString()}` : null,
    property.status ? `- Status: ${property.status.replace(/_/g, " ")}` : null,
    property.zoning ? `- Zoning: ${property.zoning}` : null,
    ``,
    `Provide the analysis using these exact section headings (use ## for each):`,
    ``,
    `## Property Summary`,
    `Summarize the property type, location characteristics, size, zoning, and current status.`,
    ``,
    `## Market Position`,
    `Assess where this property sits in the local market. Include comparable value ranges and demand indicators for the area.`,
    ``,
    `## Key Risks`,
    `Identify the top risks: environmental (flood zones, wetlands), access issues, zoning restrictions, title concerns, or market risks.`,
    ``,
    `## Investment Recommendation`,
    `Give a clear buy/hold/pass recommendation with reasoning. Rate confidence level.`,
    ``,
    `## Suggested Offer Range`,
    `This is RAW LAND, not residential. Anchor the offer range to land-investing norms, NOT retail home pricing:`,
    `- Cash acquisition: low = 20% of FMV, target = 25–30% of FMV, high = 40% of FMV. Show the math.`,
    `- Seller-finance / terms: 100–150% of FMV with 10–30% down and 8–12% interest on 60–120 months.`,
    `- If FMV is unknown or the market value is $0 / absent, say so explicitly; do not invent numbers.`,
    `- For Arizona parcels, remember assessed value is 16% of Full Cash Value — never use assessed as market.`,
    `- If legal access / zoning / flood zone is unknown, state that clearly and reduce confidence.`,
  ];
  return parts.filter(p => p !== null).join("\n");
}

const quickActions = [
  { label: "What's the flood risk?", icon: Droplets, prompt: "What is the flood risk for this property? Are there any environmental concerns I should be aware of?" },
  { label: "Find similar properties", icon: Search, prompt: "Can you find comparable properties similar to this one for valuation purposes?" },
  { label: "Generate an offer", icon: FileText, prompt: "Help me generate an offer letter for this property." },
  { label: "Calculate financing", icon: Calculator, prompt: "Calculate seller financing options if I purchase this property. Show me different term and interest rate scenarios." },
];

export function PropertyAnalysisChat({ property, open, onOpenChange }: PropertyAnalysisChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasRunAnalysis, setHasRunAnalysis] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
    
    telemetry.aiUsed('property_analysis');

    try {
      const response = await apiRequest("POST", `/api/properties/${property.id}/analyze`, {
        message: messageText,
        conversationHistory: messages.map(m => ({ role: m.role, content: m.content })),
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data = await response.json();

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
        actions: data.actions,
        suggestions: data.suggestions,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      // Surface the failure inline in the conversation so a silent
      // Atlas failure never looks like "still loading." The toast is
      // still shown for global visibility; the inline message ensures
      // a user who missed the toast knows exactly which turn failed.
      const errMsg = String(error?.message || "Failed to analyze property");
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ Analysis failed: ${errMsg}. Please retry or ask a more specific question.`,
          timestamp: new Date(),
        },
      ]);
      toast({
        title: "Couldn't run analysis",
        description: `${errMsg} — your conversation is preserved. Retry or rephrase.`,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const runQuickAnalysis = useCallback(() => {
    const prompt = buildQuickAnalysisPrompt(property);
    setHasRunAnalysis(true);
    sendMessage(prompt);
  }, [property]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(inputValue);
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  const handleSuggestionClick = (suggestion: string) => {
    sendMessage(suggestion);
  };

  const formatCurrency = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    if (isNaN(num) || num === 0) return null;
    return `$${num.toLocaleString()}`;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0" data-testid="panel-property-analysis-chat">
        <SheetHeader className="p-4 border-b space-y-3">
          <SheetTitle className="flex items-center gap-2" data-testid="text-chat-title">
            <Bot className="w-5 h-5" aria-hidden="true" />
            Analyze Property with AI
          </SheetTitle>
          <SheetDescription asChild>
            <div className="space-y-2" data-testid="property-context-summary">
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{property.address || `${property.county}, ${property.state}`}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>APN: {property.apn}</span>
                {property.sizeAcres && (
                  <span className="flex items-center gap-1">
                    <Ruler className="w-3 h-3" aria-hidden="true" />
                    {property.sizeAcres} acres
                  </span>
                )}
                {formatCurrency(property.marketValue) && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" aria-hidden="true" />
                    {formatCurrency(property.marketValue)}
                  </span>
                )}
                <Badge variant="outline" className="capitalize text-xs">
                  {property.status.replace(/_/g, " ")}
                </Badge>
              </div>
            </div>
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 p-4" ref={scrollAreaRef as any}>
          <div
            className="space-y-4"
            role="log"
            aria-live="polite"
            aria-label="Property analysis conversation"
          >
            {messages.length === 0 && (
              <div className="space-y-5" data-testid="empty-chat-state">
                {/* Primary CTA: Run Quick Analysis */}
                <div className="text-center py-6 space-y-4">
                  <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-6 h-6 text-primary" aria-hidden="true" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-semibold text-sm">Property Analysis</h3>
                    <p className="text-xs text-muted-foreground max-w-[280px] mx-auto">
                      Get an instant structured report covering market position, risks, and investment recommendation.
                    </p>
                  </div>
                  <Button
                    size="lg"
                    className="gap-2 px-6"
                    onClick={runQuickAnalysis}
                    disabled={isLoading}
                    data-testid="button-run-quick-analysis"
                    aria-label={isLoading ? "Running analysis…" : "Run Quick Analysis"}
                  >
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="w-4 h-4" aria-hidden="true" />
                    )}
                    Run Quick Analysis
                  </Button>
                </div>

                {/* Secondary: Quick action buttons */}
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground text-center font-medium uppercase tracking-wide">
                    Or ask a specific question
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {quickActions.map((action, index) => (
                      <Button
                        key={index}
                        variant="outline"
                        className="justify-start gap-2 h-auto py-2.5 text-left"
                        onClick={() => handleQuickAction(action.prompt)}
                        disabled={isLoading}
                        data-testid={`button-quick-action-${index}`}
                      >
                        <action.icon className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="text-sm">{action.label}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {messages.map((message, index) => {
              // Detect if this is a structured analysis response (first assistant message after quick analysis)
              const isStructuredAnalysis = message.role === "assistant"
                && hasRunAnalysis
                && message.content.includes("## ");

              if (message.role === "user" && hasRunAnalysis && index === 0) {
                // Hide the verbose system prompt from the user; show a friendly label instead
                return (
                  <div key={index} className="flex gap-3 justify-end" data-testid={`message-user-${index}`}>
                    <div className="max-w-[80%] rounded-lg p-3 bg-primary text-primary-foreground">
                      <p className="text-sm flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        Run Quick Analysis
                      </p>
                    </div>
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0" aria-hidden="true">
                      <User className="w-4 h-4" aria-hidden="true" />
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={index}
                  className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  data-testid={`message-${message.role}-${index}`}
                >
                  {message.role === "assistant" && !isStructuredAnalysis && (
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0" aria-hidden="true">
                      <Bot className="w-4 h-4 text-primary" aria-hidden="true" />
                    </div>
                  )}
                  {isStructuredAnalysis ? (
                    <div className="w-full" data-testid="structured-analysis-output">
                      <StructuredAnalysis content={message.content} />
                      {message.suggestions && message.suggestions.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-xs text-muted-foreground">Dig deeper:</p>
                          <div className="flex flex-wrap gap-1">
                            {message.suggestions.map((suggestion, sIndex) => (
                              <Button
                                key={sIndex}
                                variant="secondary"
                                size="sm"
                                className="text-xs h-auto py-1 px-2"
                                onClick={() => handleSuggestionClick(suggestion)}
                                disabled={isLoading}
                                data-testid={`button-suggestion-${index}-${sIndex}`}
                              >
                                {suggestion}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div
                      className={`max-w-[80%] rounded-lg p-3 ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      {message.role === "assistant" ? (
                        <AnalysisMarkdown content={message.content} />
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      )}
                      {message.suggestions && message.suggestions.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                          <p className="text-xs text-muted-foreground">Follow-up questions:</p>
                          <div className="flex flex-wrap gap-1">
                            {message.suggestions.map((suggestion, sIndex) => (
                              <Button
                                key={sIndex}
                                variant="secondary"
                                size="sm"
                                className="text-xs h-auto py-1 px-2"
                                onClick={() => handleSuggestionClick(suggestion)}
                                disabled={isLoading}
                                data-testid={`button-suggestion-${index}-${sIndex}`}
                              >
                                {suggestion}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {message.role === "user" && !(hasRunAnalysis && index === 0) && (
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0" aria-hidden="true">
                      <User className="w-4 h-4" aria-hidden="true" />
                    </div>
                  )}
                </div>
              );
            })}

            {isLoading && (
              <div
                className="flex gap-3 justify-start"
                data-testid="loading-state"
                role="status"
                aria-live="polite"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0" aria-hidden="true">
                  <Bot className="w-4 h-4 text-primary" aria-hidden="true" />
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span className="text-sm text-muted-foreground">Analyzing…</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <Input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask about this property..."
              disabled={isLoading}
              className="flex-1"
              data-testid="input-chat-message"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!inputValue.trim() || isLoading}
              aria-label={isLoading ? "Waiting for analysis…" : "Send message"}
              data-testid="button-send-message"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="w-4 h-4" aria-hidden="true" />
              )}
            </Button>
          </form>
          {messages.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {quickActions.slice(0, 2).map((action, index) => (
                <Button
                  key={index}
                  variant="ghost"
                  size="sm"
                  className="text-xs h-auto py-1 px-2"
                  onClick={() => handleQuickAction(action.prompt)}
                  disabled={isLoading}
                  data-testid={`button-bottom-action-${index}`}
                >
                  <action.icon className="w-3 h-3 mr-1" aria-hidden="true" />
                  {action.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
