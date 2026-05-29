import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkAllCommand } from '../cli/check.js';
import type { CmdContext, CmdResult } from '../context.js';
import { flattenSections, loadAllSections } from '../lattice.js';
import { walkEntries } from '../walk.js';
import type { MaterializationManifest, SourceSpan } from './types.js';

async function hasGeneratedMarkers(latDir: string): Promise<boolean> {
  if (!existsSync(latDir)) return false;
  for (const entry of await walkEntries(latDir)) {
    if (!entry.endsWith('.md')) continue;
    const content = await readFile(join(latDir, entry), 'utf-8');
    if (content.includes('code-kg:id')) return true;
  }
  return false;
}

function appendErrors(base: CmdResult, errors: string[]): CmdResult {
  if (errors.length === 0) return base;
  const output = [
    base.output,
    base.output ? '' : undefined,
    '# Code-KG metadata errors',
    '',
    ...errors.map((error) => `- ${error}`),
  ]
    .filter((line): line is string => line !== undefined)
    .join('\n');
  return { output, isError: true };
}

async function lineCount(path: string): Promise<number> {
  const content = await readFile(path, 'utf-8');
  return content.split(/\r?\n/).length;
}

async function validateSourceSpan(
  ctx: CmdContext,
  stableId: string,
  span: SourceSpan,
): Promise<string[]> {
  const errors: string[] = [];
  if (typeof span.file !== 'string' || span.file.length === 0) {
    errors.push(`Manifest section ${stableId} has a source_span without file.`);
    return errors;
  }
  if (!Number.isInteger(span.start_line) || span.start_line < 1) {
    errors.push(
      `Manifest section ${stableId} has invalid source_span start_line for ${span.file}.`,
    );
  }
  if (!Number.isInteger(span.end_line) || span.end_line < span.start_line) {
    errors.push(
      `Manifest section ${stableId} has invalid source_span end_line for ${span.file}.`,
    );
  }

  const target = join(ctx.projectRoot, span.file);
  if (!existsSync(target)) {
    errors.push(
      `Manifest section ${stableId} source_span file does not exist: ${span.file}.`,
    );
    return errors;
  }

  if (Number.isInteger(span.end_line) && span.end_line >= span.start_line) {
    const lines = await lineCount(target);
    if (span.end_line > lines) {
      errors.push(
        `Manifest section ${stableId} source_span exceeds file length for ${span.file}.`,
      );
    }
  }
  return errors;
}

async function validateManifestAnchors(
  ctx: CmdContext,
  manifest: MaterializationManifest,
): Promise<string[]> {
  const errors: string[] = [];
  for (const [stableId, section] of Object.entries(manifest.sections)) {
    const policy = section.source_anchor_policy ?? 'coverage-only';
    const spans = Array.isArray(section.source_spans)
      ? section.source_spans
      : [];
    if (policy !== 'coverage-only' && policy !== 'edit-safe') {
      errors.push(
        `Manifest section ${stableId} has invalid source_anchor_policy ${String(section.source_anchor_policy)}.`,
      );
      continue;
    }
    if (!Array.isArray(section.source_spans)) {
      errors.push(`Manifest section ${stableId} must contain source_spans.`);
    }
    if (policy === 'coverage-only' && spans.length > 0) {
      errors.push(
        `Manifest section ${stableId} is coverage-only but has source_spans.`,
      );
    }
    if (policy === 'edit-safe' && spans.length === 0) {
      errors.push(
        `Manifest section ${stableId} is edit-safe but has no source_spans.`,
      );
    }
    for (const span of spans) {
      errors.push(...(await validateSourceSpan(ctx, stableId, span)));
    }
  }
  return errors;
}

export async function codeKgCheckCommand(ctx: CmdContext): Promise<CmdResult> {
  const base = await checkAllCommand(ctx);
  const errors: string[] = [];
  const manifestPath = join(
    ctx.projectRoot,
    '.code-kg',
    'materialization-manifest.json',
  );
  const manifestExists = existsSync(manifestPath);

  if (!manifestExists) {
    if (await hasGeneratedMarkers(ctx.latDir)) {
      errors.push(
        'Generated code-kg:id markers exist, but .code-kg/materialization-manifest.json is missing.',
      );
    }
    return appendErrors(base, errors);
  }

  try {
    const manifest = JSON.parse(
      await readFile(manifestPath, 'utf-8'),
    ) as MaterializationManifest;
    if (manifest.version !== 1) {
      errors.push('Manifest version must be 1.');
    }
    if (!manifest.sections || typeof manifest.sections !== 'object') {
      errors.push('Manifest must contain a sections object.');
    } else if (existsSync(ctx.latDir)) {
      const ids = new Set(
        flattenSections(await loadAllSections(ctx.latDir)).map(
          (section) => section.id,
        ),
      );
      for (const [stableId, section] of Object.entries(manifest.sections)) {
        if (typeof section.public_section_id !== 'string') {
          errors.push(
            `Manifest section ${stableId} is missing public_section_id.`,
          );
          continue;
        }
        if (!ids.has(section.public_section_id)) {
          errors.push(
            `Manifest section ${stableId} points to missing section ${section.public_section_id}.`,
          );
        }
      }
    }
    if (manifest.sections && typeof manifest.sections === 'object') {
      errors.push(...(await validateManifestAnchors(ctx, manifest)));
    }
  } catch (err) {
    errors.push(
      `Could not parse .code-kg/materialization-manifest.json: ${(err as Error).message}`,
    );
  }

  return appendErrors(base, errors);
}
