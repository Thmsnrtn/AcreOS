import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { 
  Minus, 
  X, 
  Send, 
  Loader2,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export function FloatingAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasActivity, setHasActivity] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen, isMinimized]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
    setHasActivity(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ message: userMessage.content }),
      });

      if (response.ok) {
        const data = await response.json();
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data.response || data.message || "I'm here to help! What would you like to know?",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else {
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: "I'm your AI assistant for AcreOS. I can help you with land investing questions, property analysis, lead management, and more. How can I assist you today?",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      }
    } catch (error) {
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "I'm your AI assistant for AcreOS. I can help you with land investing questions, property analysis, lead management, and more. How can I assist you today?",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } finally {
      setIsLoading(false);
      setTimeout(() => setHasActivity(false), 3000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
  };

  const handleRestore = () => {
    if (isMinimized) {
      setIsMinimized(false);
    } else {
      setIsOpen(true);
    }
  };

  const renderMarkdown = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, i) => {
      let processedLine = line
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`(.*?)`/g, '<code class="px-1 py-0.5 bg-muted rounded text-sm">$1</code>');
      
      if (line.startsWith('- ') || line.startsWith('• ')) {
        processedLine = `<span class="inline-block w-4">•</span>${processedLine.slice(2)}`;
      }
      
      return (
        <span 
          key={i} 
          dangerouslySetInnerHTML={{ __html: processedLine }} 
          className="block"
        />
      );
    });
  };

  return (
    <div className="fixed z-50 bottom-36 right-4 md:bottom-24 md:right-6" data-testid="floating-assistant-container">
      {isOpen && !isMinimized && (
        <div 
          className={cn(
            "absolute bottom-16 right-0 mb-2",
            "w-[360px] md:w-[400px] h-[500px] md:h-[600px]",
            "glass-panel floating-window rounded-2xl overflow-hidden",
            "flex flex-col",
            "animate-in slide-in-from-bottom-4 fade-in duration-300"
          )}
          data-testid="assistant-chat-panel"
        >
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/50 bg-background/50 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white via-primary/20 to-primary/40 flex items-center justify-center shadow-lg">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                <div className="absolute inset-0 rounded-full bg-white/30 animate-ping opacity-30" />
              </div>
              <h3 className="font-semibold text-foreground">AI Assistant</h3>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleMinimize}
                data-testid="button-minimize-assistant"
              >
                <Minus className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={handleClose}
                data-testid="button-close-assistant"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1 px-4 py-3">
            <div className="space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-[300px] text-center px-4">
                  <div className="relative mb-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-white via-primary/10 to-primary/30 flex items-center justify-center shadow-xl">
                      <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <div className="absolute inset-0 rounded-full bg-white/20 animate-pulse" />
                  </div>
                  <h4 className="font-semibold text-lg mb-2">Welcome to AI Assistant</h4>
                  <p className="text-muted-foreground text-sm max-w-[280px]">
                    I can help you with land investing, property analysis, lead management, and navigating AcreOS.
                  </p>
                </div>
              )}
              
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-muted text-foreground rounded-bl-md"
                    )}
                    data-testid={`message-${message.role}-${message.id}`}
                  >
                    <div className="text-sm leading-relaxed">
                      {message.role === "assistant" 
                        ? renderMarkdown(message.content)
                        : message.content
                      }
                    </div>
                    <div 
                      className={cn(
                        "text-[10px] mt-1 opacity-60",
                        message.role === "user" ? "text-right" : "text-left"
                      )}
                    >
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))}
              
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <div className="p-3 border-t border-border/50 bg-background/50 backdrop-blur-sm">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask me anything..."
                className="min-h-[44px] max-h-[120px] resize-none rounded-xl border-border/50 bg-background/80 text-sm"
                rows={1}
                data-testid="input-assistant-message"
              />
              <Button
                size="icon"
                onClick={handleSendMessage}
                disabled={!inputValue.trim() || isLoading}
                className="h-[44px] w-[44px] rounded-xl shrink-0"
                data-testid="button-send-assistant-message"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {isOpen && isMinimized && (
        <div 
          className={cn(
            "absolute bottom-16 right-0 mb-2",
            "glass-panel floating-window rounded-xl px-4 py-2",
            "flex items-center gap-3 cursor-pointer hover-elevate",
            "animate-in slide-in-from-bottom-2 fade-in duration-200"
          )}
          onClick={handleRestore}
          data-testid="assistant-minimized-bar"
        >
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-white via-primary/20 to-primary/40 flex items-center justify-center">
              <Sparkles className="w-3 h-3 text-primary" />
            </div>
            <span className="text-sm font-medium">AI Assistant</span>
            {messages.length > 0 && (
              <span className="text-xs text-muted-foreground">
                ({messages.length} messages)
              </span>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              handleClose();
            }}
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      <button
        onClick={() => isOpen ? (isMinimized ? handleRestore() : handleClose()) : setIsOpen(true)}
        className={cn(
          "relative w-14 h-14 rounded-full",
          "bg-gradient-to-br from-white via-white/90 to-white/70",
          "dark:from-white/90 dark:via-white/80 dark:to-white/60",
          "shadow-[0_0_20px_rgba(255,255,255,0.5),0_4px_12px_rgba(0,0,0,0.15)]",
          "dark:shadow-[0_0_25px_rgba(255,255,255,0.3),0_4px_12px_rgba(0,0,0,0.3)]",
          "border border-white/50 dark:border-white/30",
          "flex items-center justify-center",
          "transition-all duration-300 ease-out",
          "hover:scale-105 hover:shadow-[0_0_30px_rgba(255,255,255,0.7),0_6px_16px_rgba(0,0,0,0.2)]",
          "dark:hover:shadow-[0_0_35px_rgba(255,255,255,0.4),0_6px_16px_rgba(0,0,0,0.4)]",
          "active:scale-95",
          isOpen && "ring-2 ring-primary/40 ring-offset-2 ring-offset-background"
        )}
        data-testid="button-floating-assistant"
      >
        <div 
          className={cn(
            "absolute inset-1 rounded-full",
            "bg-gradient-to-br from-white to-primary/10",
            hasActivity ? "animate-pulse" : "animate-[pulse_3s_ease-in-out_infinite]"
          )}
        />
        
        <div 
          className={cn(
            "absolute inset-0 rounded-full",
            "bg-white/20",
            hasActivity 
              ? "animate-ping opacity-40" 
              : "animate-[ping_4s_ease-in-out_infinite] opacity-20"
          )}
        />
        
        <Sparkles 
          className={cn(
            "w-6 h-6 relative z-10",
            "text-primary drop-shadow-sm",
            hasActivity && "animate-bounce"
          )} 
        />
      </button>
    </div>
  );
}
