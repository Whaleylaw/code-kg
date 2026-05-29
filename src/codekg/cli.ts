#!/usr/bin/env node

if (!process.argv.includes('--verbose')) {
  process.noDeprecation = true;
}

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { plainStyler, type CmdContext, type CmdResult } from '../context.js';
import type { CodeKgSearchBackend } from './search.js';
import { resolveContext } from '../cli/context.js';
import {
  createBootstrapPlan,
  formatMaterializationPreview,
  writeBootstrapPlan,
} from './bootstrap.js';
import { codeKgCheckCommand } from './check.js';
import {
  extractProjectGraph,
  formatGraphReport,
  writeGraphCache,
} from './graph.js';

type PreviewAcceptOptions = {
  preview?: boolean;
  accept?: boolean;
};

type ExtractOptions = {
  json?: boolean;
  writeCache?: boolean;
};

type DriftOptions = {
  applySafe?: boolean;
};

type ReconcileOptions = {
  preview?: boolean;
  write?: boolean;
};

type ConfidenceReconcileOptions = {
  acceptPromotions?: boolean;
};

type ApplyBacklinksOptions = {
  preview?: boolean;
  write?: boolean;
};

type SearchCliOptions = {
  semantic?: boolean;
  backend?: CodeKgSearchBackend;
  limit: number;
  reindex?: boolean;
};

type InstallGlobalOptions = {
  binDir?: string;
};

function findVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const candidate = join(dir, 'package.json');
    try {
      return JSON.parse(readFileSync(candidate, 'utf-8')).version;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) return '0.0.0';
    dir = parent;
  }
}

function handleResult(result: CmdResult): void {
  if (result.isError) {
    console.error(result.output);
    process.exit(1);
  }
  if (result.output) console.log(result.output);
}

function parsePositiveInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

function parseSearchBackend(value: string): CodeKgSearchBackend {
  if (value === 'local' || value === 'semantic' || value === 'auto-semantic') {
    return value;
  }
  throw new InvalidArgumentError(
    'must be "local", "semantic", or "auto-semantic"',
  );
}

async function readStdinIfAvailable(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  let input = '';
  for await (const chunk of process.stdin) {
    input += String(chunk);
  }
  return input || undefined;
}

async function runCheck(root: string): Promise<CmdResult> {
  return codeKgCheckCommand({
    latDir: join(root, 'lat.md'),
    projectRoot: root,
    styler: plainStyler,
    mode: 'cli',
  });
}

function rootOnlyContext(): CmdContext {
  const root = resolve(program.opts().dir ?? process.cwd());
  return {
    latDir: join(root, 'lat.md'),
    projectRoot: root,
    styler: plainStyler,
    mode: 'cli',
  };
}

async function runMaterialization(
  title: string,
  opts: PreviewAcceptOptions,
): Promise<void> {
  if (!opts.preview && !opts.accept) {
    opts.preview = true;
  }
  const root = resolve(program.opts().dir ?? process.cwd());
  const plan = await createBootstrapPlan(root);
  if (opts.preview) {
    console.log(await formatMaterializationPreview(plan));
    return;
  }
  const changes = await writeBootstrapPlan(plan);
  console.log(['# ' + title, '', ...changes.map((c) => `- ${c}`)].join('\n'));
  const result = await runCheck(root);
  handleResult(result);
}

async function runExtract(rootArg = '.', opts: ExtractOptions): Promise<void> {
  const base = resolve(program.opts().dir ?? process.cwd());
  const root = resolve(base, rootArg);
  const graph = await extractProjectGraph(root);
  const cachePath = opts.writeCache
    ? await writeGraphCache(root, graph)
    : undefined;
  if (opts.json) {
    if (cachePath) {
      process.stderr.write(`Wrote ${cachePath}\n`);
    }
    console.log(JSON.stringify(graph, null, 2));
    return;
  }
  console.log(
    cachePath
      ? `${formatGraphReport(root, graph)}\n\n## Cache\n\n- Wrote ${cachePath}`
      : formatGraphReport(root, graph),
  );
}

