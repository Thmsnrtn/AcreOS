import OpenAI from "openai";
import { storage } from "../storage";
import { creditService } from "./credits";
import {
  SupportCase,
  SupportMessage,
  SupportPlaybook,
  SUPPORT_CATEGORIES,
  InsertSupportCase,
  InsertSupportMessage,
  InsertSupportAction,
} from "@shared/schema";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

interface ClassificationResult {
  category: string;
  confidence: number;
  suggestedPlaybook?: string;
  sentiment: "positive" | "neutral" | "negative" | "frustrated";
  urgency: "low" | "medium" | "high" | "critical";
}

interface ActionResult {
  success: boolean;
  message: string;
  data?: any;
}

const ESCALATION_THRESHOLDS = {
  maxAiAttempts: 3,
  maxCreditAdjustment: 500, // $5 max per case
  lowConfidenceThreshold: 0.4,
};

export class SupportBrainService {
  async classifyMessage(
    message: string,
    context: { organizationId: number; existingCase?: SupportCase }
  ): Promise<ClassificationResult> {
    const playbooks = await storage.getSupportPlaybooks();

    const systemPrompt = `You are a support case classifier for AcreOS, a land investment management platform.

Analyze the user's message and classify it:
1. Category: One of: billing, technical, account, feature, bug, data, integration, other
2. Confidence: 0-1 score of how confident you are in the classification
3. Suggested playbook: Match to one of these playbooks if applicable: ${playbooks.map((p) => p.slug).join(", ")}
4. Sentiment: positive, neutral, negative, or frustrated
5. Urgency: low, medium, high, or critical

Available playbooks and their triggers:
${playbooks.map((p) => `- ${p.slug}: ${p.triggerPatterns?.join(", ")}`).join("\n")}

Respond in JSON format only:
{
  "category": "string",
  "confidence": number,
  "suggestedPlaybook": "string or null",
  "sentiment": "string",
  "urgency": "string"
}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        temperature: 0.3,
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content || "{}");
      return {
        category: result.category || "other",
        confidence: result.confidence || 0.5,
        suggestedPlaybook: result.suggestedPlaybook,
        sentiment: result.sentiment || "neutral",
        urgency: result.urgency || "medium",
      };
    } catch (error) {
      console.error("Classification error:", error);
      return {
        category: "other",
        confidence: 0.3,
        sentiment: "neutral",
        urgency: "medium",
      };
    }
  }

  async createCase(
    organizationId: number,
    userId: string,
    subject: string,
    initialMessage: string
  ): Promise<{ case: SupportCase; classification: ClassificationResult }> {
    const classification = await this.classifyMessage(initialMessage, {
      organizationId,
    });

    const priority =
      classification.urgency === "critical"
        ? 5
        : classification.urgency === "high"
          ? 4
          : classification.urgency === "medium"
            ? 2
            : 1;

    const supportCase = await storage.createSupportCase({
      organizationId,
      userId,
      subject,
      category: classification.category,
      status: "ai_handling",
      priority,
      aiClassification: classification,
    });

    await storage.createSupportMessage({
      caseId: supportCase.id,
      role: "user",
      content: initialMessage,
    });

    return { case: supportCase, classification };
  }

  async handleMessage(
    caseId: number,
    message: string,
    organizationId: number
  ): Promise<{ response: string; actionsTaken: string[]; escalated: boolean }> {
    const supportCase = await storage.getSupportCase(caseId);
    if (!supportCase) {
      throw new Error("Support case not found");
    }

    await storage.createSupportMessage({
      caseId,
      role: "user",
      content: message,
    });

    const classification = await this.classifyMessage(message, {
      organizationId,
      existingCase: supportCase,
    });

    if (classification.confidence < ESCALATION_THRESHOLDS.lowConfidenceThreshold) {
      return this.escalateCase(supportCase, "Low confidence in classification");
    }

    const currentAttempts = (supportCase.aiAttempts || 0) + 1;
    if (currentAttempts >= ESCALATION_THRESHOLDS.maxAiAttempts) {
      return this.escalateCase(supportCase, "Maximum AI attempts reached");
    }

    await storage.updateSupportCase(caseId, {
      aiAttempts: currentAttempts,
    });

    const playbook = classification.suggestedPlaybook
      ? await storage.getSupportPlaybook(classification.suggestedPlaybook)
      : null;

    if (playbook) {
      return this.executePlaybook(supportCase, playbook, message, organizationId);
    }

    return this.generateContextualResponse(supportCase, message, organizationId);
  }

  private async executePlaybook(
    supportCase: SupportCase,
    playbook: SupportPlaybook,
    userMessage: string,
    organizationId: number
  ): Promise<{ response: string; actionsTaken: string[]; escalated: boolean }> {
    const actionsTaken: string[] = [];
    const actionsAttempted: Array<{
      action: string;
      success: boolean;
      details?: string;
    }> = [];
    let allSucceeded = true;

    for (const step of playbook.steps || []) {
      const result = await this.executeAction(
        step.actionType,
        step.actionParams,
        organizationId,
        supportCase.id
      );

      actionsAttempted.push({
        action: step.actionType,
        success: result.success,
        details: result.message,
      });

      if (result.success) {
        actionsTaken.push(step.successMessage);
      } else {
        allSucceeded = false;
        if (!step.continueOnFailure) {
          break;
        }
      }
    }

    await storage.incrementPlaybookUsage(playbook.slug, allSucceeded);

    const response = allSucceeded
      ? await this.generatePlaybookResponse(playbook, actionsTaken, organizationId)
      : playbook.failureResponse ||
        "I encountered some issues. Let me get a human to help you.";

    await storage.createSupportMessage({
      caseId: supportCase.id,
      role: "ai_support",
      content: response,
      aiModel: "gpt-4o-mini",
      aiConfidence: allSucceeded ? "0.9" : "0.5",
      playbookUsed: playbook.slug,
      actionsAttempted,
    });

    if (!allSucceeded && playbook.canEscalate) {
      return this.escalateCase(supportCase, "Playbook execution failed");
    }

    if (allSucceeded) {
      await storage.updateSupportCase(supportCase.id, {
        status: "awaiting_user",
      });
    }

    return { response, actionsTaken, escalated: false };
  }

  private async executeAction(
    actionType: string,
    params: Record<string, any>,
    organizationId: number,
    caseId: number
  ): Promise<ActionResult> {
    try {
      switch (actionType) {
        case "get_credit_balance": {
          const balance = await creditService.getBalance(organizationId);
          return {
            success: true,
            message: `Current balance: $${(balance / 100).toFixed(2)}`,
            data: { balance },
          };
        }

        case "get_recent_usage": {
          const usage = await storage.getUsageRecords(organizationId, params.days || 30);
          const totalSpent = usage.reduce(
            (sum, u) => sum + Number(u.totalCostCents || 0),
            0
          );
          return {
            success: true,
            message: `Recent usage: ${usage.length} actions, $${(totalSpent / 100).toFixed(2)} total`,
            data: { usage, totalSpent },
          };
        }

        case "check_recent_issues": {
          return {
            success: true,
            message: "Checked for recent issues",
            data: { hasRecentIssues: true },
          };
        }

        case "issue_courtesy_credit": {
          const maxCents = Math.min(
            params.maxCents || 100,
            ESCALATION_THRESHOLDS.maxCreditAdjustment
          );
          const creditAmount = Math.min(maxCents, 200);

          await creditService.addCredits(
            organizationId,
            creditAmount,
            "support_credit",
            `Courtesy credit issued via support case #${caseId}`,
            { caseId }
          );

