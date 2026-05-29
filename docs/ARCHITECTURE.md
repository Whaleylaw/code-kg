# Code-KG Merged Architecture

Date: 2026-05-25
Status: merged proposal

This document merges the Codex and Claude architecture drafts, the reciprocal
reviews, and the implementation facts discovered in `graphify-7` and
`lat.md-main`.

## Problem

AI code agents repeatedly spend context rebuilding the same understanding of a
repository. They search, read files, infer the architecture, make a change, and
then that working model disappears with the session.

On larger repositories this creates three concrete problems:

- Orientation consumes context that should be used for the actual task.
- Agents work from partial or stale mental models and can miss architectural
  intent.
- Decisions and rationale live in scattered pull requests, commit messages, and
  docs that agents rarely discover at the right moment.

## Solution

Code-KG gives agents a persistent, reviewable map of a codebase. Bootstrap mode
extracts structure from the repository and proposes a first `lat.md/` knowledge
base. Ongoing mode makes that knowledge base part of daily development: agents
read it before broad source inspection, update it when behavior changes, and
validate it before finishing.

## Executive Summary

Code-KG combines Graphify's automatic repository discovery with lat.md's
reviewable markdown knowledge graph.

The product has two modes:

1. Bootstrap: extract a codebase graph, preview the proposed knowledge map, and
   materialize a useful first `lat.md/` directory.
2. Ongoing maintenance: agents and humans use, update, validate, and drift-check
   `lat.md/` as code changes.

The key architectural decision is that `lat.md/` is the human and agent-facing
source of truth after bootstrap. Generated graphs, indexes, manifests, and
search databases are supporting artifacts. They help the tool preserve edits,
detect drift, and explain generated output, but agents should normally read the
curated markdown rather than the raw graph.

The first valuable workflow must be:

```text
code-kg bootstrap --preview
  -> inspect proposed files and sections
  -> suppress noisy candidates
  -> accept materialization
  -> generated lat.md/ passes code-kg check
```

If the tool cannot create the first useful `lat.md/` map, it is just lat.md with
a new command name. Bootstrap quality is therefore part of MVP, not a later
enhancement.

## Goals

- Give agents a persistent, searchable map before they read source files.
- Bootstrap that map automatically from an existing repository.
- Keep project knowledge in normal markdown that can be reviewed in pull
  requests.
- Preserve user edits and suppressions across repeated extraction runs.
- Detect stale links, renamed code, and important uncovered modules before
  agents rely on old context.
- Keep the default path local, fast, and usable without model API keys.

## Non-Goals

- Do not replace source-code inspection. `lat.md/` orients agents, but agents
  still verify implementation details in source.
- Do not make raw graph JSON the normal agent interface.
- Do not mutate source files during bootstrap.
- Do not require hosted embeddings or LLM extraction for first-run value.
- Do not commit bulky caches, vector indexes, or raw graph snapshots by default.

## Product Model

Graphify is the discovery engine. It detects files, extracts code structure,
builds a graph, clusters communities, finds god nodes, and highlights surprising
relationships.

lat.md is the memory layer. It stores project knowledge as markdown sections
with wiki links, source links, optional `@lat` backlinks, search, MCP tools, and
validation.

Code-KG is the bridge:

1. Extract graph evidence from the repository.
2. Convert useful evidence into reviewable `lat.md/` sections.
3. Preserve generated-to-curated provenance in a manifest.
4. Let agents maintain the markdown during normal work.
5. Re-extract later and compare fresh evidence against accepted knowledge.

## System Overview

```text
                               bootstrap
                               ---------

   repository
       |
       v
   detect files and scope
       |
       v
   extract structural graph
       |
       v
   build and analyze graph
       |
       v
   generate materialization preview
       |
       v
   accept / suppress / edit plan
       |
       v
   write lat.md/ and manifest
       |
       v
   code-kg check


                            daily agent workflow
                            --------------------

   user prompt
       |
       v
   code-kg search or locate
       |
       v
   code-kg section targeted context
       |
       v
   source verification
       |
       v
   code changes
       |
       v
   lat.md/ updates
       |
       v
   code-kg check


                              drift workflow
                              --------------

   repository
       |
       v
   re-extract structural graph
       |
       v
   compare graph + manifest + lat.md/
       |
       v
   report broken refs, stale generated links,
   uncovered modules, and suggested relationships
```

## Design Principles

- Canonical knowledge is markdown. `lat.md/` is what humans review and agents
  read.
- Metadata is allowed, but not inside `lat.md/` unless it is markdown. Current
  lat.md validation rejects non-markdown files under `lat.md/`, so Code-KG
  stores tool metadata in `.code-kg/`.
