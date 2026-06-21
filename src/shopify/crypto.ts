import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM encryption for Shopify access tokens at rest (Phase 2 / Phase 13).
// Format (base64 fields, version-prefixed so the key can be rotated):
//   v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>
// The key comes from APP_ENCRYPTION_KEY (base64, 32 bytes). Losing it = all shops
// must reconnect; rotating it = re-encrypt stored tokens (decrypt with old, encrypt
// with new — see reEncrypt()).

const VERSION = "v1";

export class EncryptionError extends Error {}

function loadKey(keyB64: string | undefined): Buffer {
  if (!keyB64) throw new EncryptionError("APP_ENCRYPTION_KEY is not set");
  let key: Buffer;
  try {
    key = Buffer.from(keyB64, "base64");
  } catch {
    throw new EncryptionError("APP_ENCRYPTION_KEY is not valid base64");
  }
  if (key.length !== 32) {
    throw new EncryptionError(`APP_ENCRYPTION_KEY must decode to 32 bytes (got ${key.length})`);
  }
  return key;
}

/** Encrypt a secret string. Returns a self-describing, versioned token blob. */
export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = loadKey(keyB64);
  const iv = randomBytes(12); // 96-bit nonce recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt a blob produced by encryptSecret. Throws on tamper / wrong key. */
export function decryptSecret(blob: string, keyB64: string): string {
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new EncryptionError("unrecognized ciphertext format/version");
  }
  const key = loadKey(keyB64);
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64!, "base64");
  const tag = Buffer.from(tagB64!, "base64");
  const ct = Buffer.from(ctB64!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new EncryptionError("decryption failed (tampered data or wrong key)");
  }
}

/** Rotate: decrypt with the old key, re-encrypt with the new key. */
export function reEncrypt(blob: string, oldKeyB64: string, newKeyB64: string): string {
  return encryptSecret(decryptSecret(blob, oldKeyB64), newKeyB64);
}

/** Constant-time string compare (for opaque tokens/secrets, not HMAC digests). */
export function safeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