const program = new Command();

program
  .name('code-kg')
  .description(
    'Bootstrap and maintain a lat.md knowledge graph for code agents',
  )
  .version(findVersion())
  .option('--dir <path>', 'project root (default: cwd)')
  .option('--no-color', 'disable color output')
  .option('--verbose', 'show extra diagnostics');

program
  .command('bootstrap')
  .description('Preview or create the first Code-KG lat.md knowledge base')
  .option('--preview', 'show what would be generated')
  .option('--accept', 'write generated files')
  .action(async (opts: PreviewAcceptOptions) =>
    runMaterialization('Code-KG Bootstrap', opts),
  );

program
  .command('materialize')
  .description('Preview or write generated lat.md materialization')
  .option('--preview', 'show what would be generated')
  .option('--accept', 'write generated files')
  .action(async (opts: PreviewAcceptOptions) =>
    runMaterialization('Code-KG Materialize', opts),
  );

program
  .command('extract')
  .description('Run deterministic structural graph extraction')
  .argument('[root]', 'directory to inspect', '.')
  .option('--json', 'print the ProjectGraph JSON')
  .option('--write-cache', 'write .code-kg/cache/graph.json')
  .action(async (root: string, opts: ExtractOptions) => runExtract(root, opts));

program
  .command('init')
  .description('Create the initial Code-KG knowledge base')
  .action(async () => {
    const root = resolve(program.opts().dir ?? process.cwd());
    const plan = await createBootstrapPlan(root);
    const changes = await writeBootstrapPlan(plan);
    console.log(
      ['# Code-KG Init', '', ...changes.map((c) => `- ${c}`)].join('\n'),
    );
    const result = await runCheck(root);
    handleResult(result);
  });

program
  .command('doctor')
  .description('Check Code-KG setup health')
  .action(async () => {
    const ctx = rootOnlyContext();
    const { doctorCommand } = await import('./doctor.js');
    handleResult(await doctorCommand(ctx));
  });

program
  .command('install-global')
  .description('Install a code-kg wrapper into a PATH bin directory')
  .option('--bin-dir <path>', 'bin directory for the code-kg wrapper')
  .action(async (opts: InstallGlobalOptions) => {
    const { installGlobalCommand } = await import('./global-install.js');
    handleResult(await installGlobalCommand(opts));
  });

const semantic = program
  .command('semantic')
  .description('Configure and maintain semantic search');

semantic
  .command('status')
  .description('Show semantic search provider and vector cache status')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { semanticCommand } = await import('./semantic.js');
    handleResult(await semanticCommand(ctx, { action: 'status' }));
  });

semantic
  .command('enable-local')
  .description('Use local embeddings for semantic search')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { semanticCommand } = await import('./semantic.js');
    handleResult(await semanticCommand(ctx, { action: 'enable-local' }));
  });

semantic
  .command('reindex')
  .description('Rebuild the semantic search vector cache')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { semanticCommand } = await import('./semantic.js');
    handleResult(await semanticCommand(ctx, { action: 'reindex' }));
  });

program
  .command('search')
  .description('Search lat.md sections with local or semantic retrieval')
  .argument('[query]')
  .option('--semantic', 'use semantic embedding search')
  .option(
    '--backend <backend>',
    'search backend: local, semantic, or auto-semantic',
    parseSearchBackend,
    'local',
  )
  .option('--limit <n>', 'max results', parsePositiveInteger, 5)
  .option('--reindex', 'rebuild the semantic search index')
  .action(async (query: string | undefined, opts: SearchCliOptions) => {
    const ctx = resolveContext(program.opts());
    const backend = opts.semantic ? 'semantic' : opts.backend;
    const { codeKgSearchCommand } = await import('./search.js');
    handleResult(
      await codeKgSearchCommand(ctx, query, {
        backend,
        limit: opts.limit,
        reindex: opts.reindex,
      }),
    );
  });

