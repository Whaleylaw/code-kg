import type { EmbeddingProvider } from './provider.js';

const MAX_REMOTE_BATCH = 2048;
const MAX_LOCAL_BATCH = 32;

type FeatureExtractionPipeline = (
  input: string | string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): unknown }>;

const localPipelines = new Map<string, Promise<FeatureExtractionPipeline>>();

async function getLocalPipeline(
  model: string,
): Promise<FeatureExtractionPipeline> {
  let pipelinePromise = localPipelines.get(model);
  if (!pipelinePromise) {
    pipelinePromise = import('@huggingface/transformers').then(
      async ({ pipeline }) =>
        (await pipeline(
          'feature-extraction',
          model,
        )) as FeatureExtractionPipeline,
    );
    localPipelines.set(model, pipelinePromise);
  }
  return pipelinePromise;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'number')
  );
}

function isNumberMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every((item) => isNumberArray(item));
}

function normalizeLocalVectors(value: unknown): number[][] {
  if (isNumberArray(value)) return [value];
  if (isNumberMatrix(value)) return value;
  throw new Error(
    'Local embedding model returned an unsupported tensor shape.',
  );
}

async function embedLocal(
  texts: string[],
  provider: EmbeddingProvider,
): Promise<number[][]> {
  if (provider.kind !== 'local') {
    throw new Error('embedLocal requires a local embedding provider.');
  }

  const extractor = await getLocalPipeline(provider.model);
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_LOCAL_BATCH) {
    const batch = texts.slice(i, i + MAX_LOCAL_BATCH);
    const tensor = await extractor(batch, { pooling: 'mean', normalize: true });
    const vectors = normalizeLocalVectors(tensor.tolist());

    if (vectors.length !== batch.length) {
      throw new Error(
        `Local embedding model returned ${vectors.length} vector(s) for ${batch.length} input(s).`,
      );
    }

    for (const vector of vectors) {
      if (vector.length !== provider.dimensions) {
        throw new Error(
          `Local embedding model returned ${vector.length} dimensions; expected ${provider.dimensions}. Set LAT_LOCAL_EMBEDDING_DIMENSIONS if you changed LAT_LOCAL_EMBEDDING_MODEL.`,
        );
      }
      results.push(vector);
    }
  }

  return results;
}

export async function embed(
  texts: string[],
  provider: EmbeddingProvider,
  key: string,
): Promise<number[][]> {
  if (provider.kind === 'local') {
    return embedLocal(texts, provider);
  }

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_REMOTE_BATCH) {
    const batch = texts.slice(i, i + MAX_REMOTE_BATCH);
    const resp = await fetch(`${provider.apiBase}/embeddings`, {
      method: 'POST',
      headers: provider.headers(key),
      body: JSON.stringify({
        model: provider.model,
        input: batch,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(
        `Embedding API error (${resp.status}): ${body.slice(0, 200)}`,
      );
    }

    const json = (await resp.json()) as {
      data: { embedding: number[]; index: number }[];
    };
    const sorted = json.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      results.push(item.embedding);
    }
  }

  return results;
}
