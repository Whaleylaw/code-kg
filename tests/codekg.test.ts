import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  unlink,
  chmod,
  stat,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { delimiter } from 'node:path';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBootstrapPlan,
  formatMaterializationPreview,
  formatBootstrapPreview,
  writeBootstrapPlan,
} from '../src/codekg/bootstrap.js';
import { plainStyler, type CmdContext } from '../src/context.js';
import {
  codeKgSearchCommand,
  localSearchCommand,
  selectCodeKgSearchBackend,
} from '../src/codekg/search.js';
import { codeKgCheckCommand } from '../src/codekg/check.js';
import { extractProjectGraph, writeGraphCache } from '../src/codekg/graph.js';
import { driftCommand } from '../src/codekg/drift.js';
import { reconcileCommand } from '../src/codekg/reconcile.js';
import { confidenceCommand } from '../src/codekg/confidence.js';
import { suppressCommand } from '../src/codekg/suppress.js';
import { applyBacklinksCommand } from '../src/codekg/backlinks.js';
import { backlinkAnchorsForSection } from '../src/codekg/anchors.js';
import {
  agentsCommand,
  hookCheckCommand,
  sessionCheckCommand,
} from '../src/codekg/agents.js';
import { createCodeKgMcpServer } from '../src/codekg/mcp.js';
import { doctorCommand } from '../src/codekg/doctor.js';
import { discoverProject } from '../src/codekg/discovery.js';
import { installGlobalCommand } from '../src/codekg/global-install.js';
import { semanticCommand } from '../src/codekg/semantic.js';
import { contextCommand } from '../src/codekg/context.js';
import { gapsCommand } from '../src/codekg/gaps.js';
import { changedCommand } from '../src/codekg/changed.js';
import { updateCommand } from '../src/codekg/update.js';
import type {
  ManifestRelationship,
  MaterializationManifest,
  RelationshipStatus,
} from '../src/codekg/types.js';

const roots: string[] = [];
const execFile = promisify(execFileCallback);

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'codekg-'));
  roots.push(root);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'demo', main: 'src/index.ts' }, null, 2),
  );
  await writeFile(
    join(root, 'src', 'util.ts'),
    'export function makeValue() {\n  return 1;\n}\n',
  );
  await writeFile(
    join(root, 'src', 'index.ts'),
    'import { makeValue } from "./util";\n\nexport const value = makeValue();\n',
  );
  await writeFile(
    join(root, 'tests', 'index.test.ts'),
    'import "../src/index";\n',
  );
  return root;
}

function ctx(root: string): CmdContext {
  return {
    latDir: join(root, 'lat.md'),
    projectRoot: root,
    styler: plainStyler,
    mode: 'cli',
  };
}

async function readManifest(root: string): Promise<MaterializationManifest> {
  return JSON.parse(
    await readFile(
      join(root, '.code-kg', 'materialization-manifest.json'),
      'utf-8',
    ),
  ) as MaterializationManifest;
}

