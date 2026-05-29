import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectProvider,
  type EmbeddingProvider,
} from '../src/search/provider.js';
import { openDb, ensureSchema, closeDb } from '../src/search/db.js';
import { indexSections } from '../src/search/index.js';
import { searchSections } from '../src/search/search.js';
import { startReplayServer, hasReplayData } from './rag-replay-server.js';
import { getEmbeddingKey, writeConfig } from '../src/config.js';
import type { Client } from '@libsql/client';
import type { Server } from 'node:http';

// --- Unit tests (always run) ---

// @lat: [[search#Provider Detection]]
describe('detectProvider', () => {
  it('detects OpenAI key', () => {
    const p = detectProvider('sk-abc123');
    expect(p.name).toBe('openai');
  });

  it('detects local embedding provider', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lat-provider-'));
    const originalModel = process.env.LAT_LOCAL_EMBEDDING_MODEL;
    const originalDimensions = process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;
    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmp;
    delete process.env.LAT_LOCAL_EMBEDDING_MODEL;
    delete process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;

    try {
      const p = detectProvider('local');
      expect(p.name).toBe('local');
      expect(p.kind).toBe('local');
      expect(p.model).toBe('Xenova/bge-small-en-v1.5');
      expect(p.dimensions).toBe(384);
    } finally {
      if (originalModel === undefined) {
        delete process.env.LAT_LOCAL_EMBEDDING_MODEL;
      } else {
        process.env.LAT_LOCAL_EMBEDDING_MODEL = originalModel;
      }
      if (originalDimensions === undefined) {
        delete process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;
      } else {
        process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS = originalDimensions;
      }
      if (originalConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalConfigHome;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects invalid local embedding dimensions', () => {
    const originalDimensions = process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;
    process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS = 'abc';

    try {
      expect(() => detectProvider('local')).toThrow(
        /LAT_LOCAL_EMBEDDING_DIMENSIONS/,
      );
    } finally {
      if (originalDimensions === undefined) {
        delete process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;
      } else {
        process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS = originalDimensions;
      }
    }
  });

  it('uses persisted local model settings', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lat-provider-config-'));
    const originalConfigHome = process.env.XDG_CONFIG_HOME;
    const originalModel = process.env.LAT_LOCAL_EMBEDDING_MODEL;
    const originalDimensions = process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;

    try {
      process.env.XDG_CONFIG_HOME = tmp;
      delete process.env.LAT_LOCAL_EMBEDDING_MODEL;
      delete process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;
      writeConfig({
        embedding_provider: 'local',
        local_embedding_model: 'local/test-model',
        local_embedding_dimensions: 256,
      });

      const p = detectProvider('local');

      expect(p.kind).toBe('local');
      expect(p.model).toBe('local/test-model');
      expect(p.dimensions).toBe(256);
    } finally {
      if (originalConfigHome === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalConfigHome;
      }
      if (originalModel === undefined) {
        delete process.env.LAT_LOCAL_EMBEDDING_MODEL;
      } else {
        process.env.LAT_LOCAL_EMBEDDING_MODEL = originalModel;
      }
      if (originalDimensions === undefined) {
        delete process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;
      } else {
        process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS = originalDimensions;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('detects Vercel key', () => {
    const p = detectProvider('vck_abc123');
    expect(p.name).toBe('vercel');
  });

  it('rejects Anthropic key with helpful message', () => {
    expect(() => detectProvider('sk-ant-abc123')).toThrow(/Anthropic/);
  });

  it('rejects unknown key', () => {
    expect(() => detectProvider('xyz_abc123')).toThrow(/Unrecognized/);
  });
});

describe('ensureSchema', () => {
  it('rebuilds vector tables when embedding dimensions change', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lat-schema-'));
    const latDir = join(tmp, 'lat.md');
    let db: Client | undefined;

    try {
      db = openDb(latDir);
      await ensureSchema(db, 1536);
      await ensureSchema(db, 384);

      const rows = await db.execute({
        sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sections'",
      });
      expect(rows.rows[0].sql).toContain('F32_BLOB(384)');
    } finally {
      if (db) await closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('embedding config', () => {
  it('uses persisted local embedding provider when no env key is set', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lat-config-'));
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
    };

    try {
      process.env.XDG_CONFIG_HOME = tmp;
      delete process.env.LAT_EMBEDDING_PROVIDER;
      delete process.env.LAT_LLM_KEY;
      delete process.env.LAT_LLM_KEY_FILE;
      delete process.env.LAT_LLM_KEY_HELPER;

      writeConfig({ embedding_provider: 'local' });

      expect(getEmbeddingKey()).toBe('local');
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not fall back to persisted local provider when remote env provider is explicit', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lat-config-'));
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
    };

    try {
      process.env.XDG_CONFIG_HOME = tmp;
      process.env.LAT_EMBEDDING_PROVIDER = 'openai';
      delete process.env.LAT_LLM_KEY;
      delete process.env.LAT_LLM_KEY_FILE;
      delete process.env.LAT_LLM_KEY_HELPER;
      writeConfig({ embedding_provider: 'local' });

      expect(getEmbeddingKey()).toBeUndefined();
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// --- RAG functional tests ---
//
// Two modes:
// - Normal (default): replays cached vectors from tests/cases/rag/replay-data/
// - Capture (_LAT_TEST_CAPTURE_EMBEDDINGS=1): proxies to real API via LAT_LLM_KEY,
//   records vectors to replay-data/, then runs assertions against live results
//
// To re-cook: pnpm cook-test-rag

const capturing = !!process.env._LAT_TEST_CAPTURE_EMBEDDINGS;
const replayDir = join(import.meta.dirname, 'cases', 'rag', 'replay-data');
const canRun = capturing || hasReplayData(replayDir);

describe.skipIf(!canRun)('search (rag)', () => {
  let tmp: string;
  let latDir: string;
  let db: Client;
  let server: Server;
  let provider: EmbeddingProvider;
  let replayKey: string;
  let flushCapture: () => void;

  beforeAll(async () => {
    if (capturing) {
      // Capture mode: proxy to real API, record vectors
      const realKey = process.env.LAT_LLM_KEY;
      if (!realKey) throw new Error('LAT_LLM_KEY must be set in capture mode');
      const realProvider = detectProvider(realKey);
      if (realProvider.kind !== 'remote') {
        throw new Error('Capture mode requires a remote embedding provider.');
      }

      const replay = await startReplayServer(replayDir, {
        capture: true,
        provider: realProvider,
        key: realKey,
      });
      server = replay.server;
      flushCapture = replay.flush;
      replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;
      provider = detectProvider(replayKey);
    } else {
      // Replay mode: serve cached vectors
      const replay = await startReplayServer(replayDir);
      server = replay.server;
      flushCapture = replay.flush;
      replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;
      provider = detectProvider(replayKey);
    }

    // Copy fixture to tmp so .cache doesn't pollute the repo
    tmp = mkdtempSync(join(tmpdir(), 'lat-rag-'));
    latDir = join(tmp, 'lat.md');
    cpSync(join(import.meta.dirname, 'cases', 'rag', 'lat.md'), latDir, {
      recursive: true,
    });

    db = openDb(latDir);
    await ensureSchema(db, provider.dimensions);
  });

  afterAll(async () => {
    if (capturing) flushCapture();
    if (db) await closeDb(db);
    if (server) server.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  // @lat: [[search#RAG Replay Tests#Indexes all sections]]
  it('indexes all sections', async () => {
    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.added).toBe(9);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.unchanged).toBe(0);
  });

  // @lat: [[search#RAG Replay Tests#Finds auth section for login query]]
  it('finds auth section for login query', async () => {
    const results = await searchSections(
      db,
      'how do we handle user login and security?',
      provider,
      replayKey,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Authentication');
  });

  // @lat: [[search#RAG Replay Tests#Finds performance section for latency query]]
  it('finds performance section for latency query', async () => {
    const results = await searchSections(
      db,
      'what tools do we use to measure response times?',
      provider,
      replayKey,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Performance');
  });

  // @lat: [[search#RAG Replay Tests#Incremental index skips unchanged sections]]
  it('incremental index skips unchanged sections', async () => {
    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.unchanged).toBe(9);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
  });

  // @lat: [[search#RAG Replay Tests#Detects deleted sections when file is removed]]
  it('detects deleted sections when file is removed', async () => {
    rmSync(join(latDir, 'testing.md'));

    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.removed).toBe(4); // testing + unit + integration + performance
    expect(stats.unchanged).toBe(5); // architecture sections remain
  });
});

describe.skipIf(process.env.LAT_TEST_LOCAL_EMBEDDINGS !== '1')(
  'search (local embeddings eval)',
  () => {
    let tmp: string;
    let latDir: string;
    let db: Client;
    let provider: EmbeddingProvider;

    beforeAll(async () => {
      tmp = mkdtempSync(join(tmpdir(), 'lat-local-embeddings-'));
      latDir = join(tmp, 'lat.md');
      cpSync(join(import.meta.dirname, 'cases', 'rag', 'lat.md'), latDir, {
        recursive: true,
      });

      provider = detectProvider('local');
      db = openDb(latDir);
      await ensureSchema(db, provider.dimensions);
      await indexSections(latDir, db, provider, 'local');
    });

    afterAll(async () => {
      if (db) await closeDb(db);
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    });

    it('finds auth documentation for login/security query', async () => {
      const results = await searchSections(
        db,
        'how do we handle user login and security?',
        provider,
        'local',
        3,
      );

      expect(results.map((result) => result.id)).toContain(
        'lat.md/architecture#Architecture#Authentication',
      );
    });

    it('finds performance documentation for latency query', async () => {
      const results = await searchSections(
        db,
        'what tools do we use to measure response times?',
        provider,
        'local',
        3,
      );

      expect(results.map((result) => result.id)).toContain(
        'lat.md/testing#Testing Strategy#Performance Tests',
      );
    });
  },
);
