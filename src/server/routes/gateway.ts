/**
 * KendaliAI Gateway API Routes
 *
 * Path-based routing for gateway instances.
 */

import { gatewayRuntime } from "../gateway/runtime";
import { loadGateway } from "../../gateway/storage";

/**
 * CORS Headers
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

/**
 * JSON response helper
 */
function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

/**
 * Error response helper
 */
function error(message: string, status = 500): Response {
  return json({ success: false, error: message }, status);
}

/**
 * Handle gateway routes
 * Pattern: /:gatewayId/*
 */
export async function handleGatewayRoute(
  req: Request,
  gatewayId: string,
): Promise<Response | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Gateway status
  if (method === "GET" && path === `/${gatewayId}/status`) {
    return handleGatewayStatus(gatewayId);
  }

  // Start gateway
  if (method === "POST" && path === `/${gatewayId}/start`) {
    return handleGatewayStart(gatewayId);
  }

  // Stop gateway
  if (method === "POST" && path === `/${gatewayId}/stop`) {
    return handleGatewayStop(gatewayId);
  }

  // Chat completion
  if (method === "POST" && path === `/${gatewayId}/v1/chat/completions`) {
    return handleGatewayChatCompletion(req, gatewayId);
  }

  // List models
  if (method === "GET" && path === `/${gatewayId}/v1/models`) {
    return handleGatewayModels(gatewayId);
  }

  // Embeddings
  if (method === "POST" && path === `/${gatewayId}/v1/embeddings`) {
    return handleGatewayEmbeddings(req, gatewayId);
  }

  // Not a gateway route
  return null;
}

/**
 * Handle gateway status
 */
async function handleGatewayStatus(gatewayId: string): Promise<Response> {
  try {
    const isRunning = gatewayRuntime.isGatewayRunning(gatewayId);
    const runningGateway = gatewayRuntime.getRunningGateway(gatewayId);
    const config = runningGateway?.config ?? (await loadGateway(gatewayId));

    if (!config) {
      return error("Gateway not found", 404);
    }

    const startedAt = runningGateway?.startedAt;
    const uptime = startedAt
      ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
      : 0;

    return json({
      id: config.id,
      name: config.name,
      provider: config.provider.type,
      model: config.provider.model,
      channel: config.channel.type,
      status: isRunning ? "running" : config.status,
      uptime,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return error(`Failed to get gateway status: ${message}`);
  }
}

/**
 * Handle gateway start
 */
async function handleGatewayStart(gatewayId: string): Promise<Response> {
  try {
    const config = await gatewayRuntime.startGateway(gatewayId);
    return json({
      success: true,
      message: `Gateway ${config.name} started`,
      gateway: {
        id: config.id,
        name: config.name,
        status: "running",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return error(`Failed to start gateway: ${message}`);
  }
}

/**
 * Handle gateway stop
 */
async function handleGatewayStop(gatewayId: string): Promise<Response> {
  try {
    await gatewayRuntime.stopGateway(gatewayId);
    return json({
      success: true,
      message: "Gateway stopped",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return error(`Failed to stop gateway: ${message}`);
  }
}

/**
 * Handle gateway chat completion
 */
async function handleGatewayChatCompletion(
  req: Request,
  gatewayId: string,
): Promise<Response> {
  try {
    const body = await req.json();
    const { messages, temperature, max_tokens } = body;

    if (!messages || !Array.isArray(messages)) {
      return error("messages array is required", 400);
    }

    const isRunning = gatewayRuntime.isGatewayRunning(gatewayId);

    if (!isRunning) {
      // Auto-start gateway if not running
      await gatewayRuntime.startGateway(gatewayId);
    }

    const response = await gatewayRuntime.chatCompletion(
      gatewayId,
      messages.map((m: { role: string; content: string }) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      })),
      {
        temperature,
        maxTokens: max_tokens,
      },
    );

    // Format as OpenAI-compatible response
    return json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "unknown",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: response.content,
          },
          finish_reason: "stop",
        },
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.promptTokens,
            completion_tokens: response.usage.completionTokens,
            total_tokens:
              response.usage.promptTokens + response.usage.completionTokens,
          }
        : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return error(`Chat completion failed: ${message}`);
  }
}

/**
 * Handle gateway models
 */
async function handleGatewayModels(gatewayId: string): Promise<Response> {
  try {
    const running = gatewayRuntime.getRunningGateway(gatewayId);
    if (!running) {
      return error("Gateway not running", 400);
    }

    const models = running.provider.listModels();

    return json({
      object: "list",
      data: models.map((m: { id: string }) => ({
        id: m.id,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "organization",
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return error(`Failed to list models: ${message}`);
  }
}

/**
 * Handle gateway embeddings
 */
async function handleGatewayEmbeddings(
  req: Request,
  gatewayId: string,
): Promise<Response> {
  try {
    const body = await req.json();
    const { input } = body;

    if (!input) {
      return error("input is required", 400);
    }

    const isRunning = gatewayRuntime.isGatewayRunning(gatewayId);
    if (!isRunning) {
      return error("Gateway not running", 400);
    }

    const inputs = Array.isArray(input) ? input : [input];
    const result = await gatewayRuntime.embeddings(gatewayId, inputs);

    // Format as OpenAI-compatible response
    return json({
      object: "list",
      data: result.embeddings.map((embedding: number[], index: number) => ({
        object: "embedding",
        index,
        embedding,
      })),
      usage: result.usage
        ? {
            prompt_tokens: result.usage.promptTokens,
            total_tokens: result.usage.promptTokens,
          }
        : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return error(`Embeddings failed: ${message}`);
  }
}
