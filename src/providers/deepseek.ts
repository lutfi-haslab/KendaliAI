/**
 * KendaliAI DeepSeek Provider
 *
 * DeepSeek provider implementation using AI SDK (OpenAI-compatible).
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

// DeepSeek models
const DEEPSEEK_MODELS: ModelInfo[] = [
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    type: "chat",
    contextLength: 64000,
    pricing: { input: 0.00014, output: 0.00028 },
  },
  {
    id: "deepseek-coder",
    name: "DeepSeek Coder",
    type: "chat",
    contextLength: 64000,
    pricing: { input: 0.00014, output: 0.00028 },
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    type: "chat",
    contextLength: 64000,
    pricing: { input: 0.00055, output: 0.0001 },
  },
];

export interface DeepSeekConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

/**
 * Create a DeepSeek provider instance
 */
export function createDeepSeekProvider(
  config: DeepSeekConfig,
): ProviderInstance {
  const apiKey = config.apiKey;
  const baseURL = config.baseURL || "https://api.deepseek.com/v1";
  const defaultModel = config.defaultModel || "deepseek-chat";

  // Create OpenAI-compatible client
  const openai = createOpenAI({
    apiKey,
    baseURL,
  });

  return {
    name: "deepseek",
    type: "deepseek",

    isConfigured(): boolean {
      return Boolean(apiKey && apiKey.length > 0);
    },

    getModel(modelId?: string) {
      return openai(modelId || defaultModel);
    },

    listModels(): ModelInfo[] {
      return DEEPSEEK_MODELS;
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
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
 * Default DeepSeek provider (unconfigured)
 */
export const deepseekProvider: ProviderInstance = {
  name: "deepseek",
  type: "deepseek",

  isConfigured(): boolean {
    return false;
  },

  getModel(): never {
    throw new Error(
      "DeepSeek provider not configured. Please set DEEPSEEK_API_KEY.",
    );
  },

  listModels(): ModelInfo[] {
    return DEEPSEEK_MODELS;
  },

  async chat(): Promise<never> {
    throw new Error(
      "DeepSeek provider not configured. Please set DEEPSEEK_API_KEY.",
    );
  },

  async chatCompletion(): Promise<never> {
    throw new Error(
      "DeepSeek provider not configured. Please set DEEPSEEK_API_KEY.",
    );
  },

  async embeddings(): Promise<never> {
    throw new Error(
      "DeepSeek provider not configured. Please set DEEPSEEK_API_KEY.",
    );
  },
};