- Bootstrap is preview-first. Generated output is inspected before it becomes
  committed project memory.
- Generated content is provisional. Inferred or ambiguous facts carry visible
  confidence until accepted.
- User edits win. A repeated extraction run must not overwrite curated or edited
  sections without an explicit merge decision.
- Drift detection is advisory by default. Auto-apply is limited to narrow,
  unambiguous fixes.
- Search must work locally. Hosted embeddings can improve ranking, but lexical
  search must provide a zero-key baseline.
- Source edits are opt-in. Backlink insertion is a separate command with
  preview and write modes.

## Storage Layout

### Committed by Default

```text
lat.md/
  lat.md                     root index required by lat.md
  architecture.md            generated or curated system overview
  <community>.md             important subsystem files
  cross-cutting.md           bridge nodes and cross-community flows
  confidence.md              markdown review queue for unresolved uncertainty
  tests.md                   optional testing and behavior map

.code-kg/
  materialization-manifest.json

AGENTS.md                    optional generated agent guidance
```

`lat.md/lat.md` is the root index. Subdirectory indexes use the existing lat.md
convention: `<dir>/<dir>.md`. Code-KG should not introduce `index.md` unless
lat.md validation is intentionally changed.

### Ignored by Default

```text
.code-kg/cache/
  extraction.json
  graph.json
  analysis.json
  bootstrap-preview.json
  drift-report.json

.code-kg/search.sqlite
.code-kg/token-costs.jsonl
.code-kg/tmp/
```

The manifest is committed by default because it protects user edits,
suppressions, and stable generated identities across machines. It is tool state,
not the source of architectural truth. Raw graph files and indexes are caches
and should be regenerated.

Teams may choose not to commit `.code-kg/materialization-manifest.json`, but
that degrades merge safety. In that mode Code-KG can still parse `lat.md/`, but
it cannot reliably distinguish generated, edited, suppressed, or moved sections
from plain human-authored content.

## Major Components

### 1. File Detection

Detection finds supported project artifacts and filters out files that should
not be read.

Responsibilities:

- Walk a target directory while honoring `.gitignore`, `.codekgignore`, and
  built-in ignore rules.
- Classify files as code, markdown/docs, office documents, PDFs, images,
  video/audio, generated output, or unsupported files.
- Skip secrets, credentials, keys, dependency directories, build outputs, and
  Code-KG caches.
- Report scope before expensive extraction begins.
- Produce a deterministic file inventory for preview and benchmarks.

MVP detection should be local and deterministic. Rich document conversion and
semantic extraction can be layered on later.

### 2. Structural Extraction

Structural extraction converts source files into graph fragments. It is local,
deterministic, and the default bootstrap path.

Entities:

- Files
- Modules/packages
- Classes/types/interfaces
- Functions/methods
- Tests/specs
- Config files when they define important runtime behavior

Relationships:

- `contains`
- `imports`
- `calls`
- `extends`
- `implements`
- `tests`
- `configures`

Edges carry a `level` field so drift can separate deterministic source facts
from model-backed suggestions:

| Level | Meaning | Drift behavior |
| --- | --- | --- |
| `structural` | Derived from AST or other deterministic parsing. | Previously accepted structural facts can become warnings; new cross-file relationships between documented entities are eligible for suggestions. |
| `semantic` | Derived from LLMs or heuristics, such as similarity, configures, or documents. | Suggested only; never required documentation coverage. |

Structural does not mean every extracted edge must appear in `lat.md/`. Most
code edges are too granular for durable project memory.

Graph fragment shape:

```json
{
  "nodes": [
    {
      "id": "src_auth_ts_validateToken",
      "label": "validateToken",
      "kind": "function",
      "source_file": "src/auth.ts",
      "source_span": {
        "start_line": 42,
        "end_line": 67
      },
      "confidence": "EXTRACTED"
    }
  ],
  "edges": [
    {
      "id": "edge_src_auth_validateToken_calls_src_crypto_verifyJWT",
      "source": "src_auth_ts_validateToken",
      "target": "src_crypto_ts_verifyJWT",
      "relation": "calls",
      "level": "structural",
      "confidence": "EXTRACTED",
      "confidence_score": 1.0,
      "source_file": "src/auth.ts",
      "source_span": {
        "start_line": 47,
        "end_line": 47
      }
    }
  ]
}
```

Node IDs are internal graph IDs. They should be stable enough for repeated runs
by combining source path, symbol name, kind, and source span. When code moves,
drift detection may need rename or move heuristics to connect old and new IDs.

### 3. Semantic Extraction

Semantic extraction is optional and post-MVP. It uses LLMs or local models to
extract conceptual relationships from docs, design notes, PDFs, images, and
ambiguous code.

