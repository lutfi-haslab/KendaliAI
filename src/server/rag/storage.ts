/**
 * KendaliAI Vector Storage Module
 * 
 * Implements vector storage for RAG using SQLite with sqlite-vss extension.
 * Provides efficient similarity search with VSS indexes.
 */

import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { Database } from "bun:sqlite";
import * as sqlite_vss from "sqlite-vss";
import type { 
  VectorConfig, 
  VectorSearchResult, 
  TextChunk,
  RetrievalConfig 
} from "./types";

// ============================================
// Database Types
// ============================================

interface DocumentRow {
  id: string;
  gateway_id: string | null;
  content: string;
  content_hash: string;
  source: string;
  source_path: string | null;
  title: string | null;
  metadata: string | null;
  status: string;
  error: string | null;
  ingested_at: number;
}

interface ChunkRow {
  id: string;
  document_id: string;
  content: string;
  chunk_index: number;
  start_position: number;
  end_position: number;
  embedding: string | null;
  embedding_model: string | null;
  metadata: string | null;
  created_at: number;
}

interface ChunkWithDocument extends ChunkRow {
  doc_gateway_id: string | null;
  doc_source: string | null;
  doc_title: string | null;
}

// ============================================
// Vector Storage Implementation
// ============================================

/**
 * SQLite-based vector storage for RAG with sqlite-vss extension
 */
export class VectorStorage {
  private db: Database;
  private config: VectorConfig;
  private initialized = false;
  private dimensions: number;
  
  constructor(db: Database, config: VectorConfig) {
    this.db = db;
    this.config = config;
    this.dimensions = config.dimensions || 1536;
  }
  
  /**
   * Initialize storage tables and VSS extension
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    
    // Load sqlite-vss extension
    try {
      sqlite_vss.load(this.db);
      console.log("[RAG] sqlite-vss extension loaded");
    } catch (error) {
      console.warn("[RAG] Failed to load sqlite-vss extension, falling back to JSON storage:", error);
    }
    
    // Create documents table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rag_documents (
        id TEXT PRIMARY KEY,
        gateway_id TEXT,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        source TEXT NOT NULL,
        source_path TEXT,
        title TEXT,
        metadata TEXT,
        status TEXT DEFAULT 'pending',
        error TEXT,
        ingested_at INTEGER NOT NULL
      )
    `);
    
    // Create chunks table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        content TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        start_position INTEGER NOT NULL,
        end_position INTEGER NOT NULL,
        embedding TEXT,
        embedding_model TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
      )
    `);
    
    // Create VSS virtual table for vector search
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_vss USING vss0(
        embedding(${this.dimensions})
      )
    `);
    
    // Create mapping table for VSS
    this.db.run(`
      CREATE TABLE IF NOT EXISTS rag_chunks_vss_map (
        chunk_id TEXT PRIMARY KEY,
        embedding_id INTEGER NOT NULL,
        FOREIGN KEY (chunk_id) REFERENCES rag_chunks(id) ON DELETE CASCADE
      )
    `);
    
    // Create FTS table for keyword search
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_fts USING fts5(
        content,
        content='rag_chunks',
        content_rowid='rowid'
      )
    `);
    
    // Create indexes
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_rag_documents_gateway 
      ON rag_documents(gateway_id)
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_document 
      ON rag_chunks(document_id)
    `);
    
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_rag_documents_hash 
      ON rag_documents(content_hash)
    `);
    
    // Create triggers for FTS sync
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rowid, content) 
        VALUES (new.rowid, new.content);
      END
    `);
    
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content) 
        VALUES('delete', old.rowid, old.content);
      END
    `);
    
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS rag_chunks_au AFTER UPDATE ON rag_chunks BEGIN
        INSERT INTO rag_chunks_fts(rag_chunks_fts, rowid, content) 
        VALUES('delete', old.rowid, old.content);
        INSERT INTO rag_chunks_fts(rowid, content) 
        VALUES (new.rowid, new.content);
      END
    `);
    
    this.initialized = true;
  }
  
  /**
   * Check if VSS extension is available
   */
  private isVSSAvailable(): boolean {
    try {
      const result = this.db.query<{ vss_version: string }, []>(`
        SELECT vss_version() as vss_version
      `).get();
      return !!result?.vss_version;
    } catch {
      return false;
    }
  }
  
  // ============================================
  // Document Operations
  // ============================================
  
