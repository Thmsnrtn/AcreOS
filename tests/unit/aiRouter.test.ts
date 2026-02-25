import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyTaskComplexity,
  classifyFromMessages,
  TaskComplexity,
} from "../../server/services/aiRouter";

describe("AI Router - Task Complexity Classification", () => {
  describe("classifyTaskComplexity", () => {
    it("classifies simple tasks", () => {
      expect(classifyTaskComplexity("summarize")).toBe(TaskComplexity.SIMPLE);
      expect(classifyTaskComplexity("extract_data")).toBe(TaskComplexity.SIMPLE);
      expect(classifyTaskComplexity("draft_email")).toBe(TaskComplexity.SIMPLE);
      expect(classifyTaskComplexity("categorize")).toBe(TaskComplexity.SIMPLE);
      expect(classifyTaskComplexity("simple_qa")).toBe(TaskComplexity.SIMPLE);
    });

    it("classifies complex tasks", () => {
      expect(classifyTaskComplexity("deal_analysis")).toBe(TaskComplexity.COMPLEX);
      expect(classifyTaskComplexity("legal_document")).toBe(TaskComplexity.COMPLEX);
      expect(classifyTaskComplexity("negotiation_strategy")).toBe(TaskComplexity.COMPLEX);
      expect(classifyTaskComplexity("risk_assessment")).toBe(TaskComplexity.COMPLEX);
      expect(classifyTaskComplexity("financial_modeling")).toBe(TaskComplexity.COMPLEX);
    });

    it("uses content length for unknown task types", () => {
      expect(classifyTaskComplexity("unknown_task", 100)).toBe(TaskComplexity.SIMPLE);
      expect(classifyTaskComplexity("unknown_task", 1500)).toBe(TaskComplexity.MODERATE);
      expect(classifyTaskComplexity("unknown_task", 5000)).toBe(TaskComplexity.COMPLEX);
    });

    it("defaults to MODERATE for unknown tasks without length", () => {
      expect(classifyTaskComplexity("unknown_task")).toBe(TaskComplexity.MODERATE);
    });
  });

  describe("classifyFromMessages", () => {
    it("detects complex patterns in message content", () => {
      const messages = [
        { role: "user", content: "Analyze multiple properties and compare options for the best deal" },
      ];
      expect(classifyFromMessages("general", messages)).toBe(TaskComplexity.COMPLEX);
    });

    it("promotes to COMPLEX when file attachments present with action indicators", () => {
      const messages = [
        { role: "user", content: "Import these properties from the attached file" },
      ];
      expect(classifyFromMessages("general", messages, true)).toBe(TaskComplexity.COMPLEX);
    });

    it("promotes to COMPLEX when file content markers detected", () => {
      const messages = [
        { role: "user", content: "Process this --- File: inventory.csv" },
      ];
      expect(classifyFromMessages("general", messages)).toBe(TaskComplexity.COMPLEX);
    });

    it("classifies simple greetings", () => {
      const messages = [
        { role: "user", content: "Hello" },
      ];
      expect(classifyFromMessages("greeting", messages)).toBe(TaskComplexity.SIMPLE);
    });
  });
});

describe("AI Router - Caching", () => {
  let clearAICache: any;
  let getAICacheStats: any;

  beforeEach(async () => {
    const mod = await import("../../server/services/aiRouter");
    clearAICache = mod.clearAICache;
    getAICacheStats = mod.getAICacheStats;
    clearAICache();
  });

  it("starts with empty cache", () => {
    const stats = getAICacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it("has reasonable defaults", () => {
    const stats = getAICacheStats();
    expect(stats.maxSize).toBe(500);
    expect(stats.ttlMs).toBe(15 * 60 * 1000);
  });
});
