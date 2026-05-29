export type FileCategory =
  | 'code'
  | 'document'
  | 'test'
  | 'config'
  | 'asset'
  | 'unsupported';

export type DiscoveredFile = {
  path: string;
  category: FileCategory;
  extension: string;
};

export type DiscoveryResult = {
  root: string;
  files: DiscoveredFile[];
  counts: Record<FileCategory, number>;
  packageHints: string[];
  entrypoints: string[];
  testPaths: string[];
};

export type SourceSpan = {
  file: string;
  start_line: number;
  end_line: number;
};

export type Confidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';

export type EntityNode = {
  id: string;
  label: string;
  kind:
    | 'module'
    | 'file'
    | 'function'
    | 'class'
    | 'const'
    | 'type'
    | 'interface'
    | 'method'
    | 'variable'
    | 'config';
  source_file?: string;
  source_span?: SourceSpan;
  confidence: Confidence;
};

export type RelationshipEdge = {
  id: string;
  source: string;
  target: string;
  relation:
    | 'contains'
    | 'imports'
    | 'calls'
    | 'extends'
    | 'implements'
    | 'tests'
    | 'configures';
  level: 'structural' | 'semantic';
  confidence: Confidence;
  confidence_score: number;
  source_file?: string;
  source_span?: SourceSpan;
};

export type GraphFragment = {
  nodes: EntityNode[];
  edges: RelationshipEdge[];
  parse_errors: string[];
};

export type Community = {
  id: string;
  label: string;
  node_ids: string[];
  file_count: number;
  symbol_count: number;
  cohesion: number;
};

export type Gap = {
  kind: 'unparsed-file' | 'empty-community';
  message: string;
  node_id?: string;
  file?: string;
};

export type GraphAnalysis = {
  god_nodes: EntityNode[];
  bridges: EntityNode[];
  surprising_connections: RelationshipEdge[];
  gaps: Gap[];
  algorithm: 'multi-language-directory-fallback';
  parse_errors: string[];
};

export type ProjectGraph = {
  nodes: EntityNode[];
  edges: RelationshipEdge[];
  communities: Community[];
  analysis: GraphAnalysis;
};

export type BootstrapFile = {
  path: string;
  content: string;
  committed: boolean;
};

export type BootstrapPlan = {
  root: string;
  discovery: DiscoveryResult;
  graph: ProjectGraph;
  files: BootstrapFile[];
};

export type ManifestSection = {
  stable_id: string;
  public_section_id: string;
  file: string;
  heading_path: string[];
  status: 'generated' | 'edited' | 'curated' | 'suppressed' | 'orphaned';
  source_anchor_policy?: 'coverage-only' | 'edit-safe';
  source_node_ids: string[];
  source_spans: SourceSpan[];
  generated_hash: string;
  current_hash: string;
  last_seen_graph_hash: string;
};

export type RelationshipStatus =
  | 'accepted'
  | 'inferred'
  | 'ambiguous'
  | 'rejected'
  | 'suppressed'
  | 'stale';

export type ManifestRelationship = {
  source_section?: string;
  target_section?: string;
  source_node_id?: string;
  target_node_id?: string;
  relation?: RelationshipEdge['relation'];
  level?: RelationshipEdge['level'];
  confidence?: Confidence;
  confidence_score?: number;
  status: RelationshipStatus;
};

export type MaterializationManifest = {
  version: 1;
  tool_version: string;
  project_root: string;
  generated_at: string;
  sections: Record<string, ManifestSection>;
  relationships: Record<string, ManifestRelationship>;
  suppressed: {
    nodes: string[];
    relationships: string[];
  };
};
