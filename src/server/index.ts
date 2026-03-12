/**
 * KendaliAI Server - Main Entry Point
 *
 * This is the main server file that bootstraps all components
 * and starts the HTTP server with OpenAI-compatible API endpoints.
 * Uses Bun's native server.
 */

// Core imports
import { configLoader } from "./config";
import { getDatabase, initDatabase, dbManager } from "./database";
import { eventBus } from "./eventbus";
import { log } from "./core";

// Database schema
import {
  messages,
  gateways,
  tools,
  channels,
  memories,
  skills,
  pairings,
} from "./database/schema";
import { desc, count, eq } from "drizzle-orm";

// Providers
import {
  providerRegistry,
  OpenAIProvider,
  DeepSeekProvider,
  ZAIProvider,
  CustomProvider,
} from "./providers";
import type { AIProvider, GenerateOptions, StreamChunk } from "./providers";

// Tools
import { toolRegistry } from "./tools/registry";

// Routing
import { RoutingManager } from "./routing";

// RAG
import { createRAGEngine } from "./rag";
import type { RAGEngine } from "./rag";

// ============================================
// Types
// ============================================

interface StatsResponse {
  messages: number;
  gateways: number;
  uptime: number;
  requests: number;
  systemLatency: number;
  recentActivity: any[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface GatewayConfig {
  id: string;
  name: string;
  description?: string;
  provider: {
    type: "openai" | "deepseek" | "zai" | "custom";
    apiKey?: string;
    model?: string;
    endpoint?: string;
  };
  agent: {
    name: string;
    personality?: string;
    instructions?: string;
    traits?: string[];
  };
  skills?: string[];
  tools?: string[];
  channels?: Array<{
    type: string;
    config: Record<string, unknown>;
  }>;
  status: "stopped" | "running";
  createdAt: string;
}

// ============================================
// CORS Headers
// ============================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
};

// ============================================
// Helper Functions
// ============================================

function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function error(message: string, status = 500): Response {
  return json({ success: false, error: message }, status);
}

// ============================================
// In-Memory Gateway Store
// ============================================

const gatewayInstances: Map<string, {
  config: GatewayConfig;
  provider: AIProvider;
  status: "stopped" | "running";
}> = new Map();

// Routing manager instance (initialized in bootstrap)
let routingManager: RoutingManager | null = null;

// RAG engine instance (initialized in bootstrap)
let ragEngineInstance: RAGEngine | null = null;

// ============================================
// Bootstrap Function
// ============================================

async function bootstrap() {
  log.info("Starting KendaliAI Server...");

  // Initialize database
  const db = initDatabase();
  log.info("Database initialized successfully.");

  // Get raw database for routing manager
  const rawDb = dbManager.getRaw();
  if (rawDb) {
    routingManager = new RoutingManager(rawDb);
    log.info("Routing manager initialized.");
  }

  // Load configuration
  await configLoader.load();
  log.info("Configuration loaded.");

  // Register built-in tools
  registerBuiltinTools();
  log.info("Built-in tools registered.");

  // Initialize RAG engine
  try {
    if (rawDb) {
      ragEngineInstance = await createRAGEngine(rawDb, {});
      log.info("RAG engine initialized.");
    }
  } catch (err) {
    log.warn("RAG engine initialization skipped:", err);
  }

  // Set up event handlers
  eventBus.on("MESSAGE_RECEIVED", async (payload: {
    adapter?: string;
    from?: string;
    text?: string;
    username?: string;
    user?: string;
  }) => {
    log.info(`EventBus received message from ${payload.adapter}: ${payload.text}`);
    
    try {
      await db.insert(messages).values({
        gatewayId: null,
        channelId: null,
        role: "user",
        content: payload.text || "",
        senderId: payload.from || payload.username || payload.user || "unknown",
        senderName: payload.username || payload.user || "unknown",
      });
    } catch (err) {
      log.error("Failed to save message:", err);
    }
  });

  log.info("KendaliAI Server bootstrapped successfully.");
}

// ============================================
// Register Built-in Tools
// ============================================

function registerBuiltinTools() {
  // Ping tool
  toolRegistry.register({
    name: "ping",
    description: "Replies with pong",
    parameters: { type: "object", properties: {} },
    handler: async () => "pong",
  });

  // Echo tool
  toolRegistry.register({
    name: "echo",
    description: "Echoes back the input message",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message to echo" },
      },
      required: ["message"],
    },
    handler: async (params: Record<string, unknown>) =>
      `Echo: ${params.message}`,
  });

  // Time tool
  toolRegistry.register({
    name: "time",
    description: "Returns the current time",
    parameters: { type: "object", properties: {} },
    handler: async () => new Date().toISOString(),
  });

  // Random tool
  toolRegistry.register({
    name: "random",
    description: "Returns a random number",
    parameters: {
      type: "object",
      properties: {
        min: { type: "number", description: "Minimum value" },
        max: { type: "number", description: "Maximum value" },
      },
    },
    handler: async (params: Record<string, unknown>) => {
      const min = (params.min as number) ?? 0;
      const max = (params.max as number) ?? 100;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },
  });
}

