# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

Git repository on branch `main`, with a GitHub remote at `origin` (https://github.com/Whaleylaw/code-kg, public). Push to sync. The committed knowledge base (`lat.md/*.md`, `.code-kg/materialization-manifest.json`) is tracked and meant to be committed alongside code changes; the artifacts in `## Generated/ignored artifacts` below are excluded via `.gitignore`.

## Source of Truth

`docs/ARCHITECTURE.md` is the canonical merged architecture spec (~1100 lines) — the source of truth for product model, manifest schema, drift rules, and the MVP roadmap. Read the relevant section before changing behavior in those areas.

## Commands

This is a pnpm + TypeScript (ESM) project. There is no global install in dev — run the built CLI via `node dist/...`.

```bash
pnpm install
pnpm build              # tsc -> dist/  (required before running the CLI)
pnpm test               # vitest run (all tests)
pnpm test:watch
pnpm typecheck          # tsc --noEmit
pnpm format             # prettier --write 'src/**/*.ts'
pnpm format:check
pnpm test:package       # build + scripts/verify-package.mjs smoke test

# Run a single test file / single test
pnpm vitest run tests/codekg.test.ts
pnpm vitest run tests/search.test.ts --testNamePattern "local embeddings eval"
```

The CLI entrypoint after build is `node dist/src/codekg/cli.js <command>` (this is the `code-kg` binary defined in `package.json` `bin`). See `README.md` for the full command list and `docs/USAGE.md` for the tested happy path.

Opt-in tests gated behind env flags (skipped by default):
- `LAT_TEST_LOCAL_EMBEDDINGS=1` — runs the real local-embedding retrieval eval (downloads a model).

## Architecture

Code-KG produces and maintains `lat.md/`, a **reviewable markdown knowledge graph** of a codebase, so AI agents can read a persistent map instead of re-deriving structure every session. The curated markdown in `lat.md/` is the source of truth; generated graphs, manifests, and the search DB are supporting artifacts.

### Two layers in `src/`

1. **Vendored/adapted lat.md runtime** (`src/` root + `src/cli/`, `src/search/`, `src/extensions/`): the markdown lattice engine — parsing wiki-links, sections, lattice graph, lexical + semantic search, and the original lat.md CLI (`src/cli/index.ts`). This is upstream-derived plumbing that Code-KG builds on; prefer changing the Code-KG layer over editing this unless fixing the runtime itself.
2. **Code-KG layer** (`src/codekg/`): everything new — bootstrap, structural extraction, manifest, drift, reconcile, confidence, suppression, backlinks, agent-guidance install, and the `code-kg` CLI (`src/codekg/cli.ts`) + MCP server (`src/codekg/mcp.ts`).

### Command pattern

Commands are pure functions taking a `CmdContext` (`{ latDir, projectRoot, styler, mode: 'cli' | 'mcp' }`) and returning a `CmdResult` (`{ output, isError? }`) — see `src/context.ts`. The same command functions back both the CLI and the MCP server; `mode` and `styler` (plain vs. colored) are the only environment differences. When adding a command, write it as a context-in/result-out function and wire it into both `cli.ts` and `mcp.ts`.

### Key data model: the materialization manifest

`.code-kg/materialization-manifest.json` records, per generated section, what was generated and how it may be edited. Types live in `src/codekg/types.ts`. The critical distinction:

- `source_anchor_policy: "coverage-only"` — section has `source_node_ids` used only for drift/coverage evidence. **Not** safe to auto-edit.
- `source_anchor_policy: "edit-safe"` — section has `source_spans`; only these sections may receive automated source edits (e.g. `apply-backlinks --write`).

Repeated materialization preserves human-edited and curated sections: when generated content changes for an edited section, the new candidate is written to `.code-kg/cache/merge-proposals/` for manual review rather than overwriting. Respect this merge-safe contract — never blindly overwrite edited sections.

### Generated/ignored artifacts

`.gitignore` excludes `.code-kg/cache/`, `.code-kg/search.sqlite`, `.code-kg/tmp/`, and `lat.md/.cache/`. The committed knowledge base is `lat.md/*.md` and `.code-kg/materialization-manifest.json`. Tree-sitter WASM grammars come from `@repomix/tree-sitter-wasms` / `web-tree-sitter` (structural extraction in `src/codekg/graph.ts`).

### Search

Local-first. Lexical search always works offline; semantic search uses a local embedding provider (`Xenova/bge-small-en-v1.5`, 384-dim) via `@huggingface/transformers`, persisted in libsql/`search.sqlite`. `--backend auto-semantic` picks semantic when a provider is configured and falls back to lexical otherwise. Remote embeddings work via `LAT_LLM_KEY` (OpenAI `sk-...` or Vercel `vck_...`).

## Working in this repo with Code-KG itself

This repo dogfoods Code-KG — `lat.md/` and `.code-kg/` describe this very codebase, and `AGENTS.md` carries managed agent guidance. Per that guidance: prefer `code-kg search "<question>"` / `code-kg context <file>` to orient before broad grep/glob source sweeps, and run `code-kg check` + `code-kg drift` after changing code or knowledge docs. (Requires `pnpm build` first, then `node dist/src/codekg/cli.js <cmd>`.)
