import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import xdg from '@folder/xdg';

// ── XDG config directory ────────────────────────────────────────────

export function getConfigDir(): string {
  return join(xdg().config, 'lat');
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'config.json');
}

// ── Config read/write ───────────────────────────────────────────────

export type LatConfig = {
  llm_key?: string;
  embedding_provider?: 'local' | 'openai' | 'vercel' | string;
  local_embedding_model?: string;
  local_embedding_dimensions?: number;
};

export function readConfig(): LatConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (err) {
    process.stderr.write(
      `Error: failed to parse config ${configPath}: ${(err as Error).message}\n`,
    );
    process.exit(1);
  }
}

export function writeConfig(config: LatConfig): void {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + '\n');
}

// ── Centralized LLM key resolution ─────────────────────────────────

/**
 * Returns the LLM key from (in priority order):
 * 1. LAT_LLM_KEY environment variable
 * 2. LAT_LLM_KEY_FILE — path to a file containing the key
 * 3. LAT_LLM_KEY_HELPER — shell command that prints the key
 * 4. llm_key field in ~/.config/lat/config.json
 *
 * Returns undefined if none is set.
 */
function getEnvLlmKey(): string | undefined {
  const envKey = process.env.LAT_LLM_KEY;
  if (envKey) return envKey;

  const file = process.env.LAT_LLM_KEY_FILE;
  if (file) {
    const content = readFileSync(file, 'utf-8').trim();
    if (!content) {
      throw new Error(`LAT_LLM_KEY_FILE (${file}) is empty.`);
    }
    return content;
  }

  const helper = process.env.LAT_LLM_KEY_HELPER;
  if (helper) {
    const result = execSync(helper, {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    if (!result) {
      throw new Error('LAT_LLM_KEY_HELPER command returned an empty string.');
    }
    return result;
  }

  return undefined;
}

export function getEmbeddingKey(): string | undefined {
  const envProvider = process.env.LAT_EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (envProvider) {
    if (envProvider === 'local') return 'local';
    if (envProvider !== 'openai' && envProvider !== 'vercel') {
      throw new Error(
        'LAT_EMBEDDING_PROVIDER must be local, openai, or vercel.',
      );
    }
    const envKey = getEnvLlmKey();
    if (envKey) return envKey;

    const config = readConfig();
    return config.llm_key;
  }

  const envKey = getEnvLlmKey();
  if (envKey) return envKey;

  const config = readConfig();
  const provider = config.embedding_provider?.trim().toLowerCase();
  if (provider) {
    if (provider === 'local') return 'local';
    if (provider !== 'openai' && provider !== 'vercel') {
      throw new Error('embedding_provider must be local, openai, or vercel.');
    }
  }

  if (config.llm_key) return config.llm_key;

  return undefined;
}

export function getLlmKey(): string | undefined {
  const envKey = getEnvLlmKey();
  if (envKey) return envKey;

  const config = readConfig();
  if (config.llm_key) return config.llm_key;

  return undefined;
}

export function getLocalEmbeddingModelConfig(): {
  model?: string;
  dimensions?: number;
} {
  const config = readConfig();
  return {
    model: config.local_embedding_model,
    dimensions: config.local_embedding_dimensions,
  };
}

export function saveLocalEmbeddingConfig(): void {
  writeConfig({
    ...readConfig(),
    embedding_provider: 'local',
  });
}

export function saveRemoteEmbeddingKey(key: string): void {
  const provider = key.startsWith('vck_') ? 'vercel' : 'openai';
  writeConfig({
    ...readConfig(),
    embedding_provider: provider,
    llm_key: key,
  });
}

export function hasEmbeddingConfig(): boolean {
  try {
    return !!getEmbeddingKey();
  } catch {
    return false;
  }
}