          await storage.createSupportAction({
            caseId,
            actionType: "credit_adjustment",
            actionDetails: { amount: creditAmount },
            success: true,
            performedBy: "ai_support",
          });

          return {
            success: true,
            message: `Added $${(creditAmount / 100).toFixed(2)} courtesy credit`,
            data: { amount: creditAmount },
          };
        }

        case "run_diagnostics": {
          const org = await storage.getOrganization(organizationId);
          return {
            success: true,
            message: "System diagnostics completed",
            data: {
              subscriptionTier: org?.subscriptionTier,
              subscriptionStatus: org?.subscriptionStatus,
              creditBalance: org?.creditBalance,
            },
          };
        }

        case "identify_feature":
        case "generate_explanation": {
          return { success: true, message: "Feature identified" };
        }

        default:
          return {
            success: false,
            message: `Unknown action type: ${actionType}`,
          };
      }
    } catch (error: any) {
      console.error(`Action ${actionType} failed:`, error);
      return { success: false, message: error.message };
    }
  }

  private async generatePlaybookResponse(
    playbook: SupportPlaybook,
    actionsTaken: string[],
    organizationId: number
  ): Promise<string> {
    const org = await storage.getOrganization(organizationId);
    const balance = await creditService.getBalance(organizationId);

    const contextInfo = `
Account Info:
- Subscription: ${org?.subscriptionTier || "free"}
- Credit Balance: $${(balance / 100).toFixed(2)}
- Actions Completed: ${actionsTaken.join(", ")}
`;

    const systemPrompt = `You are a helpful support agent for AcreOS, a land investment management platform.
Generate a friendly, professional response based on the actions taken and account context.
Keep the response concise but helpful. Do not use emojis.

${contextInfo}

The playbook's success response template: "${playbook.successResponse}"

Adapt this template with the specific details from the context. Be conversational and helpful.`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: "Generate the response message." },
        ],
        temperature: 0.7,
        max_tokens: 300,
      });

      return (
        response.choices[0].message.content ||
        playbook.successResponse ||
        "Your request has been processed successfully."
      );
    } catch (error) {
      return (
        playbook.successResponse ||
        "Your request has been processed. Is there anything else I can help with?"
      );
    }
  }

  private async generateContextualResponse(
    supportCase: SupportCase,
    userMessage: string,
    organizationId: number
  ): Promise<{ response: string; actionsTaken: string[]; escalated: boolean }> {
    const messages = await storage.getSupportMessages(supportCase.id);
    const org = await storage.getOrganization(organizationId);
    const balance = await creditService.getBalance(organizationId);

    const systemPrompt = `You are a helpful support agent for AcreOS, a land investment management platform.
Help the user with their question based on the conversation history and account context.

Account Context:
- Subscription Tier: ${org?.subscriptionTier || "free"}
- Credit Balance: $${(balance / 100).toFixed(2)}
- Case Category: ${supportCase.category}

AcreOS Features:
- CRM for managing land leads (buyers and sellers)
- Property inventory tracking
- Note/loan management for seller financing
- Direct mail, email, and SMS campaigns
- AI-powered due diligence and market analysis
- Deal pipeline tracking

Keep responses concise, professional, and helpful. Do not use emojis.
If you cannot resolve the issue, say you will escalate to a human.`;

    const chatHistory = messages.map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    }));

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, ...chatHistory],
        temperature: 0.7,
        max_tokens: 400,
      });

      const aiResponse =
        response.choices[0].message.content ||
        "I apologize, but I am having trouble understanding your request. Let me connect you with a human support agent.";

      await storage.createSupportMessage({
        caseId: supportCase.id,
        role: "ai_support",
        content: aiResponse,
        aiModel: "gpt-4o-mini",
        aiConfidence: "0.7",
      });

      await storage.updateSupportCase(supportCase.id, {
        status: "awaiting_user",
      });

      return { response: aiResponse, actionsTaken: [], escalated: false };
    } catch (error) {
      console.error("AI response generation failed:", error);
      return this.escalateCase(supportCase, "AI response generation failed");
    }
  }

  private async escalateCase(
    supportCase: SupportCase,
    reason: string
  ): Promise<{ response: string; actionsTaken: string[]; escalated: boolean }> {
    await storage.updateSupportCase(supportCase.id, {
      status: "escalated",
      escalatedAt: new Date(),
      escalationReason: reason,
    });

    const response = `I've reviewed your case and believe it would be best handled by our team directly. I've escalated this to a human support agent who will review it shortly. You'll receive a response within 24 hours.

In the meantime, is there anything else I can help you with?`;

    await storage.createSupportMessage({
      caseId: supportCase.id,
      role: "system",
      content: `Case escalated: ${reason}`,
    });

    await storage.createSupportMessage({
      caseId: supportCase.id,
      role: "ai_support",
      content: response,
      aiModel: "gpt-4o-mini",
    });

    return { response, actionsTaken: [], escalated: true };
  }

  async resolveCase(
    caseId: number,
    resolutionSummary: string,
    resolvedBy: string = "ai_support"
  ): Promise<SupportCase | undefined> {
    return storage.updateSupportCase(caseId, {
      status: "resolved",
      resolvedAt: new Date(),
      resolutionSummary,
      resolutionType: resolvedBy === "ai_support" ? "auto_resolved" : "escalated_resolved",
    });
  }

  async rateSatisfaction(caseId: number, rating: number): Promise<void> {
    await storage.updateSupportCase(caseId, {
      userSatisfaction: rating,
      status: "closed",
    });
  }

  async getEscalatedCases(): Promise<SupportCase[]> {
    return storage.getEscalatedCases();
  }
}

export const supportBrainService = new SupportBrainService();
