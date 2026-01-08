import { useState, useRef, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  User
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Property } from "@shared/schema";

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
      toast({
        title: "Error",
        description: error.message || "Failed to analyze property",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

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
            <Bot className="w-5 h-5" />
            Analyze Property with AI
          </SheetTitle>
          <SheetDescription asChild>
            <div className="space-y-2" data-testid="property-context-summary">
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{property.address || `${property.county}, ${property.state}`}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>APN: {property.apn}</span>
                {property.sizeAcres && (
                  <span className="flex items-center gap-1">
                    <Ruler className="w-3 h-3" />
                    {property.sizeAcres} acres
                  </span>
                )}
                {formatCurrency(property.marketValue) && (
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    {formatCurrency(property.marketValue)}
                  </span>
                )}
                <Badge variant="outline" className="capitalize text-xs">
                  {property.status.replace("_", " ")}
                </Badge>
              </div>
            </div>
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 p-4" ref={scrollAreaRef as any}>
          <div className="space-y-4">
            {messages.length === 0 && (
              <div className="space-y-4" data-testid="empty-chat-state">
                <p className="text-sm text-muted-foreground text-center py-4">
                  Ask questions about this property or use the quick actions below to get started.
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {quickActions.map((action, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      className="justify-start gap-2 h-auto py-3 text-left"
                      onClick={() => handleQuickAction(action.prompt)}
                      disabled={isLoading}
                      data-testid={`button-quick-action-${index}`}
                    >
                      <action.icon className="w-4 h-4 shrink-0" />
                      <span className="text-sm">{action.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`message-${message.role}-${index}`}
              >
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
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
                {message.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 justify-start" data-testid="loading-state">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="bg-muted rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">Analyzing...</span>
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
              data-testid="button-send-message"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
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
                  <action.icon className="w-3 h-3 mr-1" />
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