program
  .command('context')
  .description('Show graph, docs, and test context for a file or symbol')
  .argument('<query>', 'file path, symbol, or graph node label')
  .action(async (query: string) => {
    const ctx = resolveContext(program.opts());
    const { contextCommand } = await import('./context.js');
    handleResult(await contextCommand(ctx, query));
  });

program
  .command('gaps')
  .description('Report missing knowledge, anchors, and test coverage')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { gapsCommand } = await import('./gaps.js');
    handleResult(await gapsCommand(ctx));
  });

program
  .command('changed')
  .description('Show Code-KG impact for current git working-tree changes')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { changedCommand } = await import('./changed.js');
    handleResult(await changedCommand(ctx));
  });

program
  .command('update')
  .description('Refresh generated knowledge, semantic index, check, and drift')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { updateCommand } = await import('./update.js');
    handleResult(await updateCommand(ctx));
  });

for (const command of ['locate', 'section', 'refs', 'expand'] as const) {
  const cmd = program.command(command).allowUnknownOption(true);
  cmd.argument('<query>');
  cmd.action(async (query: string) => {
    const ctx = resolveContext(program.opts());
    if (command === 'locate') {
      const { locateCommand } = await import('../cli/locate.js');
      handleResult(await locateCommand(ctx, query));
    } else if (command === 'section') {
      const { sectionCommand } = await import('../cli/section.js');
      handleResult(await sectionCommand(ctx, query));
    } else if (command === 'refs') {
      const { refsCommand } = await import('../cli/refs.js');
      handleResult(await refsCommand(ctx, query, 'md+code'));
    } else {
      const { expandCommand } = await import('../cli/expand.js');
      handleResult(await expandCommand(ctx, query));
    }
  });
}

program
  .command('check')
  .description('Validate lat.md and Code-KG metadata')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    handleResult(await codeKgCheckCommand(ctx));
  });

program
  .command('drift')
  .description('Report drift between code and knowledge base')
  .option('--apply-safe', 'apply safe manifest metadata updates')
  .action(async (opts: DriftOptions) => {
    const ctx = resolveContext(program.opts());
    const { driftCommand } = await import('./drift.js');
    handleResult(await driftCommand(ctx, opts));
  });

program
  .command('reconcile')
  .description('Reconcile generated section status in the manifest')
  .option('--preview', 'show manifest status changes without writing')
  .option('--write', 'write manifest status changes')
  .action(async (opts: ReconcileOptions) => {
    const ctx = resolveContext(program.opts());
    const { reconcileCommand } = await import('./reconcile.js');
    handleResult(await reconcileCommand(ctx, { write: opts.write === true }));
  });

const confidence = program
  .command('confidence')
  .description('List or resolve manifest confidence review items');

confidence
  .command('list')
  .description('List inferred and ambiguous manifest relationships')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { confidenceCommand } = await import('./confidence.js');
    handleResult(await confidenceCommand(ctx, { action: 'list' }));
  });

confidence
  .command('accept')
  .description('Mark a manifest relationship as accepted')
  .argument('<relationship-id>', 'manifest relationship id')
  .action(async (relationshipId: string) => {
    const ctx = resolveContext(program.opts());
    const { confidenceCommand } = await import('./confidence.js');
    handleResult(
      await confidenceCommand(ctx, {
        action: 'accept',
        relationshipId,
      }),
    );
  });

confidence
  .command('reject')
  .description('Mark a manifest relationship as rejected')
  .argument('<relationship-id>', 'manifest relationship id')
  .action(async (relationshipId: string) => {
    const ctx = resolveContext(program.opts());
    const { confidenceCommand } = await import('./confidence.js');
    handleResult(
      await confidenceCommand(ctx, {
        action: 'reject',
        relationshipId,
      }),
    );
  });

confidence
  .command('reconcile')
  .description('Detect confidence annotations removed from markdown')
  .option(
    '--accept-promotions',
    'mark detected promotion candidates as accepted',
  )
  .action(async (opts: ConfidenceReconcileOptions) => {
    const ctx = resolveContext(program.opts());
    const { confidenceCommand } = await import('./confidence.js');
    handleResult(
      await confidenceCommand(ctx, {
        action: 'reconcile',
        acceptPromotions: opts.acceptPromotions === true,
      }),
    );
  });

