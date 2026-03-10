/**
 * KendaliAI Error Handling
 *
 * Custom error classes for structured error handling.
 */

/**
 * Base error class for all KendaliAI errors
 */
export class KendaliAIError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = "KendaliAIError";
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends KendaliAIError {
  constructor(message: string) {
    super(message, "CONFIGURATION_ERROR", 500);
    this.name = "ConfigurationError";
  }
}

/**
 * Validation error
 */
export class ValidationError extends KendaliAIError {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message, "VALIDATION_ERROR", 400);
    this.name = "ValidationError";
  }
}

/**
 * Not found error
 */
export class NotFoundError extends KendaliAIError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} not found: ${id}` : `${resource} not found`,
      "NOT_FOUND",
      404,
    );
    this.name = "NotFoundError";
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends KendaliAIError {
  constructor(message: string = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
  }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends KendaliAIError {
  constructor(message: string = "Forbidden") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends KendaliAIError {
  constructor(
    public readonly limit: number,
    public readonly resetAt: Date,
  ) {
    super(
      `Rate limit exceeded. Try again after ${resetAt.toISOString()}`,
      "RATE_LIMIT",
      429,
    );
    this.name = "RateLimitError";
  }
}

/**
 * Provider error
 */
export class ProviderError extends KendaliAIError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly cause?: Error,
  ) {
    super(message, "PROVIDER_ERROR", 500);
    this.name = "ProviderError";
  }
}

/**
 * Channel error
 */
export class ChannelError extends KendaliAIError {
  constructor(
    message: string,
    public readonly channel: string,
    public readonly cause?: Error,
  ) {
    super(message, "CHANNEL_ERROR", 500);
    this.name = "ChannelError";
  }
}

/**
 * Hook error
 */
export class HookError extends KendaliAIError {
  constructor(
    message: string,
    public readonly hook: string,
    public readonly cause?: Error,
  ) {
    super(message, "HOOK_ERROR", 500);
    this.name = "HookError";
  }
}

/**
 * Workflow error
 */
export class WorkflowError extends KendaliAIError {
  constructor(
    message: string,
    public readonly workflowId?: string,
    public readonly cause?: Error,
  ) {
    super(message, "WORKFLOW_ERROR", 500);
    this.name = "WorkflowError";
  }
}

/**
 * Vector index error
 */
export class VectorIndexError extends KendaliAIError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message, "VECTOR_INDEX_ERROR", 500);
    this.name = "VectorIndexError";
  }
}

/**
 * RAG error
 */
export class RAGError extends KendaliAIError {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message, "RAG_ERROR", 500);
    this.name = "RAGError";
  }
}

/**
 * Error handler utility
 */
export function handleError(error: unknown): KendaliAIError {
  if (error instanceof KendaliAIError) {
    return error;
  }

  if (error instanceof Error) {
    return new KendaliAIError(error.message, "UNKNOWN_ERROR", 500);
  }

  return new KendaliAIError("An unknown error occurred", "UNKNOWN_ERROR", 500);
}