// ============================================
// Provider Factory
// ============================================

function createProvider(config: GatewayConfig["provider"]): AIProvider {
  switch (config.type) {
    case "openai":
      return new OpenAIProvider({
        type: "openai",
        apiKey: config.apiKey,
        defaultModel: config.model,
      });
    case "deepseek":
      return new DeepSeekProvider({
        type: "deepseek",
        apiKey: config.apiKey,
        defaultModel: config.model,
      });
    case "zai":
      return new ZAIProvider({
        type: "zai",
        apiKey: config.apiKey,
        defaultModel: config.model,
      });
    case "custom":
      return new CustomProvider({
        type: "custom",
        baseURL: config.endpoint || "http://localhost:11434/v1",
        apiKey: config.apiKey,
        defaultModel: config.model,
      });
    default:
      throw new Error(`Unknown provider type: ${config.type}`);
  }
}

// ============================================
// API Route Handlers
// ============================================

async function handleStats(): Promise<Response> {
  try {
    const db = getDatabase();
    const [messageCount] = await db
      .select({ count: count() })
      .from(messages);
    const [gatewayCount] = await db
      .select({ count: count() })
      .from(gateways);

    const stats: StatsResponse = {
      messages: messageCount?.count ?? 0,
      gateways: gatewayCount?.count ?? 0,
      uptime: process.uptime(),
      requests: 0,
      systemLatency: 0,
      recentActivity: [],
    };

    return json(stats);
  } catch (err) {
    log.error("Failed to get stats:", err);
    return error("Failed to get stats");
  }
}

async function handleGetGateways(): Promise<Response> {
  try {
    const db = getDatabase();
    // Return both database gateways and in-memory instances
    const dbGateways = await db.select().from(gateways);
    const memoryGateways = Array.from(gatewayInstances.values()).map((g) => ({
      ...g.config,
      status: g.status,
    }));

    return json({
      database: dbGateways,
      running: memoryGateways,
    });
  } catch (err) {
    log.error("Failed to get gateways:", err);
    return error("Failed to get gateways");
  }
}

async function handleCreateGateway(req: Request): Promise<Response> {
  try {
    const db = getDatabase();
    const body = await req.json();
    
    // Create gateway config
    const gatewayConfig: GatewayConfig = {
      id: body.id || `gw_${Date.now()}`,
      name: body.name,
      description: body.description,
      provider: body.provider || { type: "openai" },
      agent: body.agent || { name: body.name },
      skills: body.skills || [],
      tools: body.tools || [],
      channels: body.channels || [],
      status: "stopped",
      createdAt: new Date().toISOString(),
    };

    // Create provider instance
    const provider = createProvider(gatewayConfig.provider);

    // Store in memory
    gatewayInstances.set(gatewayConfig.id, {
      config: gatewayConfig,
      provider,
      status: "stopped",
    });

    // Also save to database
    const result = await db
      .insert(gateways)
      .values({
        id: gatewayConfig.id,
        name: gatewayConfig.name,
        provider: gatewayConfig.provider.type,
        endpoint: gatewayConfig.provider.endpoint,
        defaultModel: gatewayConfig.provider.model,
      })
      .returning();

    return json({ config: gatewayConfig, db: result[0] }, 201);
  } catch (err) {
    log.error("Failed to create gateway:", err);
    return error("Failed to create gateway");
  }
}

