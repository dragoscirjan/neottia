import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

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

const FREE_MODEL_CANDIDATES: string[] = [
  'minimax/minimax-m2.7:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'cohere/north-mini-code:free',
];

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
 * Uses the configured OpenCode binary and the user's stored credentials or
 * explicit OPENROUTER_API_KEY. Set NEOTTIA_TEST_OPENCODE_BIN to override PATH.
 */
export function opencodeBin(): string | undefined {
  const configured = process.env.NEOTTIA_TEST_OPENCODE_BIN;
  return configured ? resolve(configured) : findOnPath('opencode');
}

export function opencodeReady(opencodePath = opencodeBin()): boolean {
  return binExists(opencodePath) && (openrouterApiKey() !== undefined || hasStoredOpenrouterAuth());
}

function storedOpenrouterAuthPath(): string {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(dataHome, 'opencode', 'auth.json');
}

function hasStoredOpenrouterAuth(): boolean {
  const authPath = storedOpenrouterAuthPath();
  if (!existsSync(authPath)) return false;
  try {
    const auth = JSON.parse(readFileSync(authPath, 'utf8')) as Record<string, unknown>;
    const provider = auth.openrouter;
    return (
      provider !== null &&
      typeof provider === 'object' &&
      'key' in provider &&
      typeof (provider as { key?: unknown }).key === 'string' &&
      (provider as { key: string }).key.trim().length > 0
    );
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
  /** Isolated home directory for harnesses that discover global state via HOME. */
  readonly homeDir?: string;
}

export interface HarnessRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
}

/** True when a file exists (PATH hits and absolute paths both work). */
export function binExists(bin: string | undefined): bin is string {
  return typeof bin === 'string' && bin.length > 0 && existsSync(bin);
}

/** Locates an executable on PATH. */
function findOnPath(name: string): string | undefined {
  // Windows separates with ';' and entries may be drive-rooted ('C:\bin').
  const separator = process.platform === 'win32' ? ';' : ':';
  const exts = process.platform === 'win32' ? (process.env.PATHEXT ?? '').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH ?? '').split(separator).filter(Boolean)) {
    for (const ext of exts.length ? exts : ['']) {
      const candidate = join(dir, `${name}${ext}`);
      if (existsSync(candidate)) return resolve(candidate);
    }
  }
  return undefined;
}

/** pi binary; overridable via NEOTTIA_TEST_PI_BIN. */
export function piBin(): string | undefined {
  const configured = process.env.NEOTTIA_TEST_PI_BIN;
  return configured ? resolve(configured) : findOnPath('pi');
}

