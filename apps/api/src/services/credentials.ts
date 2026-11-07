import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TOKEN_PATTERN } from '@session-bridge/shared';

/** Public identifier (96 random bits). Never authorises anything by itself. */
export function generateHandoffId(): string {
  return `hs_${randomBytes(12).toString('base64url')}`;
}

/** Bearer credential: 256 random bits. Shown to the creator once; only its HMAC is stored. */
export function generateRetrievalToken(): string {
  return `sbt_${randomBytes(32).toString('base64url')}`;
}

/** HMAC-SHA-256 keyed with the server pepper. Tokens are high-entropy, so a fast keyed hash is appropriate. */
export function hashToken(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

/** Constant-time comparison of the presented token's hash against the stored hash. */
export function verifyToken(presented: string, storedHash: string, pepper: string): boolean {
  const a = Buffer.from(hashToken(presented, pepper), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Extracts a well-formed token from `Authorization: Bearer <token>`; null if absent or malformed. */
export function parseBearer(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  const token = match?.[1];
  return token && TOKEN_PATTERN.test(token) ? token : null;
}