  /**
   * Store a document
   */
  async storeDocument(doc: {
    id: string;
    content: string;
    contentHash: string;
    source: string;
    sourcePath?: string;
    title?: string;
    metadata?: Record<string, unknown>;
    gatewayId?: string;
  }): Promise<void> {
    const now = Date.now();
    
    this.db.run(`
      INSERT INTO rag_documents (
        id, gateway_id, content, content_hash, source, source_path, 
        title, metadata, status, ingested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processed', ?)
    `, [
      doc.id,
      doc.gatewayId || null,
      doc.content,
      doc.contentHash,
      doc.source,
      doc.sourcePath || null,
      doc.title || null,
      doc.metadata ? JSON.stringify(doc.metadata) : null,
      now,
    ]);
  }
  
  /**
   * Get document by ID
   */
  async getDocument(id: string): Promise<DocumentRow | null> {
    return this.db.query<DocumentRow, [string]>(`
      SELECT * FROM rag_documents WHERE id = ? LIMIT 1
    `).get(id);
  }
  
  /**
   * List documents
   */
  async listDocuments(options?: {
    gatewayId?: string;
    limit?: number;
    offset?: number;
  }): Promise<DocumentRow[]> {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;
    
    if (options?.gatewayId) {
      return this.db.query<DocumentRow, [string, number, number]>(`
        SELECT * FROM rag_documents 
        WHERE gateway_id = ?
        ORDER BY ingested_at DESC
        LIMIT ? OFFSET ?
      `).all(options.gatewayId, limit, offset);
    }
    
    return this.db.query<DocumentRow, [number, number]>(`
      SELECT * FROM rag_documents 
      ORDER BY ingested_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
  }
  
  /**
   * Delete document and its chunks
   */
  async deleteDocument(id: string): Promise<void> {
    // Get chunk IDs first for VSS cleanup
    const chunks = this.db.query<{ id: string }, [string]>(`
      SELECT id FROM rag_chunks WHERE document_id = ?
    `).all(id);
    
    // Delete from VSS mapping and table
    for (const chunk of chunks) {
      this.deleteChunkVSS(chunk.id);
    }
    
    // Delete chunks (cascade should handle this, but be explicit)
    this.db.run(`DELETE FROM rag_chunks WHERE document_id = ?`, [id]);
    // Delete document
    this.db.run(`DELETE FROM rag_documents WHERE id = ?`, [id]);
  }
  
  /**
   * Check if document exists by hash
   */
  async documentExistsByHash(contentHash: string): Promise<DocumentRow | null> {
    return this.db.query<DocumentRow, [string]>(`
      SELECT * FROM rag_documents WHERE content_hash = ? LIMIT 1
    `).get(contentHash);
  }
  
  // ============================================
  // Chunk Operations
  // ============================================
  
  /**
   * Store a chunk with VSS indexing
   */
  async storeChunk(chunk: TextChunk): Promise<void> {
    // Insert chunk
    this.db.run(`
      INSERT INTO rag_chunks (
        id, document_id, content, chunk_index, start_position, 
        end_position, embedding, embedding_model, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      chunk.id,
      chunk.documentId,
      chunk.content,
      chunk.index,
      chunk.startPosition,
      chunk.endPosition,
      chunk.embedding ? JSON.stringify(chunk.embedding) : null,
      chunk.embeddingModel || null,
      chunk.metadata ? JSON.stringify(chunk.metadata) : null,
      chunk.createdAt.getTime(),
    ]);
    
    // Add to VSS index if embedding exists
    if (chunk.embedding && this.isVSSAvailable()) {
      this.addToVSSIndex(chunk.id, chunk.embedding);
    }
  }
  
