import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent } from "@/components/ui/dialog";
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
  Image as ImageIcon
} from "lucide-react";
import { cn } from "@/lib/utils";

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

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  attachments?: MessageAttachment[];
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

export function FloatingAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasActivity, setHasActivity] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dragCounterRef = useRef(0);

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
        body: JSON.stringify({ agentRole: "executive" }),
      });
      
      if (response.ok) {
        const data = await response.json();
        return data.id;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

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

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && attachments.length === 0) || isLoading || isStreaming) return;

    const messageAttachments: MessageAttachment[] = [];
    
    for (const att of attachments) {
      const base64 = att.type === "image" ? await fileToBase64(att.file) : undefined;
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
      
      const response = await fetch("/api/ai/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage.content,
          conversationId: isTemporaryChat ? undefined : activeConversationId,
          agentRole: "executive",
          images: imageContents.length > 0 ? imageContents : undefined,
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
                
                if (data.type === "content" && data.chunk) {
                  accumulatedContent += data.chunk;
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
                      ? { ...msg, role: "error" as const, content: data.error || "An error occurred", isStreaming: false }
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

  const openImageModal = (imageSrc: string) => {
    setSelectedImage(imageSrc);
    setImageModalOpen(true);
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
    <div className="fixed z-50 bottom-36 right-4 md:bottom-24 md:right-6" data-testid="floating-assistant-container">
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
            "absolute bottom-16 right-0 mb-2",
            "w-[360px] md:w-[400px] h-[500px] md:h-[600px]",
            "glass-panel floating-window rounded-2xl overflow-hidden",
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
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-white via-primary/20 to-primary/40 flex items-center justify-center shadow-lg">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
                {isStreaming && (
                  <div className="absolute inset-0 rounded-full bg-primary/30 animate-ping" />
                )}
              </div>
              <div className="flex flex-col">
                <h3 className="font-semibold text-foreground text-sm leading-tight">AI Assistant</h3>
                {isTemporaryChat && (
                  <div className="flex items-center gap-1">
                    <Ghost className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Temporary</span>
                  </div>
                )}
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
                  <p className="text-muted-foreground text-xs mt-2">
                    Attach images or documents for visual analysis
                  </p>
                  {isTemporaryChat && (
                    <Badge variant="secondary" className="mt-3 gap-1">
                      <Ghost className="w-3 h-3" />
                      Temporary Mode
                    </Badge>
                  )}
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
            
            <div className="flex items-end gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={handleAttachClick}
                    disabled={attachments.length >= MAX_ATTACHMENTS}
                    className="h-[44px] w-[44px] rounded-xl shrink-0"
                    data-testid="button-attach-file"
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {attachments.length >= MAX_ATTACHMENTS 
                    ? `Max ${MAX_ATTACHMENTS} attachments` 
                    : "Attach files"}
                </TooltipContent>
              </Tooltip>
              <Textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isTemporaryChat ? "Ask anything (not saved)..." : "Ask me anything..."}
                className="min-h-[44px] max-h-[120px] resize-none rounded-xl border-border/50 bg-background/80 text-sm"
                rows={1}
                data-testid="input-assistant-message"
              />
              <Button
                size="icon"
                onClick={handleSendMessage}
                disabled={(!inputValue.trim() && attachments.length === 0) || isLoading || isStreaming}
                className="h-[44px] w-[44px] rounded-xl shrink-0"
                data-testid="button-send-assistant-message"
              >
                {isLoading || isStreaming ? (
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
