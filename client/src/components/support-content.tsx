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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Plus, Send, CheckCircle, User, Bot, Star, Loader2, ArrowLeft, Headphones, Lightbulb } from "lucide-react";
import type { SupportCase, SupportMessage, FeatureRequest } from "@shared/schema";

type CaseWithMessages = {
  case: SupportCase;
  messages: SupportMessage[];
  actions: any[];
};

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

function getFeatureRequestStatusColor(status: string): string {
  switch (status) {
    case "submitted":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20";
    case "under_review":
      return "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20";
    case "planned":
      return "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20";
    case "in_progress":
      return "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
    case "completed":
      return "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20";
    case "declined":
      return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
    default:
      return "";
  }
}

function getFeatureRequestStatusLabel(status: string): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under Review";
    case "planned":
      return "Planned";
    case "in_progress":
      return "In Progress";
    case "completed":
      return "Completed";
    case "declined":
      return "Declined";
    default:
      return status;
  }
}

function getCategoryLabel(category: string): string {
  switch (category) {
    case "enhancement":
      return "Enhancement";
    case "new_feature":
      return "New Feature";
    case "integration":
      return "Integration Request";
    case "ux":
      return "UX Improvement";
    default:
      return category;
  }
}

export function SupportContent() {
  const { toast } = useToast();
  const [activeCaseId, setActiveCaseId] = useState<number | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [replyMessage, setReplyMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Feature Request state
  const [isFeatureRequestOpen, setIsFeatureRequestOpen] = useState(false);
  const [featureTitle, setFeatureTitle] = useState("");
  const [featureDescription, setFeatureDescription] = useState("");
  const [featureCategory, setFeatureCategory] = useState("");

  const { data: cases, isLoading: casesLoading } = useQuery<SupportCase[]>({
    queryKey: ["/api/support/cases"],
  });

  const { data: activeCaseData, isLoading: caseLoading } = useQuery<CaseWithMessages>({
    queryKey: ["/api/support/cases", activeCaseId],
    enabled: !!activeCaseId,
  });

  // Feature Requests
  const { data: featureRequests, isLoading: featureRequestsLoading } = useQuery<FeatureRequest[]>({
    queryKey: ["/api/feature-requests"],
  });

  const createFeatureRequestMutation = useMutation({
    mutationFn: async (data: { title: string; description: string; category: string }) => {
      const res = await apiRequest("POST", "/api/feature-requests", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/feature-requests"] });
      setIsFeatureRequestOpen(false);
      setFeatureTitle("");
      setFeatureDescription("");
      setFeatureCategory("");
      toast({
        title: "Feature request submitted",
        description: "Thank you for your feedback! We'll review your request.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Error",
        description: err.message || "Failed to submit feature request",
        variant: "destructive",
      });
    },
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

  const handleCreateFeatureRequest = () => {
    if (!featureTitle.trim() || !featureDescription.trim() || !featureCategory) return;
    createFeatureRequestMutation.mutate({
      title: featureTitle,
      description: featureDescription,
      category: featureCategory,
    });
  };

  const activeCase = activeCaseData?.case;
  const messages = activeCaseData?.messages || [];
  const canReply = activeCase && !["closed", "resolved"].includes(activeCase.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
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
        <Card className="lg:h-[calc(100vh-350px)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Headphones className="w-5 h-5" />
              Your Cases
            </CardTitle>
            <CardDescription>Select a case to view the conversation</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[300px] lg:h-[calc(100vh-450px)]">
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

        <Card className="lg:h-[calc(100vh-350px)] flex flex-col">
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
                            : "bg-muted"
                        }`}
                      >
                        {msg.role === "user" ? (
                          <User className="w-4 h-4" />
                        ) : (
                          <Bot className="w-4 h-4" />
                        )}
                      </div>
                      <div
                        className={`flex-1 max-w-[80%] ${
                          msg.role === "user" ? "text-right" : ""
                        }`}
                      >
                        <div
                          className={`inline-block p-3 rounded-lg ${
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
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

              {showRating ? (
                <div className="p-4 border-t">
                  <div className="text-center space-y-3">
                    <p className="text-sm font-medium">How was your experience?</p>
                    <div className="flex justify-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setRating(star)}
                          className="p-1 hover-elevate"
                          data-testid={`button-rating-${star}`}
                        >
                          <Star
                            className={`w-6 h-6 ${
                              star <= rating
                                ? "fill-yellow-400 text-yellow-400"
                                : "text-muted-foreground"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                    <Button
                      size="sm"
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
              ) : canReply ? (
                <div className="p-4 border-t">
                  <div className="flex gap-2">
                    <Textarea
                      placeholder="Type your message..."
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      className="min-h-[60px] resize-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      data-testid="input-reply-message"
                    />
                    <Button
                      size="icon"
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
              ) : null}
            </>
          )}
        </Card>
      </div>

      {/* Feature Requests Section */}
      <Card data-testid="card-feature-requests">
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Lightbulb className="w-5 h-5" />
              Feature Requests
            </CardTitle>
            <CardDescription>Suggest improvements and new features</CardDescription>
          </div>
          <Dialog open={isFeatureRequestOpen} onOpenChange={setIsFeatureRequestOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" data-testid="button-new-feature-request">
                <Plus className="w-4 h-4 mr-2" /> Submit Request
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Submit Feature Request</DialogTitle>
                <DialogDescription>
                  Share your ideas for new features or improvements.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="feature-title">Title</Label>
                  <Input
                    id="feature-title"
                    placeholder="Brief summary of your request..."
                    value={featureTitle}
                    onChange={(e) => setFeatureTitle(e.target.value)}
                    data-testid="input-feature-title"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="feature-category">Category</Label>
                  <Select value={featureCategory} onValueChange={setFeatureCategory}>
                    <SelectTrigger data-testid="select-feature-category">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="enhancement" data-testid="select-category-enhancement">Enhancement</SelectItem>
                      <SelectItem value="new_feature" data-testid="select-category-new-feature">New Feature</SelectItem>
                      <SelectItem value="integration" data-testid="select-category-integration">Integration Request</SelectItem>
                      <SelectItem value="ux" data-testid="select-category-ux">UX Improvement</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="feature-description">Description</Label>
                  <Textarea
                    id="feature-description"
                    placeholder="Describe your feature request in detail..."
                    rows={5}
                    value={featureDescription}
                    onChange={(e) => setFeatureDescription(e.target.value)}
                    data-testid="input-feature-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsFeatureRequestOpen(false)} data-testid="button-cancel-feature-request">
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateFeatureRequest}
                  disabled={!featureTitle.trim() || !featureDescription.trim() || !featureCategory || createFeatureRequestMutation.isPending}
                  data-testid="button-submit-feature-request"
                >
                  {createFeatureRequestMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Lightbulb className="w-4 h-4 mr-2" />
                      Submit Request
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {featureRequestsLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Loading feature requests...
            </div>
          ) : featureRequests?.length === 0 ? (
            <div className="p-6 text-center">
              <Lightbulb className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-muted-foreground text-sm">No feature requests yet</p>
              <p className="text-muted-foreground text-xs mt-1">
                Submit your first feature request to help us improve
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {featureRequests?.map((request) => (
                <div
                  key={request.id}
                  className="p-4 border rounded-md"
                  data-testid={`feature-request-${request.id}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-medium" data-testid={`feature-request-title-${request.id}`}>{request.title}</h4>
                    <Badge variant="outline" className={`text-xs ${getFeatureRequestStatusColor(request.status || "submitted")}`} data-testid={`feature-request-status-${request.id}`}>
                      {getFeatureRequestStatusLabel(request.status || "submitted")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-2" data-testid={`feature-request-description-${request.id}`}>
                    {request.description}
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="text-xs" data-testid={`feature-request-category-${request.id}`}>
                      {getCategoryLabel(request.category)}
                    </Badge>
                    <span data-testid={`feature-request-date-${request.id}`}>{formatDate(request.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
