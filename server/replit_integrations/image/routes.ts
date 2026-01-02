import type { Express, Request, Response } from "express";
import { openai } from "./client";
import { usageMeteringService, creditService } from "../../services/credits";
import { storage } from "../../storage";

async function getOrganizationFromRequest(req: Request): Promise<{ id: number } | null> {
  if (!req.user) return null;
  const user = req.user as any;
  const userId = user.claims?.sub || user.id;
  if (!userId) return null;
  const org = await storage.getOrganizationByOwner(userId);
  return org;
}

export function registerImageRoutes(app: Express): void {
  app.post("/api/generate-image", async (req: Request, res: Response) => {
    try {
      const { prompt, size = "1024x1024" } = req.body;

      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

      // Get organization for credit checks if user is authenticated
      const org = await getOrganizationFromRequest(req);
      
      if (org) {
        // Credit pre-check for AI image generation (25 cents per image)
        const aiImageCost = await usageMeteringService.calculateCost("ai_image", 1);
        const hasCredits = await creditService.hasEnoughCredits(org.id, aiImageCost);
        if (!hasCredits) {
          const balance = await creditService.getBalance(org.id);
          return res.status(402).json({
            error: "Insufficient credits",
            required: aiImageCost / 100,
            balance: balance / 100,
          });
        }
      }

      const response = await openai.images.generate({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: size as "1024x1024" | "512x512" | "256x256",
      });

      const imageData = response.data[0];
      
      // Record usage after successful image generation
      if (org) {
        await usageMeteringService.recordUsage(org.id, "ai_image", 1, {
          prompt: prompt.substring(0, 100),
          size,
        });
      }
      
      res.json({
        url: imageData.url,
        b64_json: imageData.b64_json,
      });
    } catch (error) {
      console.error("Error generating image:", error);
      res.status(500).json({ error: "Failed to generate image" });
    }
  });
}

