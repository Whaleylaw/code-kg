import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CmdContext, CmdResult } from '../context.js';
import type { MaterializationManifest } from './types.js';

type SuppressAction = 'list' | 'node' | 'relationship' | 'clear';

export type SuppressOptions = {
  action: SuppressAction;
  id?: string;
};

function manifestPath(ctx: CmdContext): string {
  return join(ctx.projectRoot, '.code-kg', 'materialization-manifest.json');
}

async function readManifest(ctx: CmdContext): Promise<MaterializationManifest> {
  return JSON.parse(
    await readFile(manifestPath(ctx), 'utf-8'),
  ) as MaterializationManifest;
}

async function writeManifest(
  ctx: CmdContext,
  manifest: MaterializationManifest,
): Promise<void> {
  await writeFile(
    manifestPath(ctx),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf-8',
  );
}

function ensureSuppressed(manifest: MaterializationManifest): void {
  manifest.suppressed ??= { nodes: [], relationships: [] };
  manifest.suppressed.nodes ??= [];
  manifest.suppressed.relationships ??= [];
}

function missingManifest(): CmdResult {
  return {
    output:
      '# Code-KG Suppress\n\n.code-kg/materialization-manifest.json is missing.',
    isError: true,
  };
}

function missingId(): CmdResult {
  return {
    output: '# Code-KG Suppress\n\nSuppression id is required.',
    isError: true,
  };
}

function formatList(manifest: MaterializationManifest): string {
  const lines = ['# Code-KG Suppress', ''];
  if (
    manifest.suppressed.nodes.length === 0 &&
    manifest.suppressed.relationships.length === 0
  ) {
    lines.push('No suppression tombstones.');
    return lines.join('\n');
  }

  lines.push('## Nodes', '');
  lines.push(
    ...(manifest.suppressed.nodes.length
      ? manifest.suppressed.nodes.map((id) => `- ${id}`)
      : ['- None']),
  );
  lines.push('', '## Relationships', '');
  lines.push(
    ...(manifest.suppressed.relationships.length
      ? manifest.suppressed.relationships.map((id) => `- ${id}`)
      : ['- None']),
  );
  return lines.join('\n');
}

async function addSuppression(
  ctx: CmdContext,
  manifest: MaterializationManifest,
  kind: 'node' | 'relationship',
  id: string,
): Promise<CmdResult> {
  const collection =
    kind === 'node'
      ? manifest.suppressed.nodes
      : manifest.suppressed.relationships;
  if (collection.includes(id)) {
    return {
      output: `# Code-KG Suppress\n\nSuppression already exists for ${kind} ${id}.`,
      isError: false,
    };
  }

  collection.push(id);
  collection.sort();
  await writeManifest(ctx, manifest);
  return {
    output: `# Code-KG Suppress\n\nSuppressed ${kind} ${id}.`,
    isError: false,
  };
}

async function clearSuppression(
  ctx: CmdContext,
  manifest: MaterializationManifest,
  id: string,
): Promise<CmdResult> {
  const before =
    manifest.suppressed.nodes.length + manifest.suppressed.relationships.length;
  manifest.suppressed.nodes = manifest.suppressed.nodes.filter(
    (entry) => entry !== id,
  );
  manifest.suppressed.relationships = manifest.suppressed.relationships.filter(
    (entry) => entry !== id,
  );
  const after =
    manifest.suppressed.nodes.length + manifest.suppressed.relationships.length;

  if (before === after) {
    return {
      output: `# Code-KG Suppress\n\nNo suppression tombstone found for ${id}.`,
      isError: false,
    };
  }

  await writeManifest(ctx, manifest);
  return {
    output: `# Code-KG Suppress\n\nCleared suppression ${id}.`,
    isError: false,
  };
}

export async function suppressCommand(
  ctx: CmdContext,
  opts: SuppressOptions,
): Promise<CmdResult> {
  if (!existsSync(manifestPath(ctx))) return missingManifest();
  const manifest = await readManifest(ctx);
  ensureSuppressed(manifest);

  if (opts.action === 'list') {
    return { output: formatList(manifest), isError: false };
  }

  if (!opts.id) return missingId();

  if (opts.action === 'node' || opts.action === 'relationship') {
    return addSuppression(ctx, manifest, opts.action, opts.id);
  }

  return clearSuppression(ctx, manifest, opts.id);
}
