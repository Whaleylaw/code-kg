import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { CmdContext, CmdResult } from '../context.js';
import { backlinkAnchorsForSection } from './anchors.js';
import type { MaterializationManifest } from './types.js';

type ApplyBacklinksOptions = {
  write: boolean;
};

type BacklinkInsertion = {
  file: string;
  line: number;
  comment: string;
};

type BacklinkSkip = {
  file: string;
  reason: string;
};

type BacklinkPlan = {
  insertions: BacklinkInsertion[];
  skips: BacklinkSkip[];
};

const SLASH_COMMENT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.cxx',
]);

const HASH_COMMENT_EXTENSIONS = new Set([
  '.py',
  '.rb',
  '.sh',
  '.bash',
  '.zsh',
  '.pl',
]);

const SKIP_PATH_PARTS = new Set([
  'node_modules',
  'vendor',
  'dist',
  'build',
  '.code-kg',
]);

function manifestPath(ctx: CmdContext): string {
  return join(ctx.projectRoot, '.code-kg', 'materialization-manifest.json');
}

async function readManifest(ctx: CmdContext): Promise<MaterializationManifest> {
  return JSON.parse(
    await readFile(manifestPath(ctx), 'utf-8'),
  ) as MaterializationManifest;
}

function commentPrefix(file: string): string | null {
  const extension = extname(file);
  if (SLASH_COMMENT_EXTENSIONS.has(extension)) return '//';
  if (HASH_COMMENT_EXTENSIONS.has(extension)) return '#';
  return null;
}

function skippedPathReason(file: string): string | null {
  const parts = file.split(/[\\/]/);
  return parts.some((part) => SKIP_PATH_PARTS.has(part))
    ? `skipped generated or dependency path ${file}`
    : null;
}

function missingManifest(): CmdResult {
  return {
    output:
      '# Code-KG Apply Backlinks\n\n.code-kg/materialization-manifest.json is missing.',
    isError: true,
  };
}

async function backlinkPlan(ctx: CmdContext): Promise<BacklinkPlan> {
  const manifest = await readManifest(ctx);
  const insertions: BacklinkInsertion[] = [];
  const skips: BacklinkSkip[] = [];
  const seen = new Set<string>();

  for (const section of Object.values(manifest.sections)) {
    if (section.status === 'suppressed' || section.status === 'orphaned') {
      continue;
    }

    for (const span of backlinkAnchorsForSection(section)) {
      const pathReason = skippedPathReason(span.file);
      if (pathReason) {
        skips.push({ file: span.file, reason: pathReason });
        continue;
      }

      const prefix = commentPrefix(span.file);
      if (!prefix) {
        skips.push({
          file: span.file,
          reason: `skipped unsupported file ${span.file}`,
        });
        continue;
      }

      const target = join(ctx.projectRoot, span.file);
      if (!existsSync(target)) {
        skips.push({
          file: span.file,
          reason: `skipped missing file ${span.file}`,
        });
        continue;
      }

      const comment = `${prefix} @lat: [[${section.public_section_id}]]`;
      const content = await readFile(target, 'utf-8');
      if (content.includes(`@lat: [[${section.public_section_id}]]`)) {
        continue;
      }

      const key = `${span.file}:${span.start_line}:${comment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      insertions.push({
        file: span.file,
        line: span.start_line,
        comment,
      });
    }
  }

  insertions.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  return { insertions, skips };
}

function formatPlan(plan: BacklinkPlan, write: boolean): string {
  const lines = ['# Code-KG Apply Backlinks', ''];
  if (plan.insertions.length === 0 && plan.skips.length === 0) {
    lines.push('No backlink changes.');
    return lines.join('\n');
  }

  const verb = write ? 'inserted' : 'would insert';
  lines.push(
    ...plan.insertions.map(
      (entry) => `- ${verb} ${entry.comment} at ${entry.file}:${entry.line}`,
    ),
  );
  lines.push(...plan.skips.map((skip) => `- ${skip.reason}`));
  return lines.join('\n');
}

async function writeInsertions(
  ctx: CmdContext,
  insertions: BacklinkInsertion[],
): Promise<BacklinkInsertion[]> {
  const written: BacklinkInsertion[] = [];
  const byFile = new Map<string, BacklinkInsertion[]>();
  for (const insertion of insertions) {
    if (!byFile.has(insertion.file)) byFile.set(insertion.file, []);
    byFile.get(insertion.file)!.push(insertion);
  }

  for (const [file, fileInsertions] of byFile) {
    const target = join(ctx.projectRoot, file);
    const content = await readFile(target, 'utf-8');
    const lines = content.split(/\r?\n/);
    const pending = fileInsertions
      .filter((entry) => !content.includes(entry.comment))
      .sort((a, b) => b.line - a.line);

    for (const insertion of pending) {
      const index = Math.max(0, Math.min(insertion.line - 1, lines.length));
      lines.splice(index, 0, insertion.comment);
      written.push(insertion);
    }

    if (pending.length > 0) {
      await writeFile(target, lines.join('\n'), 'utf-8');
    }
  }

  written.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
  return written;
}

export async function applyBacklinksCommand(
  ctx: CmdContext,
  opts: ApplyBacklinksOptions,
): Promise<CmdResult> {
  if (!existsSync(manifestPath(ctx))) return missingManifest();

  const plan = await backlinkPlan(ctx);
  if (!opts.write) {
    return { output: formatPlan(plan, false), isError: false };
  }

  const written = await writeInsertions(ctx, plan.insertions);
  return {
    output: formatPlan({ insertions: written, skips: plan.skips }, true),
    isError: false,
  };
}