/** True when pi can call OpenRouter: explicit env key or stored credentials. */
export function piReady(piPath?: string): boolean {
  if (!binExists(piPath)) return false;
  if (openrouterApiKey()) return true;
  const check = spawnSync(piPath as string, ['auth', 'check', '--provider', 'openrouter'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  return check.status === 0;
}

/** Runs `pi -p` with project-local extensions trusted. */
export function runPi(options: HarnessRunOptions & { piPath: string }): HarnessRunResult {
  const { cwd, prompt, piPath } = options;
  const modelId = options.modelId ?? openrouterModelId();
  const env = withApiKey(options.apiKey);
  if (options.xdgDataDir) env.XDG_DATA_HOME = options.xdgDataDir;
  if (options.xdgConfigDir) env.XDG_CONFIG_HOME = options.xdgConfigDir;
  if (options.homeDir) {
    // Pi reads global state beneath HOME; copy only auth into the disposable home.
    if (!env.OPENROUTER_API_KEY) {
      const source = join(homedir(), '.pi', 'agent', 'auth.json');
      if (existsSync(source)) {
        const destination = join(options.homeDir, '.pi', 'agent', 'auth.json');
        mkdirSync(join(destination, '..'), { recursive: true, mode: 0o700 });
        writeFileSync(destination, readFileSync(source), { mode: 0o600 });
      }
    }
    env.HOME = options.homeDir;
  }
  const result = spawnSync(
    piPath,
    ['-p', '--no-session', '--mode', 'text', '-a', '--provider', 'openrouter', '--model', modelId, prompt],
    {
      cwd,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 240_000,
      env,
    },
  );
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status };
}

/** Runs `opencode run` inside the temp project (opencode.json already present). */
export function runOpencode(options: HarnessRunOptions): HarnessRunResult {
  const { cwd, prompt } = options;
  const model = `openrouter/${options.modelId ?? openrouterModelId()}`;
  const env = withApiKey(options.apiKey);
  const opencodePath = opencodeBin();
  if (!opencodePath) return { stdout: '', stderr: 'OpenCode binary not found.', status: 127 };
  if (options.xdgDataDir) {
    // Isolated auth: a fresh auth.json built from the effective key, so a
    // stale stored credential on the host cannot break the run.
    const key = env.OPENROUTER_API_KEY;
    const authDir = join(options.xdgDataDir, 'opencode');
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    const authPath = join(authDir, 'auth.json');
    if (key) {
      writeFileSync(authPath, JSON.stringify({ openrouter: { type: 'api', key } }), { mode: 0o600 });
    } else if (hasStoredOpenrouterAuth()) {
      writeFileSync(authPath, readFileSync(storedOpenrouterAuthPath()), { mode: 0o600 });
    }
    env.XDG_DATA_HOME = options.xdgDataDir;
  }
  if (options.xdgConfigDir) env.XDG_CONFIG_HOME = options.xdgConfigDir;
  if (options.homeDir) env.HOME = options.homeDir;
  const result = spawnSync(opencodePath, ['run', '--model', model, prompt], {
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

/** Ordered ':free' model ids: preferred candidates first, then the catalog. */
export function freeModelFallbackIds(): string[] {
  const override = process.env.NEOTTIA_TEST_OPENROUTER_MODEL;
  if (override) return [override];
  const catalog = fetchCatalog()
    .map((model) => model.id)
    .filter((id) => id.endsWith(':free'));
  const preferred = FREE_MODEL_CANDIDATES.filter((candidate) => catalog.includes(candidate));
  return [...preferred, ...catalog.filter((id) => !preferred.includes(id)).sort()];
}

export function isTransientModelError(result: HarnessRunResult): boolean {
  return /429|rate.?limit|temporarily|overloaded|upstream error|EHOSTUNREACH|connection refused/iu.test(
    result.stderr + result.stdout,
  );
}

/**
 * Runs opencode, falling back through up to five free models when the
 * upstream free pool is rate-limited (429). Non-transient failures return
 * immediately.
 */
export function runOpencodeWithModelFallback(
  options: HarnessRunOptions,
  attempts = 5,
): { result: HarnessRunResult; modelId: string } {
  const ids = freeModelFallbackIds().slice(0, attempts);
  if (ids.length === 0) throw new Error('No free OpenRouter models available for the harness fallback.');
  let modelId = ids[0] as string;
  let last: HarnessRunResult = runOpencode({ ...options, modelId });
  for (const candidate of ids.slice(1)) {
    if (last.status === 0 || !isTransientModelError(last)) return { result: last, modelId };
    modelId = candidate;
    last = runOpencode({ ...options, modelId });
  }
  return { result: last, modelId };
}

/** pi variant of {@link runOpencodeWithModelFallback}. */
export function runPiWithModelFallback(
  options: HarnessRunOptions & { piPath: string },
  attempts = 5,
): { result: HarnessRunResult; modelId: string } {
  const ids = freeModelFallbackIds().slice(0, attempts);
  if (ids.length === 0) throw new Error('No free OpenRouter models available for the harness fallback.');
  let modelId = ids[0] as string;
  let last: HarnessRunResult = runPi({ ...options, modelId });
  for (const candidate of ids.slice(1)) {
    if (last.status === 0 || !isTransientModelError(last)) return { result: last, modelId };
    modelId = candidate;
    last = runPi({ ...options, modelId });
  }
  return { result: last, modelId };
}

/**
 * Requires a live harness attempt to reach a conclusive provider outcome.
 * Exhausted transient providers fail the optional live task instead of
 * turning its acceptance cases into passing dynamic skips.
 */
export function assertHarnessConclusive(result: HarnessRunResult): void {
  if (isTransientModelError(result)) {
    throw new Error(
      `Live harness acceptance was inconclusive after transient provider failures:\n${(
        result.stderr + result.stdout
      ).slice(-2000)}`,
    );
  }
  assertHarnessSuccess(result);
}

/** Throws with a tail of stderr when a harness run failed. */
export function assertHarnessSuccess(result: HarnessRunResult): void {
  if (result.status !== 0) {
    throw new Error(
      `harness run failed (status ${result.status}):\n--- stdout ---\n${result.stdout.slice(-2000)}\n--- stderr ---\n${result.stderr.slice(-2000)}`,
    );
  }
}
