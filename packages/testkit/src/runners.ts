import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Gating + binary resolution for harness integration tests. Tests skip
 * cleanly when a prerequisite is missing so `mise run validate` and CI stay
 * green without API keys or harness installations.
 */

/** OpenRouter API key enabling harness tests; harness tests skip without it. */
export function openrouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined;
}

/**
 * Free-tier OpenRouter model used by harness tests. Free models rotate, so
 * the id is resolved live from OpenRouter's public catalog unless explicitly
 * overridden via NEOTTIA_TEST_OPENROUTER_MODEL.
 */
export function openrouterModelId(): string {
  return process.env.NEOTTIA_TEST_OPENROUTER_MODEL || resolveFreeOpenRouterModel();
}

const FREE_MODEL_CANDIDATES = [
  'minimax/minimax-m2.7:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'cohere/north-mini-code:free',
] as const;

/** Picks the first available ':free' model; deterministic between candidates. */
export function resolveFreeOpenRouterModel(catalog: Array<{ id: string }> = fetchCatalog()): string {
  const ids = new Set(catalog.map((model) => model.id));
  for (const candidate of FREE_MODEL_CANDIDATES) if (ids.has(candidate)) return candidate;
  const free = catalog
    .map((model) => model.id)
    .filter((id) => id.endsWith(':free'))
    .sort();
  if (free.length > 0) return free[0] as string;
  throw new Error('No free OpenRouter models available; set NEOTTIA_TEST_OPENROUTER_MODEL explicitly.');
}

let catalogCache: Array<{ id: string }> | undefined;

function fetchCatalog(): Array<{ id: string }> {
  catalogCache ??= requestCatalog();
  return catalogCache;
}

function requestCatalog(): Array<{ id: string }> {
  const result = spawnSync('curl', ['-sS', '--max-time', '20', 'https://openrouter.ai/api/v1/models'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (result.status !== 0) throw new Error(`Cannot reach the OpenRouter catalog: ${result.stderr}`);
  const parsed = JSON.parse(result.stdout) as { data?: Array<{ id: string }> };
  if (!Array.isArray(parsed.data)) throw new Error('Unexpected OpenRouter catalog response.');
  return parsed.data;
}

/** Full model spec for OpenCode (`provider/model`). */
export function opencodeModel(): string {
  return `openrouter/${openrouterModelId()}`;
}

/**
 * Runs opencode through `npx -y opencode-ai`, so tests never depend on a
 * locally installed binary or version. Auth comes from the user's stored
 * OpenCode credentials or an explicit OPENROUTER_API_KEY.
 */
export function opencodeReady(): boolean {
  return openrouterApiKey() !== undefined || hasStoredOpenrouterAuth();
}

function hasStoredOpenrouterAuth(): boolean {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  const authPath = join(dataHome, 'opencode', 'auth.json');
  if (!existsSync(authPath)) return false;
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>;
    return 'openrouter' in auth;
  } catch {
    return false;
  }
}

export interface HarnessRunOptions {
  readonly cwd: string;
  readonly prompt: string;
  readonly modelId?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
  /** Isolated XDG data dir; when set, opencode auth is written inside it. */
  readonly xdgDataDir?: string;
  /** Isolated XDG config dir; when set, global harness config cannot leak in. */
  readonly xdgConfigDir?: string;
}

export interface HarnessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}

/** Runs `opencode run` inside the temp project (opencode.json already present). */
export function runOpencode(options: HarnessRunOptions): HarnessRunResult {
  const { cwd, prompt } = options;
  const model = `openrouter/${options.modelId ?? openrouterModelId()}`;
  const env = withApiKey(options.apiKey);
  if (options.xdgDataDir) {
    // Isolated auth: a fresh auth.json built from the effective key, so a
    // stale stored credential on the host cannot break the run.
    const key = env.OPENROUTER_API_KEY;
    if (key) {
      const authDir = join(options.xdgDataDir, 'opencode');
      mkdirSync(authDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(authDir, 'auth.json'), JSON.stringify({ openrouter: { type: 'api', key } }), {
        mode: 0o600,
      });
    }
    env.XDG_DATA_HOME = options.xdgDataDir;
    if (options.xdgConfigDir) env.XDG_CONFIG_HOME = options.xdgConfigDir;
  }
  const result = spawnSync('npx', ['-y', 'opencode-ai', 'run', '--model', model, prompt], {
    cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 240_000,
    env,
  });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

/**
 * Injects the API key only when explicitly provided: an empty value would
 * shadow pi's stored credentials.
 */
function withApiKey(key?: string): NodeJS.ProcessEnv {
  const explicit = key ?? openrouterApiKey();
  return explicit ? { ...process.env, OPENROUTER_API_KEY: explicit } : { ...process.env };
}

/** Throws with a tail of stderr when a harness run failed. */
export function assertHarnessSuccess(result: HarnessRunResult): void {
  if (result.status !== 0) {
    throw new Error(
      `harness run failed (status ${result.status}):\n--- stdout ---\n${result.stdout.slice(-2000)}\n--- stderr ---\n${result.stderr.slice(-2000)}`,
    );
  }
}
