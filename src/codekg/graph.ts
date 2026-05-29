import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, posix, resolve } from 'node:path';
import {
  parseSourceSymbols,
  SOURCE_EXTENSIONS,
  type SourceSymbol,
} from '../source-parser.js';
import { discoverProject } from './discovery.js';
import type {
  Community,
  DiscoveryResult,
  EntityNode,
  FileCategory,
  Gap,
  GraphFragment,
  ProjectGraph,
  RelationshipEdge,
} from './types.js';

const LOCAL_IMPORT_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.py',
  '.go',
  '.rs',
  '.c',
  '.h',
];

const GRAPH_CACHE_PATH = '.code-kg/cache/graph.json';

type ImportSpec = {
  primarySpecs: string[];
  fallbackSpecs: string[];
  line: number;
};

function stableId(prefix: string, ...parts: string[]): string {
  const raw = parts.join('|');
  const readable = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const digest = createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return `${prefix}_${readable || 'root'}_${digest}`;
}

function moduleLabel(path: string): string {
  const dir = dirname(path);
  if (dir === '.') return 'root';
  return dir.split('/')[0];
}

function fileNode(path: string): EntityNode {
  return {
    id: stableId('file', path),
    label: path,
    kind: 'file',
    source_file: path,
    confidence: 'EXTRACTED',
  };
}

function moduleNode(label: string): EntityNode {
  return {
    id: stableId('module', label),
    label,
    kind: 'module',
    confidence: 'EXTRACTED',
  };
}

function symbolNode(path: string, symbol: SourceSymbol): EntityNode {
  const label = symbol.parent ? `${symbol.parent}#${symbol.name}` : symbol.name;
  return {
    id: stableId('symbol', path, label, symbol.kind),
    label,
    kind: symbol.kind,
    source_file: path,
    source_span: {
      file: path,
      start_line: symbol.startLine,
      end_line: symbol.endLine,
    },
    confidence: 'EXTRACTED',
  };
}

function edge(
  source: string,
  target: string,
  relation: RelationshipEdge['relation'],
  sourceFile?: string,
  line?: number,
): RelationshipEdge {
  return {
    id: stableId('edge', source, relation, target),
    source,
    target,
    relation,
    level: 'structural',
    confidence: 'EXTRACTED',
    confidence_score: 1.0,
    source_file: sourceFile,
    source_span:
      sourceFile && line
        ? { file: sourceFile, start_line: line, end_line: line }
        : undefined,
  };
}

function validateGraphFragment(fragment: GraphFragment): void {
  const nodeIds = new Set(fragment.nodes.map((node) => node.id));
  for (const relationship of fragment.edges) {
    if (!nodeIds.has(relationship.source)) {
      throw new Error(`edge ${relationship.id} has missing source`);
    }
    if (!nodeIds.has(relationship.target)) {
      throw new Error(`edge ${relationship.id} has missing target`);
    }
  }
}

function extractImportSpecs(path: string, content: string): ImportSpec[] {
  const ext = extname(path);
  if (ext === '.py') return extractPythonImportSpecs(content);

  const specs: ImportSpec[] = [];
  const patterns = [
    /\bimport\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*\s+from\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const spec = match[1];
      if (!spec) continue;
      const line = content.slice(0, match.index).split('\n').length;
      specs.push({ primarySpecs: [spec], fallbackSpecs: [], line });
    }
  }

  return specs;
}

