import { useRef, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Pen, Type, RotateCcw, Check, Download } from "lucide-react";
import { cn } from "@/lib/utils";

interface SignatureCaptureProps {
  onSignatureCapture: (signatureData: {
    data: string;
    type: "drawn" | "typed";
    signerName: string;
  }) => void;
  signerName?: string;
  consentText?: string;
  className?: string;
  disabled?: boolean;
}

export function SignatureCapture({
  onSignatureCapture,
  signerName: initialSignerName = "",
  consentText = "I agree that this electronic signature is legally binding and has the same legal effect as a handwritten signature.",
  className,
  disabled = false,
}: SignatureCaptureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureType, setSignatureType] = useState<"drawn" | "typed">("drawn");
  const [typedSignature, setTypedSignature] = useState("");
  const [signerName, setSignerName] = useState(initialSignerName);
  const [consentGiven, setConsentGiven] = useState(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const getCanvasContext = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d");
  }, []);

  const initializeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1a1a1a";
  }, []);

  useEffect(() => {
    initializeCanvas();
    
    const handleResize = () => {
      if (hasSignature) return;
      initializeCanvas();
    };
    
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [initializeCanvas, hasSignature]);

  const getPointerPosition = (e: MouseEvent | TouchEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    
    if ("touches" in e) {
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    }
    
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (e: MouseEvent | TouchEvent) => {
    if (disabled) return;
    
    const ctx = getCanvasContext();
    if (!ctx) return;
    
    setIsDrawing(true);
    const pos = getPointerPosition(e);
    lastPointRef.current = pos;
    
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: MouseEvent | TouchEvent) => {
    if (!isDrawing || disabled) return;
    
    const ctx = getCanvasContext();
    if (!ctx || !lastPointRef.current) return;
    
    const pos = getPointerPosition(e);
    
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    
    lastPointRef.current = pos;
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    lastPointRef.current = null;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = getCanvasContext();
    if (!canvas || !ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    initializeCanvas();
  };

  const generateTypedSignature = (): string => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 100;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.font = "italic 36px 'Georgia', 'Times New Roman', serif";
    ctx.fillStyle = "#1a1a1a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(typedSignature || signerName, canvas.width / 2, canvas.height / 2);
    
    return canvas.toDataURL("image/png");
  };

  const getSignatureData = (): string => {
    if (signatureType === "typed") {
      return generateTypedSignature();
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return "";
    
    return canvas.toDataURL("image/png");
  };

  const handleSubmit = () => {
    if (!consentGiven || !signerName.trim()) return;
    
    if (signatureType === "drawn" && !hasSignature) return;
    if (signatureType === "typed" && !typedSignature.trim()) return;
    
    const signatureData = getSignatureData();
    
    onSignatureCapture({
      data: signatureData,
      type: signatureType,
      signerName: signerName.trim(),
    });
  };

  const canSubmit = 
    consentGiven && 
    signerName.trim() && 
    ((signatureType === "drawn" && hasSignature) || 
     (signatureType === "typed" && typedSignature.trim()));

  return (
    <Card className={cn("w-full max-w-lg", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pen className="h-5 w-5" />
          Electronic Signature
        </CardTitle>
        <CardDescription>
          Sign using your finger, stylus, or mouse
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="signer-name">Full Legal Name</Label>
          <Input
            id="signer-name"
            data-testid="input-signer-name"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Enter your full legal name"
            disabled={disabled}
          />
        </div>

        <Tabs value={signatureType} onValueChange={(v) => setSignatureType(v as "drawn" | "typed")}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="drawn" data-testid="tab-draw-signature">
              <Pen className="h-4 w-4 mr-2" />
              Draw
            </TabsTrigger>
            <TabsTrigger value="typed" data-testid="tab-type-signature">
              <Type className="h-4 w-4 mr-2" />
              Type
            </TabsTrigger>
          </TabsList>

          <TabsContent value="drawn" className="space-y-3">
            <div className="relative">
              <canvas
                ref={canvasRef}
                className="w-full h-32 border rounded-md bg-white cursor-crosshair touch-none"
                style={{ touchAction: "none" }}
                data-testid="canvas-signature"
                onMouseDown={(e) => startDrawing(e.nativeEvent)}
                onMouseMove={(e) => draw(e.nativeEvent)}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={(e) => {
                  e.preventDefault();
                  startDrawing(e.nativeEvent);
                }}
                onTouchMove={(e) => {
                  e.preventDefault();
                  draw(e.nativeEvent);
                }}
                onTouchEnd={stopDrawing}
              />
              {!hasSignature && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground">
                  Sign here
                </div>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={clearSignature}
              disabled={!hasSignature || disabled}
              data-testid="button-clear-signature"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Clear
            </Button>
          </TabsContent>

          <TabsContent value="typed" className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="typed-signature">Type Your Signature</Label>
              <Input
                id="typed-signature"
                data-testid="input-typed-signature"
                value={typedSignature}
                onChange={(e) => setTypedSignature(e.target.value)}
                placeholder={signerName || "Your signature"}
                className="font-serif italic text-xl"
                disabled={disabled}
              />
            </div>
            {typedSignature && (
              <div className="p-4 border rounded-md bg-white">
                <p className="font-serif italic text-2xl text-center text-foreground">
                  {typedSignature}
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex items-start gap-3 pt-2">
          <Checkbox
            id="consent"
            data-testid="checkbox-consent"
            checked={consentGiven}
            onCheckedChange={(checked) => setConsentGiven(checked === true)}
            disabled={disabled}
          />
          <Label htmlFor="consent" className="text-sm text-muted-foreground leading-relaxed">
            {consentText}
          </Label>
        </div>

        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={!canSubmit || disabled}
          data-testid="button-submit-signature"
        >
          <Check className="h-4 w-4 mr-2" />
          Apply Signature
        </Button>
      </CardContent>
    </Card>
  );
}

interface SignatureDisplayProps {
  signatureData: string;
  signerName: string;
  signedAt?: Date | string;
  className?: string;
}

export function SignatureDisplay({
  signatureData,
  signerName,
  signedAt,
  className,
}: SignatureDisplayProps) {
  const formattedDate = signedAt 
    ? new Date(signedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className={cn("border rounded-md p-4 bg-muted/30", className)}>
      <div className="flex flex-col items-center gap-2">
        <img 
          src={signatureData} 
          alt={`Signature of ${signerName}`}
          className="max-h-16 w-auto"
          data-testid="img-signature-display"
        />
        <div className="border-t w-48 pt-2 text-center">
          <p className="font-medium text-sm" data-testid="text-signer-name">{signerName}</p>
          {formattedDate && (
            <p className="text-xs text-muted-foreground" data-testid="text-signed-date">
              Signed: {formattedDate}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function downloadSignatureImage(signatureData: string, fileName: string = "signature.png") {
  const link = document.createElement("a");
  link.href = signatureData;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
