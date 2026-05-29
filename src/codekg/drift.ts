import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CmdContext, CmdResult } from '../context.js';
import { extractProjectGraph, hashProjectGraph } from './graph.js';
import type {
  EntityNode,
  ManifestRelationship,
  ManifestSection,
  MaterializationManifest,
  ProjectGraph,
  RelationshipEdge,
} from './types.js';

type DriftSeverity = 'ERROR' | 'WARNING' | 'SUGGEST' | 'INFO';

type DriftFinding = {
  severity: DriftSeverity;
  message: string;
};

type DriftOptions = {
  applySafe?: boolean;
};

function manifestPath(ctx: CmdContext): string {
  return join(ctx.projectRoot, '.code-kg', 'materialization-manifest.json');
}

async function readManifest(
  ctx: CmdContext,
): Promise<MaterializationManifest | null> {
  const path = manifestPath(ctx);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8')) as MaterializationManifest;
}

function manifestSourceNodeIds(manifest: MaterializationManifest): Set<string> {
  const ids = new Set<string>();
  for (const section of Object.values(manifest.sections)) {
    for (const id of section.source_node_ids) ids.add(id);
  }
  return ids;
}

function manifestGraphHashes(manifest: MaterializationManifest): Set<string> {
  return new Set(
    Object.values(manifest.sections)
      .map((section) => section.last_seen_graph_hash)
      .filter(Boolean),
  );
}

function findMissingSourceNodes(
  manifest: MaterializationManifest,
  graph: ProjectGraph,
): DriftFinding[] {
  const graphNodeIds = new Set(graph.nodes.map((node) => node.id));
  const findings: DriftFinding[] = [];
  for (const [stableId, section] of Object.entries(manifest.sections)) {
    for (const nodeId of section.source_node_ids) {
      if (manifest.suppressed.nodes.includes(nodeId)) continue;
      if (!graphNodeIds.has(nodeId)) {
        findings.push({
          severity: 'WARNING',
          message: `Manifest section ${stableId} source node ${nodeId} disappeared from the fresh graph.`,
        });
      }
    }
  }
  return findings;
}

function findUncoveredFiles(
  manifest: MaterializationManifest,
  graph: ProjectGraph,
): DriftFinding[] {
  const coveredIds = manifestSourceNodeIds(manifest);
  const suppressedIds = new Set(manifest.suppressed.nodes);
  return graph.nodes
    .filter((node) => node.kind === 'file')
    .filter((node) => !suppressedIds.has(node.id))
    .filter((node) => !coveredIds.has(node.id))
    .map((node) => ({
      severity: 'INFO' as const,
      message: `Uncovered source file detected: ${node.source_file ?? node.label}.`,
    }));
}

function relationshipMatchesEdge(
  relationship: ManifestRelationship,
  edge: RelationshipEdge,
): boolean {
  return (
    relationship.source_node_id === edge.source &&
    relationship.target_node_id === edge.target &&
    relationship.relation === edge.relation &&
    (relationship.level ?? edge.level) === edge.level
  );
}

function observedRelationship(
  id: string,
  relationship: ManifestRelationship,
  graph: ProjectGraph,
): boolean {
  return graph.edges.some(
    (edge) => edge.id === id || relationshipMatchesEdge(relationship, edge),
  );
}

function findStaleRelationships(
  manifest: MaterializationManifest,
  graph: ProjectGraph,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const [id, relationship] of Object.entries(manifest.relationships)) {
    if (relationship.status !== 'accepted') continue;
    if (relationship.level && relationship.level !== 'structural') continue;
    if (!observedRelationship(id, relationship, graph)) {
      findings.push({
        severity: 'WARNING',
        message: `stale relationship ${id}: accepted structural relationship no longer appears in the fresh graph.`,
      });
    }
  }
  return findings;
}

function sectionPriority(section: ManifestSection): number {
  if (section.status === 'curated') return 0;
  if (section.status === 'edited') return 1;
  if (section.status === 'generated') return 2;
  return 3;
}

function eligibleSectionsForNode(
  manifest: MaterializationManifest,
  nodeId: string,
): string[] {
  return Object.values(manifest.sections)
    .filter(
      (section) =>
        (section.status === 'curated' || section.status === 'edited') &&
        section.source_node_ids.includes(nodeId),
    )
    .sort((a, b) => sectionPriority(a) - sectionPriority(b))
    .map((section) => section.stable_id);
}