Semantic edges carry:

- `level: "semantic"`
- `confidence: "INFERRED"` or `confidence: "AMBIGUOUS"`
- `confidence_score`
- `evidence`
- `provider`
- `prompt_hash` or equivalent reproducibility metadata

Semantic extraction must be opt-in because it can cost tokens, introduce
uncertain claims, and produce authoritative-looking noise.

### 4. Graph Build And Analysis

The graph builder merges fragments into one project graph and emits analysis
for materialization.

Responsibilities:

- Validate graph fragment schema.
- Normalize paths and IDs.
- Deduplicate equivalent entities.
- Preserve edge direction.
- Compute node degree, betweenness, god nodes, bridge nodes, and knowledge gaps.
- Group related nodes into communities.
- Emit a compact analysis object for preview and materialization.

Canonical in-memory shape:

```text
ProjectGraph
  nodes: EntityNode[]
  edges: RelationshipEdge[]
  communities: Community[]
  analysis:
    god_nodes: EntityNode[]
    bridges: EntityNode[]
    surprising_connections: RelationshipEdge[]
    gaps: Gap[]
```

### 5. Graphify Bridge

The primary user-facing runtime should be TypeScript because lat.md already owns
the CLI, markdown parser, checks, and MCP style. Graphify's analysis code is
Python and currently uses NetworkX, with optional Leiden via `graspologic` and
NetworkX Louvain fallback.

The bridge is an explicit component. Code-KG must not assume that
`python -m graphify.cluster` or `python -m graphify.analyze` already accept JSON
on stdin and stdout. A bridge command must be built.

Bridge contract:

```bash
python -m code_kg_graphify_bridge analyze \
  --input .code-kg/cache/graph-fragments.json \
  --output .code-kg/cache/analysis.json
```

Input:

```json
{
  "nodes": [],
  "edges": [],
  "options": {
    "community_algorithm": "auto",
    "max_community_fraction": 0.25
  }
}
```

Output:

```json
{
  "communities": [],
  "god_nodes": [],
  "bridges": [],
  "surprising_connections": [],
  "cohesion": {},
  "algorithm": "graspologic-leiden | networkx-louvain | fallback"
}
```

Implementation strategy:

- MVP may call the bridge if Python and Graphify dependencies are available.
- If the bridge is unavailable, TypeScript falls back to deterministic grouping:
  directory/module grouping, graph connectivity, and simple label propagation.
- Preview output always shows which analysis mode was used.
- Long term, high-value extraction may move to TypeScript with tree-sitter WASM,
  while advanced graph algorithms can remain bridged until a better JS or WASM
  implementation is justified.

The bridge is considered unavailable when:

- Python is not on `PATH`.
- The bridge package is not installed.
- The bridge command exits non-zero.
- The bridge output fails schema validation.

When unavailable, Code-KG logs one concise notice, proceeds with the TypeScript
fallback, and marks the analysis output with `"algorithm": "fallback"`. The CLI
should not interrupt bootstrap with an install prompt; setup guidance belongs in
`code-kg doctor` and documentation.

## Materialization

Materialization is the central new component. It turns graph evidence into a
maintainable `lat.md/` knowledge base.

### Inputs

- Project graph.
- Analysis results.
- Existing `lat.md/`, if present.
- Existing `.code-kg/materialization-manifest.json`, if present.
- User choices from preview: accepted, suppressed, renamed, or skipped
  candidates.
- Policy options for overwrite, merge, confidence display, and source backlink
  proposals.

### Outputs

- Markdown files in `lat.md/` that pass `code-kg check`.
- A committed `.code-kg/materialization-manifest.json`.
- Optional ignored cache files in `.code-kg/cache/`.
- Optional `AGENTS.md` guidance and hooks.

### Preview-First Workflow

`code-kg bootstrap --preview` and `code-kg materialize --preview` write no
project files by default. They display:

- Files that would be created.
- Sections that would be created or updated.
- Source nodes behind each generated section.
- Links that would be added.
- Confidence distribution.
- Community cohesion and analysis algorithm.
- Suppression candidates, low-cohesion communities, and god nodes.
- Any validation issue that would prevent generated output from passing checks.

Preview applies quality gates as warnings before anything is written:

- Communities below a configurable cohesion warning threshold are flagged for
  merge or suppression. They are not automatically skipped until thresholds are
  backed by benchmarks or explicit user policy.
- God nodes that look like broad utility functions are flagged for review rather
  than automatically becoming top-level sections.
- Communities where more than half of relationships are `INFERRED` are marked
  low-confidence.
- Sections with no incoming or outgoing wiki links are marked isolated because
  they add markdown without adding navigable context.

