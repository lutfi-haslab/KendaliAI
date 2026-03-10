/**
 * KendaliAI DeepSeek Provider
 *
 * DeepSeek provider implementation using AI SDK (OpenAI-compatible).
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { ProviderInstance, ModelInfo } from "./types";

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
    pricing: { input: 0.00055, output: 0.00219 },
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
  const client = createOpenAI({
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
      const model = modelId || defaultModel;
      return client(model);
    },

    listModels(): ModelInfo[] {
      return DEEPSEEK_MODELS;
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
};