function graphNodeById(graph: ProjectGraph): Map<string, EntityNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function isCrossFileRelationship(
  edge: RelationshipEdge,
  nodes: Map<string, EntityNode>,
): boolean {
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  return !!(
    source?.source_file &&
    target?.source_file &&
    source.source_file !== target.source_file
  );
}

function relationshipAlreadyReviewed(
  manifest: MaterializationManifest,
  edge: RelationshipEdge,
): boolean {
  if (manifest.suppressed.relationships.includes(edge.id)) return true;
  if (
    manifest.suppressed.nodes.includes(edge.source) ||
    manifest.suppressed.nodes.includes(edge.target)
  ) {
    return true;
  }
  return Object.entries(manifest.relationships).some(
    ([id, relationship]) =>
      id === edge.id || relationshipMatchesEdge(relationship, edge),
  );
}

function findSuggestedRelationships(
  manifest: MaterializationManifest,
  graph: ProjectGraph,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const nodes = graphNodeById(graph);
  for (const edge of graph.edges) {
    if (edge.level !== 'structural') continue;
    if (edge.relation === 'contains') continue;
    if (!isCrossFileRelationship(edge, nodes)) continue;
    if (relationshipAlreadyReviewed(manifest, edge)) continue;

    const sourceSections = eligibleSectionsForNode(manifest, edge.source);
    const targetSections = eligibleSectionsForNode(manifest, edge.target);
    const sourceSection = sourceSections[0];
    const targetSection = targetSections.find(
      (section) => section !== sourceSection,
    );
    if (!sourceSection || !targetSection) continue;

    findings.push({
      severity: 'SUGGEST',
      message: `new documented structural relationship ${edge.id}: ${sourceSection} ${edge.relation} ${targetSection}.`,
    });
  }
  return findings;
}

function formatFindings(findings: DriftFinding[]): string {
  if (findings.length === 0) {
    return ['# Code-KG Drift', '', 'No drift findings.'].join('\n');
  }

  const lines = ['# Code-KG Drift', ''];
  for (const severity of ['ERROR', 'WARNING', 'SUGGEST', 'INFO'] as const) {
    const group = findings.filter((finding) => finding.severity === severity);
    if (group.length === 0) continue;
    lines.push(`## ${severity}`, '');
    lines.push(...group.map((finding) => `- ${finding.message}`), '');
  }
  return lines.join('\n').trimEnd();
}

async function applySafeManifestUpdates(
  ctx: CmdContext,
  manifest: MaterializationManifest,
  graphHash: string,
): Promise<void> {
  for (const section of Object.values(manifest.sections)) {
    section.last_seen_graph_hash = graphHash;
  }
  await writeFile(manifestPath(ctx), JSON.stringify(manifest, null, 2) + '\n');
}

export async function driftCommand(
  ctx: CmdContext,
  opts: DriftOptions = {},
): Promise<CmdResult> {
  const manifest = await readManifest(ctx);
  if (!manifest) {
    return {
      output: formatFindings([
        {
          severity: 'ERROR',
          message:
            '.code-kg/materialization-manifest.json is missing; run code-kg bootstrap --accept first.',
        },
      ]),
      isError: true,
    };
  }

  const graph = await extractProjectGraph(ctx.projectRoot);
  const graphHash = hashProjectGraph(graph);
  const findings: DriftFinding[] = [];
  findings.push(...findMissingSourceNodes(manifest, graph));
  findings.push(...findStaleRelationships(manifest, graph));
  findings.push(...findSuggestedRelationships(manifest, graph));

  if (!manifestGraphHashes(manifest).has(graphHash)) {
    findings.push({
      severity: 'INFO',
      message:
        'Structural graph changed since the last materialized manifest snapshot.',
    });
    findings.push(...findUncoveredFiles(manifest, graph));
  }

  if (
    opts.applySafe &&
    findings.every((finding) => finding.severity !== 'ERROR')
  ) {
    await applySafeManifestUpdates(ctx, manifest, graphHash);
    findings.push({
      severity: 'INFO',
      message: 'Applied safe manifest metadata updates.',
    });
  }

  return {
    output: formatFindings(findings),
    isError: findings.some((finding) => finding.severity === 'ERROR'),
  };
}