Writing files requires one of:

- `--accept`
- An interactive accept flow.
- A non-preview command that clearly states it mutates files.

### Public Section IDs And Stable Internal IDs

lat.md section IDs are derived from markdown file paths and visible heading
chains. Code-KG must respect that. For example:

```text
lat.md/auth.md#Auth#Token Validation
```

Code-KG also needs stable internal IDs that survive heading edits and file
moves. These are stored in the manifest and may be embedded as markdown comments
near generated sections:

```markdown
## Token Validation
<!-- code-kg:id auth.token-validation -->

Token validation verifies signed credentials before protected handlers run.
```

Rules:

- Wiki links use current lat.md public section IDs, not raw graph labels.
- The manifest maps stable internal IDs to current public section IDs.
- Generated sections may include `code-kg:id` comments so moves and renames can
  be detected.
- If a heading changes, the public section ID changes. Code-KG updates generated
  links when safe and reports human-authored links as drift if needed.
- Raw labels are display text only. They are never the canonical link target.

### Collision Handling

Duplicate labels are expected. For example, many repositories contain multiple
`Config`, `Client`, `Request`, or `validate` symbols.

Materialization resolves collisions by:

- Assigning stable internal IDs from graph node identity, not display labels.
- Placing entities under their community or subsystem file.
- Adding source context to headings when duplicate labels land in the same file,
  such as `## AuthService (auth.ts)` and `## AuthService (admin.ts)`.
- Keeping the manifest as the source of generated link targets.

### Manifest Schema

The manifest is versioned and committed by default.

```json
{
  "version": 1,
  "tool_version": "0.1.0",
  "project_root": ".",
  "generated_at": "2026-05-25T00:00:00Z",
  "sections": {
    "auth.token-validation": {
      "stable_id": "auth.token-validation",
      "public_section_id": "lat.md/auth#Auth#Token Validation",
      "file": "lat.md/auth.md",
      "heading_path": ["Auth", "Token Validation"],
      "status": "generated",
      "source_node_ids": ["src_auth_ts_validateToken"],
      "source_spans": [
        {
          "file": "src/auth.ts",
          "start_line": 42,
          "end_line": 67
        }
      ],
      "generated_hash": "sha256:...",
      "current_hash": "sha256:...",
      "last_seen_graph_hash": "sha256:..."
    }
  },
  "relationships": {
    "rel_auth_validate_calls_crypto_verify": {
      "source_section": "auth.token-validation",
      "target_section": "crypto.jwt-verification",
      "source_node_id": "src_auth_ts_validateToken",
      "target_node_id": "src_crypto_ts_verifyJWT",
      "relation": "calls",
      "level": "structural",
      "confidence": "EXTRACTED",
      "status": "accepted"
    }
  },
  "suppressed": {
    "nodes": [],
    "relationships": []
  }
}
```

Section statuses:

| Status | Meaning | Re-materialization behavior |
| --- | --- | --- |
| `generated` | Auto-created and unedited. | May update in place. |
| `edited` | Generated, then changed by user. | Never overwrite; emit merge proposal. |
| `curated` | Human-authored or promoted. | Never overwrite. |
| `suppressed` | User rejected candidate. | Do not regenerate. |
| `orphaned` | Generated section source disappeared. | Report drift; do not delete automatically. |

Relationship statuses:

| Status | Meaning |
| --- | --- |
| `accepted` | Trusted by generated rule or human review. |
| `inferred` | Visible but not yet trusted. |
| `ambiguous` | Review candidate only. |
| `rejected` | Reviewed and rejected. |
| `suppressed` | Keep out of generated output. |
| `stale` | Previously accepted but no longer observed. |

### Merge Algorithm

| Scenario | Behavior |
| --- | --- |
| Generated section unchanged | Regenerate or update in place. |
| Generated section edited by user | Mark `edited`; emit merge proposal. |
| Curated section exists | Leave untouched; suggest links only. |
| Section renamed or moved with marker intact | Update manifest mapping. |
| Marker missing but source anchors match | Report probable move; ask for confirmation. |
| User deleted generated section | Mark `orphaned`; do not recreate automatically. |
| User suppressed candidate | Persist tombstone; do not recreate. |
| New entity appears | Propose section in preview; do not auto-write unless accepted. |
| Source symbol renamed unambiguously | Safe to update generated source links. |
| Community assignment changes | Report community shift; do not reorganize files automatically. |

The materializer must prefer stale generated content over lost user work. A
manual merge is acceptable; clobbered edits are not.

### Markdown Output Rules

