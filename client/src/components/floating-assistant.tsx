import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Minus,
  X,
  Send,
  Loader2,
  Sparkles,
  Plus,
  Ghost,
  AlertCircle,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Palette,
  Eye,
  Play,
  Briefcase,
  Users,
  ShoppingCart,
  Megaphone,
  Wallet,
  Search,
  ChevronDown,
  MapPin,
  Gauge,
  Mic,
  MicOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LiveDemoMode } from "@/components/live-demo-mode";
import { BackgroundMode } from "@/components/background-mode";
import { Action, ActionResult, ActionExecutor, parseActionsFromText } from "@/lib/action-executor";

interface PageContextInfo {
  name: string;
  entityType?: string;
  actions: string[];
}

interface CurrentContext {
  name: string;
  entityType?: string;
  entityId?: string;
  actions: string[];
}

const PAGE_CONTEXTS: Record<string, PageContextInfo> = {
  "/": { name: "Dashboard", actions: ["View stats", "Check notifications", "Go to leads"] },
  "/leads": { name: "Leads", entityType: "lead", actions: ["Add new lead", "Filter leads", "Export leads"] },
  "/leads/:id": { name: "Lead Details", entityType: "lead", actions: ["Update lead status", "Add note", "Send message"] },
  "/properties": { name: "Properties", entityType: "property", actions: ["Add property", "Search properties", "View on map"] },
  "/properties/:id": { name: "Property Details", entityType: "property", actions: ["Edit property", "Analyze property", "Create deal"] },
  "/deals": { name: "Deals", entityType: "deal", actions: ["Create deal", "View pipeline", "Filter deals"] },
  "/notes": { name: "Finance Notes", entityType: "note", actions: ["Create note", "View payments", "Schedule reminder"] },
  "/campaigns": { name: "Marketing", entityType: "campaign", actions: ["Create campaign", "View metrics", "Send mail"] },
  "/settings": { name: "Settings", actions: ["Update profile", "Manage API keys", "View usage"] },
  "/analytics": { name: "Analytics", actions: ["View reports", "Export data", "Set date range"] },
  "/inbox": { name: "Inbox", entityType: "message", actions: ["View messages", "Send reply", "Archive"] },
  "/tasks": { name: "Tasks", entityType: "task", actions: ["Create task", "Mark complete", "Filter by status"] },
  "/documents": { name: "Documents", entityType: "document", actions: ["Upload document", "Generate contract", "Share"] },
  "/finance": { name: "Finance", entityType: "payment", actions: ["View payments", "Create invoice", "Export report"] },
};

function getPageContext(path: string): CurrentContext {
  if (PAGE_CONTEXTS[path]) {
    return { ...PAGE_CONTEXTS[path], entityId: undefined };
  }
  
  const detailPatterns = [
    { regex: /^\/leads\/(\d+)$/, template: "/leads/:id" },
    { regex: /^\/properties\/(\d+)$/, template: "/properties/:id" },
    { regex: /^\/deals\/(\d+)$/, template: "/deals/:id" },
    { regex: /^\/notes\/(\d+)$/, template: "/notes/:id" },
    { regex: /^\/campaigns\/(\d+)$/, template: "/campaigns/:id" },
    { regex: /^\/tasks\/(\d+)$/, template: "/tasks/:id" },
  ];
  
  for (const pattern of detailPatterns) {
    const match = path.match(pattern.regex);
    if (match) {
      const contextInfo = PAGE_CONTEXTS[pattern.template];
      if (contextInfo) {
        return {
          ...contextInfo,
          entityId: match[1],
        };
      }
    }
  }
  
  return {
    name: "Page",
    actions: ["Ask a question", "Get help", "View overview"],
  };
}

interface Attachment {
  id: string;
  file: File;
  preview?: string;
  type: "image" | "file";
}

interface MessageAttachment {
  id: string;
  name: string;
  size: number;
  type: "image" | "file";
  preview?: string;
  base64?: string;
}

interface GeneratedImage {
  url: string;
  prompt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  attachments?: MessageAttachment[];
  generatedImages?: GeneratedImage[];
}

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const ACCEPTED_FILE_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/csv"
];
const ACCEPTED_EXTENSIONS = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.txt,.csv";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

