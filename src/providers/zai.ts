/**
 * KendaliAI zai Provider
 *
 * zai provider implementation using AI SDK (OpenAI-compatible).
 */

import { createOpenAI } from "@ai-sdk/openai";
import { generateText, embedMany } from "ai";
import type {
  ProviderInstance,
  ModelInfo,
  ChatMessage,
  ChatCompletionResponse,
  EmbeddingResponse,
} from "./types";

// zai models
const ZAI_MODELS: ModelInfo[] = [
  {
    id: "glm-5",
    name: "GLM-5",
    type: "chat",
    contextLength: 128000,
    pricing: { input: 1.0, output: 0.2 },
  },
  {
    id: "glm-5-code",
    name: "GLM-5 Code",
    type: "chat",
    contextLength: 128000,
    pricing: { input: 1.2, output: 0.3 },
  },
  {
    id: "glm-4.7",
    name: "GLM-4.7",
    type: "chat",
    contextLength: 128000,
    pricing: { input: 0.6, output: 0.11 },
  },
  {
    id: "glm-4.7-flashx",
    name: "GLM-4.7 FlashX",
    type: "chat",
    contextLength: 128000,
    pricing: { input: 0.07, output: 0.01 },
  },
];

export interface ZaiConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

/**
 * Create a zai provider instance
 */
export function createZaiProvider(config: ZaiConfig): ProviderInstance {
  const apiKey = config.apiKey;
  const baseURL = config.baseURL || "https://api.zai.ai/v1";
  const defaultModel = config.defaultModel || "glm-4.7-flashx";

  // Create OpenAI-compatible client
  const openai = createOpenAI({
    apiKey,
    baseURL,
  });

  return {
    name: "zai",
    type: "zai",

    isConfigured(): boolean {
      return Boolean(apiKey && apiKey.length > 0);
    },

    getModel(modelId?: string) {
      return openai(modelId || defaultModel);
    },

    listModels(): ModelInfo[] {
      return ZAI_MODELS;
    },

    async chat(
      prompt: string,
      options?: { systemPrompt?: string },
    ): Promise<string> {
      const model = openai(defaultModel);
      const messages: Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }> = [];

      if (options?.systemPrompt) {
        messages.push({ role: "system", content: options.systemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      const result = await generateText({
        model,
        messages,
      });

      return result.text;
    },

    async chatCompletion(
      messages: ChatMessage[],
      _options?: { temperature?: number; maxTokens?: number },
    ): Promise<ChatCompletionResponse> {
      const model = openai(defaultModel);

      const result = await generateText({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      return {
        content: result.text,
        usage: {
          promptTokens: result.usage?.inputTokens ?? 0,
          completionTokens: result.usage?.outputTokens ?? 0,
        },
        finishReason: result.finishReason as
          | "stop"
          | "length"
          | "content_filter"
          | undefined,
      };
    },

    async embeddings(input: string): Promise<EmbeddingResponse> {
      const embeddingModel = openai.embedding("text-embedding-3-small");

      const result = await embedMany({
        model: embeddingModel,
        values: [input],
      });

      return {
        embedding: result.embeddings[0] ?? [],
        usage: {
          promptTokens: result.usage?.tokens ?? 0,
        },
      };
    },
  };
}

/**
 * Default zai provider (unconfigured)
 */
export const zaiProvider: ProviderInstance = {
  name: "zai",
  type: "zai",

  isConfigured(): boolean {
    return false;
  },

  getModel(): never {
    throw new Error("zai provider not configured. Please set ZAI_API_KEY.");
  },

  listModels(): ModelInfo[] {
    return ZAI_MODELS;
  },

  async chat(): Promise<never> {
    throw new Error("zai provider not configured. Please set ZAI_API_KEY.");
  },

  async chatCompletion(): Promise<never> {
    throw new Error("zai provider not configured. Please set ZAI_API_KEY.");
  },

  async embeddings(): Promise<never> {
    throw new Error("zai provider not configured. Please set ZAI_API_KEY.");
  },
};
