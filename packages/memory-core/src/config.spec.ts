import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import {
  CONFIG_FILE_ENV,
  CREDENTIAL_DEFAULTS,
  DEFAULT_SHARD_PATH,
  MEMORY_CONFIG_FILE_ENV,
  MEMORY_SHARD_PATH_ENV,
  ConfigError,
  loadMemoryConfig,
  resolveConfigFile,
  resolveShardPath,
} from './index.js';

function fixture(): string {
  return mkdtempSync(join(tmpdir(), 'neottia-memory-config-'));
}

function writeConfig(cwd: string, config: unknown, file = '.neottia/config.yml'): string {
  const path = join(cwd, file);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, stringify(config, { lineWidth: 0 }), 'utf8');
  return path;
}

describe('memory config shard', () => {
  it('resolves defaults when the config file is missing', () => {
    const cwd = fixture();
    try {
      const config = loadMemoryConfig(cwd);
      expect(config).toMatchObject({
        enabled: false,
        root: '.neottia/memory',
        backend: 'filesystem',
        namespace: { organization_id: 'local', project_id: 'project', default_topic: 'general', scope: 'global' },
        retrieval: { limit: 8, max_chars: 12000, include_superseded: false },
        cache: { max_age_ms: 300000, stale_policy: 'prompt' },
        security: { entropy_heuristic: true, secret_patterns: [] },
      });
      expect(config.provider.db.pg.user).toBeUndefined();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reads the shard from the harnessctl-shaped config object', () => {
    const cwd = fixture();
    try {
      writeConfig(cwd, {
        version: 1,
        skills: { memory: { enabled: true, root: '.neottia/custom-memory', namespace: { project_id: 'acme' } } },
      });
      const config = loadMemoryConfig(cwd);
      expect(config.enabled).toBe(true);
      expect(config.root).toBe('.neottia/custom-memory');
      expect(config.namespace.project_id).toBe('acme');
      expect(config.namespace.organization_id).toBe('local');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects a config file without an explicit version', () => {
    const cwd = fixture();
    try {
      writeConfig(cwd, { skills: { memory: { enabled: true } } });
      expect(() => loadMemoryConfig(cwd)).toThrow(ConfigError);
      expect(() => loadMemoryConfig(cwd)).toThrow(/version/u);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects malformed YAML and non-mapping roots', () => {
    const cwd = fixture();
    try {
      const path = writeConfig(cwd, {});
      writeFileSync(path, 'version: 1\nskills: [unclosed\n', 'utf8');
      expect(() => loadMemoryConfig(cwd)).toThrow(/Malformed YAML/u);

      writeFileSync(path, '- just\n- a list\n', 'utf8');
      expect(() => loadMemoryConfig(cwd)).toThrow(/mapping/u);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('honors structural env variables for file location and shard path', () => {
    const cwd = fixture();
    try {
      const custom = writeConfig(cwd, { version: 1, memory: { enabled: true } }, 'custom.yml');
      const config = loadMemoryConfig(cwd, {
        env: { [CONFIG_FILE_ENV]: custom, [MEMORY_SHARD_PATH_ENV]: 'memory' } as NodeJS.ProcessEnv,
      });
      expect(config.enabled).toBe(true);
      expect(resolveConfigFile(cwd, { [MEMORY_CONFIG_FILE_ENV]: custom } as NodeJS.ProcessEnv)).toBe(custom);
      expect(resolveShardPath({ [MEMORY_SHARD_PATH_ENV]: 'a.b.c' } as NodeJS.ProcessEnv)).toBe('a.b.c');
      expect(resolveShardPath()).toBe(DEFAULT_SHARD_PATH);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('applies env bindings over file values but under explicit overrides', () => {
    const cwd = fixture();
    try {
      writeConfig(cwd, {
        version: 1,
        skills: { memory: { enabled: true, retrieval: { limit: 3 } } },
      });
      const env = {
        NEOTTIA_MEMORY_RETRIEVAL_LIMIT: '20',
        NEOTTIA_MEMORY_NAMESPACE_PROJECT_ID: 'env-project',
        NEOTTIA_MEMORY_ENABLED: 'true',
      } as NodeJS.ProcessEnv;
      const config = loadMemoryConfig(cwd, { env });
      expect(config.retrieval.limit).toBe(20);
      expect(config.namespace.project_id).toBe('env-project');

      const overridden = loadMemoryConfig(cwd, { env, retrieval: { limit: 5 } });
      expect(overridden.retrieval.limit).toBe(5);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects malformed env values with the variable name in the error', () => {
    const cwd = fixture();
    try {
      expect(() =>
        loadMemoryConfig(cwd, { env: { NEOTTIA_MEMORY_RETRIEVAL_LIMIT: 'many' } as NodeJS.ProcessEnv }),
      ).toThrow(/NEOTTIA_MEMORY_RETRIEVAL_LIMIT/u);
      expect(() => loadMemoryConfig(cwd, { env: { NEOTTIA_MEMORY_ENABLED: 'maybe' } as NodeJS.ProcessEnv })).toThrow(
        /NEOTTIA_MEMORY_ENABLED/u,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('accepts ${VAR} credential references but rejects literal credentials', () => {
    const cwd = fixture();
    try {
      const referenced = loadMemoryConfig(cwd, {
        env: { PG_USER: 'memory_user', PG_PASSWORD: 'memory_password' } as NodeJS.ProcessEnv,
        backend: 'postgres',
        provider: { db: { pg: { user: '${PG_USER}', password: '${PG_PASSWORD}' } } },
      });
      expect(referenced.provider.db.pg.user).toBe('memory_user');
      expect(referenced.provider.db.pg.password).toBe('memory_password');

      expect(() =>
        loadMemoryConfig(cwd, {
          backend: 'postgres',
          provider: { db: { pg: { user: 'literal-user' } } },
        }),
      ).toThrow(ConfigError);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('falls back to credential default env vars and fails on unset ${VAR} references', () => {
    const cwd = fixture();
    try {
      const withDefaults = loadMemoryConfig(cwd, {
        env: { NEOTTIA_MEMORY_DB_PG_USER: 'fallback-user' } as NodeJS.ProcessEnv,
        backend: 'postgres',
      });
      expect(withDefaults.provider.db.pg.user).toBe('fallback-user');

      expect(() =>
        loadMemoryConfig(cwd, {
          env: {} as NodeJS.ProcessEnv,
          backend: 'postgres',
          provider: { db: { pg: { password: '${MISSING_VAR}' } } },
        }),
      ).toThrow(/MISSING_VAR/u);
      expect(Object.values(CREDENTIAL_DEFAULTS)).toContain('NEOTTIA_MEMORY_DB_PG_PASSWORD');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects unknown shard keys and unsafe root paths', () => {
    const cwd = fixture();
    try {
      writeConfig(cwd, { version: 1, skills: { memory: { enabled: true, nonsense: true } } });
      expect(() => loadMemoryConfig(cwd)).toThrow(/nonsense/u);

      writeConfig(cwd, { version: 1, skills: { memory: { enabled: true, root: '../escape' } } });
      expect(() => loadMemoryConfig(cwd)).toThrow(ConfigError);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('ignores unrelated sections of the shared config object', () => {
    const cwd = fixture();
    try {
      writeConfig(cwd, {
        version: 1,
        mcpServers: { whatever: { command: 'x' } },
        skills: { issues: { enabled: true }, memory: { enabled: true } },
      });
      expect(loadMemoryConfig(cwd).enabled).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('exposes env bindings for every schema leaf that declares one', () => {
    // Every binding must resolve through the schema without error.
    const env: Record<string, string> = {
      NEOTTIA_MEMORY_ENABLED: 'true',
      NEOTTIA_MEMORY_BACKEND: 'postgres',
      NEOTTIA_MEMORY_RETRIEVAL_LIMIT: '20',
      NEOTTIA_MEMORY_RETRIEVAL_MAX_CHARS: '20000',
      NEOTTIA_MEMORY_CACHE_MAX_AGE_MS: '1000',
      NEOTTIA_MEMORY_CACHE_STALE_POLICY: 'rebuild',
      NEOTTIA_MEMORY_DB_PG_PORT: '5433',
      NEOTTIA_MEMORY_DB_PG_SSL: 'false',
      NEOTTIA_MEMORY_RETRIEVAL_INCLUDE_SUPERSEDED: 'true',
      NEOTTIA_MEMORY_SECURITY_ENTROPY_HEURISTIC: 'false',
    };
    const cwd = fixture();
    try {
      const config = loadMemoryConfig(cwd, { env: env as NodeJS.ProcessEnv });
      expect(config).toMatchObject({
        enabled: true,
        backend: 'postgres',
        retrieval: { limit: 20, max_chars: 20000, include_superseded: true },
        cache: { max_age_ms: 1000, stale_policy: 'rebuild' },
        provider: { db: { pg: { port: 5433, ssl: false } } },
        security: { entropy_heuristic: false },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