- Every file and section must pass existing lat.md checks.
- Root index is `lat.md/lat.md`.
- Subdirectory indexes are `<dir>/<dir>.md`.
- Every section starts with a short leading paragraph.
- Generated sections are concise. Large communities should be split or
  summarized rather than dumped.
- Source links point to files and symbols using lat.md-compatible link syntax.
- Generated wiki links use manifest-resolved public section IDs.
- Confidence is visible only where it matters.

Example generated section:

```markdown
## Token Validation
<!-- code-kg:id auth.token-validation -->

Token validation verifies signed credentials before protected handlers run.

Source: [[src/auth.ts#validateToken]]

Related:
- Calls [[lat.md/crypto#Crypto#JWT Verification]]
- Uses [[lat.md/sessions#Sessions#Session Store]] *(inferred, 0.76)*
```

## Confidence And Review

Code-KG uses confidence labels:

| Label | Meaning |
| --- | --- |
| `EXTRACTED` | Directly observed from source or deterministic parsing. |
| `INFERRED` | Probable but not directly observed. |
| `AMBIGUOUS` | Potentially useful lead, not safe to treat as fact. |

INFERRED confidence score rubric:

| Score | Meaning |
| --- | --- |
| `0.95` | Near-certain: explicit cross-file reference and one plausible target. |
| `0.85` | Strong evidence: naming and context align. |
| `0.75` | Reasonable: contextual but not explicit. |
| `0.65` | Weak: naming similarity only. |
| `0.55` | Speculative: plausible but unverified. |

`EXTRACTED` edges always have `confidence_score: 1.0`. `AMBIGUOUS` edges may
omit a numeric score because they are qualitative review flags.

Display rules:

- `EXTRACTED` relationships have no inline annotation by default.
- `INFERRED` relationships use compact inline parentheticals, such as
  `*(inferred, 0.76)*`.
- `AMBIGUOUS` relationships are review candidates and should usually appear in
  `lat.md/confidence.md` until accepted.
- `lat.md/confidence.md` is a markdown review queue, not a parallel knowledge
  base.

Review lifecycle:

```bash
code-kg confidence list
code-kg confidence accept rel_auth_sessions
code-kg confidence reject rel_auth_sessions
code-kg confidence reconcile
```

Plainly deleting an inline parenthetical in markdown is not enough to update a
committed manifest unless `code-kg confidence reconcile` or a similar command
parses the edit and updates relationship status. Promotion must be represented
both in markdown and in the manifest.

When `reconcile` sees that an inferred or ambiguous parenthetical was removed
while the manifest still marks the relationship as unaccepted, it reports a
promotion candidate and requires explicit confirmation or `--accept-promotions`
before changing the manifest to `accepted`.

## Source Backlinks

Materialization never edits source files. Backlink insertion is a separate
opt-in command:

```bash
code-kg apply-backlinks --preview
code-kg apply-backlinks --write
```

MVP should support the comment styles currently compatible with lat.md code-ref
scanning:

| Languages | Style |
| --- | --- |
| TypeScript, JavaScript, Go, Rust, Java, C, C++ | `// @lat: [[section-id]]` |
| Python, Ruby, Shell, Perl | `# @lat: [[section-id]]` |

Other styles, such as HTML comments, CSS comments, Lua comments, or SQL
comments, require extending the lat.md code-ref scanner before they can be
claimed as supported.

Post-MVP target styles after scanner support exists:

| Languages | Style |
| --- | --- |
| Lua, SQL | `-- @lat: [[section-id]]` |
| HTML, XML | `<!-- @lat: [[section-id]] -->` |
| CSS | `/* @lat: [[section-id]] */` |

Backlink insertion policy:

- Default is preview only.
- Source edits require `--write`.
- Insertions are language-aware.
- The command should show a patch or diff before writing.
- It should skip generated files, vendored code, and files ignored by detection.

## Drift Detection

Drift detection compares fresh extraction against three things:

1. Current `lat.md/` sections and wiki links.
2. `.code-kg/materialization-manifest.json`.
3. Accepted source backlinks, if present.

It compares against the manifest, not every possible extracted edge. Most code
edges are too granular for durable project memory.

Drift scope:

- Broken references are always flagged when wiki links or `@lat` comments point
  to renamed or deleted targets.
- Manifest divergence is flagged when a relationship that was previously
  materialized or accepted no longer appears in code.
- New structural relationships become suggestions only when they are cross-file
  relationships between entities that already have `lat.md/` sections.
- Uncovered high-level files, classes, modules, or packages are informational
  coverage findings.
- Intra-file call edges are not suggested by default. If an intra-file
  relationship was explicitly materialized and accepted, it can still become a
  stale manifest warning.
- Rejected and suppressed edges are not flagged again unless the user clears the
  suppression.