async function handleGetMessages(req: Request): Promise<Response> {
  try {
    const db = getDatabase();
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const allMessages = await db
      .select()
      .from(messages)
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return json(allMessages);
  } catch (err) {
    log.error("Failed to get messages:", err);
    return error("Failed to get messages");
  }
}

async function handleGetTools(): Promise<Response> {
  try {
    const db = getDatabase();
    const allTools = await db.select().from(tools);
    const registeredTools = toolRegistry.list();
    
    return json({
      database: allTools,
      registered: registeredTools,
    });
  } catch (err) {
    log.error("Failed to get tools:", err);
    return error("Failed to get tools");
  }
}

async function handleExecuteTool(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { name, params } = body;

    const result = await toolRegistry.execute(name, params);
    return json({ result });
  } catch (err) {
    log.error("Failed to execute tool:", err);
    return error("Failed to execute tool");
  }
}

async function handleGetSkills(): Promise<Response> {
  try {
    const db = getDatabase();
    const allSkills = await db.select().from(skills);
    return json({ database: allSkills });
  } catch (err) {
    log.error("Failed to get skills:", err);
    return error("Failed to get skills");
  }
}

async function handleGetLogs(req: Request): Promise<Response> {
  try {
    const db = getDatabase();
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "100");
    
    // Use messages as logs for now
    const logs = await db
      .select()
      .from(messages)
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    
    return json(logs);
  } catch (err) {
    log.error("Failed to get logs:", err);
    return error("Failed to get logs");
  }
}

async function handleGetSettings(): Promise<Response> {
  try {
    const config = configLoader.get();
    // Return safe config (without sensitive data)
    return json({
      server: config.server,
      database: config.database,
      providers: Object.keys(config.providers || {}),
    });
  } catch (err) {
    log.error("Failed to get settings:", err);
    return error("Failed to get settings");
  }
}

// ============================================
// OpenAI-Compatible API Handlers
// ============================================

async function handleOpenAIChat(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { model, messages: chatMessages, stream, tools } = body;

    // Find a provider for this model
    const providers = providerRegistry.getAll();
    let selectedProvider: AIProvider | null = null;
    let selectedProviderName: string | null = null;

    for (const [name, provider] of providers) {
      const models = await provider.listModels();
      if (models.some((m) => m.id === model || m.name === model)) {
        selectedProvider = provider;
        selectedProviderName = name;
        break;
      }
    }

    // If no provider found, try to use the first available one
    if (!selectedProvider && providers.size > 0) {
      const firstEntry = Array.from(providers.entries())[0];
      if (firstEntry) {
        selectedProvider = firstEntry[1];
        selectedProviderName = firstEntry[0];
      }
    }

    if (!selectedProvider) {
      return error("No AI provider available", 503);
    }

    const options: GenerateOptions = {
      messages: chatMessages,
      model,
      tools,
    };

    // Generate response
    if (stream) {
      // Handle streaming response
      const streamGenerator = selectedProvider.stream(options);

      // Create a ReadableStream for SSE
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of streamGenerator) {
              const data = JSON.stringify({
                id: `chatcmpl-${Date.now()}`,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model || "unknown",
                choices: [
                  {
                    index: 0,
                    delta: { content: chunk.delta },
                    finish_reason: chunk.done ? chunk.finishReason : null,
                  },
                ],
              });
              controller.enqueue(`data: ${data}\n\n`);
            }
            controller.enqueue("data: [DONE]\n\n");
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });

      return new Response(readableStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          ...CORS_HEADERS,
        },
      });
    } else {
      // Non-streaming response
      const result = await selectedProvider.generate(options);

      // Get default model from config
      const defaultModel = configLoader.get().providers?.openai?.defaultModel || "gpt-4o";

      return json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model || defaultModel,
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: result.text,
            },
            finish_reason: result.finishReason || "stop",
          },
        ],
        usage: result.usage,
      });
    }
  } catch (err) {
    log.error("Failed to handle OpenAI chat:", err);
    return error("Failed to process chat completion");
  }
}