function extractPythonImportSpecs(content: string): ImportSpec[] {
  const specs: ImportSpec[] = [];
  const fromPattern = /^\s*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm;
  const importPattern = /^\s*import\s+([^\n#]+)/gm;

  for (const match of content.matchAll(fromPattern)) {
    const moduleSpec = match[1];
    if (!moduleSpec) continue;
    const line = content.slice(0, match.index).split('\n').length;
    const importedNames = pythonImportedNames(match[2] ?? '');
    specs.push({
      primarySpecs: importedNames.map((name) =>
        joinPythonModule(moduleSpec, name),
      ),
      fallbackSpecs: [moduleSpec],
      line,
    });
  }

  for (const match of content.matchAll(importPattern)) {
    const line = content.slice(0, match.index).split('\n').length;
    for (const imported of pythonImportedNames(match[1] ?? '')) {
      specs.push({ primarySpecs: [imported], fallbackSpecs: [], line });
    }
  }

  return specs;
}

function pythonImportedNames(raw: string): string[] {
  return raw
    .replace(/[()]/g, ' ')
    .split(',')
    .map(
      (part) =>
        part
          .trim()
          .split(/\s+as\s+/i)[0]
          ?.trim() ?? '',
    )
    .filter((part) => /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(part));
}

function joinPythonModule(moduleSpec: string, importedName: string): string {
  if (/^\.+$/.test(moduleSpec)) return `${moduleSpec}${importedName}`;
  return `${moduleSpec}.${importedName}`;
}

function candidatePaths(base: string): string[] {
  if (extname(base)) return [base];
  return [
    ...LOCAL_IMPORT_EXTENSIONS.map((ext) => `${base}${ext}`),
    ...LOCAL_IMPORT_EXTENSIONS.map((ext) => `${base}/index${ext}`),
    `${base}/__init__.py`,
  ];
}

function resolveLocalImportSpec(
  importer: string,
  spec: string,
  knownPaths: Set<string>,
): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) {
    if (extname(importer) === '.py') {
      const dots = spec.match(/^\.+/)?.[0].length ?? 0;
      const rest = spec.slice(dots).replace(/\./g, '/');
      let dir = dirname(importer);
      for (let i = 1; i < dots; i++) {
        dir = dirname(dir);
      }
      base = posix.normalize(posix.join(dir === '.' ? '' : dir, rest));
    } else {
      base = posix.normalize(posix.join(dirname(importer), spec));
    }
  } else if (
    extname(importer) === '.py' &&
    /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(spec)
  ) {
    base = spec.replace(/\./g, '/');
  }
  if (!base) return null;

  for (const candidate of candidatePaths(base)) {
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function resolveLocalImports(
  importer: string,
  spec: ImportSpec,
  knownPaths: Set<string>,
): string[] {
  const primaryTargets = uniqueStrings(
    spec.primarySpecs
      .map((entry) => resolveLocalImportSpec(importer, entry, knownPaths))
      .filter((target): target is string => !!target),
  );
  if (primaryTargets.length > 0) return primaryTargets;
  return uniqueStrings(
    spec.fallbackSpecs
      .map((entry) => resolveLocalImportSpec(importer, entry, knownPaths))
      .filter((target): target is string => !!target),
  );
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)].sort();
}

async function fragmentForFile(
  root: string,
  path: string,
  knownPaths: Set<string>,
  fileCategories: Map<string, FileCategory>,
): Promise<GraphFragment> {
  const nodes: EntityNode[] = [];
  const edges: RelationshipEdge[] = [];
  const parseErrors: string[] = [];
  const module = moduleNode(moduleLabel(path));
  const file = fileNode(path);
  nodes.push(module, file);
  edges.push(edge(module.id, file.id, 'contains', path));

  let content: string;
  try {
    content = await readFile(`${root}/${path}`, 'utf-8');
  } catch (err) {
    return {
      nodes,
      edges,
      parse_errors: [`${path}: ${(err as Error).message}`],
    };
  }

  try {
    const symbols = await parseSourceSymbols(path, content);
    const byLabel = new Map<string, EntityNode>();
    for (const symbol of symbols) {
      const node = symbolNode(path, symbol);
      nodes.push(node);
      byLabel.set(node.label, node);
      edges.push(edge(file.id, node.id, 'contains', path, symbol.startLine));
    }

    for (const symbol of symbols.filter((entry) => entry.parent)) {
      const parent = byLabel.get(symbol.parent!);
      const child = byLabel.get(`${symbol.parent}#${symbol.name}`);
      if (parent && child) {
        edges.push(
          edge(parent.id, child.id, 'contains', path, symbol.startLine),
        );
      }
    }
  } catch (err) {
    parseErrors.push(`${path}: ${(err as Error).message}`);
  }

  for (const importSpec of extractImportSpecs(path, content)) {
    for (const target of resolveLocalImports(path, importSpec, knownPaths)) {
      edges.push(
        edge(file.id, fileNode(target).id, 'imports', path, importSpec.line),
      );
      if (
        fileCategories.get(path) === 'test' &&
        fileCategories.get(target) === 'code'
      ) {
        edges.push(
          edge(file.id, fileNode(target).id, 'tests', path, importSpec.line),
        );
      }
    }
  }

  return { nodes, edges, parse_errors: parseErrors };
}

