export interface HandoffRecord {
  publicId: string;
  memory: unknown;
  schemaVersion: number;
  tokenHash: string;
  payloadBytes: number;
  retention: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastAccessedAt: Date | null;
  revokedAt: Date | null;
  deletedAt: Date | null;
}

export type NewHandoff = Omit<HandoffRecord, 'lastAccessedAt' | 'revokedAt' | 'deletedAt'>;

export interface PurgeInput {
  now: Date;
  /** Deleted/revoked tombstones older than this are removed. */
  tombstoneBefore: Date;
  /** Persistent handoffs not accessed since this instant are removed. null disables inactivity purging. */
  inactiveBefore: Date | null;
}
export interface PurgeResult {
  expired: number;
  tombstones: number;
  inactivePersistent: number;
}
export interface StoreStats {
  active: number;
  activePayloadBytes: number;
  expiredPending: number;
  tombstones: number;
}

export class DuplicateIdError extends Error {
  constructor() {
    super('Handoff id already exists');
    this.name = 'DuplicateIdError';
  }
}

export interface HandoffRepository {
  /** Throws DuplicateIdError when publicId already exists. */
  create(handoff: NewHandoff): Promise<void>;
  findByPublicId(publicId: string): Promise<HandoffRecord | null>;
  touch(publicId: string, at: Date): Promise<void>;
  /** Scrubs memory immediately and keeps a tombstone so repeated deletes stay idempotent. false if unknown. */
  markDeleted(publicId: string, at: Date): Promise<boolean>;
  markRevoked(publicId: string, at: Date): Promise<boolean>;
  /** Removes expired rows, old tombstones and inactive persistent rows atomically. Idempotent. */
  purge(input: PurgeInput): Promise<PurgeResult>;
  stats(now: Date): Promise<StoreStats>;
  ping(): Promise<void>;
}