async function handleOpenAIModels(): Promise<Response> {
  try {
    const providers = providerRegistry.getAll();
    const allModels: Array<{ id: string; object: string; created: number; owned_by: string }> = [];

    for (const [name, provider] of providers) {
      const models = await provider.listModels();
      for (const model of models) {
        allModels.push({
          id: model.id,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: name,
        });
      }
    }

    return json({
      object: "list",
      data: allModels,
    });
  } catch (err) {
    log.error("Failed to get models:", err);
    return error("Failed to get models");
  }
}

// ============================================
// Request Router
// ============================================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Handle OPTIONS preflight
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Health check (public)
  if (method === "GET" && path === "/health") {
    return json({ status: "ok", timestamp: new Date().toISOString() });
  }

  // ============================================
  // OpenAI-Compatible API Routes
  // ============================================

  // Chat completions
  if (method === "POST" && path === "/v1/chat/completions") {
    return handleOpenAIChat(req);
  }

  // Models
  if (method === "GET" && path === "/v1/models") {
    return handleOpenAIModels();
  }

  // ============================================
  // Public Routes
  // ============================================

  // Stats (public for dashboard)
  if (method === "GET" && path === "/api/stats") {
    return handleStats();
  }

  // ============================================
  // API Routes
  // ============================================

  // Messages
  if (method === "GET" && path === "/api/messages") {
    return handleGetMessages(req);
  }

  // Gateways
  if (path === "/api/gateways") {
    if (method === "GET") {
      return handleGetGateways();
    }
    if (method === "POST") {
      return handleCreateGateway(req);
    }
  }

  // Tools
  if (method === "GET" && path === "/api/tools") {
    return handleGetTools();
  }

  // Tool execution
  if (method === "POST" && path === "/api/tools/execute") {
    return handleExecuteTool(req);
  }

  // Skills
  if (method === "GET" && path === "/api/skills") {
    return handleGetSkills();
  }

  // Logs
  if (method === "GET" && path === "/api/logs") {
    return handleGetLogs(req);
  }

  // Settings
  if (method === "GET" && path === "/api/settings") {
    return handleGetSettings();
  }

  // RAG endpoints
  if (method === "POST" && path === "/api/rag/index") {
    if (!ragEngineInstance) {
      return error("RAG engine not initialized", 503);
    }
    try {
      const body = await req.json();
      const { documents } = body;
      // Ingest documents one by one
      let indexed = 0;
      for (const doc of documents) {
        await ragEngineInstance.ingestDocument(doc.content, doc.metadata);
        indexed++;
      }
      return json({ success: true, indexed });
    } catch (err) {
      log.error("Failed to index documents:", err);
      return error("Failed to index documents");
    }
  }

  if (method === "POST" && path === "/api/rag/search") {
    if (!ragEngineInstance) {
      return error("RAG engine not initialized", 503);
    }
    try {
      const body = await req.json();
      const { query, topK } = body;
      const results = await ragEngineInstance.search(query, { topK: topK || 5 });
      return json({ results });
    } catch (err) {
      log.error("Failed to search documents:", err);
      return error("Failed to search documents");
    }
  }

  // 404 Not Found
  return error("Not found", 404);
}

// ============================================
// Parse Command Line Arguments
// ============================================

function parseArgs(): { port?: number; host?: string } {
  const args = process.argv.slice(2);
  const result: { port?: number; host?: string } = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      result.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--host" && args[i + 1]) {
      result.host = args[i + 1];
      i++;
    }
  }
  
  return result;
}

// ============================================
// Start Server
// ============================================

async function startServer() {
  try {
    await bootstrap();

    // Parse command line arguments (override config)
    const cmdArgs = parseArgs();
    const port = cmdArgs.port || configLoader.get().server?.port || 3000;
    const host = cmdArgs.host || configLoader.get().server?.host || "0.0.0.0";

    log.info(`KendaliAI API starting on http://${host}:${port}`);

    // Use Bun's native server
    Bun.serve({
      port,
      hostname: host,
      fetch: handleRequest,
      error(err) {
        log.error("Server error:", err);
        return new Response(
          JSON.stringify({ error: "Internal server error" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...CORS_HEADERS },
          },
        );
      },
    });

    log.info(`KendaliAI API listening on http://${host}:${port}`);
  } catch (err) {
    log.error("Failed to start server:", err);
    process.exit(1);
  }
}

// Start the server
startServer();
