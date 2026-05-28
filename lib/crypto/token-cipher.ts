import "server-only";

import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Symmetric envelope cipher for short-lived secrets (OAuth tokens).
 *
 * AES-256-GCM with a random 96-bit IV per encryption. Output format :
 *
 *   base64( IV[12] || authTag[16] || ciphertext[*] )
 *
 * The key is supplied at construction (32 raw bytes). Callers wire it from
 * env via the factory `TokenCipherFactory`. The class itself is pure and
 * testable without any environment dependency.
 */
export class TokenCipher {
  private static readonly ALGORITHM = "aes-256-gcm" as const;
  private static readonly IV_BYTES = 12;
  private static readonly TAG_BYTES = 16;
  private static readonly KEY_BYTES = 32;

  constructor(private readonly key: Buffer) {
    if (key.length !== TokenCipher.KEY_BYTES) {
      throw new InvalidCipherKeyError(
        `Expected ${TokenCipher.KEY_BYTES}-byte key, got ${key.length}`,
      );
    }
  }

  public encrypt(plaintext: string): string {
    const iv = randomBytes(TokenCipher.IV_BYTES);
    const cipher = createCipheriv(TokenCipher.ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString("base64");
  }

  public decrypt(envelope: string): string {
    const buf = Buffer.from(envelope, "base64");
    if (buf.length < TokenCipher.IV_BYTES + TokenCipher.TAG_BYTES + 1) {
      throw new CipherDecryptError("Envelope too short");
    }
    const iv = buf.subarray(0, TokenCipher.IV_BYTES);
    const tag = buf.subarray(
      TokenCipher.IV_BYTES,
      TokenCipher.IV_BYTES + TokenCipher.TAG_BYTES,
    );
    const ciphertext = buf.subarray(TokenCipher.IV_BYTES + TokenCipher.TAG_BYTES);

    const decipher = createDecipheriv(TokenCipher.ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch (err) {
      throw new CipherDecryptError(
        err instanceof Error ? err.message : "Decryption failed",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export abstract class CipherError extends Error {
  public readonly name = this.constructor.name;
}

export class InvalidCipherKeyError extends CipherError {}
export class CipherDecryptError extends CipherError {}
export class MissingCipherKeyEnvError extends CipherError {
  constructor() {
    super("GMAIL_TOKEN_ENCRYPTION_KEY is not set");
  }
}

// ---------------------------------------------------------------------------
// Factory — singleton, key from env
// ---------------------------------------------------------------------------

/**
 * Lazy singleton factory for the Gmail-token `TokenCipher`.
 *
 * The encryption key is read from `GMAIL_TOKEN_ENCRYPTION_KEY` (base64,
 * 32 bytes decoded). Generate one with : `openssl rand -base64 32`.
 */
export class TokenCipherFactory {
  private static cached: TokenCipher | null = null;

  public static getInstance(): TokenCipher {
    if (this.cached) return this.cached;
    const raw = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    if (!raw) throw new MissingCipherKeyEnvError();
    const key = Buffer.from(raw, "base64");
    this.cached = new TokenCipher(key);
    return this.cached;
  }

  public static setInstance(cipher: TokenCipher): void {
    this.cached = cipher;
  }

  public static reset(): void {
    this.cached = null;
  }
}
