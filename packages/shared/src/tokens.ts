export interface TokenEstimate {
  approx_tokens: number;
  method: 'chars/4';
  /** Always false: this is a heuristic, not a tokenizer count. */
  exact: false;
}

/** Rough size estimate (about 4 characters per token). Never present this as an exact token count. */
export function estimateTokens(text: string): TokenEstimate {
  return { approx_tokens: Math.ceil(text.length / 4), method: 'chars/4', exact: false };
}

export const TOKEN_ESTIMATE_NOTE = 'approximate (chars/4), not tokenizer-exact';