### Severity Model

| Severity | Meaning | Example | Default action |
| --- | --- | --- | --- |
| `ERROR` | Existing knowledge is broken. | Wiki link points to missing section. | Report; check fails. |
| `WARNING` | Previously accepted/generated fact is stale. | Materialized call edge no longer exists. | Report merge proposal. |
| `SUGGEST` | New evidence may deserve documentation. | Cross-file dependency between documented modules. | Preview candidate. |
| `INFO` | Coverage or structure changed. | New module has no section. | Inform. |

### What Drift Flags

- Broken wiki links.
- Broken `@lat` backlinks.
- Source links to renamed or deleted symbols.
- Previously materialized relationships no longer observed.
- New cross-file structural relationships between documented entities.
- New high-level files, modules, classes, or packages without coverage.
- Significant community shifts.

### What Drift Does Not Flag

- Every missing call edge.
- Intra-file call edges by default.
- Edges the user rejected or suppressed.
- Semantic suggestions as required documentation.
- Missing docs for low-level helper functions unless they become god nodes or
  bridge nodes.

### Auto-Apply Policy

`code-kg drift` is report-only by default.

`code-kg drift --apply-safe` may:

- Update manifest metadata.
- Fix generated links when the target rename is unambiguous.
- Update source-code links inside untouched generated sections.
- Refresh untouched generated sections when their generated hash still matches.

It must not:

- Delete sections.
- Rewrite curated or edited prose.
- Accept inferred relationships.
- Add sections for every new function/class/module without preview.
- Reorganize files based on new clustering.
- Modify source files.

Adding new sections or new relationships is a materialization proposal, not a
default drift mutation.

## Search And Context Budget

Search must have a zero-key local baseline.

Search backends:

1. Local lexical search, such as SQLite FTS. This is the default.
2. Optional local embeddings, such as Ollama or another local provider.
3. Optional hosted embeddings, such as OpenAI or Vercel.

Backend selection:

- The default backend is local lexical search, even when API keys are present.
- A user can explicitly configure `search.backend=local-semantic`,
  `search.backend=hosted-semantic`, or `search.backend=auto-semantic`.
- In `auto-semantic` mode, hosted semantic search may be used when configured,
  then local semantic search, then lexical search as fallback.
- Search results report the active backend so agents and users know what ranking
  quality and cost profile they are getting.

Agent-facing read tools must be budget-aware:

- `max_tokens`
- `max_sections`
- `include_refs`
- `include_backlinks`
- `include_confidence`
- `include_source_snippets`

Default behavior:

- `search` returns section IDs, titles, short snippets, confidence/source
  metadata, and scores. It does not return full sections.
- `section` returns one section plus summarized outgoing and incoming refs.
- `expand` has conservative defaults and explicit token limits.

Initial budget targets:

- Normal task orientation: <= 6,000 tokens for search plus selected sections.
- Broad architectural task: <= 10,000 tokens before source verification.
- Agent should reach the first relevant source file in three tool calls or
  fewer for common maintenance tasks.

## CLI

The CLI presents one tool even if internals reuse both projects.

```bash
# Setup
code-kg init
code-kg doctor

# Bootstrap
code-kg bootstrap --preview
code-kg bootstrap --accept
code-kg extract .
code-kg materialize --preview
code-kg materialize --accept

# Daily use
code-kg locate "auth"
code-kg search "login flow"
code-kg section "lat.md/auth#Auth#Token Validation"
code-kg refs "lat.md/auth#Auth#Token Validation"
code-kg expand "Update [[lat.md/auth#Auth]]"
code-kg check

# Maintenance
code-kg drift
code-kg drift --apply-safe
code-kg confidence list
code-kg confidence accept <relationship-id>
code-kg confidence reject <relationship-id>
code-kg apply-backlinks --preview
code-kg apply-backlinks --write

# Debug and optional exports
code-kg debug graph query "auth db"
code-kg export html
code-kg export svg
```

Command design:

- Mutating commands support preview or dry-run.
- CLI output is structured and readable by agents.
- Commands share implementation with MCP tools.
- Expensive model-backed commands clearly show cost and provider.
- Debug graph commands are not part of the normal agent workflow.

## MCP Tools

Agents should prefer MCP tools when available.

| Tool | Purpose |
| --- | --- |
| `codekg_locate` | Find relevant sections by name or path. |
| `codekg_search` | Search curated markdown with local or semantic backend. |
| `codekg_section` | Read a section within token limits. |
| `codekg_refs` | Show incoming links, outgoing links, and code backlinks. |
| `codekg_expand` | Resolve refs in a prompt with bounded context. |
| `codekg_check` | Validate markdown, links, source refs, and indexes. |
| `codekg_drift` | Report stale or missing knowledge. |
| `codekg_confidence` | List or resolve confidence review items. |
| `codekg_debug_graph_query` | Debug raw extraction graph. Not normal workflow. |

