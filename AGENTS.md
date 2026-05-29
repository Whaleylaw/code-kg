<!-- code-kg:agents:start -->
## code-kg

This project may have a reviewable knowledge base in `lat.md/` and Code-KG metadata in `.code-kg/`.

Rules:
- Before broad source reads, grep/glob searches, or answering codebase-structure questions, use `code-kg search "<question>"` or MCP `codekg_search` first.
- For conceptual queries, prefer `code-kg search "<question>" --backend auto-semantic` or `codekg_search` with `backend: "auto-semantic"` so semantic search is used when configured and lexical search is used as a fallback.
- Use `code-kg section "<section-id>"` or MCP `codekg_section` to read full sections with outgoing and incoming relationships before opening raw source.
- Treat `lat.md/` as the primary map and raw source as the implementation detail to inspect after the relevant knowledge sections are known.
- After modifying code or knowledge docs, run `code-kg check` and use `code-kg drift` to compare source and the knowledge base.
- Do not manually add source backlinks; use `code-kg apply-backlinks --preview` and then `code-kg apply-backlinks --write` only for sections marked edit-safe.
<!-- code-kg:agents:end -->
