export class SessionBridgeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionBridgeApiError';
  }
}

export interface CreateResponse {
  handoff_id: string;
  retrieval_token: string;
  expires_at: string | null;
  status: string;
  retention: string;
  payload_bytes: number;
  truncated: boolean;
  warnings: string[];
}

export interface ResumeResponse {
  handoff_id: string;
  text?: string;
  package?: unknown;
  approx_tokens: number;
  token_estimate: string;
  truncated: boolean;
  omitted: Record<string, number>;
  archive: { available: false; reference: null };
}

export interface ApiClient {
  createHandoff(body: unknown): Promise<CreateResponse>;
  resume(id: string, token: string, body: { max_tokens?: number; format?: string }): Promise<ResumeResponse>;
  deleteHandoff(id: string, token: string): Promise<{ handoff_id: string; status: string }>;
}

/** Plain-HTTP is only allowed for loopback so tokens never travel unencrypted across a network. */
export function assertSafeBaseUrl(raw: string): URL {
  const url = new URL(raw);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('SESSION_BRIDGE_API_URL must use https (http is only allowed for localhost).');
  }
  return url;
}

export class SessionBridgeClient implements ApiClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly timeoutMs = 15_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = assertSafeBaseUrl(baseUrl).toString().replace(/\/$/, '');
  }

  private async request<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new SessionBridgeApiError(0, 'network_error', 'Could not reach the Session Bridge API.');
    }
    const payload = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!res.ok) {
      throw new SessionBridgeApiError(
        res.status,
        payload.error?.code ?? 'error',
        payload.error?.message ?? `Request failed with status ${res.status}.`,
      );
    }
    return payload as T;
  }

  createHandoff(body: unknown): Promise<CreateResponse> {
    return this.request('POST', '/v1/handoffs', null, body);
  }
  resume(id: string, token: string, body: { max_tokens?: number; format?: string }): Promise<ResumeResponse> {
    return this.request('POST', `/v1/handoffs/${encodeURIComponent(id)}/resume`, token, body);
  }
  deleteHandoff(id: string, token: string): Promise<{ handoff_id: string; status: string }> {
    return this.request('DELETE', `/v1/handoffs/${encodeURIComponent(id)}`, token);
  }
}
