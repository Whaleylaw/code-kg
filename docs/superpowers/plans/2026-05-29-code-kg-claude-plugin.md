# code-kg Claude Code Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing `code-kg` tool as a Claude Code plugin (MCP server + hooks + guidance skill), distributed from the same GitHub repo, including a proactive "offer to bootstrap" on unmapped repos.

**Architecture:** The plugin is pure config + skill text that drives the already-installed global `code-kg` binary. It wires the existing `code-kg mcp` server and `code-kg hook-check` (PreToolUse) into Claude Code, adds one new `code-kg session-check` subcommand to power a SessionStart offer, ships a guidance skill, and exposes itself through a `marketplace.json` at the repo root.

**Tech Stack:** Node.js, TypeScript (ESM), commander CLI, vitest. Claude Code plugin schema (`plugin.json`, `.mcp.json`, `hooks/hooks.json`, `skills/`, `marketplace.json`).

**Reference spec:** `docs/superpowers/specs/2026-05-29-code-kg-claude-plugin-design.md`

**Prerequisite for all tasks:** run from the repo root. Build with `pnpm build` before running CLI/tests.

---

### Task 1: Add `sessionCheckCommand` to the CLI library

Adds the logic that decides *when* to proactively offer bootstrapping: emit context only when the repo is unmapped **and** looks like a real codebase. Reuses the private `codeKgKnowledgeBaseInstalled` check (same module) and `discoverProject` for the "is this code" signal.

**Files:**
- Modify: `src/codekg/agents.ts` (add new exported command + helpers, near `hookCheckCommand`)
- Test: `tests/codekg.test.ts` (add a `describe('session-check', ...)` block)

- [ ] **Step 1: Write the failing tests**

In `tests/codekg.test.ts`, update the agents import to add `sessionCheckCommand`:

```ts
import {
  agentsCommand,
  hookCheckCommand,
  sessionCheckCommand,
} from '../src/codekg/agents.js';
```

Then append this as a new top-level `describe` block at the very end of the file (a second top-level `describe` is fine in vitest). It reuses helpers already present in this file: `makeProject`, `ctx`, `createBootstrapPlan`, `writeBootstrapPlan`, `mkdtemp`, `tmpdir`, `join`, `writeFile`, and the `roots` cleanup array:

```ts
describe('session-check', () => {
  it('offers bootstrap in an unmapped code repo', async () => {
    const root = await makeProject();

    const result = await sessionCheckCommand(ctx(root));
    const parsed = JSON.parse(result.output) as {
      hookSpecificOutput: {
        hookEventName: string;
        additionalContext: string;
      };
    };

    expect(result.isError).toBeFalsy();
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('Code-KG');
    expect(parsed.hookSpecificOutput.additionalContext).toContain(
      'code-kg bootstrap --accept',
    );
  });

  it('stays silent once the repo is mapped', async () => {
    const root = await makeProject();
    await writeBootstrapPlan(await createBootstrapPlan(root));

    const result = await sessionCheckCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe('');
  });

  it('stays silent in a directory with no source code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codekg-noncode-'));
    roots.push(root);
    await writeFile(join(root, 'README.md'), '# just docs\n');

    const result = await sessionCheckCommand(ctx(root));

    expect(result.isError).toBeFalsy();
    expect(result.output).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/codekg.test.ts -t "session-check"`
Expected: FAIL — `sessionCheckCommand` is not exported / not a function.

- [ ] **Step 3: Implement `sessionCheckCommand`**

In `src/codekg/agents.ts`, add an import for discovery near the other local imports at the top of the file:

```ts
import { discoverProject } from './discovery.js';
```

Then add this near `hookCheckCommand` (end of file is fine). `codeKgKnowledgeBaseInstalled` is already defined in this module — reuse it:

```ts
type SessionCheckOptions = {
  input?: string;
};

function sessionOfferContext(): string {
  return [
    'Code-KG: this repo has no knowledge graph yet.',
    'If the user wants a persistent map for faster orientation, offer to run',
    '`code-kg bootstrap --accept` (then `code-kg semantic enable-local` and',
    '`code-kg semantic reindex`).',
    "Do not run it without the user's go-ahead.",
  ].join(' ');
}

function sessionNudgeOutput(): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: sessionOfferContext(),
    },
  });
}

export async function sessionCheckCommand(
  ctx: CmdContext,
  _opts: SessionCheckOptions = {},
): Promise<CmdResult> {
  // Already mapped: never re-offer.
  if (codeKgKnowledgeBaseInstalled(ctx)) return { output: '' };

  // Only offer in directories that look like a real codebase.
  let hasCode = false;
  try {
    const discovery = await discoverProject(ctx.projectRoot);
    hasCode = discovery.counts.code > 0;
  } catch {
    return { output: '' };
  }
  if (!hasCode) return { output: '' };

  return { output: sessionNudgeOutput() };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/codekg.test.ts -t "session-check"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/codekg/agents.ts tests/codekg.test.ts
git commit -m "feat(codekg): add session-check command for unmapped-repo bootstrap offer"
```

---

### Task 2: Wire the `session-check` subcommand into the CLI

Exposes `code-kg session-check` so the SessionStart hook can call it. Mirrors the existing `hook-check` wiring exactly (root-only context, reads stdin for symmetry).

