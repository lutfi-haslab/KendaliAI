/**
 * KendaliAI Provider Factory
 *
 * Factory for creating AI providers using AI SDK.
 */

import type {
  ProviderInstance,
  ProviderConfig,
  ProviderType,
  ModelInfo,
} from "./types";
import { createZaiProvider, zaiProvider, type ZaiConfig } from "./zai";
import {
  createDeepSeekProvider,
  deepseekProvider,
  type DeepSeekConfig,
} from "./deepseek";

export type {
  ProviderInstance,
  ProviderConfig,
  ProviderType,
  ModelInfo,
} from "./types";
export type { ZaiConfig } from "./zai";
export type { DeepSeekConfig } from "./deepseek";

// Provider registry
const providers = new Map<ProviderType, ProviderInstance>();

/**
 * Initialize providers from configuration
 *
 * Skips providers that are not yet implemented or have missing API keys.
 * Errors are caught and logged to prevent initialization failures.
 */
export function initializeProviders(
  configs: Record<string, ProviderConfig>,
): void {
  for (const [type, config] of Object.entries(configs)) {
    if (config.apiKey) {
      try {
        const provider = createProvider(type as ProviderType, config);
        providers.set(type as ProviderType, provider);
      } catch (error) {
        if (error instanceof ProviderNotImplementedError) {
          console.warn(`Skipping ${type}: ${error.message}`);
        } else {
          throw error;
        }
      }
    }
  }
}

/**
 * Error thrown when a provider is not yet implemented
 */
export class ProviderNotImplementedError extends Error {
  constructor(public readonly providerType: ProviderType) {
    super(
      `Provider '${providerType}' is not yet implemented. Available providers: zai, deepseek`,
    );
    this.name = "ProviderNotImplementedError";
  }
}

/**
 * Error thrown when an unknown provider type is requested
 */
export class UnknownProviderError extends Error {
  constructor(public readonly providerType: string) {
    super(
      `Unknown provider type: '${providerType}'. Valid types: zai, deepseek, openai, anthropic`,
    );
    this.name = "UnknownProviderError";
  }
}

/**
 * Create a provider instance based on type
 *
 * @param type - The provider type (zai, deepseek, openai, anthropic)
 * @param config - Provider configuration including API key
 * @returns Provider instance
 * @throws {ProviderNotImplementedError} If provider type is valid but not yet implemented
 * @throws {UnknownProviderError} If provider type is not recognized
 */
export function createProvider(
  type: ProviderType,
  config: ProviderConfig,
): ProviderInstance {
  switch (type) {
    case "zai":
      return createZaiProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        defaultModel: config.defaultModel,
      });

    case "deepseek":
      return createDeepSeekProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        defaultModel: config.defaultModel,
      });

    case "openai":
    case "anthropic":
      throw new ProviderNotImplementedError(type);

    default:
      throw new UnknownProviderError(type);
  }
}

/**
 * Get a provider by type
 */
export function getProvider(type: ProviderType): ProviderInstance | undefined {
  return providers.get(type);
}

/**
 * Get all configured providers
 */
export function getAllProviders(): ProviderInstance[] {
  return Array.from(providers.values());
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(type: ProviderType): boolean {
  const provider = providers.get(type);
  return provider?.isConfigured() ?? false;
}

/**
 * Get default provider
 *
 * Returns the default provider based on the following priority:
 * 1. DeepSeek (if configured) - best cost/performance ratio
 * 2. Zai (if configured) - alternative option
 * 3. First available configured provider
 *
 * @returns The default provider instance, or undefined if none configured
 */
export function getDefaultProvider(): ProviderInstance | undefined {
  // Priority: deepseek > zai > first available
  if (isProviderConfigured("deepseek")) {
    return getProvider("deepseek");
  }
  if (isProviderConfigured("zai")) {
    return getProvider("zai");
  }
  return getAllProviders()[0];
}

/**
 * List all available models across all providers
 */
export function listAllModels(): Partial<Record<ProviderType, ModelInfo[]>> {
  const result: Partial<Record<ProviderType, ModelInfo[]>> = {};

  for (const [type, provider] of providers) {
    result[type] = provider.listModels();
  }

  return result;
}

// Export default unconfigured providers for reference
export { zaiProvider, deepseekProvider };