function mergeFragments(fragments: GraphFragment[]): GraphFragment {
  const nodes = new Map<string, EntityNode>();
  const edges = new Map<string, RelationshipEdge>();
  const parseErrors: string[] = [];
  for (const fragment of fragments) {
    for (const node of fragment.nodes) nodes.set(node.id, node);
    for (const relationship of fragment.edges) {
      edges.set(relationship.id, relationship);
    }
    parseErrors.push(...fragment.parse_errors);
  }
  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    parse_errors: parseErrors.sort(),
  };
}

function nodeCommunity(node: EntityNode): string {
  if (node.kind === 'module') return node.label;
  if (node.source_file) return moduleLabel(node.source_file);
  return 'root';
}

function analyzeGraph(fragment: GraphFragment): ProjectGraph {
  const nodeById = new Map(fragment.nodes.map((node) => [node.id, node]));
  const degree = new Map<string, number>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const relationship of fragment.edges) {
    degree.set(relationship.source, (degree.get(relationship.source) ?? 0) + 1);
    degree.set(relationship.target, (degree.get(relationship.target) ?? 0) + 1);
    outgoing.set(
      relationship.source,
      (outgoing.get(relationship.source) ?? 0) + 1,
    );
    incoming.set(
      relationship.target,
      (incoming.get(relationship.target) ?? 0) + 1,
    );
  }

  const grouped = new Map<string, EntityNode[]>();
  for (const node of fragment.nodes) {
    const key = nodeCommunity(node);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(node);
  }

  const communities: Community[] = [...grouped.entries()]
    .map(([label, nodes]) => {
      const ids = new Set(nodes.map((node) => node.id));
      const incident = fragment.edges.filter(
        (relationship) =>
          ids.has(relationship.source) || ids.has(relationship.target),
      );
      const internal = incident.filter(
        (relationship) =>
          ids.has(relationship.source) && ids.has(relationship.target),
      );
      return {
        id: stableId('community', label),
        label,
        node_ids: [...ids].sort(),
        file_count: nodes.filter((node) => node.kind === 'file').length,
        symbol_count: nodes.filter(
          (node) => node.kind !== 'file' && node.kind !== 'module',
        ).length,
        cohesion:
          incident.length === 0
            ? 1
            : Number((internal.length / incident.length).toFixed(2)),
      };
    })
    .sort((a, b) => b.node_ids.length - a.node_ids.length);

  const godNodes = fragment.nodes
    .filter((node) => (degree.get(node.id) ?? 0) >= 3)
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, 10);

  const bridges = fragment.nodes
    .filter(
      (node) =>
        (incoming.get(node.id) ?? 0) > 0 && (outgoing.get(node.id) ?? 0) > 0,
    )
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
    .slice(0, 10);

  const surprisingConnections = fragment.edges
    .filter((relationship) => relationship.relation === 'imports')
    .filter((relationship) => {
      const source = nodeById.get(relationship.source);
      const target = nodeById.get(relationship.target);
      return (
        source && target && nodeCommunity(source) !== nodeCommunity(target)
      );
    })
    .slice(0, 20);

  const filesWithSymbols = new Set(
    fragment.nodes
      .filter((node) => node.kind !== 'file' && node.kind !== 'module')
      .map((node) => node.source_file)
      .filter((file): file is string => !!file),
  );
  const gaps: Gap[] = fragment.nodes
    .filter((node) => node.kind === 'file')
    .filter(
      (node) => node.source_file && !filesWithSymbols.has(node.source_file),
    )
    .map((node) => ({
      kind: 'unparsed-file',
      node_id: node.id,
      file: node.source_file,
      message: `${node.source_file} has no extracted top-level symbols.`,
    }));

  return {
    nodes: fragment.nodes,
    edges: fragment.edges,
    communities,
    analysis: {
      god_nodes: godNodes,
      bridges,
      surprising_connections: surprisingConnections,
      gaps,
      algorithm: 'multi-language-directory-fallback',
      parse_errors: fragment.parse_errors,
    },
  };
}

