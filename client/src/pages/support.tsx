import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Plus, Send, CheckCircle, Clock, AlertTriangle, User, Bot, Star, Loader2, ArrowLeft, Headphones } from "lucide-react";
import { Sidebar } from "@/components/layout-sidebar";
import type { SupportCase, SupportMessage } from "@shared/schema";

type CaseWithMessages = {
  case: SupportCase;
  messages: SupportMessage[];
  actions: any[];
};

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "open":
    case "ai_handling":
      return "default";
    case "escalated":
      return "destructive";
    case "resolved":
    case "closed":
      return "secondary";
    default:
      return "outline";
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "open":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
    case "ai_handling":
      return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
    case "awaiting_user":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case "escalated":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    case "resolved":
      return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
    case "closed":
      return "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20";
    default:
      return "";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "ai_handling":
      return "AI Handling";
    case "awaiting_user":
      return "Awaiting Response";
    case "escalated":
      return "Escalated";
    case "resolved":
      return "Resolved";
    case "closed":
      return "Closed";
    default:
      return status;
  }
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`text-xs ${getStatusColor(status)}`}>
      {getStatusLabel(status)}
    </Badge>
  );
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function SupportPage() {
  const { toast } = useToast();
  const [activeCaseId, setActiveCaseId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [replyMessage, setReplyMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: cases, isLoading: casesLoading } = useQuery<SupportCase[]>({
    queryKey: ["/api/support/cases"],
  });

  const { data: activeCaseData, isLoading: caseLoading } = useQuery<CaseWithMessages>({
    queryKey: ["/api/support/cases", activeCaseId],
    enabled: !!activeCaseId,
  });

  const createCaseMutation = useMutation({
    mutationFn: async (data: { subject: string; message: string }) => {
      const res = await apiRequest("POST", "/api/support/cases", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases"] });
      setActiveCaseId(data.case.id);
      setIsCreateOpen(false);
      setNewSubject("");
      setNewMessage("");
      toast({
        title: "Case created",
        description: "Your support case has been created. Our AI is now reviewing it.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to create support case",
        variant: "destructive",
      });
    },
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (data: { caseId: number; message: string }) => {
      const res = await apiRequest("POST", `/api/support/cases/${data.caseId}/messages`, { message: data.message });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases", activeCaseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases"] });
      setReplyMessage("");
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to send message",
        variant: "destructive",
      });
    },
  });

  const resolveCaseMutation = useMutation({
    mutationFn: async (caseId: number) => {
      const res = await apiRequest("POST", `/api/support/cases/${caseId}/resolve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases", activeCaseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases"] });
      setShowRating(true);
      toast({
        title: "Case resolved",
        description: "Thank you! Please take a moment to rate your experience.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to resolve case",
        variant: "destructive",
      });
    },
  });

  const rateCaseMutation = useMutation({
    mutationFn: async (data: { caseId: number; rating: number }) => {
      const res = await apiRequest("POST", `/api/support/cases/${data.caseId}/rate`, { rating: data.rating });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases", activeCaseId] });
      queryClient.invalidateQueries({ queryKey: ["/api/support/cases"] });
      setShowRating(false);
      setRating(0);
      toast({
        title: "Thank you!",
        description: "Your feedback helps us improve.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to submit rating",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeCaseData?.messages]);

  const handleCreateCase = () => {
    if (!newSubject.trim() || !newMessage.trim()) return;
    createCaseMutation.mutate({ subject: newSubject, message: newMessage });
  };

  const handleSendMessage = () => {
    if (!replyMessage.trim() || !activeCaseId) return;
    sendMessageMutation.mutate({ caseId: activeCaseId, message: replyMessage });
  };

  const handleResolve = () => {
    if (!activeCaseId) return;
    resolveCaseMutation.mutate(activeCaseId);
  };

  const handleRate = () => {
    if (!activeCaseId || rating === 0) return;
    rateCaseMutation.mutate({ caseId: activeCaseId, rating });
  };

  const activeCase = activeCaseData?.case;
  const messages = activeCaseData?.messages || [];
  const canReply = activeCase && !["closed", "resolved"].includes(activeCase.status);

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">Support</h1>
              <p className="text-muted-foreground">Get help from our AI-powered support system.</p>
            </div>
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-lg" data-testid="button-new-case">
                  <Plus className="w-4 h-4 mr-2" /> New Support Case
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Create Support Case</DialogTitle>
                  <DialogDescription>
                    Describe your issue and our AI will assist you immediately.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="subject">Subject</Label>
                    <Input
                      id="subject"
                      placeholder="Brief summary of your issue..."
                      value={newSubject}
                      onChange={(e) => setNewSubject(e.target.value)}
                      data-testid="input-case-subject"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Describe your issue</Label>
                    <Textarea
                      id="message"
                      placeholder="Please provide details about your issue..."
                      rows={5}
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      data-testid="input-case-message"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)} data-testid="button-cancel-case">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateCase}
                    disabled={!newSubject.trim() || !newMessage.trim() || createCaseMutation.isPending}
                    data-testid="button-submit-case"
                  >
                    {createCaseMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        <MessageSquare className="w-4 h-4 mr-2" />
                        Create Case
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid lg:grid-cols-[350px_1fr] gap-6">
            <Card className="lg:h-[calc(100vh-200px)]">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Headphones className="w-5 h-5" />
                  Your Cases
                </CardTitle>
                <CardDescription>Select a case to view the conversation</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-340px)] lg:h-[calc(100vh-300px)]">
                  {casesLoading ? (
                    <div className="p-4 text-center text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Loading cases...
                    </div>
                  ) : cases?.length === 0 ? (
                    <div className="p-6 text-center">
                      <MessageSquare className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-muted-foreground text-sm">No support cases yet</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        Create a new case to get help
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y">
                      {cases?.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => {
                            setActiveCaseId(c.id);
                            setShowRating(false);
                          }}
                          className={`w-full p-4 text-left hover-elevate transition-colors ${
                            activeCaseId === c.id ? "bg-accent" : ""
                          }`}
                          data-testid={`button-case-${c.id}`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="font-medium text-sm line-clamp-1" data-testid={`text-case-subject-${c.id}`}>
                              {c.subject}
                            </span>
                            <StatusBadge status={c.status} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(c.createdAt)}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="lg:h-[calc(100vh-200px)] flex flex-col">
              {!activeCaseId ? (
                <div className="flex-1 flex items-center justify-center p-6">
                  <div className="text-center">
                    <MessageSquare className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-lg font-medium mb-2">Select a case</h3>
                    <p className="text-muted-foreground text-sm max-w-sm">
                      Choose an existing case from the list or create a new one to start a conversation.
                    </p>
                  </div>
                </div>
              ) : caseLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <CardHeader className="pb-3 border-b flex-shrink-0">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden"
                            onClick={() => setActiveCaseId(null)}
                            data-testid="button-back"
                          >
                            <ArrowLeft className="w-4 h-4" />
                          </Button>
                          <CardTitle className="text-lg line-clamp-1" data-testid="text-active-case-subject">
                            {activeCase?.subject}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status={activeCase?.status || ""} />
                          <span className="text-xs text-muted-foreground">
                            Created {formatDate(activeCase?.createdAt)}
                          </span>
                        </div>
                      </div>
                      {canReply && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleResolve}
                          disabled={resolveCaseMutation.isPending}
                          data-testid="button-resolve-case"
                        >
                          {resolveCaseMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle className="w-4 h-4 mr-2" />
                              Mark Resolved
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </CardHeader>

                  <ScrollArea className="flex-1 p-4">
                    <div className="space-y-4">
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex gap-3 ${
                            msg.role === "user" ? "flex-row-reverse" : ""
                          }`}
                          data-testid={`message-${msg.id}`}
                        >
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                              msg.role === "user"
                                ? "bg-primary text-primary-foreground"
                                : msg.role === "ai_support"
                                ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                                : "bg-accent"
                            }`}
                          >
                            {msg.role === "user" ? (
                              <User className="w-4 h-4" />
                            ) : msg.role === "ai_support" ? (
                              <Bot className="w-4 h-4" />
                            ) : (
                              <Headphones className="w-4 h-4" />
                            )}
                          </div>
                          <div
                            className={`flex-1 max-w-[85%] ${
                              msg.role === "user" ? "text-right" : ""
                            }`}
                          >
                            <div
                              className={`inline-block rounded-lg p-3 text-sm ${
                                msg.role === "user"
                                  ? "bg-primary text-primary-foreground"
                                  : "bg-muted"
                              }`}
                            >
                              <p className="whitespace-pre-wrap" data-testid={`text-message-content-${msg.id}`}>
                                {msg.content}
                              </p>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {formatDate(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  </ScrollArea>

                  {showRating && (
                    <div className="p-4 border-t bg-muted/30">
                      <div className="text-center">
                        <p className="text-sm font-medium mb-3">
                          How would you rate your support experience?
                        </p>
                        <div className="flex justify-center gap-2 mb-3">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              onClick={() => setRating(star)}
                              className="p-1 transition-transform hover:scale-110"
                              data-testid={`button-rating-${star}`}
                            >
                              <Star
                                className={`w-8 h-8 ${
                                  star <= rating
                                    ? "fill-yellow-400 text-yellow-400"
                                    : "text-muted-foreground"
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                        <Button
                          onClick={handleRate}
                          disabled={rating === 0 || rateCaseMutation.isPending}
                          data-testid="button-submit-rating"
                        >
                          {rateCaseMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "Submit Rating"
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {canReply && !showRating && (
                    <div className="p-4 border-t flex-shrink-0">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Type your message..."
                          value={replyMessage}
                          onChange={(e) => setReplyMessage(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                          disabled={sendMessageMutation.isPending}
                          data-testid="input-reply-message"
                        />
                        <Button
                          onClick={handleSendMessage}
                          disabled={!replyMessage.trim() || sendMessageMutation.isPending}
                          data-testid="button-send-message"
                        >
                          {sendMessageMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )}

                  {!canReply && !showRating && (
                    <div className="p-4 border-t bg-muted/30 text-center text-sm text-muted-foreground">
                      This case has been {activeCase?.status}. 
                      {activeCase?.userSatisfaction && (
                        <span className="ml-2">
                          Your rating: {activeCase.userSatisfaction}/5
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
