# Code-KG Usage

This is the practical local workflow for using Code-KG in a repo. It assumes
`code-kg` is already on `PATH`.

## Fresh Repo Setup

From the repository root:

```bash
code-kg bootstrap --accept
code-kg semantic enable-local
code-kg semantic reindex
code-kg agents install
code-kg agents status
```

Expected status should show:

```text
- lat.md/: found
- AGENTS.md guidance: installed
- Codex hook: installed
- semantic search: local
- MCP command: code-kg mcp
```

## Daily Agent Workflow

Use semantic search before broad source search:

```bash
code-kg search "how is memory coverage tested" --backend auto-semantic
```

Open the relevant knowledge section before raw source:

```bash
code-kg context apps/api/memory.py
code-kg section "lat.md/tests/tests#Tests#Test Coverage Links#apps/api/memory.py"
```

After code or knowledge changes:

```bash
code-kg changed
code-kg update
code-kg check
code-kg drift
```

## Hook Behavior

`code-kg agents install` adds managed guidance to `AGENTS.md` and installs a
Codex `PreToolUse` hook. The hook is non-blocking. It nudges agents before broad
raw-source search or direct raw-source reads when Code-KG is installed.

Examples:

```bash
printf '%s' '{"tool_name":"Grep","tool_input":{"pattern":"memory coverage","path":"apps"}}' \
  | code-kg hook-check
```

The hook suggests:

```text
code-kg search "memory coverage" --backend auto-semantic
```

Reads of `lat.md/` and `.code-kg/` stay silent so agents can inspect the
knowledge base without loops.

For raw source reads, the hook suggests:

```text
code-kg context "apps/api/memory.py"
```

## Health Checks

Use these when something feels off:

```bash
code-kg agents status
code-kg semantic status
code-kg gaps
code-kg changed
code-kg doctor
code-kg drift
```

`agents status` is the fastest way to verify the installed hook matcher, hook
command, semantic readiness, and MCP command.

`gaps` reports missing documentation anchors and source files without detected
test coverage. `changed` maps current git working-tree changes back to relevant
sections and tests.

## Local Semantic Search

The default local embedding provider is `Xenova/bge-small-en-v1.5` with 384
dimensions. The first semantic index run may download model files into the
Transformers cache. After that, search and indexing are local.

To force a rebuild:

```bash
code-kg semantic reindex
```

To search with semantic fallback:

```bash
code-kg search "entry points" --backend auto-semantic
```
