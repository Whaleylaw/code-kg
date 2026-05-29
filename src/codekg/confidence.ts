import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CmdContext, CmdResult } from '../context.js';
import type { ManifestRelationship, MaterializationManifest } from './types.js';

type ConfidenceAction = 'list' | 'accept' | 'reject' | 'reconcile';

export type ConfidenceOptions = {
  action: ConfidenceAction;
  relationshipId?: string;
  acceptPromotions?: boolean;
};

type PromotionCandidate = {
  id: string;
  file: string;
  status: ManifestRelationship['status'];
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

function missingManifest(): CmdResult {
  return {
    output:
      '# Code-KG Confidence\n\n.code-kg/materialization-manifest.json is missing.',
    isError: true,
  };
}

function isReviewable(relationship: ManifestRelationship): boolean {
  return (
    relationship.status === 'inferred' || relationship.status === 'ambiguous'
  );
}

function relationshipTarget(
  manifest: MaterializationManifest,
  relationship: ManifestRelationship,
): string | undefined {
  if (!relationship.target_section) return undefined;
  return (
    manifest.sections[relationship.target_section]?.public_section_id ??
    relationship.target_section
  );
}

function relationshipSourceFile(
  manifest: MaterializationManifest,
  relationship: ManifestRelationship,
): string | undefined {
  if (!relationship.source_section) return undefined;
  return manifest.sections[relationship.source_section]?.file;
}

function formatRelationship(
  manifest: MaterializationManifest,
  id: string,
  relationship: ManifestRelationship,
): string {
  const source = relationship.source_section ?? 'unknown source';
  const target = relationshipTarget(manifest, relationship) ?? 'unknown target';
  const relation = relationship.relation ?? 'related';
  const confidence = relationship.confidence
    ? `, ${relationship.confidence.toLowerCase()}`
    : '';
  const score =
    typeof relationship.confidence_score === 'number'
      ? `, ${relationship.confidence_score.toFixed(2)}`
      : '';
  return `- ${id}: ${source} ${relation} ${target} (${relationship.status}${confidence}${score})`;
}

function formatList(manifest: MaterializationManifest): string {
  const entries = Object.entries(manifest.relationships).filter(
    ([, relationship]) => isReviewable(relationship),
  );
  if (entries.length === 0) {
    return ['# Code-KG Confidence', '', 'No confidence review items.'].join(
      '\n',
    );
  }
  return [
    '# Code-KG Confidence',
    '',
    ...entries.map(([id, relationship]) =>
      formatRelationship(manifest, id, relationship),
    ),
  ].join('\n');
}

function formatMutation(
  action: 'accept' | 'reject',
  relationshipId: string,
): string {
  const status = action === 'accept' ? 'accepted' : 'rejected';
  return [
    '# Code-KG Confidence',
    '',
    `Marked ${relationshipId} as ${status}.`,
  ].join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lineContaining(content: string, needle: string): string | null {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    if (line.includes(needle)) return line;
  }
  return null;
}

async function findPromotionCandidates(
  ctx: CmdContext,
  manifest: MaterializationManifest,
): Promise<PromotionCandidate[]> {
  const candidates: PromotionCandidate[] = [];
  for (const [id, relationship] of Object.entries(manifest.relationships)) {
    if (
      relationship.status !== 'inferred' &&
      relationship.status !== 'ambiguous'
    ) {
      continue;
    }
    const file = relationshipSourceFile(manifest, relationship);
    const target = relationshipTarget(manifest, relationship);
    if (!file || !target) continue;

    const filePath = join(ctx.projectRoot, file);
    if (!existsSync(filePath)) continue;
    const content = await readFile(filePath, 'utf-8');
    const linkedLine = lineContaining(content, `[[${target}`);
    if (!linkedLine) continue;

    const confidencePattern = new RegExp(
      `\\*\\(\\s*${escapeRegExp(relationship.status)}\\b`,
      'i',
    );
    const confidenceStillVisible =
      confidencePattern.test(linkedLine) ||
      /\*\(\s*(inferred|ambiguous)\b/i.test(linkedLine);
    if (!confidenceStillVisible) {
      candidates.push({ id, file, status: relationship.status });
    }
  }
  return candidates;
}

function formatReconcile(
  candidates: PromotionCandidate[],
  acceptPromotions: boolean,
): string {
  if (candidates.length === 0) {
    return [
      '# Code-KG Confidence Reconcile',
      '',
      'No confidence reconcile changes.',
    ].join('\n');
  }

  const verb = acceptPromotions ? 'accepted promotion' : 'promotion candidate';
  return [
    '# Code-KG Confidence Reconcile',
    '',
    ...candidates.map(
      (candidate) =>
        `- ${verb} ${candidate.id}: ${candidate.status} annotation was removed in ${candidate.file}`,
    ),
    ...(acceptPromotions
      ? []
      : [
          '',
          'Run `code-kg confidence reconcile --accept-promotions` to mark these relationships accepted.',
        ]),
  ].join('\n');
}

export async function confidenceCommand(
  ctx: CmdContext,
  opts: ConfidenceOptions,
): Promise<CmdResult> {
  if (!existsSync(manifestPath(ctx))) return missingManifest();
  const manifest = await readManifest(ctx);

  if (opts.action === 'list') {
    return { output: formatList(manifest), isError: false };
  }

  if (opts.action === 'accept' || opts.action === 'reject') {
    const relationshipId = opts.relationshipId;
    if (!relationshipId) {
      return {
        output: '# Code-KG Confidence\n\nRelationship id is required.',
        isError: true,
      };
    }
    const relationship = manifest.relationships[relationshipId];
    if (!relationship) {
      return {
        output: `# Code-KG Confidence\n\nRelationship not found: ${relationshipId}`,
        isError: true,
      };
    }
    relationship.status = opts.action === 'accept' ? 'accepted' : 'rejected';
    await writeManifest(ctx, manifest);
    return {
      output: formatMutation(opts.action, relationshipId),
      isError: false,
    };
  }

  const candidates = await findPromotionCandidates(ctx, manifest);
  if (opts.acceptPromotions) {
    for (const candidate of candidates) {
      manifest.relationships[candidate.id].status = 'accepted';
    }
    if (candidates.length > 0) await writeManifest(ctx, manifest);
  }
  return {
    output: formatReconcile(candidates, opts.acceptPromotions === true),
    isError: false,
  };
}