**Files:**
- Modify: `src/codekg/cli.ts` (add a `.command('session-check')` next to `hook-check`)
- Test: `tests/codekg.test.ts` (CLI-level smoke via the built binary)

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('session-check', ...)` block from Task 1. It runs the built CLI against a temp code repo and expects the offer JSON on stdout. It uses `execFile` (already imported as `execFile = promisify(execFileCallback)`):

```ts
it('emits the offer through the built `session-check` CLI command', async () => {
  const root = await makeProject();
  const cliPath = join(
    import.meta.dirname,
    '..',
    'dist',
    'src',
    'codekg',
    'cli.js',
  );

  const { stdout } = await execFile('node', [cliPath, 'session-check'], {
    cwd: root,
  });

  const parsed = JSON.parse(stdout.trim()) as {
    hookSpecificOutput: { hookEventName: string };
  };
  expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm build && pnpm vitest run tests/codekg.test.ts -t "built \`session-check\` CLI"`
Expected: FAIL — commander errors with "unknown command 'session-check'" (non-zero exit, no JSON).

- [ ] **Step 3: Add the CLI command**

In `src/codekg/cli.ts`, immediately after the existing `hook-check` command block (the one ending `);` before `program.command('mcp')`), add:

```ts
program
  .command('session-check')
  .description('Run the safe Code-KG SessionStart bootstrap-offer check')
  .action(async () => {
    const ctx = rootOnlyContext();
    const { sessionCheckCommand } = await import('./agents.js');
    handleResult(
      await sessionCheckCommand(ctx, { input: await readStdinIfAvailable() }),
    );
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm build && pnpm vitest run tests/codekg.test.ts -t "built \`session-check\` CLI"`
Expected: PASS.

- [ ] **Step 5: Run the full suite + checks**

Run: `pnpm build && pnpm test`
Expected: all tests pass; the embedded `typecheck` and `prettier` checks pass. If prettier flags formatting, run `pnpm format` and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/codekg/cli.ts tests/codekg.test.ts
git commit -m "feat(codekg): expose session-check subcommand"
```

---

### Task 3: Create the plugin manifest and MCP config

Scaffolds the plugin directory. These are config files driving the global binary — no build artifacts referenced.

**Files:**
- Create: `plugins/code-kg/.claude-plugin/plugin.json`
- Create: `plugins/code-kg/.mcp.json`

- [ ] **Step 1: Write `plugins/code-kg/.claude-plugin/plugin.json`**

```json
{
  "name": "code-kg",
  "description": "Persistent, reviewable code knowledge graph for AI agents",
  "version": "0.1.0",
  "author": { "name": "Whaleylaw" },
  "repository": "https://github.com/Whaleylaw/code-kg",
  "license": "MIT"
}
```

- [ ] **Step 2: Write `plugins/code-kg/.mcp.json`**

```json
{
  "mcpServers": {
    "code-kg": {
      "command": "code-kg",
      "args": ["mcp"],
      "cwd": "${CLAUDE_PROJECT_DIR}"
    }
  }
}
```

- [ ] **Step 3: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/code-kg/.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('plugins/code-kg/.mcp.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add plugins/code-kg/.claude-plugin/plugin.json plugins/code-kg/.mcp.json
git commit -m "feat(plugin): add plugin manifest and MCP server config"
```

---

### Task 4: Create the plugin hooks config

Wires both events to the global binary. The PreToolUse hook reuses `hook-check`; SessionStart uses the new `session-check`.

**Files:**
- Create: `plugins/code-kg/hooks/hooks.json`

- [ ] **Step 1: Write `plugins/code-kg/hooks/hooks.json`**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Grep|Glob|Read|LS",
        "hooks": [
          { "type": "command", "command": "code-kg hook-check" }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "code-kg session-check" }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/code-kg/hooks/hooks.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add plugins/code-kg/hooks/hooks.json
git commit -m "feat(plugin): add PreToolUse and SessionStart hooks"
```

---

### Task 5: Write the guidance skill

The on-demand guidance skill that ships with the plugin. Markdown with frontmatter; no code.

**Files:**
- Create: `plugins/code-kg/skills/code-kg/SKILL.md`

- [ ] **Step 1: Write `plugins/code-kg/skills/code-kg/SKILL.md`**

```markdown
---
description: Use when working in a repo that has (or should have) a Code-KG knowledge graph (a `lat.md/` directory), when the user asks how to use code-kg, or when you need to orient in a codebase before broad source reads. Explains bootstrapping a repo and the daily query/validate workflow.
---

# Using Code-KG

Code-KG maintains `lat.md/`, a reviewable markdown knowledge graph of a
codebase, so you can read a persistent map instead of re-deriving structure by
grepping. The CLI is the global `code-kg` binary; the MCP server exposes the
daily query/validate tools.

## Prerequisite

If `code-kg` is not found, it is not installed on this machine. Tell the user to
run `code-kg install-global` (or `npm i -g code-kg`) once, then retry.

## Onboard a repo (no `lat.md/` yet)

Run these from the repo root, with the user's go-ahead:

```bash
code-kg bootstrap --accept      # extract structure, write lat.md/ + .code-kg/
code-kg semantic enable-local   # persist the local embedding provider
code-kg semantic reindex        # build the local semantic index
code-kg doctor                  # readiness report
```

## Daily workflow (repo already mapped)

- **Before broad source search**, query the graph first — MCP `codekg_search`
  with `backend: "auto-semantic"`, or `code-kg search "<question>" --backend
  auto-semantic`.
- **Before opening raw source**, run `code-kg context <file-or-symbol>` (or MCP
  `codekg_section "<section-id>"`) to read the relevant sections, their
  relationships, and tests.
- **After changing code or knowledge docs**, run `code-kg check` and
  `code-kg drift` to compare source against the knowledge base. Use
  `code-kg changed` / `code-kg update` around edits, and `code-kg gaps` to find
  undocumented or untested files.

## MCP tools vs. CLI

- **MCP tools** (available in any mapped repo): search, section, check, drift,
  confidence, suppress, backlinks. Prefer these for queries and validation.
- **CLI via Bash** for everything not exposed over MCP: `bootstrap`, `doctor`,
  `semantic`, `context`, `gaps`, `changed`, `update`.

## Edit-safe contract

Never hand-edit source backlinks or overwrite curated/edited knowledge sections.
Use `code-kg apply-backlinks --preview` then `--write`, and only for sections
marked edit-safe. When regenerated content conflicts with an edited section,
Code-KG writes a candidate under `.code-kg/cache/merge-proposals/` for manual
review — surface that to the user rather than forcing the change.
```

- [ ] **Step 2: Verify the frontmatter is valid and the file is non-empty**

Run: `head -5 plugins/code-kg/skills/code-kg/SKILL.md`
Expected: shows the `---` frontmatter block with a `description:` line.

- [ ] **Step 3: Commit**

```bash
git add plugins/code-kg/skills/code-kg/SKILL.md
git commit -m "feat(plugin): add Code-KG guidance skill"
```

---

### Task 6: Create the marketplace catalog

Makes the repo installable via `/plugin marketplace add Whaleylaw/code-kg`.

**Files:**
- Create: `.claude-plugin/marketplace.json` (repo root)

- [ ] **Step 1: Write `.claude-plugin/marketplace.json`**

```json
{
  "name": "code-kg",
  "owner": { "name": "Whaleylaw" },
  "plugins": [
    {
      "name": "code-kg",
      "source": "./plugins/code-kg",
      "description": "Persistent, reviewable code knowledge graph for AI agents"
    }
  ]
}
```

- [ ] **Step 2: Validate JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat(plugin): add marketplace catalog"
```

---

### Task 7: Document plugin usage in the README

**Files:**
- Modify: `README.md` (add a section)

- [ ] **Step 1: Add a "Use as a Claude Code plugin" section**

Append to `README.md` (after the "Daily Workflow" section):

```markdown
## Use as a Claude Code Plugin

This repo is also a Claude Code plugin marketplace. The plugin wires the global
`code-kg` binary into Claude Code as an MCP server plus hooks, and ships a
guidance skill.

Prerequisites (once per machine): `code-kg install-global` so `code-kg` is on
`PATH`.

Install:

```bash
/plugin marketplace add Whaleylaw/code-kg
/plugin install code-kg@code-kg
```

What it adds:

- MCP server (`code-kg mcp`) — search, section, check, drift, confidence,
  suppress, and backlink tools in any mapped repo.
- A PreToolUse hook that nudges toward `code-kg search` / `code-kg context`
  before broad grep/glob/read (silent in unmapped repos).
- A SessionStart hook that offers to bootstrap unmapped code repos.
- A guidance skill explaining the bootstrap and daily workflow.

Map a repo with `code-kg bootstrap --accept` (see Daily Workflow above).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document Claude Code plugin install and usage"
```

---

### Task 8: Manual verification and push

**Files:** none (verification only)

- [ ] **Step 1: Final build + full test suite**

Run: `pnpm build && pnpm test`
Expected: all tests pass, including the four new `session-check` tests; typecheck and prettier checks pass.

- [ ] **Step 2: Load the plugin locally**

Run: `claude --plugin-dir ./plugins/code-kg` (in a separate terminal/session).
Expected: Claude Code loads the plugin. In a repo where `code-kg bootstrap --accept` has been run, `/mcp` lists the `code-kg` server and its tools.

- [ ] **Step 3: Verify hook behavior manually**

In a **mapped** repo, confirm a PreToolUse nudge fires before a `grep`/`Read`.
In an **unmapped code** repo, confirm the SessionStart offer appears.
In a **non-code** directory, confirm both stay silent. These map to the
automated `session-check` tests; this step is a sanity check in the real host.

- [ ] **Step 4: Push**

```bash
git push origin main
```
Expected: `main` up to date on `origin`.

---

## Notes for the implementer

- `codeKgKnowledgeBaseInstalled` is already defined (not exported) in
  `src/codekg/agents.ts` — call it directly within that module; do not
  re-implement it.
- The `_opts` parameter on `sessionCheckCommand` is intentionally unused; it
  mirrors `hookCheckCommand`'s signature and keeps the CLI wiring symmetric.
  `tsconfig.json` does not set `noUnusedParameters`, so the leading-underscore
  name compiles cleanly.
- Run `pnpm format` if the embedded prettier test fails after edits to `.ts`
  files. JSON/markdown plugin files are not covered by the `src/**/*.ts`
  prettier glob.
- Do not reference `dist/` from any plugin file — the runtime is the global
  `code-kg` binary.
