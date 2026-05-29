# Code-KG

Code-KG is the standalone implementation package for the architecture in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Code-KG began as a merge of the lat.md and Graphify projects. The current MVP
runtime vendors/adapts the lat.md TypeScript runtime internally while adding
Code-KG bootstrap, materialization, metadata validation, local lexical search,
and MCP entrypoints.

The current implementation also includes the first MVP 2 structural graph path:
tree-sitter source-symbol extraction, deterministic local import edges,
directory-based communities, high-degree node detection, bridge-node detection,
and preview quality warnings.

The first MVP 3 slices add report-only drift checks against the materialization
manifest, safe graph-cache artifact writes under `.code-kg/cache/`, manifest
reconciliation for edited generated markdown, and confidence review commands for
manifest relationships. Drift now validates accepted structural relationships,
suggests new cross-file structural relationships only when both endpoints
already have curated or edited section anchors, and respects suppression
tombstones. Repeated materialization updates untouched generated files but
preserves edited or curated sections. When generated content changes for an
edited section, Code-KG leaves the edited markdown in place and writes the new
candidate under `.code-kg/cache/merge-proposals/` for manual review.

Manifest sections distinguish broad coverage evidence from edit-safe source
anchors. `source_node_ids` can support drift and coverage for overview sections,
but source-editing features must use only `source_spans` on sections marked with
`source_anchor_policy: "edit-safe"`.

The agent guidance slice installs a managed `AGENTS.md` section plus a safe
Codex PreToolUse hook entry. The guidance tells coding agents to query Code-KG
before broad source reads or grep-style exploration; the hook inspects Bash
tool context plus structured Grep, Glob, Read, LS, read_file, and
list_directory payloads where the host supports them. It adds a non-blocking
reminder before broad raw-source search commands such as `rg`, `grep`, `find`,
or `git grep`; when it can infer the search pattern, it suggests a concrete
`code-kg search "<query>" --backend auto-semantic` command instead of a generic
placeholder.

The Code-KG MCP server exposes the daily agent workflow directly: search,
section reads with approximate token budgets, check, drift, confidence,
suppression, and backlink preview/write tools.

`code-kg doctor` now acts as a readiness report for agent use. It checks the
knowledge base, manifest, cache ignore rule, installed agent guidance, Codex
hook, MCP command, and manifest status summary.

## Current MVP Commands

```bash
pnpm install
pnpm build

node dist/src/codekg/cli.js bootstrap --preview
node dist/src/codekg/cli.js bootstrap --accept
node dist/src/codekg/cli.js doctor
node dist/src/codekg/cli.js extract .
node dist/src/codekg/cli.js extract . --json
node dist/src/codekg/cli.js extract . --write-cache
node dist/src/codekg/cli.js drift
node dist/src/codekg/cli.js reconcile --preview
node dist/src/codekg/cli.js reconcile --write
node dist/src/codekg/cli.js confidence list
node dist/src/codekg/cli.js confidence accept <relationship-id>
node dist/src/codekg/cli.js confidence reject <relationship-id>
node dist/src/codekg/cli.js confidence reconcile
node dist/src/codekg/cli.js confidence reconcile --accept-promotions
node dist/src/codekg/cli.js suppress list
node dist/src/codekg/cli.js suppress node <node-id>
node dist/src/codekg/cli.js suppress relationship <relationship-id>
node dist/src/codekg/cli.js suppress clear <id>
node dist/src/codekg/cli.js apply-backlinks --preview
node dist/src/codekg/cli.js apply-backlinks --write
node dist/src/codekg/cli.js search "entry points"
node dist/src/codekg/cli.js search "conceptual query" --semantic
node dist/src/codekg/cli.js search "conceptual query" --backend semantic --limit 10
node dist/src/codekg/cli.js search "conceptual query" --backend auto-semantic
node dist/src/codekg/cli.js context src/index.ts
node dist/src/codekg/cli.js gaps
node dist/src/codekg/cli.js changed
node dist/src/codekg/cli.js update
node dist/src/codekg/cli.js semantic status
node dist/src/codekg/cli.js semantic enable-local
node dist/src/codekg/cli.js semantic reindex
node dist/src/codekg/cli.js agents install
node dist/src/codekg/cli.js agents status
node dist/src/codekg/cli.js agents uninstall
node dist/src/codekg/cli.js hook-check
node dist/src/codekg/cli.js check
node dist/src/codekg/cli.js mcp
```

The package exposes `code-kg` as its binary after build or package install.

## Daily Workflow

For the normal local workflow, use the global binary:

```bash
code-kg bootstrap --accept
code-kg semantic enable-local
code-kg semantic reindex
code-kg agents install
code-kg agents status
code-kg doctor
code-kg drift
```

After that, use `code-kg search "<question>" --backend auto-semantic` before
broad source searches, `code-kg context <file-or-symbol>` before opening raw
source files, and `code-kg changed` / `code-kg update` around code changes. See
[docs/USAGE.md](docs/USAGE.md) for the tested happy path and common checks.

## Semantic Search Providers

Semantic search is local-first. To use the built-in local embedding provider:

```bash
code-kg semantic enable-local
code-kg semantic reindex
code-kg search "conceptual query" --backend auto-semantic
```

The default local model is `Xenova/bge-small-en-v1.5` with 384-dimensional
vectors. The first run downloads the model into the Transformers cache; inference
and vector search then run locally. Override with `LAT_LOCAL_EMBEDDING_MODEL`
and `LAT_LOCAL_EMBEDDING_DIMENSIONS` if you choose a different local embedding
model.

`code-kg semantic enable-local` persists the local provider in the lat config
directory so semantic search, hooks, and MCP tools work without exporting
environment variables each session:

```json
{
  "embedding_provider": "local"
}
```

Remote embeddings are still supported through `LAT_LLM_KEY`:

- OpenAI keys (`sk-...`) use `text-embedding-3-small`
- Vercel AI Gateway keys (`vck_...`) use `openai/text-embedding-3-small`

Use `--backend auto-semantic` when you want the best configured backend without
breaking offline/local workflows. It selects semantic search when an embedding
provider is configured and falls back to local lexical search otherwise. Search
output includes a `Backend:` line so agents can see which path was used.

Run the opt-in local retrieval eval with:

```bash
LAT_TEST_LOCAL_EMBEDDINGS=1 pnpm vitest run tests/search.test.ts --testNamePattern "local embeddings eval"
```
