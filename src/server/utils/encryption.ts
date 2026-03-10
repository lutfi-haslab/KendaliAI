/**
 * KendaliAI Encryption Utilities
 *
 * Secure encryption for sensitive data using AES-256-GCM.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  /** Encryption key (32 bytes for AES-256) */
  key: Buffer | string;
  /** IV length (default: 12 bytes for GCM) */
  ivLength?: number;
  /** Auth tag length (default: 16 bytes) */
  authTagLength?: number;
}

/**
 * Get or generate encryption key
 * In production, ENCRYPTION_KEY must be set to avoid data loss on restart
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    return Buffer.from(envKey, "utf-8");
  }

  // Warn in development about missing key
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ENCRYPTION_KEY environment variable must be set in production. " +
        "Generate a 32-byte key using: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
    );
  }

  console.warn(
    "[Encryption] WARNING: Using random encryption key. " +
      "Set ENCRYPTION_KEY environment variable to persist encrypted data across restarts.",
  );
  return randomBytes(32);
}

/**
 * Default encryption configuration
 */
const DEFAULT_CONFIG: EncryptionConfig = {
  key: getEncryptionKey(),
  ivLength: 12,
  authTagLength: 16,
};

/**
 * Encryption class for encrypting and decrypting data
 */
export class Encryption {
  private config: EncryptionConfig;
  private key: Buffer;
  private ivLength: number;
  private authTagLength: number;

  constructor(config: EncryptionConfig = DEFAULT_CONFIG) {
    this.config = config;

    // Ensure key is a Buffer
    if (typeof config.key === "string") {
      this.key = Buffer.from(config.key, "utf-8");
    } else {
      this.key = config.key;
    }

    this.ivLength = config.ivLength || 12;
    this.authTagLength = config.authTagLength || 16;
  }

  /**
   * Encrypt data
   */
  encrypt(plaintext: string): string {
    // Generate random IV
    const iv = randomBytes(this.ivLength);

    // Create cipher
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);

    // Encrypt - must call both update() and final()
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf-8"),
      cipher.final(),
    ]);

    // Get auth tag (must be called after final())
    const authTag = cipher.getAuthTag();

    // Combine IV + encrypted + auth tag
    // Format: iv:encrypted:authTag (base64 encoded)
    const combined = Buffer.concat([iv, encrypted, authTag]);
    return combined.toString("base64");
  }

  /**
   * Decrypt data
   */
  decrypt(encryptedData: string): string {
    try {
      // Decode base64
      const combined = Buffer.from(encryptedData, "base64");

      // Extract components
      const iv = combined.subarray(0, this.ivLength);
      const encrypted = combined.subarray(
        this.ivLength,
        combined.length - this.authTagLength,
      );
      const authTag = combined.subarray(combined.length - this.authTagLength);

      // Create decipher
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);

      // Set auth tag (must be called before final())
      decipher.setAuthTag(authTag);

      // Decrypt - must call both update() and final()
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString("utf-8");
    } catch (error) {
      throw new Error(`Decryption failed: ${error}`);
    }
  }

  /**
   * Hash a value
   */
  hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  /**
   * Verify a hash
   */
  verifyHash(value: string, hashedValue: string): boolean {
    return this.hash(value) === hashedValue;
  }
}

/**
 * Create a new encryption instance
 */
export function createEncryption(config?: EncryptionConfig): Encryption {
  return new Encryption(config ?? DEFAULT_CONFIG);
}

/**
 * Encrypt API key for storage
 */
export function encryptApiKey(apiKey: string, encryption?: Encryption): string {
  const enc = encryption || new Encryption();
  return enc.encrypt(apiKey);
}

/**
 * Decrypt API key from storage
 */
export function decryptApiKey(
  encryptedKey: string,
  encryption?: Encryption,
): string {
  const enc = encryption || new Encryption();
  return enc.decrypt(encryptedKey);
}