export async function extractProjectGraph(
  rootArg = '.',
  discoveryArg?: DiscoveryResult,
): Promise<ProjectGraph> {
  const root = resolve(rootArg);
  const discovery = discoveryArg ?? (await discoverProject(root));
  const codePaths = discovery.files
    .filter((file) => file.category === 'code' || file.category === 'test')
    .filter((file) => SOURCE_EXTENSIONS.has(file.extension))
    .map((file) => file.path);
  const knownPaths = new Set(codePaths);
  const fileCategories = new Map(
    discovery.files.map((file) => [file.path, file.category]),
  );
  const fragments = await Promise.all(
    codePaths.map((path) =>
      fragmentForFile(root, path, knownPaths, fileCategories),
    ),
  );
  const fragment = mergeFragments(fragments);
  validateGraphFragment(fragment);
  return analyzeGraph(fragment);
}

export function hashProjectGraph(graph: ProjectGraph): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(graph)).digest('hex')}`;
}

export async function writeGraphCache(
  rootArg: string,
  graph: ProjectGraph,
): Promise<string> {
  const root = resolve(rootArg);
  const target = join(root, GRAPH_CACHE_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(graph, null, 2) + '\n', 'utf-8');
  return GRAPH_CACHE_PATH;
}

export function formatGraphReport(root: string, graph: ProjectGraph): string {
  const lines = [
    '# Code-KG Extract',
    '',
    `Root: ${root}`,
    '',
    '## Structural Graph',
    '',
    `- Nodes: ${graph.nodes.length}`,
    `- Edges: ${graph.edges.length}`,
    `- Communities: ${graph.communities.length}`,
    `- Analysis algorithm: ${graph.analysis.algorithm}`,
    `- Parse errors: ${graph.analysis.parse_errors.length}`,
    '',
    '## Communities',
    '',
    ...(graph.communities.length
      ? graph.communities
          .slice(0, 10)
          .map(
            (community) =>
              `- ${community.label}: ${community.file_count} files, ${community.symbol_count} symbols, cohesion ${community.cohesion}`,
          )
      : ['- No communities were detected.']),
    '',
    '## God Nodes',
    '',
    ...(graph.analysis.god_nodes.length
      ? graph.analysis.god_nodes
          .slice(0, 10)
          .map((node) => `- ${node.label} (${node.kind})`)
      : ['- No high-degree nodes were detected.']),
    '',
    '## Bridge Nodes',
    '',
    ...(graph.analysis.bridges.length
      ? graph.analysis.bridges
          .slice(0, 10)
          .map((node) => `- ${node.label} (${node.kind})`)
      : ['- No bridge nodes were detected.']),
    '',
    '## Quality Gates',
    '',
    ...qualityGateWarnings(graph),
  ];
  return lines.join('\n');
}

export function qualityGateWarnings(graph: ProjectGraph): string[] {
  const warnings: string[] = [];
  for (const community of graph.communities) {
    if (community.file_count > 1 && community.cohesion < 0.35) {
      warnings.push(
        `- Low cohesion community: ${community.label} (${community.cohesion})`,
      );
    }
  }
  for (const node of graph.analysis.god_nodes.slice(0, 5)) {
    warnings.push(`- Review god node candidate: ${node.label} (${node.kind})`);
  }
  for (const error of graph.analysis.parse_errors.slice(0, 5)) {
    warnings.push(`- Parse warning: ${error}`);
  }
  if (warnings.length === 0) {
    warnings.push('- No MVP 2 quality gate warnings.');
  }
  return warnings;
}