const AGENTS = [
  { id: "executive", name: "Atlas", description: "Chief of Staff - Daily briefings, task routing", icon: Briefcase },
  { id: "sales", name: "Samantha", description: "Sales - Buyer relationships, lead qualification", icon: Users },
  { id: "acquisitions", name: "Alex", description: "Acquisitions - Purchasing negotiations", icon: ShoppingCart },
  { id: "marketing", name: "Maya", description: "Marketing - Campaign execution", icon: Megaphone },
  { id: "collections", name: "Charlie", description: "Collections - Payment collection", icon: Wallet },
  { id: "research", name: "Riley", description: "Research - Property research", icon: Search },
] as const;

type AgentId = typeof AGENTS[number]["id"];

export function FloatingAssistant() {
  const [location] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasActivity, setHasActivity] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentId>("executive");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isImageMode, setIsImageMode] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [executionMode, setExecutionMode] = useState<"live" | "background">("background");
  const [executionSpeed, setExecutionSpeed] = useState<0.5 | 1 | 2>(1);
  const [pendingActions, setPendingActions] = useState<Action[]>([]);
  const [isExecutingActions, setIsExecutingActions] = useState(false);
  const [currentTaskName, setCurrentTaskName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dragCounterRef = useRef(0);
  const executorRef = useRef<ActionExecutor | null>(null);
  
  const currentContext = useMemo(() => getPageContext(location), [location]);
  
  const contextLabel = useMemo(() => {
    if (currentContext.entityId) {
      return `${currentContext.name} #${currentContext.entityId}`;
    }
    return currentContext.name;
  }, [currentContext]);

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

  useEffect(() => {
    return () => {
      attachments.forEach((att) => {
        if (att.preview) {
          URL.revokeObjectURL(att.preview);
        }
      });
    };
  }, []);

  const createConversation = useCallback(async (): Promise<number | null> => {
    try {
      const response = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ agentRole: selectedAgent }),
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.id;
      }
      return null;
    } catch {
      return null;
    }
  }, [selectedAgent]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const isValidFileType = (file: File): boolean => {
    return ACCEPTED_IMAGE_TYPES.includes(file.type) || ACCEPTED_FILE_TYPES.includes(file.type);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const processFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const remainingSlots = MAX_ATTACHMENTS - attachments.length;
    
    if (remainingSlots <= 0) {
      return;
    }

    const newAttachments: Attachment[] = [];
    
    for (const file of fileArray.slice(0, remainingSlots)) {
      if (!isValidFileType(file)) {
        continue;
      }
      
      if (file.size > MAX_FILE_SIZE) {
        continue;
      }

      const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
      const attachment: Attachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        type: isImage ? "image" : "file",
        preview: isImage ? URL.createObjectURL(file) : undefined,
      };
      
      newAttachments.push(attachment);
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => {
      const attachment = prev.find((a) => a.id === id);
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter((a) => a.id !== id);
    });
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  // Web Speech API voice input
  const startVoiceInput = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice input is not supported in this browser. Try Chrome or Edge.');
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognitionRef.current = recognition;
    setIsListening(true);

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join('');
      setInputValue(transcript);
    };
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognition.start();
  }, []);

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && attachments.length === 0) || isLoading || isStreaming || isGeneratingImage) return;
    
    if (isImageMode || (attachments.length === 0 && detectImageGenerationIntent(inputValue))) {
      await generateImage(inputValue);
      return;
    }

    const messageAttachments: MessageAttachment[] = [];
    
    for (const att of attachments) {
      const base64 = await fileToBase64(att.file);
      messageAttachments.push({
        id: att.id,
        name: att.file.name,
        size: att.file.size,
        type: att.type,
        preview: att.preview,
        base64,
      });
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
      attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setAttachments([]);
    setIsLoading(true);
    setHasActivity(true);

    let activeConversationId = conversationId;

    if (!isTemporaryChat && !conversationId) {
      activeConversationId = await createConversation();
      if (activeConversationId) {
        setConversationId(activeConversationId);
      }
    }

    const assistantMessageId = `assistant-${Date.now()}`;
    
    setMessages((prev) => [...prev, {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      isStreaming: true,
    }]);
    
    setIsLoading(false);
    setIsStreaming(true);

    try {
      abortControllerRef.current = new AbortController();
      
      const imageContents = messageAttachments
        .filter((a) => a.type === "image" && a.base64)
        .map((a) => a.base64);
      
      const fileAttachments = messageAttachments
        .filter((a) => a.type === "file" && a.base64)
        .map((a) => ({
          name: a.name,
          content: a.base64,
          size: a.size,
        }));
      
      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage.content,
          conversationId: isTemporaryChat ? undefined : activeConversationId,
          agentRole: selectedAgent,
          images: imageContents.length > 0 ? imageContents : undefined,
          files: fileAttachments.length > 0 ? fileAttachments : undefined,
          context: {
            page: currentContext.name,
            entityType: currentContext.entityType,
            entityId: currentContext.entityId,
          },
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        let errorMessage = "Something went wrong. Please try again.";
        
        if (response.status === 429) {
          const data = await response.json().catch(() => ({}));
          errorMessage = data.message || "You've reached your daily AI request limit. Please upgrade your plan for more requests.";
        } else if (response.status === 402) {
          const data = await response.json().catch(() => ({}));
          const balance = data.balance?.toFixed(2) || "0.00";
          errorMessage = `Insufficient credits (balance: $${balance}). Please add credits to continue using AI features.`;
        } else if (response.status === 401) {
          errorMessage = "Please sign in to use the AI assistant.";
        }
        
        setMessages((prev) => prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, role: "error" as const, content: errorMessage, isStreaming: false }
            : msg
        ));
        setIsStreaming(false);
        setTimeout(() => setHasActivity(false), 3000);
        return;
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.type === "content" && data.content) {
                  accumulatedContent += data.content;
                  setMessages((prev) => prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: accumulatedContent }
                      : msg
                  ));
                } else if (data.type === "tool_start") {
                  const toolName = data.toolCall?.name || "action";
                  const toolDisplay = toolName.replace(/_/g, ' ');
                  setMessages((prev) => prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: accumulatedContent + `\n\n[Executing: ${toolDisplay}...]` }
                      : msg
                  ));
                } else if (data.type === "tool_result") {
                  const toolName = data.toolCall?.name || "action";
                  const toolDisplay = toolName.replace(/_/g, ' ');
                  const statusLine = `\n[Done: ${toolDisplay}]`;
                  if (!accumulatedContent.includes(statusLine)) {
                    accumulatedContent = accumulatedContent.replace(/\n\n\[Executing:.*\]$/g, '') + statusLine + '\n';
                  }
                  setMessages((prev) => prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, content: accumulatedContent }
                      : msg
                  ));
                } else if (data.type === "done") {
                  setMessages((prev) => prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, isStreaming: false }
                      : msg
                  ));
                } else if (data.type === "error") {
                  setMessages((prev) => prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, role: "error" as const, content: data.error || data.content || "An error occurred", isStreaming: false }
                      : msg
                  ));
                }
              } catch {
              }
            }
          }
        }
      }

      if (!accumulatedContent) {
        setMessages((prev) => prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, content: "I'm here to help! What would you like to know?", isStreaming: false }
            : msg
        ));
      } else {
        setMessages((prev) => prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, isStreaming: false }
            : msg
        ));
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantMessageId));
      } else {
        setMessages((prev) => prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, role: "error" as const, content: "Connection failed. Please check your internet and try again.", isStreaming: false }
            : msg
        ));
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
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

  const handleNewChat = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setMessages([]);
    setConversationId(null);
    setIsStreaming(false);
    setIsLoading(false);
    setAttachments([]);
    setIsImageMode(false);
    setIsGeneratingImage(false);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleTemporaryToggle = (checked: boolean) => {
    setIsTemporaryChat(checked);
    if (checked) {
      setConversationId(null);
    }
  };

  const cancelCurrentExecution = useCallback(() => {
    if (executorRef.current) {
      executorRef.current.cancel();
      executorRef.current = null;
    }
  }, []);

  const registerExecutor = useCallback((executor: ActionExecutor) => {
    executorRef.current = executor;
  }, []);

  const handleExecuteActions = (actions: Action[], taskName?: string) => {
    if (actions.length === 0 || isExecutingActions) return;
    cancelCurrentExecution();
    setPendingActions(actions);
    setCurrentTaskName(taskName || `Executing ${actions.length} actions`);
    setIsExecutingActions(true);
  };

  const handleActionsComplete = (results: ActionResult[]) => {
    executorRef.current = null;
    const successCount = results.filter(r => r.success).length;
    const failedResults = results.filter(r => !r.success);
    const failedCount = failedResults.length;
    
    let content: string;
    if (failedCount > 0) {
      const errorDetails = failedResults
        .map(r => `• ${r.action.description || r.action.type}: ${r.error || "Unknown error"}`)
        .join("\n");
      content = `Completed ${successCount} of ${results.length} actions. ${failedCount} action(s) failed:\n\n${errorDetails}`;
    } else {
      content = `Successfully completed all ${successCount} actions.`;
    }
    
    const statusMessage: Message = {
      id: `system-${Date.now()}`,
      role: failedCount > 0 ? "error" : "assistant",
      content,
      timestamp: new Date(),
    };
    
    setMessages((prev) => [...prev, statusMessage]);
    setPendingActions([]);
    setIsExecutingActions(false);
    setCurrentTaskName("");
  };

  const handleActionsCancel = () => {
    cancelCurrentExecution();
    setPendingActions([]);
    setIsExecutingActions(false);
    setCurrentTaskName("");
    
    const cancelMessage: Message = {
      id: `system-${Date.now()}`,
      role: "assistant",
      content: "Action execution was cancelled.",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, cancelMessage]);
  };

  const handleActionsError = (error: string) => {
    executorRef.current = null;
    setPendingActions([]);
    setIsExecutingActions(false);
    setCurrentTaskName("");
    
    const errorMessage: Message = {
      id: `error-${Date.now()}`,
      role: "error",
      content: `Action execution failed: ${error}`,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, errorMessage]);
  };

  const handleSuggestedAction = (action: string) => {
    setInputValue(action);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const openImageModal = (imageSrc: string) => {
    setSelectedImage(imageSrc);
    setImageModalOpen(true);
  };

  const detectImageGenerationIntent = (message: string): boolean => {
    const lowerMessage = message.toLowerCase();
    const imageKeywords = [
      "generate image",
      "generate an image",
      "generate a image",
      "create image",
      "create an image",
      "create a image",
      "make image",
      "make an image",
      "make a image",
      "draw",
      "make a picture",
      "make picture",
      "create a picture",
      "generate a picture",
      "paint",
      "sketch",
      "illustrate",
      "design an image",
      "create artwork",
      "generate artwork"
    ];
    return imageKeywords.some(keyword => lowerMessage.includes(keyword));
  };

  const generateImage = async (prompt: string): Promise<void> => {
    if (!prompt.trim() || isGeneratingImage) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsImageMode(false);
    setIsGeneratingImage(true);
    setHasActivity(true);

    const assistantMessageId = `assistant-${Date.now()}`;
    
    setMessages((prev) => [...prev, {
      id: assistantMessageId,
      role: "assistant",
      content: "Generating image...",
      timestamp: new Date(),
      isStreaming: true,
    }]);

    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          prompt: prompt.trim(),
          size: "1024x1024",
        }),
      });

      if (!response.ok) {
        let errorMessage = "Failed to generate image. Please try again.";
        
        if (response.status === 402) {
          const data = await response.json().catch(() => ({}));
          const balance = data.balance?.toFixed(2) || "0.00";
          errorMessage = `Insufficient credits (balance: $${balance}). Please add credits to generate images.`;
        } else if (response.status === 401) {
          errorMessage = "Please sign in to generate images.";
        } else if (response.status === 500) {
          errorMessage = "Image generation failed. Please try again with a different prompt.";
        }
        
        setMessages((prev) => prev.map((msg) =>
          msg.id === assistantMessageId
            ? { ...msg, role: "error" as const, content: errorMessage, isStreaming: false }
            : msg
        ));
        return;
      }

      const data = await response.json();
      const imageUrl = data.b64_json 
        ? `data:image/png;base64,${data.b64_json}` 
        : data.url;

      setMessages((prev) => prev.map((msg) =>
        msg.id === assistantMessageId
          ? { 
              ...msg, 
              content: "Here's your generated image:", 
              isStreaming: false,
              generatedImages: [{ url: imageUrl, prompt: prompt.trim() }]
            }
          : msg
      ));
    } catch (error) {
      setMessages((prev) => prev.map((msg) =>
        msg.id === assistantMessageId
          ? { ...msg, role: "error" as const, content: "Connection failed. Please check your internet and try again.", isStreaming: false }
          : msg
      ));
    } finally {
      setIsGeneratingImage(false);
      setTimeout(() => setHasActivity(false), 3000);
    }
  };

  const renderMarkdown = (content: string) => {
    const blocks: JSX.Element[] = [];
    let blockIndex = 0;
    
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        const textBefore = content.slice(lastIndex, match.index);
        blocks.push(
          <span key={blockIndex++}>
            {renderInlineContent(textBefore)}
          </span>
        );
      }
      
      const language = match[1] || "";
      const code = match[2].trim();
      blocks.push(
        <pre 
          key={blockIndex++}
          className="bg-background/80 border border-border/50 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono"
        >
          {language && (
            <div className="text-muted-foreground text-[10px] mb-2 uppercase tracking-wide">
              {language}
            </div>
          )}
          <code>{code}</code>
        </pre>
      );
      
      lastIndex = match.index + match[0].length;
    }
    
    if (lastIndex < content.length) {
      blocks.push(
        <span key={blockIndex++}>
          {renderInlineContent(content.slice(lastIndex))}
        </span>
      );
    }
    
    return blocks;
  };
  
  const renderInlineContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, i) => {
      if (/^#{1,3}\s/.test(line)) {
        const level = line.match(/^#+/)?.[0].length || 1;
        const text = line.replace(/^#+\s/, '');
        const className = level === 1 
          ? "text-base font-bold mt-3 mb-1.5" 
          : level === 2 
            ? "text-sm font-semibold mt-2 mb-1" 
            : "text-sm font-medium mt-1.5 mb-0.5";
        return (
          <span key={i} className={cn("block", className)}>
            {processInlineFormatting(text)}
          </span>
        );
      }
      
      if (/^\d+\.\s/.test(line)) {
        const text = line.replace(/^\d+\.\s/, '');
        const number = line.match(/^\d+/)?.[0] || "1";
        return (
          <span key={i} className="block pl-4 relative">
            <span className="absolute left-0 text-muted-foreground">{number}.</span>
            {processInlineFormatting(text)}
          </span>
        );
      }
      
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return (
          <span key={i} className="block pl-4 relative">
            <span className="absolute left-0">•</span>
            {processInlineFormatting(line.slice(2))}
          </span>
        );
      }
      
      return (
        <span key={i} className="block">
          {processInlineFormatting(line) || <br />}
        </span>
      );
    });
  };
  
  const processInlineFormatting = (text: string) => {
    let processed = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 bg-muted rounded text-xs font-mono">$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-2 hover:opacity-80 inline-flex items-center gap-0.5">$1<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>');
    
    return <span dangerouslySetInnerHTML={{ __html: processed }} />;
  };

  const renderMessageAttachments = (messageAttachments: MessageAttachment[]) => {
    if (!messageAttachments || messageAttachments.length === 0) return null;
    
    return (
      <div className="flex flex-wrap gap-1.5 mt-2">
        {messageAttachments.map((att) => (
          att.type === "image" && (att.preview || att.base64) ? (
            <button
              key={att.id}
              onClick={() => openImageModal(att.base64 || att.preview || "")}
              className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/20 hover:opacity-90 transition-opacity"
              data-testid={`message-attachment-image-${att.id}`}
            >
              <img
                src={att.base64 || att.preview}
                alt={att.name}
                className="w-full h-full object-cover"
              />
            </button>
          ) : (
            <div
              key={att.id}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/10 text-xs"
              data-testid={`message-attachment-file-${att.id}`}
            >
              <FileText className="w-3 h-3" />
              <span className="max-w-[80px] truncate">{att.name}</span>
            </div>
          )
        ))}
      </div>
    );
  };

  return (
    <div className="fixed z-50 bottom-20 right-4 md:bottom-24 md:right-6 safe-area-bottom" data-testid="floating-assistant-container">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        data-testid="input-file-upload"
      />
      
      <Dialog open={imageModalOpen} onOpenChange={setImageModalOpen}>
        <DialogContent className="max-w-4xl p-2 bg-background/95 backdrop-blur-sm">
          <DialogTitle className="sr-only">Image Preview</DialogTitle>
          <DialogDescription className="sr-only">Full size preview of the selected image</DialogDescription>
          {selectedImage && (
            <img
              src={selectedImage}
              alt="Full size preview"
              className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
              data-testid="image-modal-preview"
            />
          )}
        </DialogContent>
      </Dialog>

      {isOpen && !isMinimized && (
        <div 
          className={cn(
            "fixed md:absolute bottom-0 md:bottom-16 right-0 left-0 md:left-auto mb-0 md:mb-2",
            "w-full md:w-[400px] h-[85vh] md:h-[600px]",
            "glass-panel floating-window rounded-t-2xl md:rounded-2xl overflow-hidden",
            "flex flex-col",
            "animate-in slide-in-from-bottom-4 fade-in duration-300",
            isDragging && "ring-2 ring-primary ring-offset-2 ring-offset-background"
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          data-testid="assistant-chat-panel"
        >
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-primary">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <ImageIcon className="w-8 h-8" />
                </div>
                <span className="font-medium">Drop files here</span>
                <span className="text-xs text-muted-foreground">Images and documents up to 10MB</span>
              </div>
            </div>
          )}
          
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/50 bg-background/50 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <div className="relative">
                {(() => {
                  const currentAgent = AGENTS.find(a => a.id === selectedAgent) || AGENTS[0];
                  const AgentIcon = currentAgent.icon;
                  return (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white via-primary/20 to-primary/40 flex items-center justify-center shadow-lg">
                      <AgentIcon className="w-4 h-4 text-primary" />
                    </div>
                  );
                })()}
                {isStreaming && (
                  <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
                )}
              </div>
              <div className="flex flex-col">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button 
                      className="flex items-center gap-1 font-semibold text-foreground text-sm leading-tight hover:text-primary transition-colors"
                      data-testid="dropdown-agent-selector"
                    >
                      {AGENTS.find(a => a.id === selectedAgent)?.name || "AI Assistant"}
                      <ChevronDown className="w-3 h-3 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    {AGENTS.map((agent) => {
                      const AgentIcon = agent.icon;
                      return (
                        <DropdownMenuItem
                          key={agent.id}
                          onClick={() => setSelectedAgent(agent.id)}
                          className={cn(
                            "flex items-start gap-2 py-2 cursor-pointer",
                            selectedAgent === agent.id && "bg-primary/10"
                          )}
                          data-testid={`dropdown-item-agent-${agent.id}`}
                        >
                          <AgentIcon className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                          <div className="flex flex-col">
                            <span className="font-medium text-sm">{agent.name}</span>
                            <span className="text-xs text-muted-foreground">{agent.description}</span>
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                {isTemporaryChat && (
                  <div className="flex items-center gap-1">
                    <Ghost className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Temporary</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground" data-testid="context-indicator">
                    On: {contextLabel}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={handleNewChat}
                    data-testid="button-new-chat"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">New Chat</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={executionMode === "live" ? "default" : "ghost"}
                    className={cn(
                      "h-7 w-7",
                      executionMode === "live" && "bg-primary text-primary-foreground"
                    )}
                    onClick={() => setExecutionMode(executionMode === "live" ? "background" : "live")}
                    disabled={isExecutingActions}
                    data-testid="button-toggle-execution-mode"
                  >
                    {executionMode === "live" ? (
                      <Eye className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px] text-center">
                  {executionMode === "live" 
                    ? "Live Demo: Watch the AI perform actions step-by-step with visual feedback" 
                    : "Background: AI performs actions silently in the background"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => {
                      const speeds: (0.5 | 1 | 2)[] = [0.5, 1, 2];
                      const currentIdx = speeds.indexOf(executionSpeed);
                      setExecutionSpeed(speeds[(currentIdx + 1) % speeds.length]);
                    }}
                    disabled={isExecutingActions}
                    data-testid="button-execution-speed"
                  >
                    <span className="text-[10px] font-medium">{executionSpeed}x</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Execution Speed: {executionSpeed}x (click to change)
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 px-2">
                    <Ghost className={cn("w-3.5 h-3.5", isTemporaryChat ? "text-primary" : "text-muted-foreground")} />
                    <Switch
                      checked={isTemporaryChat}
                      onCheckedChange={handleTemporaryToggle}
                      className="scale-75"
                      data-testid="switch-temporary-chat"
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isTemporaryChat ? "Temporary mode: Messages won't be saved" : "Enable temporary chat"}
                </TooltipContent>
              </Tooltip>
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
              {messages.length === 0 && (() => {
                const currentAgent = AGENTS.find(a => a.id === selectedAgent) || AGENTS[0];
                const AgentIcon = currentAgent.icon;
                const greetings: Record<AgentId, { title: string; description: string }> = {
                  executive: { 
                    title: `Hi, I'm ${currentAgent.name}!`, 
                    description: "I'm your Chief of Staff. I can provide daily briefings, route tasks to the right team members, and keep your business running smoothly." 
                  },
                  sales: { 
                    title: `Hi, I'm ${currentAgent.name}!`, 
                    description: "I specialize in buyer relationships and lead qualification. Let me help you connect with potential buyers and close deals." 
                  },
                  acquisitions: { 
                    title: `Hi, I'm ${currentAgent.name}!`, 
                    description: "I'm your acquisitions specialist. I can help with seller leads, comp research, offer drafting, and purchase negotiations." 
                  },
                  marketing: { 
                    title: `Hi, I'm ${currentAgent.name}!`, 
                    description: "I handle marketing and campaign execution. Let me help you design mail campaigns and reach the right audience." 
                  },
                  collections: { 
                    title: `Hi, I'm ${currentAgent.name}!`, 
                    description: "I manage payment collections and borrower relationships. I can help with reminders, payment plans, and account monitoring." 
                  },
                  research: { 
                    title: `Hi, I'm ${currentAgent.name}!`, 
                    description: "I'm your research specialist. I can conduct property due diligence, market analysis, and zoning research." 
                  },
                };
                const greeting = greetings[selectedAgent];
                return (
                  <div className="flex flex-col items-center justify-center h-[300px] text-center px-4">
                    <div className="relative mb-4">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-br from-white via-primary/10 to-primary/30 flex items-center justify-center shadow-xl">
                        <AgentIcon className="w-8 h-8 text-primary" />
                      </div>
                      <div className="absolute inset-0 rounded-full bg-white/20 animate-pulse" />
                    </div>
                    <h4 className="font-semibold text-lg mb-2">{greeting.title}</h4>
                    <p className="text-muted-foreground text-sm max-w-[280px]">
                      {greeting.description}
                    </p>
                    <p className="text-muted-foreground text-xs mt-2">
                      Attach images or documents for visual analysis
                    </p>
                    {isTemporaryChat && (
                      <Badge variant="secondary" className="mt-3 gap-1">
                        <Ghost className="w-3 h-3" />
                        Temporary Mode
                      </Badge>
                    )}
                    {currentContext.actions.length > 0 && (
                      <div className="mt-4 w-full">
                        <p className="text-muted-foreground text-[10px] mb-2 uppercase tracking-wide">
                          Suggested for {currentContext.name}
                        </p>
                        <div className="flex flex-wrap justify-center gap-1.5">
                          {currentContext.actions.map((action, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleSuggestedAction(action)}
                              className="px-2.5 py-1 text-xs rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                              data-testid={`button-suggested-action-${idx}`}
                            >
                              {action}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
              
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
                        : message.role === "error"
                          ? "bg-destructive/10 border border-destructive/30 text-foreground rounded-bl-md"
                          : "bg-muted text-foreground rounded-bl-md"
                    )}
                    data-testid={`message-${message.role}-${message.id}`}
                  >
                    {message.role === "error" && (
                      <div className="flex items-center gap-1.5 mb-1.5 text-destructive">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span className="text-xs font-medium">Error</span>
                      </div>
                    )}
                    {message.role === "assistant" && (() => {
                      const currentAgent = AGENTS.find(a => a.id === selectedAgent) || AGENTS[0];
                      const AgentIcon = currentAgent.icon;
                      return (
                        <div className="flex items-center gap-1 mb-1.5 text-muted-foreground">
                          <AgentIcon className="w-3 h-3" />
                          <span className="text-[10px] font-medium">{currentAgent.name}</span>
                        </div>
                      );
                    })()}
                    <div className="text-sm leading-relaxed">
                      {message.role === "assistant" || message.role === "error"
                        ? renderMarkdown(message.content)
                        : message.content
                      }
                      {message.isStreaming && (
                        <span className="inline-block w-1.5 h-4 bg-foreground/60 animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>
                    {message.role === "user" && message.attachments && (
                      renderMessageAttachments(message.attachments)
                    )}
                    {message.role === "assistant" && message.generatedImages && message.generatedImages.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {message.generatedImages.map((img, idx) => (
                          <div key={idx} className="space-y-1">
                            <button
                              onClick={() => openImageModal(img.url)}
                              className="block w-full rounded-lg overflow-hidden border border-border/50 hover:opacity-90 transition-opacity"
                              data-testid={`generated-image-${idx}`}
                            >
                              <img
                                src={img.url}
                                alt={img.prompt}
                                className="w-full h-auto max-h-[200px] object-contain bg-muted"
                              />
                            </button>
                            <p className="text-[10px] text-muted-foreground italic truncate" title={img.prompt}>
                              "{img.prompt}"
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                    {message.role === "assistant" && !message.isStreaming && (() => {
                      const parsedActions = parseActionsFromText(message.content);
                      if (parsedActions.length === 0) return null;
                      return (
                        <div className="mt-3">
                          <Button
                            size="sm"
                            variant={executionMode === "live" ? "default" : "secondary"}
                            onClick={() => handleExecuteActions(parsedActions, `Executing ${parsedActions.length} actions`)}
                            disabled={isExecutingActions}
                            className="gap-1.5"
                            data-testid={`button-execute-actions-${message.id}`}
                          >
                            {executionMode === "live" ? (
                              <Eye className="w-3.5 h-3.5" />
                            ) : (
                              <Play className="w-3.5 h-3.5" />
                            )}
                            Execute {parsedActions.length} Action{parsedActions.length > 1 ? "s" : ""}
                          </Button>
                        </div>
                      );
                    })()}
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
                      <span className="text-sm text-muted-foreground">Connecting...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>

          <div className="p-3 border-t border-border/50 bg-background/50 backdrop-blur-sm">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2" data-testid="attachments-preview">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="relative group"
                    data-testid={`attachment-preview-${att.id}`}
                  >
                    {att.type === "image" && att.preview ? (
                      <div className="w-14 h-14 rounded-lg overflow-hidden border border-border/50 bg-muted">
                        <img
                          src={att.preview}
                          alt={att.file.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-border/50 bg-muted text-xs">
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                        <div className="flex flex-col min-w-0">
                          <span className="truncate max-w-[80px]">{att.file.name}</span>
                          <span className="text-muted-foreground text-[10px]">
                            {formatFileSize(att.file.size)}
                          </span>
                        </div>
                      </div>
                    )}
                    <button
                      onClick={() => removeAttachment(att.id)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                      data-testid={`button-remove-attachment-${att.id}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {isImageMode && (
              <div className="flex items-center gap-1.5 mb-2">
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Palette className="w-3 h-3" />
                  Image Mode
                </Badge>
                <span className="text-[10px] text-muted-foreground">Your message will generate an image</span>
              </div>
            )}
            <div className="flex items-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleAttachClick}
                    disabled={attachments.length >= MAX_ATTACHMENTS || isImageMode}
                    className="h-[44px] w-[44px] rounded-xl shrink-0"
                    data-testid="button-attach-file"
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isImageMode 
                    ? "Disable image mode to attach files"
                    : attachments.length >= MAX_ATTACHMENTS 
                      ? `Max ${MAX_ATTACHMENTS} attachments` 
                      : "Attach files"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={isImageMode ? "default" : "ghost"}
                    onClick={() => setIsImageMode(!isImageMode)}
                    disabled={isGeneratingImage || isLoading || isStreaming}
                    className={cn(
                      "h-[44px] w-[44px] rounded-xl shrink-0",
                      isImageMode && "bg-primary text-primary-foreground"
                    )}
                    data-testid="button-toggle-image-mode"
                  >
                    <Palette className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isImageMode ? "Disable image generation mode" : "Enable image generation mode"}
                </TooltipContent>
              </Tooltip>
              <Textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isImageMode 
                  ? "Describe the image you want to generate..." 
                  : isTemporaryChat 
                    ? "Ask anything (not saved)..." 
                    : "Ask me anything..."}
                className="min-h-[44px] max-h-[120px] resize-none rounded-xl border-border/50 bg-background/80 text-sm"
                rows={1}
                data-testid="input-assistant-message"
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant={isListening ? "destructive" : "ghost"}
                    onClick={startVoiceInput}
                    disabled={isLoading || isStreaming || isGeneratingImage}
                    className="h-[44px] w-[44px] rounded-xl shrink-0"
                    data-testid="button-voice-input"
                    title="Voice input"
                  >
                    {isListening ? (
                      <MicOff className="w-4 h-4 animate-pulse" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isListening ? "Stop listening" : "Voice input (push to talk)"}
                </TooltipContent>
              </Tooltip>
              <Button
                size="icon"
                onClick={handleSendMessage}
                disabled={(!inputValue.trim() && attachments.length === 0) || isLoading || isStreaming || isGeneratingImage}
                className="h-[44px] w-[44px] rounded-xl shrink-0"
                data-testid="button-send-assistant-message"
              >
                {isLoading || isStreaming || isGeneratingImage ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
            {attachments.length > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1.5 text-center">
                {attachments.length}/{MAX_ATTACHMENTS} files attached
              </div>
            )}
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
            {isTemporaryChat && (
              <Ghost className="w-3.5 h-3.5 text-muted-foreground" />
            )}
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

      <LiveDemoMode
        actions={pendingActions}
        speed={executionSpeed}
        onComplete={handleActionsComplete}
        onCancel={handleActionsCancel}
        onExecutorCreated={registerExecutor}
        onSpeedChange={(newSpeed) => setExecutionSpeed(newSpeed)}
        isActive={executionMode === "live" && isExecutingActions && pendingActions.length > 0}
      />

      <BackgroundMode
        actions={pendingActions}
        taskName={currentTaskName}
        speed={executionSpeed}
        onComplete={handleActionsComplete}
        onError={handleActionsError}
        onExecutorCreated={registerExecutor}
        isActive={executionMode === "background" && isExecutingActions && pendingActions.length > 0}
      />

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