async function writeManifest(
  root: string,
  manifest: MaterializationManifest,
): Promise<void> {
  await writeFile(
    join(root, '.code-kg', 'materialization-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
}

async function addInferredRelationship(root: string): Promise<void> {
  const manifest = await readManifest(root);
  manifest.relationships['rel_arch_cross'] = {
    source_section: 'architecture',
    target_section: 'cross-cutting',
    relation: 'configures',
    level: 'semantic',
    confidence: 'INFERRED',
    confidence_score: 0.76,
    status: 'inferred',
  };
  await writeManifest(root, manifest);
}

async function addImportRelationship(
  root: string,
  status: RelationshipStatus = 'accepted',
): Promise<string> {
  const graph = await extractProjectGraph(root);
  const importEdge = graph.edges.find(
    (relationship) => relationship.relation === 'imports',
  );
  if (!importEdge) throw new Error('expected import edge in test project');
  const manifest = await readManifest(root);
  manifest.relationships[importEdge.id] = {
    source_section: 'architecture',
    target_section: 'architecture',
    source_node_id: importEdge.source,
    target_node_id: importEdge.target,
    relation: importEdge.relation,
    level: importEdge.level,
    confidence: importEdge.confidence,
    confidence_score: importEdge.confidence_score,
    status,
  };
  await writeManifest(root, manifest);
  return importEdge.id;
}

async function addDocumentedImportSections(root: string): Promise<string> {
  const graph = await extractProjectGraph(root);
  const importEdge = graph.edges.find(
    (relationship) => relationship.relation === 'imports',
  );
  if (!importEdge) throw new Error('expected import edge in test project');
  const manifest = await readManifest(root);
  manifest.sections['source.index'] = {
    stable_id: 'source.index',
    public_section_id: 'lat.md/architecture#Architecture#Index Source',
    file: 'lat.md/architecture.md',
    heading_path: ['Architecture', 'Index Source'],
    status: 'curated',
    source_node_ids: [importEdge.source],
    source_spans: [],
    generated_hash: '',
    current_hash: '',
    last_seen_graph_hash: '',
  };
  manifest.sections['source.util'] = {
    stable_id: 'source.util',
    public_section_id: 'lat.md/architecture#Architecture#Util Source',
    file: 'lat.md/architecture.md',
    heading_path: ['Architecture', 'Util Source'],
    status: 'curated',
    source_node_ids: [importEdge.target],
    source_spans: [],
    generated_hash: '',
    current_hash: '',
    last_seen_graph_hash: '',
  };
  await writeManifest(root, manifest);
  return importEdge.id;
}

async function markArchitectureEditSafe(
  root: string,
  file = 'src/util.ts',
): Promise<void> {
  const manifest = await readManifest(root);
  manifest.sections.architecture.status = 'curated';
  manifest.sections.architecture.source_anchor_policy = 'edit-safe';
  manifest.sections.architecture.source_node_ids = [];
  manifest.sections.architecture.source_spans = [
    { file, start_line: 1, end_line: 1 },
  ];
  await writeManifest(root, manifest);
}

async function connectCodeKgMcp(root: string): Promise<Client> {
  const mcpCtx: CmdContext = { ...ctx(root), mode: 'mcp' };
  const server = createCodeKgMcpServer(mcpCtx);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'codekg-test', version: '0.1.0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

function firstText(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text: string }[])[0].text;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe('code-kg bootstrap', () => {
  it('previews the skeleton knowledge base without writing files', async () => {
    const root = await makeProject();
    const plan = await createBootstrapPlan(root);
    const preview = formatBootstrapPreview(plan);

    expect(preview).toContain('# Code-KG Bootstrap Preview');
    expect(preview).toContain('## Structural Graph');
    expect(preview).toContain(
      'Analysis algorithm: multi-language-directory-fallback',
    );
    expect(preview).toContain('lat.md/lat.md');
    expect(preview).toContain('.code-kg/materialization-manifest.json');
    expect(existsSync(join(root, 'lat.md'))).toBe(false);
  });

  it('detects Python project signals, entrypoints, and pytest-style tests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codekg-python-'));
    roots.push(root);
    await mkdir(join(root, 'apps', 'api'), { recursive: true });
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(root, 'tests', 'cases', 'source', 'src'), {
      recursive: true,
    });
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'requirements.txt'), 'fastapi\npytest\n');
    await writeFile(
      join(root, 'apps', 'api', 'main.py'),
      'def main():\n  pass\n',
    );
    await writeFile(join(root, 'scripts', 'smoke.py'), 'print("ok")\n');
    await writeFile(
      join(root, 'tests', 'cases', 'source', 'src', 'app.h'),
      '#pragma once\n',
    );
    await writeFile(
      join(root, 'tests', 'test_memory.py'),
      'def test_memory():\n  assert True\n',
    );

    const discovery = await discoverProject(root);

    expect(discovery.counts.test).toBe(1);
    expect(discovery.counts.config).toBe(1);
    expect(discovery.packageHints).toContain('Python requirements.txt');
    expect(discovery.entrypoints).toContain('apps/api/main.py');
    expect(discovery.entrypoints).toContain('scripts/smoke.py');
    expect(discovery.testPaths).toEqual(['tests/test_memory.py']);
  });

  it('writes a lat.md knowledge base and committed manifest that pass checks', async () => {
    const root = await makeProject();
    const plan = await createBootstrapPlan(root);
    const changes = await writeBootstrapPlan(plan);

    expect(changes).toContain('created lat.md/lat.md');
    expect(changes).toContain('created .code-kg/materialization-manifest.json');
    expect(changes).toContain('created lat.md/tests/tests.md');
    expect(changes).toContain('updated .gitignore');

    const gitignore = await readFile(join(root, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('.code-kg/cache/');
    expect(gitignore).toContain('lat.md/.cache/');

    const result = await codeKgCheckCommand(ctx(root));
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('All checks passed');

    const manifest = JSON.parse(
      await readFile(
        join(root, '.code-kg', 'materialization-manifest.json'),
        'utf-8',
      ),
    );
    expect(manifest.sections.architecture.status).toBe('generated');
    expect(
      manifest.sections.architecture.source_node_ids.length,
    ).toBeGreaterThan(0);
    expect(manifest.sections.architecture.public_section_id).toBe(
      'lat.md/architecture#Architecture',
    );
    expect(manifest.sections.architecture.source_anchor_policy).toBe(
      'coverage-only',
    );
    expect(manifest.sections.architecture.source_spans).toEqual([]);
    expect(backlinkAnchorsForSection(manifest.sections.architecture)).toEqual(
      [],
    );
    expect(manifest.sections['cross-cutting'].public_section_id).toBe(
      'lat.md/cross-cutting#Cross-Cutting Concerns',
    );
    expect(manifest.project_root).toBe('.');
  });

  it('generates source-grounded file sections that improve bootstrap search', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codekg-python-search-'));
    roots.push(root);
    await mkdir(join(root, 'apps', 'api'), { recursive: true });
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'requirements.txt'), 'fastapi\n');
    await writeFile(
      join(root, 'apps', 'api', 'main.py'),
      'from .memory import memory_context_endpoint\n',
    );
    await writeFile(
      join(root, 'apps', 'api', 'memory.py'),
      [
        'def memory_context_endpoint(profile_name: str):',
        '    return {"profile": profile_name}',
        '',
        'def memory_search_endpoint(query: str):',
        '    return []',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(root, 'tests', 'test_memory.py'),
      [
        'from apps.api.memory import memory_context_endpoint',
        '',
        'def test_memory_context_endpoint():',
        '    assert memory_context_endpoint("default")["profile"] == "default"',
        '',
      ].join('\n'),
    );

    await writeBootstrapPlan(await createBootstrapPlan(root));
    const architecture = await readFile(
      join(root, 'lat.md', 'architecture.md'),
      'utf-8',
    );
    const tests = await readFile(
      join(root, 'lat.md', 'tests', 'tests.md'),
      'utf-8',
    );
    const search = await localSearchCommand(
      ctx(root),
      'memory endpoint tests',
      5,
    );

    expect(architecture).toContain('## Source File Highlights');
    expect(architecture).toContain('### apps/api/memory.py');
    expect(architecture).toContain('memory_context_endpoint');
    expect(tests).toContain('## Source Test Highlights');
    expect(tests).toContain('### tests/test_memory.py');
    expect(tests).toContain('test_memory_context_endpoint');
    expect(search.isError).toBeFalsy();
    expect(search.output).toContain(
      'lat.md/tests/tests#Tests#Source Test Highlights#tests/test_memory.py',
    );
  });

  it('materializes existing @lat test spec refs so bootstrap output passes checks', async () => {
    const root = await makeProject();
    await writeFile(
      join(root, 'tests', 'auth.test.ts'),
      [
        '// @lat: [[auth-flow#Rejects expired token]]',
        'export const rejectsExpiredToken = true;',
        '',
        '// @lat: [[tests/mcp#Lists all tools]]',
        'export const listsAllTools = true;',
        '',
        '// @lat: [[search#RAG Replay Tests#Indexes all sections]]',
        'export const indexesAllSections = true;',
        '',
      ].join('\n'),
    );

    const changes = await writeBootstrapPlan(await createBootstrapPlan(root));
    const result = await codeKgCheckCommand(ctx(root));
    const authSpecs = await readFile(
      join(root, 'lat.md', 'tests', 'auth-flow.md'),
      'utf-8',
    );
    const mcpSpecs = await readFile(
      join(root, 'lat.md', 'tests', 'mcp.md'),
      'utf-8',
    );
    const searchSpecs = await readFile(
      join(root, 'lat.md', 'tests', 'search.md'),
      'utf-8',
    );

    expect(changes).toContain('created lat.md/tests/auth-flow.md');
    expect(result.isError).toBeFalsy();
    expect(authSpecs).toContain('## Rejects expired token');
    expect(mcpSpecs).toContain('## Lists all tools');
    expect(searchSpecs).toContain('## RAG Replay Tests');
    expect(searchSpecs).toContain('### Indexes all sections');
  });

  it('does not materialize @lat refs from ignored build output', async () => {
    const root = await makeProject();
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, '.gitignore'), 'dist\n');
    await writeFile(
      join(root, 'dist', 'generated.js'),
      '// @lat: [[generated-build#Should Be Ignored]]\n',
    );

    await writeBootstrapPlan(await createBootstrapPlan(root));
    const result = await codeKgCheckCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(
      existsSync(join(root, 'lat.md', 'tests', 'generated-build.md')),
    ).toBe(false);
  });

  it('does not materialize @lat refs embedded inside string literals', async () => {
    const root = await makeProject();
    await writeFile(
      join(root, 'tests', 'fixture-writer.test.ts'),
      [
        'const fixture = "// @lat: [[string-fixture#Should Be Ignored]]";',
        'export const value = fixture;',
        '',
      ].join('\n'),
    );

    await writeBootstrapPlan(await createBootstrapPlan(root));
    const result = await codeKgCheckCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(existsSync(join(root, 'lat.md', 'tests', 'string-fixture.md'))).toBe(
      false,
    );
  });

  it('requires a manifest when generated section markers exist', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await unlink(join(root, '.code-kg', 'materialization-manifest.json'));

    const result = await codeKgCheckCommand(ctx(root));
    expect(result.isError).toBeTruthy();
    expect(result.output).toContain('Code-KG metadata errors');
    expect(result.output).toContain('materialization-manifest.json is missing');
  });

  it('rejects edit-safe manifest sections without precise source spans', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const manifest = await readManifest(root);
    manifest.sections.architecture.source_anchor_policy = 'edit-safe';
    manifest.sections.architecture.source_spans = [];
    await writeManifest(root, manifest);

    const result = await codeKgCheckCommand(ctx(root));

    expect(result.isError).toBeTruthy();
    expect(result.output).toContain(
      'Manifest section architecture is edit-safe but has no source_spans.',
    );
  });

  it('treats explicit edit-safe source spans as backlink anchors', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await markArchitectureEditSafe(root);
    const manifest = await readManifest(root);

    const result = await codeKgCheckCommand(ctx(root));
    const anchors = backlinkAnchorsForSection(manifest.sections.architecture);

    expect(result.isError).toBeFalsy();
    expect(anchors).toEqual([
      { file: 'src/util.ts', start_line: 1, end_line: 1 },
    ]);
  });

  it('previews backlinks for edit-safe source spans without mutating source', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await markArchitectureEditSafe(root);

    const result = await applyBacklinksCommand(ctx(root), { write: false });
    const source = await readFile(join(root, 'src', 'util.ts'), 'utf-8');

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('would insert');
    expect(result.output).toContain('src/util.ts:1');
    expect(result.output).toContain(
      '// @lat: [[lat.md/architecture#Architecture]]',
    );
    expect(source).not.toContain('@lat:');
  });

  it('writes backlinks for edit-safe source spans', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await markArchitectureEditSafe(root);

    const result = await applyBacklinksCommand(ctx(root), { write: true });
    const source = await readFile(join(root, 'src', 'util.ts'), 'utf-8');

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('inserted');
    expect(source).toContain(
      '// @lat: [[lat.md/architecture#Architecture]]\nexport function makeValue()',
    );
  });

  it('does not duplicate existing backlinks', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await markArchitectureEditSafe(root);
    await applyBacklinksCommand(ctx(root), { write: true });

    const result = await applyBacklinksCommand(ctx(root), { write: true });
    const source = await readFile(join(root, 'src', 'util.ts'), 'utf-8');
    const matches = source.match(
      /@lat: \[\[lat\.md\/architecture#Architecture\]\]/g,
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('No backlink changes.');
    expect(matches).toHaveLength(1);
  });

  it('skips unsupported source files when applying backlinks', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(join(root, 'src', 'style.css'), 'body { color: black; }\n');
    await markArchitectureEditSafe(root, 'src/style.css');

    const result = await applyBacklinksCommand(ctx(root), { write: false });
    const source = await readFile(join(root, 'src', 'style.css'), 'utf-8');

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('skipped unsupported file src/style.css');
    expect(source).not.toContain('@lat:');
  });

  it('provides local lexical search without an embedding provider', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await localSearchCommand(ctx(root), 'entry points', 5);
    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Local search results');
    expect(result.output).toContain('code-kg section');
    expect(result.output).toContain(
      'lat.md/architecture#Architecture#Entry Points',
    );
  });

  it('uses local lexical search as the default Code-KG search backend', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await codeKgSearchCommand(ctx(root), 'entry points', {
      limit: 5,
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Backend: local lexical');
    expect(result.output).toContain('Local search results');
    expect(result.output).toContain(
      'lat.md/architecture#Architecture#Entry Points',
    );
  });

  it('falls back to local lexical search for auto-semantic when no embedding provider is configured', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const originalEnv = {
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    process.env.XDG_CONFIG_HOME = configRoot;

    try {
      const result = await codeKgSearchCommand(ctx(root), 'entry points', {
        backend: 'auto-semantic',
        limit: 5,
      });

      expect(result.isError).toBeFalsy();
      expect(result.output).toContain(
        'Backend: local lexical (auto-semantic fallback)',
      );
      expect(result.output).toContain(
        'lat.md/architecture#Architecture#Entry Points',
      );
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('selects semantic search for auto-semantic when local embeddings are configured', () => {
    const originalProvider = process.env.LAT_EMBEDDING_PROVIDER;
    process.env.LAT_EMBEDDING_PROVIDER = 'local';

    try {
      expect(
        selectCodeKgSearchBackend({ backend: 'auto-semantic' }).backend,
      ).toBe('semantic');
    } finally {
      if (originalProvider === undefined) {
        delete process.env.LAT_EMBEDDING_PROVIDER;
      } else {
        process.env.LAT_EMBEDDING_PROVIDER = originalProvider;
      }
    }
  });

  it('routes explicit semantic Code-KG search through the embedding-backed backend', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const originalEnv = {
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    process.env.XDG_CONFIG_HOME = configRoot;

    try {
      const result = await codeKgSearchCommand(ctx(root), 'entry points', {
        backend: 'semantic',
        limit: 5,
      });

      expect(result.isError).toBeTruthy();
      expect(result.output).toContain(
        'No semantic embedding provider configured',
      );
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('installs Code-KG agent guidance into AGENTS.md and Codex hooks', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await agentsCommand(ctx(root), { action: 'install' });
    const agentsMd = await readFile(join(root, 'AGENTS.md'), 'utf-8');
    const hooks = JSON.parse(
      await readFile(join(root, '.codex', 'hooks.json'), 'utf-8'),
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('installed AGENTS.md guidance');
    expect(result.output).toContain('installed Codex hook');
    expect(agentsMd).toContain('<!-- code-kg:agents:start -->');
    expect(agentsMd).toContain('Before broad source reads');
    expect(agentsMd).toContain('code-kg search "<question>"');
    expect(hooks.hooks.PreToolUse).toHaveLength(1);
    expect(hooks.hooks.PreToolUse[0].matcher).toContain('Grep');
    expect(hooks.hooks.PreToolUse[0].matcher).toContain('Read');
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toContain('hook-check');
  });

  it('uses code-kg on PATH for installed Codex hooks when available', async () => {
    const root = await makeProject();
    const binDir = await mkdtemp(join(tmpdir(), 'codekg-bin-'));
    roots.push(binDir);
    await writeFile(join(binDir, 'code-kg'), '#!/bin/sh\nexit 0\n');
    await chmod(join(binDir, 'code-kg'), 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${delimiter}${originalPath ?? ''}`;

    try {
      const result = await agentsCommand(ctx(root), { action: 'install' });
      const agentsMd = await readFile(join(root, 'AGENTS.md'), 'utf-8');
      const hooks = JSON.parse(
        await readFile(join(root, '.codex', 'hooks.json'), 'utf-8'),
      );

      expect(result.isError).toBeFalsy();
      expect(hooks.hooks.PreToolUse[0].hooks[0].command).toBe(
        'code-kg hook-check',
      );
      expect(agentsMd).not.toContain('Local CLI fallback');
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  it('falls back to an absolute local CLI command when code-kg is not on PATH', async () => {
    const root = await makeProject();
    const originalPath = process.env.PATH;
    process.env.PATH = '';

    try {
      const result = await agentsCommand(ctx(root), { action: 'install' });
      const agentsMd = await readFile(join(root, 'AGENTS.md'), 'utf-8');
      const hooks = JSON.parse(
        await readFile(join(root, '.codex', 'hooks.json'), 'utf-8'),
      );
      const command = hooks.hooks.PreToolUse[0].hooks[0].command;

      expect(result.isError).toBeFalsy();
      expect(command).toContain(process.execPath);
      expect(command).toContain('dist/src/codekg/cli.js');
      expect(command).toContain('hook-check');
      expect(agentsMd).toContain('Local CLI fallback');
      expect(agentsMd).toContain('dist/src/codekg/cli.js');
    } finally {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    }
  });

  it('reports installed Code-KG agent status without reading raw config files', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await agentsCommand(ctx(root), { action: 'install' });
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
    };
    process.env.XDG_CONFIG_HOME = configRoot;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;

    try {
      const result = await agentsCommand(ctx(root), { action: 'status' });

      expect(result.isError).toBeFalsy();
      expect(result.output).toContain('# Code-KG Agents Status');
      expect(result.output).toContain('lat.md/: found');
      expect(result.output).toContain('AGENTS.md guidance: installed');
      expect(result.output).toContain('Codex hook: installed');
      expect(result.output).toContain('Codex matcher:');
      expect(result.output).toContain('Grep');
      expect(result.output).toContain('Codex command:');
      expect(result.output).toContain('hook-check');
      expect(result.output).toContain('semantic search: missing');
      expect(result.output).toContain('MCP command: code-kg mcp');
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('reports missing Code-KG agent status before installation', async () => {
    const root = await makeProject();

    const result = await agentsCommand(ctx(root), { action: 'status' });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('# Code-KG Agents Status');
    expect(result.output).toContain('lat.md/: missing');
    expect(result.output).toContain('AGENTS.md guidance: missing');
    expect(result.output).toContain('Codex hook: missing');
    expect(result.output).toContain('MCP command: code-kg mcp');
  });

  it('installs Code-KG agent guidance before lat.md exists', async () => {
    const root = await makeProject();

    const result = await agentsCommand(ctx(root), { action: 'install' });

    expect(result.isError).toBeFalsy();
    expect(existsSync(join(root, 'lat.md'))).toBe(false);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(root, '.codex', 'hooks.json'))).toBe(true);
  });

  it('updates Code-KG agent guidance idempotently while preserving existing AGENTS.md content', async () => {
    const root = await makeProject();
    await writeFile(
      join(root, 'AGENTS.md'),
      '# Existing Agent Rules\n\n- Keep this project-specific rule.\n',
    );

    await agentsCommand(ctx(root), { action: 'install' });
    const result = await agentsCommand(ctx(root), { action: 'install' });
    const agentsMd = await readFile(join(root, 'AGENTS.md'), 'utf-8');
    const hooks = JSON.parse(
      await readFile(join(root, '.codex', 'hooks.json'), 'utf-8'),
    );

    expect(result.isError).toBeFalsy();
    expect(agentsMd).toContain('# Existing Agent Rules');
    expect(agentsMd).toContain('- Keep this project-specific rule.');
    expect(agentsMd.match(/<!-- code-kg:agents:start -->/g)).toHaveLength(1);
    expect(hooks.hooks.PreToolUse).toHaveLength(1);
  });

  it('uninstalls only the managed Code-KG agent guidance and hook entries', async () => {
    const root = await makeProject();
    await writeFile(
      join(root, 'AGENTS.md'),
      '# Existing Agent Rules\n\n- Keep this project-specific rule.\n',
    );
    await mkdir(join(root, '.codex'), { recursive: true });
    await writeFile(
      join(root, '.codex', 'hooks.json'),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'echo keep' }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    await agentsCommand(ctx(root), { action: 'install' });
    const result = await agentsCommand(ctx(root), { action: 'uninstall' });
    const agentsMd = await readFile(join(root, 'AGENTS.md'), 'utf-8');
    const hooks = JSON.parse(
      await readFile(join(root, '.codex', 'hooks.json'), 'utf-8'),
    );

    expect(result.isError).toBeFalsy();
    expect(agentsMd).toBe(
      '# Existing Agent Rules\n\n- Keep this project-specific rule.\n',
    );
    expect(hooks.hooks.PreToolUse).toEqual([
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'echo keep' }],
      },
    ]);
  });

  it('removes AGENTS.md when uninstalling a file that only contains managed guidance', async () => {
    const root = await makeProject();
    await agentsCommand(ctx(root), { action: 'install' });

    const result = await agentsCommand(ctx(root), { action: 'uninstall' });

    expect(result.isError).toBeFalsy();
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
  });

  it('keeps hook-check silent without hook input', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await hookCheckCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe('');
  });

  it('nudges search-style Bash calls toward Code-KG before raw source search', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'rg -n "entry points" src tests' },
      }),
    });
    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: {
        hookEventName: string;
        additionalContext: string;
      };
    };

    expect(result.isError).toBeFalsy();
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('Code-KG');
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      'code-kg search "entry points" --backend auto-semantic',
    );
    expect(parsed.hookSpecificOutput.additionalContext).not.toContain(
      'code-kg search "<question>"',
    );
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      'code-kg section "<section-id>"',
    );
  });

  it('escapes derived hook search queries safely', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({
        tool_input: { command: 'grep -R \'user "token"\' apps tests' },
      }),
    });
    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: { additionalContext: string };
    };

    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      'code-kg search "user \\"token\\"" --backend auto-semantic',
    );
  });

  it('nudges structured Grep and Glob hook payloads', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const grepResult = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({
        tool_name: 'Grep',
        tool_input: { pattern: 'memory coverage', path: 'apps' },
      }),
    });
    const globResult = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.py' },
      }),
    });

    expect(
      JSON.parse(grepResult.output).hookSpecificOutput.additionalContext,
    ).toContain('code-kg search "memory coverage" --backend auto-semantic');
    expect(
      JSON.parse(globResult.output).hookSpecificOutput.additionalContext,
    ).toContain('code-kg search "**/*.py" --backend auto-semantic');
  });

  it('nudges structured raw source read payloads toward sections without inventing a query', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'src/index.ts' },
      }),
    });
    const contextText = JSON.parse(result.output).hookSpecificOutput
      .additionalContext as string;

    expect(contextText).toContain('raw source read');
    expect(contextText).toContain('src/index.ts');
    expect(contextText).toContain('code-kg context "src/index.ts"');
    expect(contextText).toContain('code-kg section "<section-id>"');
    expect(contextText).not.toContain('code-kg search "src/index.ts"');
  });

  it('does not nudge structured reads of Code-KG knowledge files', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({
        tool_name: 'Read',
        tool_input: { file_path: 'lat.md/architecture.md' },
      }),
    });

    expect(result.output).toBe('');
  });

  it('does not nudge when Code-KG is not installed', async () => {
    const root = await makeProject();

    const result = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({
        tool_input: { command: 'rg "entry points" src tests' },
      }),
    });

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe('');
  });

  it('does not nudge Code-KG commands or non-search shell commands', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const codeKgResult = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({
        tool_input: {
          command: 'code-kg search "entry points" --backend auto-semantic',
        },
      }),
    });
    const testResult = await hookCheckCommand(ctx(root), {
      input: JSON.stringify({ tool_input: { command: 'pnpm vitest run' } }),
    });

    expect(codeKgResult.output).toBe('');
    expect(testResult.output).toBe('');
  });

  it('returns source context for a file with sections, relationships, and tests', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await contextCommand(ctx(root), 'src/index.ts');

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('# Code-KG Context');
    expect(result.output).toContain('src/index.ts');
    expect(result.output).toContain('## Knowledge Sections');
    expect(result.output).toContain('lat.md/architecture');
    expect(result.output).toContain('## Relationships');
    expect(result.output).toContain('imports: `src/util.ts`');
    expect(result.output).toContain('tested by: `tests/index.test.ts`');
  });

  it('returns source context for a symbol query', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await contextCommand(ctx(root), 'makeValue');

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('makeValue');
    expect(result.output).toContain('src/util.ts');
    expect(result.output).toContain('## Knowledge Sections');
  });

  it('reports useful documentation and coverage gaps', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await gapsCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('# Code-KG Gaps');
    expect(result.output).toContain('## Files Without Test Coverage');
    expect(result.output).toContain('src/util.ts');
  });

  it('maps working-tree source changes to sections and tests', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await execFile('git', ['init'], { cwd: root });
    await execFile('git', ['add', '.'], { cwd: root });
    await execFile(
      'git',
      [
        '-c',
        'user.email=codekg@example.test',
        '-c',
        'user.name=Code KG',
        'commit',
        '-m',
        'baseline',
      ],
      { cwd: root },
    );
    await writeFile(
      join(root, 'src', 'index.ts'),
      'import { makeValue } from "./util";\n\nexport const value = makeValue() + 1;\n',
    );

    const result = await changedCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('# Code-KG Changed');
    expect(result.output).toContain('src/index.ts');
    expect(result.output).toContain('lat.md/architecture');
    expect(result.output).toContain('tests/index.test.ts');
  });

  it('runs the update workflow without requiring semantic configuration', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
    };
    process.env.XDG_CONFIG_HOME = configRoot;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;

    try {
      const result = await updateCommand(ctx(root));

      expect(result.isError).toBeFalsy();
      expect(result.output).toContain('# Code-KG Update');
      expect(result.output).toContain('materialized knowledge base');
      expect(result.output).toContain('semantic reindex: skipped');
      expect(result.output).toContain('code-kg check: passed');
      expect(result.output).toContain('No drift findings');
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('reports a ready Code-KG project through doctor', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await agentsCommand(ctx(root), { action: 'install' });
    await writeFile(join(root, '.gitignore'), '.code-kg/cache/\n');
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
    };
    process.env.XDG_CONFIG_HOME = configRoot;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;

    try {
      const result = await doctorCommand(ctx(root));

      expect(result.isError).toBeFalsy();
      expect(result.output).toContain('# Code-KG Doctor');
      expect(result.output).toContain('lat.md/: found');
      expect(result.output).toContain('code-kg check: passed');
      expect(result.output).toContain('materialization-manifest.json: found');
      expect(result.output).toContain('manifest sections: generated=5');
      expect(result.output).toContain('.code-kg/cache/: ignored');
      expect(result.output).toContain('AGENTS.md guidance: installed');
      expect(result.output).toContain('Codex hook: installed');
      expect(result.output).toContain('MCP command: code-kg mcp');
      expect(result.output).toContain('semantic search: missing');
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('recognizes an absolute local CLI Codex hook through doctor', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await agentsCommand(ctx(root), { action: 'install' });
    await writeFile(
      join(root, '.codex', 'hooks.json'),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [
                  {
                    type: 'command',
                    command:
                      "node '/tmp/code-kg/dist/src/codekg/cli.js' hook-check",
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) + '\n',
    );

    const result = await doctorCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Codex hook: installed');
    expect(result.output).toContain('local absolute hook');
  });

  it('reports global PATH hook form through doctor', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await agentsCommand(ctx(root), { action: 'install' });
    await writeFile(
      join(root, '.codex', 'hooks.json'),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'code-kg hook-check' }],
              },
            ],
          },
        },
        null,
        2,
      ) + '\n',
    );

    const result = await doctorCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Codex hook: installed');
    expect(result.output).toContain('global PATH hook');
  });

  it('installs a global code-kg wrapper into a chosen bin directory', async () => {
    const binDir = await mkdtemp(join(tmpdir(), 'codekg-global-bin-'));
    roots.push(binDir);

    const result = await installGlobalCommand({ binDir });
    const wrapper = join(binDir, 'code-kg');
    const wrapperText = await readFile(wrapper, 'utf-8');
    const mode = (await stat(wrapper)).mode;

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('# Code-KG Global Install');
    expect(result.output).toContain(wrapper);
    expect(wrapperText).toContain('dist/src/codekg/cli.js');
    expect(wrapperText).toContain('exec');
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it('reports local semantic provider details through doctor', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await mkdir(join(root, 'lat.md', '.cache'), { recursive: true });
    await writeFile(join(root, 'lat.md', '.cache', 'vectors.db'), '');
    await writeFile(
      join(root, '.gitignore'),
      '.code-kg/cache/\nlat.md/.cache/\n',
    );
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
      LAT_LOCAL_EMBEDDING_MODEL: process.env.LAT_LOCAL_EMBEDDING_MODEL,
      LAT_LOCAL_EMBEDDING_DIMENSIONS:
        process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS,
    };
    process.env.XDG_CONFIG_HOME = configRoot;
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;
    delete process.env.LAT_LOCAL_EMBEDDING_MODEL;
    delete process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;
    process.env.LAT_EMBEDDING_PROVIDER = 'local';

    try {
      const result = await doctorCommand(ctx(root));

      expect(result.isError).toBeFalsy();
      expect(result.output).toContain(
        'semantic search: local (Xenova/bge-small-en-v1.5, 384d, cache present)',
      );
      expect(result.output).toContain('lat.md/.cache/: ignored');
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('reports an existing vector cache without provider as an actionable doctor finding', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await mkdir(join(root, 'lat.md', '.cache'), { recursive: true });
    await writeFile(join(root, 'lat.md', '.cache', 'vectors.db'), '');
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
    };
    process.env.XDG_CONFIG_HOME = configRoot;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;

    try {
      const result = await doctorCommand(ctx(root));

      expect(result.isError).toBeFalsy();
      expect(result.output).toContain(
        'semantic search: missing (vector cache present; run `code-kg semantic enable-local`)',
      );
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('enables local semantic search through a first-class Code-KG command', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
      LAT_LOCAL_EMBEDDING_MODEL: process.env.LAT_LOCAL_EMBEDDING_MODEL,
      LAT_LOCAL_EMBEDDING_DIMENSIONS:
        process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS,
    };
    process.env.XDG_CONFIG_HOME = configRoot;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;
    delete process.env.LAT_LOCAL_EMBEDDING_MODEL;
    delete process.env.LAT_LOCAL_EMBEDDING_DIMENSIONS;

    try {
      const enable = await semanticCommand(ctx(root), {
        action: 'enable-local',
      });
      const status = await semanticCommand(ctx(root), { action: 'status' });
      const config = JSON.parse(
        await readFile(join(configRoot, 'lat', 'config.json'), 'utf-8'),
      ) as { embedding_provider?: string };

      expect(enable.isError).toBeFalsy();
      expect(enable.output).toContain('# Code-KG Semantic Search');
      expect(enable.output).toContain('local embeddings enabled');
      expect(config.embedding_provider).toBe('local');
      expect(status.output).toContain(
        'provider: local (Xenova/bge-small-en-v1.5, 384d)',
      );
      expect(status.output).toContain('vector cache: missing');
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('guides semantic reindex toward local provider setup when missing', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
    };
    process.env.XDG_CONFIG_HOME = configRoot;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;

    try {
      const result = await semanticCommand(ctx(root), { action: 'reindex' });

      expect(result.isError).toBeTruthy();
      expect(result.output).toContain(
        'No semantic embedding provider configured',
      );
      expect(result.output).toContain('code-kg semantic enable-local');
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('reports missing setup through doctor without requiring lat.md', async () => {
    const root = await makeProject();

    const result = await doctorCommand(ctx(root));

    expect(result.isError).toBeTruthy();
    expect(result.output).toContain('lat.md/: missing');
    expect(result.output).toContain('materialization-manifest.json: missing');
    expect(result.output).toContain('.code-kg/cache/: not ignored');
    expect(result.output).toContain('AGENTS.md guidance: missing');
    expect(result.output).toContain('Codex hook: missing');
  });

  it('lists Code-KG MCP tools including drift', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const client = await connectCodeKgMcp(root);

    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();

      expect(names).toContain('codekg_search');
      expect(names).toContain('codekg_section');
      expect(names).toContain('codekg_drift');
    } finally {
      await client.close();
    }
  });

  it('reports drift through the Code-KG MCP server', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const client = await connectCodeKgMcp(root);

    try {
      const result = await client.callTool({
        name: 'codekg_drift',
        arguments: {},
      });
      expect(firstText(result)).toContain('No drift findings');
    } finally {
      await client.close();
    }
  });

  it('adds budget metadata and truncates Code-KG MCP search results by max_tokens', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const client = await connectCodeKgMcp(root);

    try {
      const result = await client.callTool({
        name: 'codekg_search',
        arguments: { query: 'entry points', max_tokens: 24 },
      });
      const text = firstText(result);

      expect(text).toContain('## Budget');
      expect(text).toContain('estimated_tokens:');
      expect(text).toContain('budget_remaining:');
      expect(text).toContain('truncated: yes');
      expect(text).not.toContain('High-Degree Nodes');
    } finally {
      await client.close();
    }
  });

  it('supports auto-semantic fallback through the Code-KG MCP search tool', async () => {
    const root = await makeProject();
    const configRoot = await mkdtemp(join(tmpdir(), 'codekg-config-'));
    roots.push(configRoot);
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LAT_EMBEDDING_PROVIDER: process.env.LAT_EMBEDDING_PROVIDER,
      LAT_LLM_KEY: process.env.LAT_LLM_KEY,
      LAT_LLM_KEY_FILE: process.env.LAT_LLM_KEY_FILE,
      LAT_LLM_KEY_HELPER: process.env.LAT_LLM_KEY_HELPER,
    };
    process.env.XDG_CONFIG_HOME = configRoot;
    delete process.env.LAT_EMBEDDING_PROVIDER;
    delete process.env.LAT_LLM_KEY;
    delete process.env.LAT_LLM_KEY_FILE;
    delete process.env.LAT_LLM_KEY_HELPER;
    let client: Client | undefined;

    try {
      client = await connectCodeKgMcp(root);
      const result = await client.callTool({
        name: 'codekg_search',
        arguments: {
          query: 'entry points',
          backend: 'auto-semantic',
          max_tokens: 80,
        },
      });
      const text = firstText(result);

      expect(text).toContain('Backend: local lexical (auto-semantic fallback)');
      expect(text).toContain('lat.md/architecture#Architecture#Entry Points');
    } finally {
      await client?.close();
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('adds budget metadata and truncates Code-KG MCP section reads by max_tokens', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const client = await connectCodeKgMcp(root);

    try {
      const result = await client.callTool({
        name: 'codekg_section',
        arguments: {
          query: 'lat.md/architecture#Architecture',
          max_tokens: 32,
        },
      });
      const text = firstText(result);

      expect(text).toContain('## Budget');
      expect(text).toContain('truncated: yes');
      expect(text).toContain('lat.md/architecture#Architecture');
    } finally {
      await client.close();
    }
  });

  it('extracts a deterministic structural graph with symbols and imports', async () => {
    const root = await makeProject();
    const graph = await extractProjectGraph(root);

    expect(graph.analysis.algorithm).toBe('multi-language-directory-fallback');
    expect(graph.nodes.some((node) => node.label === 'makeValue')).toBe(true);
    expect(
      graph.edges.some((relationship) => relationship.relation === 'imports'),
    ).toBe(true);
    expect(
      graph.communities.some((community) => community.label === 'src'),
    ).toBe(true);
  });

  it('resolves common Python local import forms into graph edges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codekg-python-imports-'));
    roots.push(root);
    await mkdir(join(root, 'apps', 'api'), { recursive: true });
    await writeFile(join(root, 'requirements.txt'), 'fastapi\n');
    await writeFile(join(root, 'apps', 'api', '__init__.py'), '');
    await writeFile(
      join(root, 'apps', 'api', 'main.py'),
      [
        'import apps.api.snapshot',
        'from apps.api.memory import memory_context_endpoint',
        'from apps.api import redaction',
        'from . import logs',
        'from .cron import collect_cron_jobs',
        '',
      ].join('\n'),
    );
    for (const file of ['snapshot', 'memory', 'redaction', 'logs', 'cron']) {
      await writeFile(
        join(root, 'apps', 'api', `${file}.py`),
        `def ${file}_marker():\n    return True\n`,
      );
    }

    const graph = await extractProjectGraph(root);
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const imports = graph.edges
      .filter((relationship) => relationship.relation === 'imports')
      .map((relationship) => {
        const source = nodes.get(relationship.source)?.label;
        const target = nodes.get(relationship.target)?.label;
        return `${source} -> ${target}`;
      });

    expect(imports).toContain('apps/api/main.py -> apps/api/snapshot.py');
    expect(imports).toContain('apps/api/main.py -> apps/api/memory.py');
    expect(imports).toContain('apps/api/main.py -> apps/api/redaction.py');
    expect(imports).toContain('apps/api/main.py -> apps/api/logs.py');
    expect(imports).toContain('apps/api/main.py -> apps/api/cron.py');
  });

  it('adds explicit test relationships when tests import source files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codekg-test-relations-'));
    roots.push(root);
    await mkdir(join(root, 'apps', 'api'), { recursive: true });
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'requirements.txt'), 'fastapi\npytest\n');
    await writeFile(join(root, 'apps', 'api', '__init__.py'), '');
    await writeFile(
      join(root, 'apps', 'api', 'memory.py'),
      'def memory_context_endpoint():\n    return True\n',
    );
    await writeFile(
      join(root, 'tests', 'test_memory.py'),
      [
        'from apps.api.memory import memory_context_endpoint',
        '',
        'def test_memory_context_endpoint():',
        '    assert memory_context_endpoint()',
        '',
      ].join('\n'),
    );

    const graph = await extractProjectGraph(root);
    const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
    const relationships = graph.edges.map((relationship) => {
      const source = nodes.get(relationship.source)?.label;
      const target = nodes.get(relationship.target)?.label;
      return `${relationship.relation}: ${source} -> ${target}`;
    });

    expect(relationships).toContain(
      'imports: tests/test_memory.py -> apps/api/memory.py',
    );
    expect(relationships).toContain(
      'tests: tests/test_memory.py -> apps/api/memory.py',
    );
  });

  it('generates relationship sections for test coverage retrieval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codekg-relationship-docs-'));
    roots.push(root);
    await mkdir(join(root, 'apps', 'api'), { recursive: true });
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'requirements.txt'), 'fastapi\npytest\n');
    await writeFile(join(root, 'apps', 'api', '__init__.py'), '');
    await writeFile(
      join(root, 'apps', 'api', 'main.py'),
      'from apps.api.memory import memory_context_endpoint\n',
    );
    await writeFile(
      join(root, 'apps', 'api', 'memory.py'),
      'def memory_context_endpoint():\n    return True\n',
    );
    await writeFile(
      join(root, 'tests', 'test_memory.py'),
      [
        'from apps.api.memory import memory_context_endpoint',
        '',
        'def test_memory_context_endpoint():',
        '    assert memory_context_endpoint()',
        '',
      ].join('\n'),
    );

    await writeBootstrapPlan(await createBootstrapPlan(root));
    const architecture = await readFile(
      join(root, 'lat.md', 'architecture.md'),
      'utf-8',
    );
    const tests = await readFile(
      join(root, 'lat.md', 'tests', 'tests.md'),
      'utf-8',
    );
    const search = await localSearchCommand(
      ctx(root),
      'what tests cover memory',
      5,
    );

    expect(architecture).toContain('## Entry Point Flow');
    expect(architecture).toContain('### apps/api/main.py');
    expect(architecture).toContain('apps/api/memory.py');
    expect(tests).toContain('## Test Coverage Links');
    expect(tests).toContain('### apps/api/memory.py');
    expect(tests).toContain('tests/test_memory.py');
    expect(search.isError).toBeFalsy();
    expect(search.output).toContain(
      'lat.md/tests/tests#Tests#Test Coverage Links#apps/api/memory.py',
    );
  });

  it('writes graph extraction artifacts to the Code-KG cache', async () => {
    const root = await makeProject();
    const graph = await extractProjectGraph(root);

    const cachePath = await writeGraphCache(root, graph);
    const cached = JSON.parse(await readFile(join(root, cachePath), 'utf-8'));

    expect(cachePath).toBe('.code-kg/cache/graph.json');
    expect(
      cached.nodes.some(
        (node: { label: string }) => node.label === 'makeValue',
      ),
    ).toBe(true);
  });

  it('reports no drift immediately after accepted bootstrap', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('No drift findings');
  });

  it('reports uncovered source files when the graph changes after bootstrap', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'src', 'new-feature.ts'),
      'export function newFeature() {\n  return true;\n}\n',
    );

    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('INFO');
    expect(result.output).toContain('src/new-feature.ts');
  });

  it('warns when manifest-tracked source nodes disappear', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'src', 'util.ts'),
      'export const replacement = 1;\n',
    );

    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('WARNING');
    expect(result.output).toContain('disappeared from the fresh graph');
  });

  it('keeps observed accepted structural relationships out of drift findings', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const relationshipId = await addImportRelationship(root, 'accepted');

    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('No drift findings');
    expect(result.output).not.toContain(relationshipId);
  });

  it('warns when an accepted structural relationship disappears from the graph', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const relationshipId = await addImportRelationship(root, 'accepted');
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 1;\n');

    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('WARNING');
    expect(result.output).toContain('stale relationship');
    expect(result.output).toContain(relationshipId);
  });

  it('ignores rejected and suppressed relationships during drift', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const rejectedId = await addImportRelationship(root, 'rejected');
    const manifest = await readManifest(root);
    const rejectedRelationship = manifest.relationships[rejectedId];
    const suppressedId = `${rejectedId}_suppressed`;
    manifest.relationships[suppressedId] = {
      ...rejectedRelationship,
      status: 'suppressed',
    } satisfies ManifestRelationship;
    await writeManifest(root, manifest);
    await writeFile(join(root, 'src', 'index.ts'), 'export const value = 1;\n');

    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).not.toContain('stale relationship');
    expect(result.output).not.toContain(rejectedId);
    expect(result.output).not.toContain(suppressedId);
  });

  it('suggests new cross-file structural relationships between documented sections', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const relationshipId = await addDocumentedImportSections(root);

    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('SUGGEST');
    expect(result.output).toContain('new documented structural relationship');
    expect(result.output).toContain(relationshipId);
    expect(result.output).toContain('source.index');
    expect(result.output).toContain('source.util');
  });

  it('adds and lists node and relationship suppression tombstones', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const node = await suppressCommand(ctx(root), {
      action: 'node',
      id: 'node_demo',
    });
    const relationship = await suppressCommand(ctx(root), {
      action: 'relationship',
      id: 'rel_demo',
    });
    const duplicate = await suppressCommand(ctx(root), {
      action: 'relationship',
      id: 'rel_demo',
    });
    const list = await suppressCommand(ctx(root), { action: 'list' });
    const manifest = await readManifest(root);

    expect(node.isError).toBeFalsy();
    expect(node.output).toContain('Suppressed node node_demo');
    expect(relationship.output).toContain('Suppressed relationship rel_demo');
    expect(duplicate.output).toContain(
      'Suppression already exists for relationship rel_demo',
    );
    expect(list.output).toContain('node_demo');
    expect(list.output).toContain('rel_demo');
    expect(manifest.suppressed.nodes).toEqual(['node_demo']);
    expect(manifest.suppressed.relationships).toEqual(['rel_demo']);
  });

  it('clears suppression tombstones by id', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await suppressCommand(ctx(root), {
      action: 'node',
      id: 'node_demo',
    });
    await suppressCommand(ctx(root), {
      action: 'relationship',
      id: 'rel_demo',
    });

    const result = await suppressCommand(ctx(root), {
      action: 'clear',
      id: 'node_demo',
    });
    const manifest = await readManifest(root);

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('Cleared suppression node_demo');
    expect(manifest.suppressed.nodes).toEqual([]);
    expect(manifest.suppressed.relationships).toEqual(['rel_demo']);
  });

  it('suppresses relationship drift suggestions', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    const relationshipId = await addDocumentedImportSections(root);

    await suppressCommand(ctx(root), {
      action: 'relationship',
      id: relationshipId,
    });
    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('No drift findings');
    expect(result.output).not.toContain(relationshipId);
  });

  it('suppresses uncovered node drift findings', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'src', 'new-feature.ts'),
      'export function newFeature() {\n  return true;\n}\n',
    );
    const graph = await extractProjectGraph(root);
    const node = graph.nodes.find(
      (entry) =>
        entry.kind === 'file' && entry.source_file === 'src/new-feature.ts',
    );
    if (!node) throw new Error('expected new-feature file node');

    await suppressCommand(ctx(root), {
      action: 'node',
      id: node.id,
    });
    const result = await driftCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).not.toContain('src/new-feature.ts');
  });

  it('previews edited generated sections without mutating the manifest', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'lat.md', 'architecture.md'),
      '# Architecture\n<!-- code-kg:id architecture.overview -->\n\nHuman edited architecture notes.\n',
    );

    const result = await reconcileCommand(ctx(root), { write: false });
    const manifest = JSON.parse(
      await readFile(
        join(root, '.code-kg', 'materialization-manifest.json'),
        'utf-8',
      ),
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('would mark architecture as edited');
    expect(manifest.sections.architecture.status).toBe('generated');
  });

  it('writes edited status for changed generated sections', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'lat.md', 'architecture.md'),
      '# Architecture\n<!-- code-kg:id architecture.overview -->\n\nHuman edited architecture notes.\n',
    );

    const result = await reconcileCommand(ctx(root), { write: true });
    const manifest = JSON.parse(
      await readFile(
        join(root, '.code-kg', 'materialization-manifest.json'),
        'utf-8',
      ),
    );

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('marked architecture as edited');
    expect(manifest.sections.architecture.status).toBe('edited');
    expect(manifest.sections.architecture.current_hash).not.toBe(
      manifest.sections.architecture.generated_hash,
    );
  });

  it('updates untouched generated sections during repeated materialization', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'src', 'new-feature.ts'),
      'export function newFeature() {\n  return true;\n}\n',
    );

    const changes = await writeBootstrapPlan(await createBootstrapPlan(root));
    const architecture = await readFile(
      join(root, 'lat.md', 'architecture.md'),
      'utf-8',
    );

    expect(changes).toContain('updated lat.md/architecture.md');
    expect(architecture).toContain('- Code files: 3');
  });

  it('does not overwrite edited generated sections during repeated materialization', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'lat.md', 'architecture.md'),
      '# Architecture\n<!-- code-kg:id architecture.overview -->\n\nHuman edited architecture notes.\n',
    );
    await writeFile(
      join(root, 'src', 'new-feature.ts'),
      'export function newFeature() {\n  return true;\n}\n',
    );

    const changes = await writeBootstrapPlan(await createBootstrapPlan(root));
    const architecture = await readFile(
      join(root, 'lat.md', 'architecture.md'),
      'utf-8',
    );
    const manifest = JSON.parse(
      await readFile(
        join(root, '.code-kg', 'materialization-manifest.json'),
        'utf-8',
      ),
    );

    expect(changes).toContain('kept edited lat.md/architecture.md');
    expect(architecture).toContain('Human edited architecture notes.');
    expect(manifest.sections.architecture.status).toBe('edited');
  });

  it('previews merge proposals for edited generated sections without writing cache files', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'lat.md', 'architecture.md'),
      '# Architecture\n<!-- code-kg:id architecture.overview -->\n\nHuman edited architecture notes.\n',
    );
    await writeFile(
      join(root, 'src', 'new-feature.ts'),
      'export function newFeature() {\n  return true;\n}\n',
    );

    const preview = await formatMaterializationPreview(
      await createBootstrapPlan(root),
    );

    expect(preview).toContain('## Merge Proposals');
    expect(preview).toContain('architecture');
    expect(preview).toContain('lat.md/architecture.md');
    expect(preview).toContain('.code-kg/cache/merge-proposals/architecture.md');
    expect(
      existsSync(
        join(root, '.code-kg', 'cache', 'merge-proposals', 'architecture.md'),
      ),
    ).toBe(false);
  });

  it('writes merge proposal candidates for edited generated sections during materialization', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await writeFile(
      join(root, 'lat.md', 'architecture.md'),
      '# Architecture\n<!-- code-kg:id architecture.overview -->\n\nHuman edited architecture notes.\n',
    );
    await writeFile(
      join(root, 'src', 'new-feature.ts'),
      'export function newFeature() {\n  return true;\n}\n',
    );

    const changes = await writeBootstrapPlan(await createBootstrapPlan(root));
    const architecture = await readFile(
      join(root, 'lat.md', 'architecture.md'),
      'utf-8',
    );
    const proposal = await readFile(
      join(root, '.code-kg', 'cache', 'merge-proposals', 'architecture.md'),
      'utf-8',
    );

    expect(changes).toContain('kept edited lat.md/architecture.md');
    expect(changes).toContain(
      'merge proposal .code-kg/cache/merge-proposals/architecture.md for architecture',
    );
    expect(architecture).toContain('Human edited architecture notes.');
    expect(proposal).toContain('- Code files: 3');
  });

  it('lists inferred relationships in the confidence review queue', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await addInferredRelationship(root);

    const result = await confidenceCommand(ctx(root), { action: 'list' });

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('rel_arch_cross');
    expect(result.output).toContain('inferred');
    expect(result.output).toContain(
      'lat.md/cross-cutting#Cross-Cutting Concerns',
    );
  });

  it('accepts and rejects confidence relationships in the manifest', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await addInferredRelationship(root);

    const accepted = await confidenceCommand(ctx(root), {
      action: 'accept',
      relationshipId: 'rel_arch_cross',
    });
    let manifest = await readManifest(root);

    expect(accepted.isError).toBeFalsy();
    expect(accepted.output).toContain('Marked rel_arch_cross as accepted');
    expect(manifest.relationships.rel_arch_cross.status).toBe('accepted');

    const rejected = await confidenceCommand(ctx(root), {
      action: 'reject',
      relationshipId: 'rel_arch_cross',
    });
    manifest = await readManifest(root);

    expect(rejected.isError).toBeFalsy();
    expect(rejected.output).toContain('Marked rel_arch_cross as rejected');
    expect(manifest.relationships.rel_arch_cross.status).toBe('rejected');
  });

  it('reports confidence promotion candidates without mutating by default', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await addInferredRelationship(root);
    await writeFile(
      join(root, 'lat.md', 'architecture.md'),
      '# Architecture\n<!-- code-kg:id architecture.overview -->\n\nRelated:\n- Uses [[lat.md/cross-cutting#Cross-Cutting Concerns]]\n',
    );

    const result = await confidenceCommand(ctx(root), {
      action: 'reconcile',
    });
    const manifest = await readManifest(root);

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('promotion candidate rel_arch_cross');
    expect(result.output).toContain('--accept-promotions');
    expect(manifest.relationships.rel_arch_cross.status).toBe('inferred');
  });

  it('accepts confidence promotion candidates when explicitly requested', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));
    await addInferredRelationship(root);
    await writeFile(
      join(root, 'lat.md', 'architecture.md'),
      '# Architecture\n<!-- code-kg:id architecture.overview -->\n\nRelated:\n- Uses [[lat.md/cross-cutting#Cross-Cutting Concerns]]\n',
    );

    const result = await confidenceCommand(ctx(root), {
      action: 'reconcile',
      acceptPromotions: true,
    });
    const manifest = await readManifest(root);

    expect(result.isError).toBeFalsy();
    expect(result.output).toContain('accepted promotion rel_arch_cross');
    expect(manifest.relationships.rel_arch_cross.status).toBe('accepted');
  });
});

describe('session-check', () => {
  it('offers bootstrap in an unmapped code repo', async () => {
    const root = await makeProject();

    const result = await sessionCheckCommand(ctx(root));
    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: {
        hookEventName: string;
        additionalContext: string;
      };
    };

    expect(result.isError).toBeFalsy();
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('Code-KG');
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      'code-kg bootstrap --accept',
    );
  });

  it('stays silent once the repo is mapped', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await sessionCheckCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe('');
  });

  it('stays silent in a directory with no source code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codekg-noncode-'));
    roots.push(root);
    await writeFile(join(root, 'README.md'), '# just docs\n');

    const result = await sessionCheckCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe('');
  });
});
