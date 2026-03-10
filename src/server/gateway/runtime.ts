/**
 * KendaliAI Gateway Runtime Manager
 *
 * Manages gateway instances, lifecycle, and path-based routing.
 */

import { log } from "../core";
import {
  loadGateway,
  loadGatewayById,
  listGateways,
  saveGateway,
  deleteGateway,
  updateGatewayStatus,
} from "../../gateway/storage";
import type { GatewayConfig, GatewayStatus } from "../../gateway/types";
import { createProvider } from "../../providers";
import type { ProviderInstance, ProviderType } from "../../providers/types";
import { createChannel } from "../../channels";
import type { ChannelInstance, ChannelType } from "../../channels/types";
import {
  initializeHooks,
  destroyAllHooks,
  executeOnGatewayStart,
  executeOnGatewayStop,
  executeOnMessageReceive,
  executeOnMessageSend,
  executeOnError,
} from "../../hooks";
import type { HookConfig } from "../../hooks/types";

/**
 * Running gateway instance
 */
interface RunningGateway {
  config: GatewayConfig;
  provider: ProviderInstance;
  channel?: ChannelInstance;
  startedAt: Date;
}

/**
 * Gateway Runtime Manager
 */
class GatewayRuntimeManager {
  private runningGateways: Map<string, RunningGateway> = new Map();

  /**
   * Start a gateway by ID or name
   */
  async startGateway(idOrName: string): Promise<GatewayConfig> {
    // Try to load by ID first, then by name
    let config = await loadGatewayById(idOrName);
    if (!config) {
      config = await loadGateway(idOrName);
    }

    if (!config) {
      throw new Error(`Gateway not found: ${idOrName}`);
    }

    // Check if already running
    if (this.runningGateways.has(config.id)) {
      throw new Error(`Gateway ${config.name} is already running`);
    }

    try {
      // Create provider instance
      const provider = createProvider(config.provider.type as ProviderType, {
        apiKey: config.provider.apiKey,
        baseURL: config.provider.baseURL,
        defaultModel: config.provider.model,
      });

      // Create channel instance if enabled
      let channel: ChannelInstance | undefined;
      if (config.channel.enabled !== false) {
        channel = createChannel(config.channel.type as ChannelType, {
          type: config.channel.type,
          botToken: config.channel.botToken,
          enabled: config.channel.enabled,
        });
      }

      // Initialize hooks
      if (config.hooks && config.hooks.length > 0) {
        const hookConfigs: HookConfig[] = config.hooks.map((h) => ({
          name: h.name as any,
          enabled: h.enabled,
          config: h.config,
        }));
        await initializeHooks(hookConfigs);
      }

      // Start channel if available
      if (channel) {
        await channel.start();

        // Set up message handler
        channel.onMessage(async (message) => {
          try {
            // Execute hooks on message receive
            const hookContext = {
              gateway: config!,
              channel,
              timestamp: new Date(),
              message,
            };

            await executeOnMessageReceive(hookContext as any);

            // Generate response using provider
            const response = await provider.chat(message.text || "");

            // Send response
            if (message.chatId && response) {
              await channel.sendMessage({
                chatId: message.chatId,
                text: response,
              });

              // Execute hooks on message send
              await executeOnMessageSend({
                ...hookContext,
                response: { text: response },
              } as any);
            }
          } catch (error) {
            log.error(`[GatewayRuntime] Error processing message:`, error);
            await executeOnError({
              gateway: config!,
              channel,
              timestamp: new Date(),
              error: error as Error,
            } as any);
          }
        });
      }

      // Execute gateway start hooks
      await executeOnGatewayStart({
        gateway: config,
        channel,
        timestamp: new Date(),
      } as any);

      // Store running instance
      this.runningGateways.set(config.id, {
        config,
        provider,
        channel,
        startedAt: new Date(),
      });

      // Update status
      await updateGatewayStatus(config.name, "running");

      log.info(
        `[GatewayRuntime] Started gateway: ${config.name} (${config.id})`,
      );

      return config;
    } catch (error) {
      // Update status to error
      await updateGatewayStatus(config!.name, "error");
      throw error;
    }
  }

  /**
   * Stop a gateway by ID
   */
  async stopGateway(id: string): Promise<void> {
    const running = this.runningGateways.get(id);
    if (!running) {
      throw new Error(`Gateway not running: ${id}`);
    }

    try {
      // Execute gateway stop hooks
      await executeOnGatewayStop({
        gateway: running.config,
        channel: running.channel,
        timestamp: new Date(),
      } as any);

      // Stop channel
      if (running.channel) {
        await running.channel.stop();
      }

      // Remove from running
      this.runningGateways.delete(id);

      // Update status
      await updateGatewayStatus(running.config.name, "stopped");

      log.info(`[GatewayRuntime] Stopped gateway: ${running.config.name}`);
    } catch (error) {
      log.error(`[GatewayRuntime] Error stopping gateway:`, error);
      throw error;
    }
  }

  /**
   * Get gateway status
   */
  getGatewayStatus(id: string): GatewayStatus | null {
    const running = this.runningGateways.get(id);
    if (running) {
      return "running";
    }
    return null;
  }

  /**
   * Get running gateway info
   */
  getRunningGateway(id: string): RunningGateway | undefined {
    return this.runningGateways.get(id);
  }

  /**
   * List all running gateways
   */
  listRunningGateways(): RunningGateway[] {
    return Array.from(this.runningGateways.values());
  }

  /**
   * Check if a gateway is running
   */
  isGatewayRunning(id: string): boolean {
    return this.runningGateways.has(id);
  }

  /**
   * Chat completion through a specific gateway
   */
  async chatCompletion(
    gatewayId: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    },
  ): Promise<{
    content: string;
    usage?: { promptTokens: number; completionTokens: number };
  }> {
    const running = this.runningGateways.get(gatewayId);
    if (!running) {
      throw new Error(`Gateway not running: ${gatewayId}`);
    }

    const response = await running.provider.chatCompletion(messages, options);

    return {
      content: response.content,
      usage: response.usage,
    };
  }

  /**
   * Generate embeddings through a specific gateway
   */
  async embeddings(
    gatewayId: string,
    input: string | string[],
  ): Promise<{
    embeddings: number[][];
    usage?: { promptTokens: number };
  }> {
    const running = this.runningGateways.get(gatewayId);
    if (!running) {
      throw new Error(`Gateway not running: ${gatewayId}`);
    }

    const texts = Array.isArray(input) ? input : [input];
    const results: number[][] = [];

    for (const text of texts) {
      const result = await running.provider.embeddings(text);
      results.push(result.embedding);
    }

    return { embeddings: results };
  }

  /**
   * Stop all running gateways
   */
  async stopAll(): Promise<void> {
    const ids = Array.from(this.runningGateways.keys());
    for (const id of ids) {
      try {
        await this.stopGateway(id);
      } catch (error) {
        log.error(`[GatewayRuntime] Error stopping gateway ${id}:`, error);
      }
    }

    // Destroy all hooks
    await destroyAllHooks();
  }
}

// Export singleton instance
export const gatewayRuntime = new GatewayRuntimeManager();
