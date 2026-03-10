/**
 * KendaliAI Provider Types
 *
 * Type definitions for AI providers using AI SDK.
 */

export type ProviderType = "zai" | "deepseek" | "openai" | "anthropic";

export interface ModelInfo {
  id: string;
  name: string;
  type: "chat" | "embedding" | "completion";
  contextLength?: number;
  pricing?: {
    input: number; // per 1K tokens
    output: number; // per 1K tokens
  };
}

export interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
}

export interface ProviderInstance {
  name: string;
  type: ProviderType;
  isConfigured(): boolean;
  getModel(modelId?: string): unknown;
  listModels(): ModelInfo[];
}
