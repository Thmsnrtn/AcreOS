import OpenAI from "openai";

let openaiClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI | null {
  if (!openaiClient) {
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) {
      return null;
    }
    openaiClient = new OpenAI({
      apiKey,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return openaiClient;
}

export function requireOpenAIClient(): OpenAI {
  const client = getOpenAIClient();
  if (!client) {
    throw new Error("OpenAI client not available - AI_INTEGRATIONS_OPENAI_API_KEY not configured");
  }
  return client;
}
