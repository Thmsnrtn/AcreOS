import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { MessageSquare, Send, Phone, AlertTriangle, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { useToast } from "@/hooks/use-toast";
import { TcpaComplianceBanner } from "@/components/tcpa-compliance-banner";

interface SmsMessage {
  id: number;
  direction: "inbound" | "outbound";
  content: string;
  status: string;
  createdAt: string;
}

interface SmsConversationProps {
  leadId: number;
  leadPhone?: string;
  leadName?: string;
  tcpaConsent?: boolean;
  doNotContact?: boolean;
}

export function SmsConversation({ leadId, leadPhone, leadName, tcpaConsent, doNotContact }: SmsConversationProps) {
  const [message, setMessage] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: messages, isLoading } = useQuery<SmsMessage[]>({
    queryKey: [`/api/leads/${leadId}/sms`],
    refetchInterval: 15_000, // Poll for new messages
    enabled: !!leadPhone,
  });

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch("/api/communications/sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, to: leadPhone, message: text }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to send SMS");
      return res.json();
    },
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: [`/api/leads/${leadId}/sms`] });
    },
    onError: () => {
      toast({ title: "SMS failed", description: "Could not send message. Try again.", variant: "destructive" });
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = () => {
    const trimmed = message.trim();
    if (!trimmed || !leadPhone || doNotContact) return;
    sendMutation.mutate(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Group messages by date
  const groupedMessages = (messages || []).reduce<Record<string, SmsMessage[]>>((acc, msg) => {
    const date = new Date(msg.createdAt).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(msg);
    return acc;
  }, {});

  if (!leadPhone) {
    return (
      <div className="p-6 text-center text-muted-foreground text-sm border rounded-lg">
        <Phone className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>Add a phone number to this lead to start texting.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-3/4 ml-auto" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-10 w-3/4 ml-auto" />
      </div>
    );
  }

  const isDncBlocked = doNotContact || tcpaConsent === false;

  return (
    <div className="border rounded-lg flex flex-col h-[500px]">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            SMS with {leadName || leadPhone}
          </span>
        </div>
        {isDncBlocked ? (
          <Badge variant="destructive" className="text-xs">
            <AlertTriangle className="h-3 w-3 mr-1" />
            DNC listed
          </Badge>
        ) : (
          <Badge variant="outline" className="text-xs text-green-600 border-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            TCPA clear
          </Badge>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1">
        {(!messages || messages.length === 0) ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No messages yet. Send the first text.
          </div>
        ) : (
          Object.entries(groupedMessages).map(([date, msgs]) => (
            <div key={date}>
              <div className="flex justify-center my-3">
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  {date}
                </span>
              </div>
              <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-1.5">
                {msgs.map((msg) => (
                  <motion.div
                    key={msg.id}
                    variants={staggerItem}
                    className={`flex ${msg.direction === "outbound" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        msg.direction === "outbound"
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : "bg-muted text-foreground rounded-bl-md"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-[10px] mt-0.5 ${
                        msg.direction === "outbound" ? "text-primary-foreground/60" : "text-muted-foreground"
                      }`}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          ))
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t space-y-2">
        {isDncBlocked ? (
          <div className="text-center text-sm text-destructive py-2">
            <AlertTriangle className="h-4 w-4 inline mr-1" />
            This lead is on the Do Not Contact list. SMS sending is disabled.
          </div>
        ) : (
          <>
          <TcpaComplianceBanner />
          <div className="flex gap-2">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={sendMutation.isPending}
              aria-label="SMS message input"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!message.trim() || sendMutation.isPending}
              aria-label="Send SMS"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          </>
        )}
      </div>
    </div>
  );
}
