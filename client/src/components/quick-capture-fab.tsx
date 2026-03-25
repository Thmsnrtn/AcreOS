import { useState, useRef } from "react";
import { Camera, Plus, X, Loader2, UserPlus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMobile } from "@/hooks/use-mobile";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { fadeInUp } from "@/lib/animations";

interface QuickCaptureResult {
  lead?: { id: number; firstName?: string; phone?: string };
  extracted: { phone?: string; name?: string; address?: string };
  imageAttached: boolean;
}

export function QuickCaptureFab() {
  const { isMobile } = useMobile();
  const [open, setOpen] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const captureMutation = useMutation<QuickCaptureResult, Error, string>({
    mutationFn: async (base64Image: string) => {
      const res = await fetch("/api/leads/quick-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Image }),
      });
      if (!res.ok) throw new Error("Capture failed");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      if (data.extracted?.phone) {
        toast({
          title: `Found: ${data.extracted.phone}`,
          description: "Lead created with captured info.",
        });
        setOpen(false);
        setCapturedImage(null);
      }
    },
  });

  if (!isMobile) return null;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setCapturedImage(reader.result as string);
      captureMutation.mutate(base64);
    };
    reader.readAsDataURL(file);
  }

  function handleRetry() {
    setCapturedImage(null);
    captureMutation.reset();
    fileInputRef.current?.click();
  }

  const failed = captureMutation.isError || (captureMutation.isSuccess && !captureMutation.data?.extracted?.phone);

  return (
    <>
      {/* FAB */}
      <motion.div
        className="fixed bottom-20 right-4 z-50"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
      >
        <Button
          size="lg"
          className="rounded-full h-14 w-14 shadow-lg"
          onClick={() => {
            setOpen(true);
            setTimeout(() => fileInputRef.current?.click(), 100);
          }}
          aria-label="Quick capture lead"
        >
          <Camera className="h-6 w-6" />
        </Button>
      </motion.div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Quick Capture</DialogTitle>
          </DialogHeader>

          <AnimatePresence mode="wait">
            {captureMutation.isPending && (
              <motion.div key="loading" {...fadeInUp} className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Reading sign...</p>
                {capturedImage && (
                  <img src={capturedImage} alt="Captured" className="w-32 h-32 object-cover rounded-lg" />
                )}
              </motion.div>
            )}

            {failed && (
              <motion.div key="failed" {...fadeInUp} className="flex flex-col items-center gap-3 py-6">
                <p className="text-sm text-muted-foreground text-center">
                  We couldn't read the sign clearly.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleRetry}>
                    <RotateCcw className="h-4 w-4 mr-1" />
                    Try Again
                  </Button>
                  <Button
                    variant="default"
                    onClick={() => {
                      setOpen(false);
                      window.location.href = "/leads?action=create";
                    }}
                  >
                    <UserPlus className="h-4 w-4 mr-1" />
                    Create Lead Manually
                  </Button>
                </div>
              </motion.div>
            )}

            {captureMutation.isSuccess && captureMutation.data?.extracted?.phone && (
              <motion.div key="success" {...fadeInUp} className="flex flex-col items-center gap-3 py-6">
                <div className="text-center space-y-1">
                  <p className="text-sm font-medium">Found: {captureMutation.data.extracted.phone}</p>
                  {captureMutation.data.extracted.name && (
                    <p className="text-xs text-muted-foreground">{captureMutation.data.extracted.name}</p>
                  )}
                  {captureMutation.data.extracted.address && (
                    <p className="text-xs text-muted-foreground">{captureMutation.data.extracted.address}</p>
                  )}
                </div>
                <Button
                  onClick={() => {
                    setOpen(false);
                    setCapturedImage(null);
                    captureMutation.reset();
                  }}
                >
                  <UserPlus className="h-4 w-4 mr-1" />
                  View Lead
                </Button>
              </motion.div>
            )}

            {!captureMutation.isPending && !captureMutation.isSuccess && !captureMutation.isError && (
              <motion.div key="idle" {...fadeInUp} className="flex flex-col items-center gap-3 py-6">
                <Camera className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm text-muted-foreground text-center">
                  Photograph a "For Sale" sign to capture lead info automatically.
                </p>
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Camera className="h-4 w-4 mr-1" />
                  Open Camera
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </>
  );
}
