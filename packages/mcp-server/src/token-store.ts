import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TokenStore {
  readonly enabled: boolean;
  save(handoffId: string, token: string, expiresAt: string | null): void;
  get(handoffId: string): string | undefined;
  remove(handoffId: string): void;
}

interface Entry {
  token: string;
  expires_at: string | null;
}

export const DEFAULT_TOKEN_STORE_PATH = join(homedir(), '.session-bridge', 'tokens.json');

/**
 * Optional convenience so a fresh session on the same machine only needs the handoff ID. The file holds bearer
 * credentials in plaintext: it is created 0600 in a 0700 directory (POSIX; permissions are not enforced on
 * Windows). Disable with SESSION_BRIDGE_TOKEN_STORE=off.
 */
export class FileTokenStore implements TokenStore {
  readonly enabled = true;
  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}

  private read(): Record<string, Entry> {
    if (!existsSync(this.path)) return {};
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, Entry>;
    } catch {
      return {};
    }
  }

  private write(data: Record<string, Entry>): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, this.path);
    try {
      chmodSync(this.path, 0o600);
    } catch {
      /* best effort (e.g. Windows) */
    }
  }

  save(handoffId: string, token: string, expiresAt: string | null): void {
    const data = this.read();
    for (const [id, entry] of Object.entries(data)) {
      if (entry.expires_at && Date.parse(entry.expires_at) <= this.now()) delete data[id];
    }
    data[handoffId] = { token, expires_at: expiresAt };
    this.write(data);
  }

  get(handoffId: string): string | undefined {
    const entry = this.read()[handoffId];
    if (!entry) return undefined;
    if (entry.expires_at && Date.parse(entry.expires_at) <= this.now()) return undefined;
    return entry.token;
  }

  remove(handoffId: string): void {
    const data = this.read();
    if (handoffId in data) {
      delete data[handoffId];
      this.write(data);
    }
  }
}

export const disabledTokenStore: TokenStore = {
  enabled: false,
  save: () => {},
  get: () => undefined,
  remove: () => {},
};

export function tokenStoreFromEnv(env: NodeJS.ProcessEnv): TokenStore {
  const configured = env.SESSION_BRIDGE_TOKEN_STORE;
  if (configured === 'off') return disabledTokenStore;
  return new FileTokenStore(configured || DEFAULT_TOKEN_STORE_PATH);
}
