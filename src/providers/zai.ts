/**
 * KendaliAI zai Provider
 *
 * zai provider implementation using AI SDK (OpenAI-compatible).
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderInstance, ModelInfo } from "./types";

// zai models
const ZAI_MODELS: ModelInfo[] = [
  {
    id: "zai-1",
    name: "zai-1",
    type: "chat",
    contextLength: 128000,
    pricing: { input: 0.001, output: 0.002 },
  },
  {
    id: "zai-2",
    name: "zai-2",
    type: "chat",
    contextLength: 128000,
    pricing: { input: 0.0015, output: 0.003 },
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
  const defaultModel = config.defaultModel || "zai-1";

  // Create OpenAI-compatible client
  const client = createOpenAI({
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
      const model = modelId || defaultModel;
      return client(model);
    },

    listModels(): ModelInfo[] {
      return ZAI_MODELS;
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
};
