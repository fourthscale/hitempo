import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  TokenCipher,
  TokenCipherFactory,
  InvalidCipherKeyError,
  CipherDecryptError,
  MissingCipherKeyEnvError,
} from "@/lib/crypto/token-cipher";

const VALID_KEY = randomBytes(32);

describe("TokenCipher", () => {
  it("round-trips a plaintext value", () => {
    const cipher = new TokenCipher(VALID_KEY);
    const plaintext = "ya29.a0AfH6SMB...some-oauth-token";
    const envelope = cipher.encrypt(plaintext);
    expect(envelope).not.toContain(plaintext);
    expect(cipher.decrypt(envelope)).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const cipher = new TokenCipher(VALID_KEY);
    const a = cipher.encrypt("same");
    const b = cipher.encrypt("same");
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe(cipher.decrypt(b));
  });

  it("rejects wrong-length keys", () => {
    expect(() => new TokenCipher(Buffer.alloc(16))).toThrow(InvalidCipherKeyError);
    expect(() => new TokenCipher(Buffer.alloc(33))).toThrow(InvalidCipherKeyError);
  });

  it("fails decryption with a tampered envelope", () => {
    const cipher = new TokenCipher(VALID_KEY);
    const envelope = cipher.encrypt("secret");
    const tampered = Buffer.from(envelope, "base64");
    tampered[tampered.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(() => cipher.decrypt(tampered.toString("base64"))).toThrow(CipherDecryptError);
  });

  it("fails decryption with a different key", () => {
    const a = new TokenCipher(VALID_KEY);
    const b = new TokenCipher(randomBytes(32));
    const envelope = a.encrypt("hello");
    expect(() => b.decrypt(envelope)).toThrow(CipherDecryptError);
  });

  it("rejects truncated envelopes", () => {
    const cipher = new TokenCipher(VALID_KEY);
    expect(() => cipher.decrypt("AAAA")).toThrow(CipherDecryptError);
  });
});

describe("TokenCipherFactory", () => {
  it("throws MissingCipherKeyEnvError when the env var is absent", () => {
    TokenCipherFactory.reset();
    const previous = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    try {
      expect(() => TokenCipherFactory.getInstance()).toThrow(MissingCipherKeyEnvError);
    } finally {
      if (previous !== undefined) process.env.GMAIL_TOKEN_ENCRYPTION_KEY = previous;
      TokenCipherFactory.reset();
    }
  });

  it("caches the instance", () => {
    TokenCipherFactory.reset();
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY = VALID_KEY.toString("base64");
    const a = TokenCipherFactory.getInstance();
    const b = TokenCipherFactory.getInstance();
    expect(a).toBe(b);
    TokenCipherFactory.reset();
  });
});
