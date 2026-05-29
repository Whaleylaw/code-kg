import { getLocalEmbeddingModelConfig } from '../config.js';

export type RemoteEmbeddingProvider = {
  kind: 'remote';
  name: string;
  apiBase: string;
  model: string;
  dimensions: number;
  headers: (key: string) => Record<string, string>;
};

export type LocalEmbeddingProvider = {
  kind: 'local';
  name: 'local';
  model: string;
  dimensions: number;
};

export type EmbeddingProvider =
  | RemoteEmbeddingProvider
  | LocalEmbeddingProvider;

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const DEFAULT_LOCAL_EMBEDDING_DIMENSIONS = 384;

const openai: RemoteEmbeddingProvider = {
  kind: 'remote',
  name: 'openai',
  apiBase: 'https://api.openai.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

const vercel: RemoteEmbeddingProvider = {
  kind: 'remote',
  name: 'vercel',
  apiBase: 'https://ai-gateway.vercel.sh/v1',
  model: 'openai/text-embedding-3-small',
  dimensions: 1536,
  headers: (key) => ({
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  }),
};

function localProvider(): LocalEmbeddingProvider {
  const config = getLocalEmbeddingModelConfig();
  const dimensions = process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS
    ? parseInt(process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS, 10)
    : (config.dimensions ?? DEFAULT_LOCAL_EMBEDDING_DIMENSIONS);
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new Error(
      'LAT_LOCAL_EMBEDDING_DIMENSIONS must be a positive integer.',
    );
  }

  return {
    kind: 'local',
    name: 'local',
    model: process.env.LAT_LOCAL_EMBEDDING_MODEL?.trim()
      ? process.env.LAT_LOCAL_EMBEDDING_MODEL.trim()
      : (config.model ?? DEFAULT_LOCAL_EMBEDDING_MODEL),
    dimensions,
  };
}

export function detectProvider(key: string): EmbeddingProvider {
  if (key === 'local') return localProvider();
  if (key.startsWith('REPLAY_LAT_LLM_KEY::')) {
    const replayUrl = key.slice('REPLAY_LAT_LLM_KEY::'.length);
    return {
      kind: 'remote',
      name: 'replay',
      apiBase: replayUrl,
      model: 'replay',
      dimensions: 1536,
      headers: () => ({ 'Content-Type': 'application/json' }),
    };
  }
  if (key.startsWith('sk-ant-')) {
    throw new Error(
      "Anthropic doesn't offer an embedding model. Set LAT_LLM_KEY to an OpenAI (sk-...) or Vercel AI Gateway (vck_...) key.",
    );
  }
  if (key.startsWith('vck_')) return vercel;
  if (key.startsWith('sk-')) return openai;
  throw new Error(
    `Unrecognized LAT_LLM_KEY prefix. Supported: local, OpenAI (sk-...), Vercel AI Gateway (vck_...).`,
  );
}