MCP read tools must expose token budget parameters. The tool descriptions should
steer agents toward `search` or `locate` before broad source reads.

Read tool responses should include token estimates:

```json
{
  "sections": [],
  "estimated_tokens": 2340,
  "budget_remaining": 3660,
  "budget_model": "gpt-5"
}
```

These counts are estimates because tokenization depends on the target model.
They are still useful for deciding whether to follow more wiki links or stop and
work with the context already loaded.

## Agent Workflow

Installed agent guidance should enforce this loop:

1. Search or locate relevant `lat.md/` sections before broad source reads.
2. Read the most relevant sections.
3. Follow only necessary links.
4. Verify details in source.
5. Make code changes.
6. Update or add affected `lat.md/` sections.
7. Run `code-kg check`.
8. Run `code-kg drift` for new modules, renamed flows, or architecture changes.

Enforcement layers:

- `AGENTS.md` generated by `code-kg init`.
- Optional hooks that remind agents to read `lat.md/` before broad grep.
- Optional pre-commit hook that runs `code-kg check`.
- Optional stricter mode that warns when source changes have no matching
  `lat.md/` changes.
- `code-kg doctor` reports missing hooks, missing ignores, stale manifests, and
  invalid setup.

The default should guide rather than block. Teams can turn on stricter policy
after they trust the generated knowledge base.

## Implementation Strategy

### MVP 1: Core Runtime And Skeleton Bootstrap

Goal: create a useful first `lat.md/` without external services.

Deliverables:

- `code-kg init`
- Correct `lat.md/lat.md` root index generation.
- lat.md-compatible parser, locate, section, refs, check, and MCP wrappers.
- Local lexical search.
- Cheap repository discovery: file inventory, package/module hints, obvious
  entry points, test directories, and source anchors.
- `bootstrap --preview`
- Simple materializer that writes draft files only after accept.
- `.code-kg/materialization-manifest.json`
- Generated output passes `code-kg check`.

MVP 1 must write the first useful files. It is not enough to ship a renamed
lat.md runtime.

### MVP 2: AST Graph Bootstrap

Goal: improve bootstrap quality using deterministic extraction.

Deliverables:

- Tree-sitter-based extraction for the highest-value languages first.
- Graph fragment schema and validation.
- Graph build from fragments.
- Optional Graphify bridge for analysis.
- Deterministic TypeScript fallback analysis.
- Community grouping, god nodes, bridge nodes, and cohesion scoring.
- Materialization preview quality gates.

Initial language priority:

- TypeScript/JavaScript
- Python
- Go
- Rust

### MVP 3: Merge-Safe Materialization And Drift

Goal: make repeated runs safe enough for real repositories.

Deliverables:

- Full manifest status model.
- Marker-based section reconciliation.
- Suppression tombstones.
- Merge proposals for edited generated sections.
- Drift report with severity model.
- `drift --apply-safe`
- Confidence review commands.
- Optional hook installation.

### MVP 4: Semantic Extraction And Advanced Search

Goal: add model-backed understanding without compromising the local baseline.

Deliverables:

- Semantic extraction queue.
- Provider abstraction for hosted and local models.
- Cache by file hash and prompt hash.
- Confidence review integration.
- Optional local embeddings.
- Optional hosted embeddings.
- Research benchmark harness.

### MVP 5: Visualization And Advanced Exports

Goal: support human architecture review and onboarding.

Deliverables:

- `code-kg export html`
- `code-kg export svg`
- Optional graph snapshots for reproducible debugging.
- Not required during bootstrap.
- Not part of normal agent workflow.

## Technology Decisions

| Area | Decision | Reason |
| --- | --- | --- |
| Primary runtime | TypeScript/Node | Reuses lat.md CLI, parser, checks, MCP shape. |
| Markdown storage | `lat.md/` | Reviewable and durable. |
| Tool metadata | `.code-kg/` | Avoids current lat.md non-markdown validation failure. |
| Raw graph | Ignored cache | Useful for debug, not canonical. |
| Manifest | Committed by default | Protects edits, suppressions, and stable IDs. |
| Search default | Local lexical search | Zero-key first-run value. |
| Embeddings | Optional | Improves ranking without becoming required. |
| Graph algorithms | Optional Python bridge plus TS fallback | Ships faster while preserving installability. |
| Source backlinks | Separate opt-in command | Source edits must be deliberate. |
| Semantic extraction | Post-MVP opt-in | Keeps MVP deterministic and free. |

