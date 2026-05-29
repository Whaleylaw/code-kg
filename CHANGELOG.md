# Changelog

## Unreleased

### Added

- Standalone `code-kg` CLI outside the source `lat.md-main` and Graphify repos.
- Bootstrap and materialization for `lat.md/` plus `.code-kg/materialization-manifest.json`.
- Deterministic source graph extraction with symbols, imports, test coverage links, and generated relationship sections.
- Drift, reconcile, confidence review, suppression, and edit-safe backlink commands.
- Local-first semantic search with `code-kg semantic status`, `enable-local`, and `reindex`.
- `code-kg install-global` for installing a stable user-level wrapper.
- Managed agent guidance with `code-kg agents install`, `uninstall`, and `status`.
- Codex hook nudges for Bash search commands and structured Grep, Glob, Read, LS, read_file, and list_directory payloads.
- `code-kg context`, `gaps`, `changed`, and `update` for day-to-day graph-guided work.
- MCP tools for search, section reads, check, drift, confidence, suppressions, and backlinks.
- Package smoke coverage for bootstrap, doctor, semantic setup, global install, hook fallback/global forms, and agent status.

### Verified

- Fresh-repo setup works through the global `code-kg` binary:
  `bootstrap`, `semantic enable-local`, `semantic reindex`, `agents install`,
  `agents status`, hook checks, `doctor`, and `drift`.
- Observability Dashboard integration reports installed guidance, global PATH
  hook, local semantic cache, and no drift findings.
