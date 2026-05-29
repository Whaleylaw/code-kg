import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CmdContext, CmdResult } from '../context.js';
import { flattenSections, loadAllSections, type Section } from '../lattice.js';
import { extractProjectGraph } from './graph.js';
import type {
  EntityNode,
  MaterializationManifest,
  ProjectGraph,
  RelationshipEdge,
} from './types.js';

export type ContextInfo = {
  query: string;
  matchedNodes: EntityNode[];
  files: string[];
  sections: Section[];
  imports: string[];
  importedBy: string[];
  testedBy: string[];
  tests: string[];
};

function inlineList(items: string[]): string {
  if (items.length === 0) return 'none detected';
  return items
    .slice(0, 8)
    .map((item) => `\`${item}\``)
    .join(', ');
}

async function readManifest(
  projectRoot: string,
): Promise<MaterializationManifest | null> {
  const path = join(projectRoot, '.code-kg', 'materialization-manifest.json');
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8')) as MaterializationManifest;
}

function unique(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function nodeMatchesQuery(node: EntityNode, query: string): boolean {
  const normalized = query.toLowerCase();
  return [
    node.id,
    node.label,
    node.source_file ?? '',
    node.source_span?.file ?? '',
  ].some((value) => value.toLowerCase() === normalized);
}

function nodeContainsQuery(node: EntityNode, query: string): boolean {
  const normalized = query.toLowerCase();
  return [
    node.id,
    node.label,
    node.source_file ?? '',
    node.source_span?.file ?? '',
  ].some((value) => value.toLowerCase().includes(normalized));
}

function matchedNodes(graph: ProjectGraph, query: string): EntityNode[] {
  const exact = graph.nodes.filter((node) => nodeMatchesQuery(node, query));
  if (exact.length > 0) return exact;
  return graph.nodes
    .filter((node) => nodeContainsQuery(node, query))
    .slice(0, 8);
}

function nodeFiles(nodes: EntityNode[]): string[] {
  return unique(
    nodes
      .map((node) => node.source_file ?? node.source_span?.file)
      .filter((file): file is string => !!file),
  );
}

function relationshipLabels(
  graph: ProjectGraph,
  nodeIds: Set<string>,
  relation: RelationshipEdge['relation'],
  direction: 'outgoing' | 'incoming',
): string[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return unique(
    graph.edges
      .filter((edge) => edge.relation === relation)
      .filter((edge) =>
        direction === 'outgoing'
          ? nodeIds.has(edge.source)
          : nodeIds.has(edge.target),
      )
      .map((edge) =>
        nodes.get(direction === 'outgoing' ? edge.target : edge.source),
      )
      .map((node) => node?.source_file ?? node?.label)
      .filter((label): label is string => !!label),
  );
}

function manifestSectionIdsForNodes(
  manifest: MaterializationManifest | null,
  nodeIds: Set<string>,
  files: Set<string>,
): Set<string> {
  const ids = new Set<string>();
  if (!manifest) return ids;
  for (const section of Object.values(manifest.sections)) {
    if (section.source_node_ids.some((id) => nodeIds.has(id))) {
      ids.add(section.public_section_id);
    }
    if (section.source_spans.some((span) => files.has(span.file))) {
      ids.add(section.public_section_id);
    }
  }
  return ids;
}

function matchingSections(
  sections: Section[],
  query: string,
  files: Set<string>,
  manifestSectionIds: Set<string>,
): Section[] {
  const normalized = query.toLowerCase();
  return sections
    .filter((section) => {
      if (manifestSectionIds.has(section.id)) return true;
      if (
        [section.id, section.heading, section.firstParagraph].some((value) =>
          value.toLowerCase().includes(normalized),
        )
      ) {
        return true;
      }
      return [...files].some(
        (file) =>
          section.id.includes(file) ||
          section.heading.includes(file) ||
          section.firstParagraph.includes(file),
      );
    })
    .slice(0, 10);
}

export async function buildContextInfo(
  ctx: CmdContext,
  query: string,
): Promise<ContextInfo | null> {
  const graph = await extractProjectGraph(ctx.projectRoot);
  const nodes = matchedNodes(graph, query);
  if (nodes.length === 0) return null;

  const files = nodeFiles(nodes);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const fileNodeIds = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.kind === 'file' &&
          node.source_file &&
          files.includes(node.source_file),
      )
      .map((node) => node.id),
  );
  const relationshipNodeIds = new Set([...nodeIds, ...fileNodeIds]);
  const fileSet = new Set(files);
  const manifest = await readManifest(ctx.projectRoot);
  const manifestSectionIds = manifestSectionIdsForNodes(
    manifest,
    relationshipNodeIds,
    fileSet,
  );
  const sections = matchingSections(
    flattenSections(await loadAllSections(ctx.latDir)),
    query,
    fileSet,
    manifestSectionIds,
  );

  return {
    query,
    matchedNodes: nodes,
    files,
    sections,
    imports: relationshipLabels(
      graph,
      relationshipNodeIds,
      'imports',
      'outgoing',
    ),
    importedBy: relationshipLabels(
      graph,
      relationshipNodeIds,
      'imports',
      'incoming',
    ),
    testedBy: relationshipLabels(
      graph,
      relationshipNodeIds,
      'tests',
      'incoming',
    ),
    tests: relationshipLabels(graph, relationshipNodeIds, 'tests', 'outgoing'),
  };
}

export function formatContextInfo(info: ContextInfo): string {
  const lines = [
    '# Code-KG Context',
    '',
    `Query: \`${info.query}\``,
    '',
    '## Matches',
    '',
    ...info.matchedNodes.slice(0, 8).map((node) => {
      const file = node.source_file ?? node.source_span?.file;
      return `- ${node.kind}: \`${node.label}\`${file ? ` in \`${file}\`` : ''}`;
    }),
    '',
    '## Knowledge Sections',
    '',
    ...(info.sections.length
      ? info.sections.map((section) => `- [[${section.id}]]`)
      : ['- none detected']),
    '',
    '## Relationships',
    '',
    `- imports: ${inlineList(info.imports)}`,
    `- imported by: ${inlineList(info.importedBy)}`,
    `- tested by: ${inlineList(info.testedBy)}`,
    `- tests: ${inlineList(info.tests)}`,
    '',
    '## Commands',
    '',
    `- \`code-kg search "${info.query}" --backend auto-semantic\``,
    '- `code-kg drift`',
  ];
  return lines.join('\n');
}

export async function contextCommand(
  ctx: CmdContext,
  query: string | undefined,
): Promise<CmdResult> {
  if (!query?.trim()) {
    return { output: 'Provide a file, symbol, or node query.', isError: true };
  }
  const info = await buildContextInfo(ctx, query.trim());
  if (!info) {
    return {
      output: `No graph context found for "${query}". Run \`code-kg bootstrap --accept\` if the knowledge base is stale.`,
      isError: true,
    };
  }
  return { output: formatContextInfo(info) };
}
