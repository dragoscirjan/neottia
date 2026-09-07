import type { MemoryConfig } from './config.js';

/**
 * Secret scanning with pluggable defaults (neottia#1 decision #3):
 * the built-in patterns and entropy heuristic stay identical to the
 * harnessctl-v2 reference; config can add patterns or disable the heuristic.
 */

export interface SecretScannerOptions {
  customPatterns: readonly string[];
  entropyHeuristic: boolean;
}

const BUILT_IN_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/iu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/u,
  /\b(?:sk|rk)-(?:live|test)-[A-Za-z0-9_-]{16,}\b/u,
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/iu,
] as const;

export type SecretScanner = (value: unknown, path?: string) => void;

/** Builds a recursive scanner from strict defaults plus optional config additions. */
export function createSecretScanner(options: SecretScannerOptions): SecretScanner {
  const patterns: RegExp[] = [
    ...BUILT_IN_SECRET_PATTERNS.map((pattern) => new RegExp(pattern.source, pattern.flags)),
    ...options.customPatterns.map((pattern) => {
      try {
        return new RegExp(pattern, 'u');
      } catch (error: unknown) {
        throw new MemoryConfigPatternError(pattern, error);
      }
    }),
  ];
  const useEntropy = options.entropyHeuristic;

  const scan = (value: unknown, path = '$'): void => {
    if (typeof value === 'string') {
      if (patterns.some((pattern) => pattern.test(value)) || (useEntropy && looksHighEntropy(value)))
        throw new MemorySecretError(`Suspected secret at ${path}; memory write rejected.`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => scan(item, `${path}[${index}]`));
      return;
    }
    if (isMapping(value)) for (const [key, item] of Object.entries(value)) scan(item, `${path}.${key}`);
  };
  return scan;
}

export class MemorySecretError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MemorySecretError';
  }
}

export class MemoryConfigPatternError extends Error {
  public constructor(pattern: string, cause: unknown) {
    super(`Invalid custom secret pattern: ${pattern}`);
    this.name = 'MemoryConfigPatternError';
    this.cause = cause;
  }
}

/** Entropy gate for unknown token shapes; identical to the v1 heuristic. */
export function looksHighEntropy(value: string, ulidPattern: RegExp = /^[0-9A-HJKMNP-TV-Z]{26}$/u): boolean {
  if (
    value.length < 32 ||
    ulidPattern.test(value) ||
    /^[a-f0-9]{40,64}$/iu.test(value) ||
    /\s/u.test(value) ||
    !/[A-Za-z]/u.test(value) ||
    !/\d/u.test(value)
  )
    return false;
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy >= 4.2;
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Convenience helper deriving scanner options from the resolved memory config. */
export function scannerOptionsFromConfig(config: MemoryConfig): SecretScannerOptions {
  return { customPatterns: config.security.secret_patterns, entropyHeuristic: config.security.entropy_heuristic };
}
