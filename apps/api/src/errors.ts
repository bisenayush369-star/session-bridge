export interface ErrorExtra {
  retryAfterSeconds?: number;
  details?: unknown;
}

/** Error with an HTTP status and a stable machine-readable code. Messages must never contain secrets. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extra: ErrorExtra = {},
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errors = {
  validation: (message: string, details?: unknown) => new AppError(400, 'validation_failed', message, { details }),
  unauthorized: () =>
    new AppError(401, 'unauthorized', 'A valid "Authorization: Bearer <retrieval_token>" header is required.'),
  mcpUnauthorized: () =>
    new AppError(401, 'unauthorized', 'This endpoint needs its access key (header X-Session-Bridge-Key, or Authorization: Bearer <key>).'),
  /** Used for unknown id, wrong token and deleted handoffs alike, so existence is never revealed. */
  notFound: () => new AppError(404, 'not_found', 'Handoff not found or access denied.'),
  gone: (reason: 'expired' | 'revoked') =>
    new AppError(410, reason, `This handoff has ${reason === 'expired' ? 'expired' : 'been revoked'}.`),
  tooLarge: (message: string) => new AppError(413, 'payload_too_large', message),
  httpsRequired: () => new AppError(426, 'https_required', 'HTTPS is required.'),
  rateLimited: (retryAfterSeconds: number) =>
    new AppError(429, 'rate_limited', 'Too many requests. Retry later.', { retryAfterSeconds }),
  busy: () => new AppError(503, 'busy', 'Server is at capacity. Retry shortly.', { retryAfterSeconds: 1 }),
};
