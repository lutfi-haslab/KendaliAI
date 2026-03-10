/**
 * KendaliAI Vector Database Module
 *
 * Vector storage and search using sqlite-vss
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import * as sqliteVss from "sqlite-vss";

/**
 * Vector index configuration
 */
export interface VectorIndexConfig {
  /** Path to SQLite database file */
  dbPath: string;
  /** Embedding dimension (default: 1536 for OpenAI text-embedding-3-small) */
  embeddingDimension?: number;
  /** Embedding provider function */
  embeddingFn?: (text: string) => Promise<number[]>;
}

/**
 * Document chunk
 */
export interface DocumentChunk {
  id: string;
  content: string;
  source?: string;
  embedding?: number[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Document with embedding
 */
export interface DocumentWithEmbedding extends DocumentChunk {
  embedding: number[];
}

/**
 * Search result
 */
export interface SearchResult {
  document: DocumentWithEmbedding;
  score: number;
}

/**
 * Database row types
 */
interface DocumentRow {
  id: string;
  content: string;
  source: string | null;
  created_at: number;
  updated_at: number;
}

interface EmbeddingRow {
  id: string;
  document_id: string;
  embedding_json: string;
  created_at: number;
}

interface VssSearchRow {
  rowid: number;
  distance: number;
}

/**
 * Vector index instance using sqlite-vss
 */
export class VectorIndex {
  private db: Database;
  private config: VectorIndexConfig;
  private embeddingFn: (text: string) => Promise<number[]>;
  private embeddingDimension: number;
  private initialized: boolean = false;

  constructor(config: VectorIndexConfig) {
    this.config = config;
    this.db = new Database(config.dbPath);
    this.embeddingDimension = config.embeddingDimension || 1536;
    this.embeddingFn = config.embeddingFn || this.defaultEmbeddingFn;
  }

  /**
   * Initialize the database with sqlite-vss extension
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load sqlite-vss extension
    try {
      sqliteVss.load(this.db);
    } catch (error) {
      console.error("Failed to load sqlite-vss extension:", error);
      throw new Error(
        "sqlite-vss extension failed to load. Make sure sqlite-vss is installed correctly.",
      );
    }

    // Create documents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `);

    // Create embeddings table (stores embeddings as JSON for retrieval)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        embedding_json TEXT NOT NULL,
        created_at INTEGER,
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);

    // Create virtual table for vector similarity search using vss0
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vss_embeddings USING vss0(
        embedding(${this.embeddingDimension})
      )
    `);

    // Create index for faster document lookups
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_embeddings_document_id ON embeddings(document_id)
    `);

    this.initialized = true;
  }

  /**
   * Default embedding function using simple hash
   * In production, use OpenAI embeddings or text-embedding-3-small
   */
  private async defaultEmbeddingFn(text: string): Promise<number[]> {
    // Simple hash-based embedding for demo purposes
    // In production, replace with actual embedding API call
    const encoder = new TextEncoder();
    const data = new Uint8Array(encoder.encode(text));

    // Normalize to unit vector
    const embedding: number[] = [];
    for (let i = 0; i < data.length; i++) {
      embedding.push(data[i] / 255);
    }

    // Pad or truncate to embedding dimension
    while (embedding.length < this.embeddingDimension) {
      embedding.push(0);
    }
    return embedding.slice(0, this.embeddingDimension);
  }

  /**
   * Ensure the index is initialized before operations
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Add a document to the index
   */
  async addDocument(
    content: string,
    source?: string,
  ): Promise<DocumentWithEmbedding> {
    await this.ensureInitialized();

    const id = randomUUID();
    const embeddingId = randomUUID();
    const now = Date.now();

    // Generate embedding
    const embedding = await this.embeddingFn(content);

    // Insert document
    this.db.run(
      `INSERT INTO documents (id, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [id, content, source || null, now, now],
    );

    // Insert embedding JSON for retrieval
    this.db.run(
      `INSERT INTO embeddings (id, document_id, embedding_json, created_at) VALUES (?, ?, ?, ?)`,
      [embeddingId, id, JSON.stringify(embedding), now],
    );

    // Insert into vss vector table for similarity search
    // Use JSON.stringify as per sqlite-vss Node.js documentation
    this.db.run(`INSERT INTO vss_embeddings (rowid, embedding) VALUES (?, ?)`, [
      embeddingId,
      JSON.stringify(embedding),
    ]);

    return {
      id,
      content,
      source,
      embedding,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  /**
   * Search for similar documents using vss_search
   */
  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    await this.ensureInitialized();

    // Generate query embedding
    const queryEmbedding = await this.embeddingFn(query);

    // Use vss_search for similarity search with JSON vector
    // As per sqlite-vss Node.js documentation, use JSON.stringify
    const vssResults = this.db
      .prepare(
        `
      SELECT rowid, distance
      FROM vss_embeddings
      WHERE vss_search(embedding, ?)
      LIMIT ?
    `,
      )
      .all(JSON.stringify(queryEmbedding), limit) as VssSearchRow[];

    const searchResults: SearchResult[] = [];

    for (const vssRow of vssResults) {
      // Get embedding data
      const embeddingRow = this.db
        .prepare(
          `
        SELECT document_id, embedding_json
        FROM embeddings
        WHERE id = ?
      `,
        )
        .get(vssRow.rowid.toString()) as EmbeddingRow | undefined;

      if (!embeddingRow) {
        continue;
      }

      // Get document data
      const docRow = this.db
        .prepare(
          `
        SELECT id, content, source, created_at, updated_at
        FROM documents
        WHERE id = ?
      `,
        )
        .get(embeddingRow.document_id) as DocumentRow | undefined;

      if (!docRow) {
        continue;
      }

      let embeddingArray: number[];
      try {
        embeddingArray = JSON.parse(embeddingRow.embedding_json);
      } catch {
        continue;
      }

      searchResults.push({
        document: {
          id: docRow.id,
          content: docRow.content,
          source: docRow.source ?? undefined,
          embedding: embeddingArray,
          createdAt: new Date(docRow.created_at),
          updatedAt: new Date(docRow.updated_at),
        },
        score: 1 - vssRow.distance, // Convert distance to similarity score
      });
    }

    return searchResults;
  }

  /**
   * Delete a document
   */
  async deleteDocument(id: string): Promise<void> {
    await this.ensureInitialized();

    // Get embedding id first
    const embeddingRow = this.db
      .prepare(`SELECT id FROM embeddings WHERE document_id = ?`)
      .get(id) as EmbeddingRow | undefined;

    if (embeddingRow) {
      // Delete from vss table
      this.db.run(`DELETE FROM vss_embeddings WHERE rowid = ?`, [
        embeddingRow.id,
      ]);
    }

    // Delete from embeddings table (cascade should handle this)
    this.db.run(`DELETE FROM embeddings WHERE document_id = ?`, [id]);

    // Delete document
    this.db.run(`DELETE FROM documents WHERE id = ?`, [id]);
  }

  /**
   * Update a document
   */
  async updateDocument(
    id: string,
    content: string,
  ): Promise<DocumentWithEmbedding> {
    await this.ensureInitialized();

    const existing = await this.getDocument(id);
    if (!existing) {
      throw new Error(`Document not found: ${id}`);
    }

    const now = Date.now();

    // Update document content
    this.db.run(
      `UPDATE documents SET content = ?, updated_at = ? WHERE id = ?`,
      [content, now, id],
    );

    // Regenerate embedding
    const embedding = await this.embeddingFn(content);

    // Get embedding id
    const embeddingRow = this.db
      .prepare(`SELECT id FROM embeddings WHERE document_id = ?`)
      .get(id) as EmbeddingRow | undefined;

    if (embeddingRow) {
      // Update embedding JSON
      this.db.run(
        `UPDATE embeddings SET embedding_json = ?, created_at = ? WHERE document_id = ?`,
        [JSON.stringify(embedding), now, id],
      );

      // Update vss vector (delete and re-insert)
      this.db.run(`DELETE FROM vss_embeddings WHERE rowid = ?`, [
        embeddingRow.id,
      ]);

      // Use JSON.stringify as per sqlite-vss Node.js documentation
      this.db.run(
        `INSERT INTO vss_embeddings (rowid, embedding) VALUES (?, ?)`,
        [embeddingRow.id, JSON.stringify(embedding)],
      );
    }

    return {
      ...existing,
      content,
      embedding,
      updatedAt: new Date(now),
    };
  }

  /**
   * Get a document by ID
   */
  async getDocument(id: string): Promise<DocumentWithEmbedding | undefined> {
    await this.ensureInitialized();

    const result = this.db
      .prepare(
        `
        SELECT 
          d.id, 
          d.content, 
          d.source, 
          e.embedding_json, 
          d.created_at, 
          d.updated_at
        FROM documents d
        JOIN embeddings e ON d.id = e.document_id
        WHERE d.id = ?
      `,
      )
      .get(id) as (DocumentRow & { embedding_json: string }) | undefined;

    if (!result) {
      return undefined;
    }

    let embeddingArray: number[];
    try {
      embeddingArray = JSON.parse(result.embedding_json);
    } catch {
      embeddingArray = [];
    }

    return {
      id: result.id,
      content: result.content,
      source: result.source ?? undefined,
      embedding: embeddingArray,
      createdAt: new Date(result.created_at),
      updatedAt: new Date(result.updated_at),
    };
  }

  /**
   * Get all documents (without embeddings for performance)
   */
  async listDocuments(
    limit: number = 100,
    offset: number = 0,
  ): Promise<DocumentChunk[]> {
    await this.ensureInitialized();

    const results = this.db
      .prepare(
        `
        SELECT id, content, source, created_at, updated_at
        FROM documents
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(limit, offset) as DocumentRow[];

    return results.map((row) => ({
      id: row.id,
      content: row.content,
      source: row.source ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * Count total documents
   */
  async countDocuments(): Promise<number> {
    await this.ensureInitialized();

    const result = this.db
      .prepare(`SELECT COUNT(*) as count FROM documents`)
      .get() as { count: number };

    return result.count;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}

// Export factory function for convenience
export function createVectorIndex(config: VectorIndexConfig): VectorIndex {
  return new VectorIndex(config);
}
