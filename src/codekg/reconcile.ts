import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CmdContext, CmdResult } from '../context.js';
import type { MaterializationManifest } from './types.js';

type ReconcileOptions = {
  write: boolean;
};

type ReconcileChange = {
  stableId: string;
  status: 'edited' | 'orphaned';
  currentHash?: string;
};

function hash(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function manifestPath(ctx: CmdContext): string {
  return join(ctx.projectRoot, '.code-kg', 'materialization-manifest.json');
}

async function readManifest(ctx: CmdContext): Promise<MaterializationManifest> {
  return JSON.parse(
    await readFile(manifestPath(ctx), 'utf-8'),
  ) as MaterializationManifest;
}

function formatOutput(changes: ReconcileChange[], write: boolean): string {
  if (changes.length === 0) {
    return ['# Code-KG Reconcile', '', 'No reconcile changes.'].join('\n');
  }

  const verb = write ? 'marked' : 'would mark';
  return [
    '# Code-KG Reconcile',
    '',
    ...changes.map((change) => {
      if (change.status === 'orphaned') {
        return `- ${verb} ${change.stableId} as orphaned`;
      }
      return `- ${verb} ${change.stableId} as edited`;
    }),
  ].join('\n');
}

export async function reconcileCommand(
  ctx: CmdContext,
  opts: ReconcileOptions,
): Promise<CmdResult> {
  const path = manifestPath(ctx);
  if (!existsSync(path)) {
    return {
      output:
        '# Code-KG Reconcile\n\n.code-kg/materialization-manifest.json is missing.',
      isError: true,
    };
  }

  const manifest = await readManifest(ctx);
  const changes: ReconcileChange[] = [];
  for (const [stableId, section] of Object.entries(manifest.sections)) {
    if (section.status !== 'generated') continue;
    const filePath = join(ctx.projectRoot, section.file);
    if (!existsSync(filePath)) {
      changes.push({ stableId, status: 'orphaned' });
      if (opts.write) section.status = 'orphaned';
      continue;
    }
    const currentHash = hash(await readFile(filePath, 'utf-8'));
    if (currentHash !== section.generated_hash) {
      changes.push({ stableId, status: 'edited', currentHash });
      if (opts.write) {
        section.status = 'edited';
        section.current_hash = currentHash;
      }
    }
  }

  if (opts.write && changes.length > 0) {
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  }

  return {
    output: formatOutput(changes, opts.write),
    isError: false,
  };
}