## Validation

`code-kg check` should include or wrap lat.md checks:

- All wiki links resolve.
- Source links resolve where supported.
- `@lat` backlinks point to existing sections.
- Required section leading paragraphs exist and stay short.
- Directory indexes use lat.md naming conventions.
- Non-markdown files are not placed under `lat.md/`.
- `.code-kg/` metadata exists when generated content depends on it.
- Suppressed/orphaned generated sections are represented consistently.

Generated bootstrap output must pass checks before the command reports success.

## Benchmarks And Success Metrics

### MVP Metrics

| Metric | Target | Collection point |
| --- | --- | --- |
| Generated check pass rate | 100% | `bootstrap --accept` runs `check`. |
| AST bootstrap time | < 5 min for 1000 files | `extract` and `bootstrap` timers. |
| Incremental drift time | < 30 sec for typical repo changes | `drift` timer. |
| Community file size | < 500 lines by default | Materialization report. |
| Preview acceptance | >= 70% kept or lightly edited | Preview/manifest stats. |

### Research Metrics

| Metric | Target | Collection |
| --- | --- | --- |
| Agent orientation tokens | >= 40% reduction | A/B benchmark across fixed task set. |
| Time to first relevant source file | <= 3 tool calls | Agent trace benchmark. |
| Inferred edge accuracy | >= 80% true positive rate | Manual audit sample. |
| Agent task accuracy | Measurable improvement | Same tasks with and without Code-KG. |

## Risks

- Generated markdown can look more authoritative than it is. Mitigation:
  confidence annotations, preview, and review queue.
- Materialization can produce noise. Mitigation: quality gates, suppression, and
  preview-first writes.
- User edits can be overwritten. Mitigation: manifest hashes, section markers,
  and conservative merge behavior.
- Graphify bridge can hurt install experience. Mitigation: optional bridge and
  TypeScript fallback.
- `lat.md/` can drift if agents skip updates. Mitigation: hooks, check, drift,
  and AGENTS guidance.
- Stable IDs and lat.md heading IDs can diverge. Mitigation: internal stable IDs
  in manifest, public IDs from current markdown, and drift link repair.
- Search can increase context cost. Mitigation: local snippets, token budgets,
  and bounded MCP reads.

## Resolved Decisions

These decisions came out of the architecture review exchange and should not be
reopened without new implementation evidence.

| Decision | Resolution |
| --- | --- |
| Root index filename | Use `lat.md/lat.md` and existing lat.md directory index conventions. |
| Tool metadata location | Store Code-KG metadata in `.code-kg/`, not inside `lat.md/`. |
| Manifest role | Commit `.code-kg/materialization-manifest.json` by default for merge safety. |
| Source comment insertion | Keep source backlink insertion separate and opt-in. |
| Confidence display | Use inline parentheticals plus a lifecycle-managed markdown review queue. |
| Confidence reconciliation | Require explicit `code-kg confidence` commands or reconcile flow; markdown edits alone do not update metadata. |
| Raw graph query | Treat as debug-only, not part of the default agent workflow. |
| Search default | Use local lexical search by default; semantic backends are opt-in. |
| Drift scope | Compare against accepted knowledge and manifest state, not every extracted edge. |
| Drift auto-apply | Use `drift --apply-safe`; new sections and relationships go through preview. |
| Edge levels | Use `structural` and `semantic` to guide drift severity, not to require all structural edges in docs. |
| MVP ordering | Runtime and skeleton bootstrap, AST bootstrap, merge-safe drift, semantic extraction, visualization. |
| Token budgets | All read tools accept budget parameters and report estimated token usage. |

## Open Decisions

These should be resolved before implementation begins:

1. Should a stateless mode exist for teams that refuse to commit
   `.code-kg/materialization-manifest.json`, knowing it weakens merge safety?
2. What exact source-link syntax should Code-KG use for source symbols so it
   remains compatible with lat.md resolution?
3. Which tree-sitter languages are truly MVP, based on install size and parser
   maturity?
4. Should `lat.md/confidence.md` be created by default, or only when unresolved
   inferred/ambiguous items exist?
5. Should generated section markers be required for all generated sections, or
   only for sections that may be updated by future materialization?

## Final Shape

The merged architecture keeps the split both drafts agreed on:

- Graphify-style extraction discovers the codebase.
- lat.md stores the durable project memory.
- Code-KG owns the bridge between generated evidence and curated markdown.

The most important product bet is not the graph algorithm. It is whether
Code-KG can generate a useful, reviewable first knowledge base and then avoid
damaging it as humans and agents improve it. The architecture should therefore
optimize first for preview quality, merge safety, local search, and validation.
