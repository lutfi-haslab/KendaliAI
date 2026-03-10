/**
 * KendaliAI RAG Engine
 *
 * Retrieval-Augmented Generation implementation.
 */

import { randomUUID } from "crypto";
import { VectorIndex, type SearchResult } from "../vector";
import type { ProviderInstance } from "../../providers/types";

/**
 * RAG Configuration
 */
export interface RAGConfig {
  /** Vector index instance */
  vectorIndex: VectorIndex;
  /** AI Provider for generation */
  provider: ProviderInstance;
  /** Default model for generation */
  model?: string;
  /** System prompt for RAG */
  systemPrompt?: string;
  /** Maximum context length */
  maxContextLength?: number;
  /** Temperature for generation */
  temperature?: number;
}

/**
 * RAG Context
 */
export interface RAGContext {
  /** Original query */
  query: string;
  /** Retrieved documents */
  documents: SearchResult[];
  /** Generated context */
  context: string;
  /** Final response */
  response?: string;
}

/**
 * RAG Engine
 */
export class RAGEngine {
  private vectorIndex: VectorIndex;
  private provider: ProviderInstance;
  private model: string;
  private systemPrompt: string;
  private maxContextLength: number;
  private temperature: number;

  constructor(config: RAGConfig) {
    this.vectorIndex = config.vectorIndex;
    this.provider = config.provider;
    this.model = config.model || "default";
    this.systemPrompt =
      config.systemPrompt ||
      "You are a helpful AI assistant. Use the provided context to answer questions accurately.";
    this.maxContextLength = config.maxContextLength || 4000;
    this.temperature = config.temperature ?? 0;
  }

  /**
   * Process a query with RAG
   */
  async query(userQuery: string): Promise<RAGContext> {
    // Search for relevant documents
    const documents = await this.vectorIndex.search(userQuery, 5);

    // Build context from retrieved documents
    const context = this.buildContext(documents);

    // Generate response using the provider
    const response = await this.provider.chat(userQuery, {
      systemPrompt: `${this.systemPrompt}\n\nContext:\n${context}`,
    });

    return {
      query: userQuery,
      documents,
      context,
      response,
    };
  }

  /**
   * Build context string from search results
   */
  private buildContext(documents: SearchResult[]): string {
    if (documents.length === 0) {
      return "No relevant context found.";
    }

    const contextParts: string[] = [];

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      contextParts.push(
        `[Document ${i + 1}] (Score: ${doc.score.toFixed(2)}):\n${doc.document.content}`,
      );
    }

    return contextParts.join("\n\n");
  }

  /**
   * Add a document to the knowledge base
   */
  async addDocument(content: string, source?: string): Promise<void> {
    await this.vectorIndex.addDocument(content, source);
  }

  /**
   * Remove a document from the knowledge base
   */
  async removeDocument(id: string): Promise<void> {
    await this.vectorIndex.deleteDocument(id);
  }

  /**
   * Update a document in the knowledge base
   */
  async updateDocument(id: string, content: string): Promise<void> {
    await this.vectorIndex.updateDocument(id, content);
  }
}
