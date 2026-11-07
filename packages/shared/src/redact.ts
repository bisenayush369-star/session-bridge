/**
 * Best-effort secret redaction. Pattern matching is imperfect: it WILL miss some secrets and may redact some
 * harmless strings. Treat it as defence in depth, never as a guarantee.
 */
interface Rule {
  kind: string;
  re: RegExp;
  replace?: (match: string, ...groups: string[]) => string;
}

const mark = (kind: string): string => `[REDACTED:${kind}]`;
const REFERENCE_VALUE = /^(?:process\.|import\.meta|os\.|env[.(]|\$|\{|<|\[|config\.|settings\.|getenv)/i;

const RULES: Rule[] = [
  { kind: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { kind: 'session-bridge-token', re: /\bsbt_[A-Za-z0-9_-]{20,}/g },
  { kind: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { kind: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { kind: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { kind: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  {
    kind: 'bearer-token',
    re: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g,
    replace: (_m, lead = '') => `${lead}${mark('bearer-token')}`,
  },
  {
    kind: 'url-credentials',
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,
    replace: (_m, scheme = '') => `${scheme}${mark('url-credentials')}@`,
  },
  {
    kind: 'secret-assignment',
    re: /\b([A-Za-z0-9_]*(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|authorization)["']?\s*[:=]\s*)(["']?)([^\s"'`,;]{8,})\2/gi,
    replace: (match, lead = '', quote = '', value = '') =>
      REFERENCE_VALUE.test(value) || value.includes('(') || /^\d+$/.test(value)
        ? match
        : `${lead}${quote}${mark('secret')}${quote}`,
  },
];

export interface RedactionResult {
  text: string;
  count: number;
}

export function redactSecrets(input: string): RedactionResult {
  let count = 0;
  let text = input;
  for (const rule of RULES) {
    text = text.replace(rule.re, (...args: unknown[]) => {
      const groups = args.slice(0, -2) as string[];
      const match = groups[0] ?? '';
      const out = rule.replace ? rule.replace(match, ...groups.slice(1)) : mark(rule.kind);
      if (out !== match) count += 1;
      return out;
    });
  }
  return { text, count };
}

/** Redacts every string inside a JSON-like value (objects/arrays), returning a copy. */
export function redactDeep<T>(value: T): { value: T; count: number } {
  let count = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const r = redactSecrets(v);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return { value: walk(value) as T, count };
}