const suppress = program
  .command('suppress')
  .description('List or update suppression tombstones');

suppress
  .command('list')
  .description('List suppressed graph nodes and relationships')
  .action(async () => {
    const ctx = resolveContext(program.opts());
    const { suppressCommand } = await import('./suppress.js');
    handleResult(await suppressCommand(ctx, { action: 'list' }));
  });

suppress
  .command('node')
  .description('Suppress a graph node candidate')
  .argument('<node-id>', 'graph node id')
  .action(async (id: string) => {
    const ctx = resolveContext(program.opts());
    const { suppressCommand } = await import('./suppress.js');
    handleResult(await suppressCommand(ctx, { action: 'node', id }));
  });

suppress
  .command('relationship')
  .description('Suppress a graph relationship candidate')
  .argument('<relationship-id>', 'graph relationship id')
  .action(async (id: string) => {
    const ctx = resolveContext(program.opts());
    const { suppressCommand } = await import('./suppress.js');
    handleResult(await suppressCommand(ctx, { action: 'relationship', id }));
  });

suppress
  .command('clear')
  .description('Clear a suppression tombstone by id')
  .argument('<id>', 'suppressed node or relationship id')
  .action(async (id: string) => {
    const ctx = resolveContext(program.opts());
    const { suppressCommand } = await import('./suppress.js');
    handleResult(await suppressCommand(ctx, { action: 'clear', id }));
  });

program
  .command('apply-backlinks')
  .description('Preview or insert edit-safe @lat source backlinks')
  .option('--preview', 'show source backlinks without writing')
  .option('--write', 'insert source backlinks')
  .action(async (opts: ApplyBacklinksOptions) => {
    const ctx = resolveContext(program.opts());
    const { applyBacklinksCommand } = await import('./backlinks.js');
    handleResult(
      await applyBacklinksCommand(ctx, { write: opts.write === true }),
    );
  });

const agents = program
  .command('agents')
  .description('Install or remove Code-KG guidance for coding agents');

agents
  .command('install')
  .description('Install managed AGENTS.md guidance and safe Codex hook')
  .action(async () => {
    const ctx = rootOnlyContext();
    const { agentsCommand } = await import('./agents.js');
    handleResult(await agentsCommand(ctx, { action: 'install' }));
  });

agents
  .command('uninstall')
  .description('Remove managed Code-KG agent guidance and hook entries')
  .action(async () => {
    const ctx = rootOnlyContext();
    const { agentsCommand } = await import('./agents.js');
    handleResult(await agentsCommand(ctx, { action: 'uninstall' }));
  });

agents
  .command('status')
  .description('Show Code-KG agent guidance, hook, semantic, and MCP status')
  .action(async () => {
    const ctx = rootOnlyContext();
    const { agentsCommand } = await import('./agents.js');
    handleResult(await agentsCommand(ctx, { action: 'status' }));
  });

program
  .command('hook-check')
  .description('Run the safe Code-KG agent hook check')
  .action(async () => {
    const ctx = rootOnlyContext();
    const { hookCheckCommand } = await import('./agents.js');
    handleResult(
      await hookCheckCommand(ctx, { input: await readStdinIfAvailable() }),
    );
  });

program
  .command('session-check')
  .description('Run the safe Code-KG SessionStart bootstrap-offer check')
  .action(async () => {
    const ctx = rootOnlyContext();
    const { sessionCheckCommand } = await import('./agents.js');
    handleResult(
      await sessionCheckCommand(ctx, { input: await readStdinIfAvailable() }),
    );
  });

program
  .command('mcp')
  .description('Start the MCP server')
  .action(async () => {
    const { startCodeKgMcpServer } = await import('./mcp.js');
    await startCodeKgMcpServer();
  });

await program.parseAsync();