  /**
   * Store multiple chunks with VSS indexing
   */
  async storeChunks(chunks: TextChunk[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO rag_chunks (
        id, document_id, content, chunk_index, start_position, 
        end_position, embedding, embedding_model, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((items: TextChunk[]) => {
      for (const chunk of items) {
        stmt.run(
          chunk.id,
          chunk.documentId,
          chunk.content,
          chunk.index,
          chunk.startPosition,
          chunk.endPosition,
          chunk.embedding ? JSON.stringify(chunk.embedding) : null,
          chunk.embeddingModel || null,
          chunk.metadata ? JSON.stringify(chunk.metadata) : null,
          chunk.createdAt.getTime()
        );
        
        // Add to VSS index if embedding exists
        if (chunk.embedding && this.isVSSAvailable()) {
          this.addToVSSIndex(chunk.id, chunk.embedding);
        }
      }
    });
    
    insertMany(chunks);
  }
  
  /**
   * Get chunks for a document
   */
  async getChunks(documentId: string): Promise<ChunkRow[]> {
    return this.db.query<ChunkRow, [string]>(`
      SELECT * FROM rag_chunks 
      WHERE document_id = ? 
      ORDER BY chunk_index ASC
    `).all(documentId);
  }
  
  /**
   * Update chunk embedding
   */
  async updateChunkEmbedding(
    chunkId: string, 
    embedding: number[], 
    model: string
  ): Promise<void> {
    this.db.run(`
      UPDATE rag_chunks 
      SET embedding = ?, embedding_model = ?
      WHERE id = ?
    `, [JSON.stringify(embedding), model, chunkId]);
    
    // Update VSS index
    if (this.isVSSAvailable()) {
      // Delete old VSS entry
      this.deleteChunkVSS(chunkId);
      // Add new VSS entry
      this.addToVSSIndex(chunkId, embedding);
    }
  }
  
  // ============================================
  // VSS Operations
  // ============================================
  
  /**
   * Add chunk to VSS index
   */
  private addToVSSIndex(chunkId: string, embedding: number[]): void {
    if (!this.isVSSAvailable()) return;
    
    try {
      // Insert into VSS table
      const result = this.db.run(`
        INSERT INTO rag_chunks_vss (embedding) VALUES (vss_vector(?))
      `, [JSON.stringify(embedding)]);
      
      const embeddingId = result.lastInsertRowid;
      
      // Store mapping
      this.db.run(`
        INSERT INTO rag_chunks_vss_map (chunk_id, embedding_id) VALUES (?, ?)
      `, [chunkId, embeddingId]);
    } catch (error) {
      console.error("[RAG] Failed to add to VSS index:", error);
    }
  }
  
  /**
   * Delete chunk from VSS index
   */
  private deleteChunkVSS(chunkId: string): void {
    if (!this.isVSSAvailable()) return;
    
    try {
      // Get embedding ID
      const mapping = this.db.query<{ embedding_id: number }, [string]>(`
        SELECT embedding_id FROM rag_chunks_vss_map WHERE chunk_id = ?
      `).get(chunkId);
      
      if (mapping) {
        // Delete from VSS table
        this.db.run(`DELETE FROM rag_chunks_vss WHERE rowid = ?`, [mapping.embedding_id]);
        // Delete mapping
        this.db.run(`DELETE FROM rag_chunks_vss_map WHERE chunk_id = ?`, [chunkId]);
      }
    } catch (error) {
      console.error("[RAG] Failed to delete from VSS index:", error);
    }
  }
  
  // ============================================
  // Search Operations
  // ============================================
  
  /**
   * Vector similarity search using VSS
   */
  async vectorSearch(
    embedding: number[],
    options?: Partial<RetrievalConfig>
  ): Promise<VectorSearchResult[]> {
    const topK = options?.topK || 5;
    const minScore = options?.minScore || 0.0;
    const gatewayId = options?.gatewayId;
    
    // Try VSS search first
    if (this.isVSSAvailable()) {
      return this.vssSearch(embedding, topK, minScore, gatewayId);
    }
    
    // Fallback to JSON-based search
    return this.jsonVectorSearch(embedding, topK, minScore, gatewayId);
  }
  
  /**
   * VSS-based vector search
   */
  private async vssSearch(
    embedding: number[],
    topK: number,
    minScore: number,
    gatewayId?: string
  ): Promise<VectorSearchResult[]> {
    try {
      interface VSSSearchRow {
        chunk_id: string;
        distance: number;
      }
      
      let query: string;
      let params: (string | number)[];
      
      if (gatewayId) {
        query = `
          SELECT m.chunk_id, v.distance
          FROM rag_chunks_vss v
          JOIN rag_chunks_vss_map m ON v.rowid = m.embedding_id
          JOIN rag_chunks c ON c.id = m.chunk_id
          JOIN rag_documents d ON c.document_id = d.id
          WHERE vss_search(v.embedding, vss_vector(?)) AND d.gateway_id = ?
          ORDER BY v.distance ASC
          LIMIT ?
        `;
        params = [JSON.stringify(embedding), gatewayId, topK];
      } else {
        query = `
          SELECT m.chunk_id, v.distance
          FROM rag_chunks_vss v
          JOIN rag_chunks_vss_map m ON v.rowid = m.embedding_id
          WHERE vss_search(v.embedding, vss_vector(?))
          ORDER BY v.distance ASC
          LIMIT ?
        `;
        params = [JSON.stringify(embedding), topK];
      }
      
      const vssResults = this.db.query<VSSSearchRow, typeof params>(query).all(...params);
      
      // Get chunk details and convert distances to scores
      const results: VectorSearchResult[] = [];
      
      for (const vssResult of vssResults) {
        // Convert distance to similarity score (0-1)
        // VSS uses cosine distance by default, so similarity = 1 - distance
        const score = Math.max(0, 1 - vssResult.distance);
        
        if (score >= minScore) {
          const chunk = this.db.query<ChunkWithDocument, [string]>(`
            SELECT c.*, d.gateway_id as doc_gateway_id, d.source as doc_source, d.title as doc_title
            FROM rag_chunks c
            JOIN rag_documents d ON c.document_id = d.id
            WHERE c.id = ?
          `).get(vssResult.chunk_id);
          
          if (chunk) {
            results.push({
              chunkId: chunk.id,
              documentId: chunk.document_id,
              content: chunk.content,
              score,
              metadata: {
                index: chunk.chunk_index,
                source: chunk.doc_source,
                title: chunk.doc_title,
                ...(chunk.metadata ? JSON.parse(chunk.metadata) : {}),
              },
            });
          }
        }
      }
      
      return results;
    } catch (error) {
      console.error("[RAG] VSS search failed, falling back to JSON search:", error);
      return this.jsonVectorSearch(embedding, topK, minScore, gatewayId);
    }
  }
  
  /**
   * JSON-based vector search (fallback)
   */
  private async jsonVectorSearch(
    embedding: number[],
    topK: number,
    minScore: number,
    gatewayId?: string
  ): Promise<VectorSearchResult[]> {
    // Get all chunks with embeddings
    let query: string;
    let params: (string | null)[];
    
    if (gatewayId) {
      query = `
        SELECT c.*, d.gateway_id as doc_gateway_id, d.source as doc_source, d.title as doc_title
        FROM rag_chunks c
        JOIN rag_documents d ON c.document_id = d.id
        WHERE c.embedding IS NOT NULL AND d.gateway_id = ?
        ORDER BY c.chunk_index ASC
      `;
      params = [gatewayId];
    } else {
      query = `
        SELECT c.*, d.gateway_id as doc_gateway_id, d.source as doc_source, d.title as doc_title
        FROM rag_chunks c
        JOIN rag_documents d ON c.document_id = d.id
        WHERE c.embedding IS NOT NULL
        ORDER BY c.chunk_index ASC
      `;
      params = [];
    }
    
    const rows = this.db.query<ChunkWithDocument, typeof params>(query).all(...params);
    
    // Calculate similarities
    const results: VectorSearchResult[] = [];
    
    for (const row of rows) {
      if (!row.embedding) continue;
      
      try {
        const chunkEmbedding = JSON.parse(row.embedding) as number[];
        const score = this.cosineSimilarity(embedding, chunkEmbedding);
        
        if (score >= minScore) {
          results.push({
            chunkId: row.id,
            documentId: row.document_id,
            content: row.content,
            score,
            metadata: {
              index: row.chunk_index,
              source: row.doc_source,
              title: row.doc_title,
              ...(row.metadata ? JSON.parse(row.metadata) : {}),
            },
          });
        }
      } catch {
        // Skip invalid embeddings
      }
    }
    
    // Sort by score and return top K
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  /**
   * Keyword search using FTS
   */
  async keywordSearch(
    query: string,
    options?: Partial<RetrievalConfig>
  ): Promise<VectorSearchResult[]> {
    const topK = options?.topK || 5;
    const gatewayId = options?.gatewayId;
    
    // Use FTS5 for keyword search
    let sql: string;
    let params: (string | number | null)[];
    
    if (gatewayId) {
      sql = `
        SELECT c.id, c.document_id, c.content, c.chunk_index, 
               c.metadata, d.gateway_id, d.source, d.title,
               bm25(rag_chunks_fts) as score
        FROM rag_chunks_fts fts
        JOIN rag_chunks c ON c.rowid = fts.rowid
        JOIN rag_documents d ON c.document_id = d.id
        WHERE rag_chunks_fts MATCH ? AND d.gateway_id = ?
        ORDER BY score
        LIMIT ?
      `;
      params = [query, gatewayId, topK];
    } else {
      sql = `
        SELECT c.id, c.document_id, c.content, c.chunk_index,
               c.metadata, d.gateway_id, d.source, d.title,
               bm25(rag_chunks_fts) as score
        FROM rag_chunks_fts fts
        JOIN rag_chunks c ON c.rowid = fts.rowid
        JOIN rag_documents d ON c.document_id = d.id
        WHERE rag_chunks_fts MATCH ?
        ORDER BY score
        LIMIT ?
      `;
      params = [query, topK];
    }
    
    interface KeywordSearchRow {
      id: string;
      document_id: string;
      content: string;
      chunk_index: number;
      metadata: string | null;
      gateway_id: string | null;
      source: string | null;
      title: string | null;
      score: number;
    }
    
    const rows = this.db.query<KeywordSearchRow, typeof params>(sql).all(...params);
    
    // Normalize BM25 scores to 0-1 range
    const maxScore = Math.max(...rows.map(r => Math.abs(r.score)), 1);
    
    return rows.map(row => ({
      chunkId: row.id,
      documentId: row.document_id,
      content: row.content,
      score: 1 - (Math.abs(row.score) / maxScore), // Invert and normalize
      metadata: {
        index: row.chunk_index,
        source: row.source,
        title: row.title,
        ...(row.metadata ? JSON.parse(row.metadata) : {}),
      },
    }));
  }
  
  /**
   * Hybrid search combining vector and keyword
   */
  async hybridSearch(
    embedding: number[],
    query: string,
    options?: Partial<RetrievalConfig>
  ): Promise<VectorSearchResult[]> {
    const vectorWeight = options?.vectorWeight || 0.7;
    const keywordWeight = options?.keywordWeight || 0.3;
    const topK = options?.topK || 5;
    
    // Run both searches
    const [vectorResults, keywordResults] = await Promise.all([
      this.vectorSearch(embedding, { ...options, topK: topK * 3 }),
      this.keywordSearch(query, { ...options, topK: topK * 3 }),
    ]);
    
    // Merge results with weighted scoring
    const merged = new Map<string, VectorSearchResult>();
    
    // Add vector results
    for (const result of vectorResults) {
      merged.set(result.chunkId, {
        ...result,
        score: result.score * vectorWeight,
      });
    }
    
    // Add/merge keyword results
    for (const result of keywordResults) {
      const existing = merged.get(result.chunkId);
      if (existing) {
        existing.score += result.score * keywordWeight;
      } else {
        merged.set(result.chunkId, {
          ...result,
          score: result.score * keywordWeight,
        });
      }
    }
    
    // Sort by combined score and return top K
    return Array.from(merged.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  // ============================================
  // Statistics
  // ============================================
  
  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalDocuments: number;
    totalChunks: number;
    totalEmbeddings: number;
    avgChunkSize: number;
    storageSize: number;
    vssAvailable: boolean;
  }> {
    const docCount = this.db.query<{ count: number }, []>(`
      SELECT COUNT(*) as count FROM rag_documents
    `).get();
    
    const chunkStats = this.db.query<{
      count: number;
      embedding_count: number;
      avg_size: number;
    }, []>(`
      SELECT 
        COUNT(*) as count,
        SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as embedding_count,
        AVG(LENGTH(content)) as avg_size
      FROM rag_chunks
    `).get();
    
    // Estimate storage size
    const dbSize = this.db.query<{ size: number }, []>(`
      SELECT SUM(LENGTH(content) + COALESCE(LENGTH(embedding), 0)) as size
      FROM rag_chunks
    `).get();
    
    return {
      totalDocuments: docCount?.count || 0,
      totalChunks: chunkStats?.count || 0,
      totalEmbeddings: chunkStats?.embedding_count || 0,
      avgChunkSize: Math.round(chunkStats?.avg_size || 0),
      storageSize: dbSize?.size || 0,
      vssAvailable: this.isVSSAvailable(),
    };
  }
  
  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    // Clear VSS data first
    if (this.isVSSAvailable()) {
      this.db.run(`DELETE FROM rag_chunks_vss`);
      this.db.run(`DELETE FROM rag_chunks_vss_map`);
    }
    
    this.db.run(`DELETE FROM rag_chunks`);
    this.db.run(`DELETE FROM rag_documents`);
  }
  
  /**
   * Dispose resources
   */
  async dispose(): Promise<void> {
    // Nothing to dispose for SQLite
    this.initialized = false;
  }
  
  // ============================================
  // Private Helpers
  // ============================================
  
  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Create content hash
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return randomUUID();
}
