# Design: code-kg Claude Code Plugin + Guidance Skill

Date: 2026-05-29
Status: approved design

## Background

`code-kg` is a Node.js CLI that maintains `lat.md/`, a reviewable markdown
knowledge graph of a codebase, so AI agents read a persistent map instead of
re-deriving structure each session. It already ships:

- An MCP server (`code-kg mcp`) exposing the daily query/validate tools:
  search, section, check, drift, confidence, suppress, backlinks.
- A Claude-Code-compatible `PreToolUse` hook (`code-kg hook-check`) that reads
  tool input on stdin and emits `hookSpecificOutput.additionalContext`. It is
  silent unless the current repo has *both* `lat.md/` and
  `.code-kg/materialization-manifest.json` (see `src/codekg/agents.ts:697`).

What it lacks is a way to use it ergonomically across *other* repos from inside
Claude Code. Today integration is wired via `code-kg agents install`, which
targets Codex (`.codex/hooks.json` + `AGENTS.md`), not Claude Code.

## Goal

Package code-kg as a Claude Code plugin so it works in any repo the user opens,
plus a guidance skill that teaches the workflow and proactively offers to map
unmapped repos.

## Non-Goals

- No npm publish or self-contained bundling of the runtime (decided: global
  binary model).
- No slash commands in v1 (lean scope).
- No change to the existing Codex integration (`agents install` stays as-is).

## Runtime Model: Global Binary

Decision: the plugin assumes the `code-kg` binary is on `PATH`. The plugin is
therefore pure configuration + skill text, fully decoupled from `dist/`. This is
the simplest model and fits the primary use case ("my own repos on my machine").

Consequences, documented for the user (not automated):

- Install once per machine: `code-kg install-global` (or `npm i -g`).
- Map once per repo: `code-kg bootstrap --accept`.

## Repository Layout

The same GitHub repo (`Whaleylaw/code-kg`) is both the tool source and the
plugin marketplace. New files only; the npm package is untouched.

```
code-kg/                          # repo root (npm package, unchanged)
├── .claude-plugin/
│   └── marketplace.json          # NEW — marketplace catalog
├── plugins/
│   └── code-kg/                  # NEW — the plugin
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── .mcp.json             # launches `code-kg mcp`
│       ├── hooks/
│       │   └── hooks.json        # PreToolUse nudge + SessionStart offer
│       └── skills/
│           └── code-kg/
│               └── SKILL.md      # guidance skill (ships with the plugin)
├── src/ dist/ package.json ...   # existing, untouched
```

Rationale: only `plugin.json` and `marketplace.json` may live in
`.claude-plugin/`; everything else (skills/, hooks/, .mcp.json) sits at the
plugin root. Keeping the plugin in `plugins/code-kg/` isolates it cleanly from
the package sources. `marketplace.json` at repo root lets `/plugin marketplace
add Whaleylaw/code-kg` resolve it.

## Components

### 1. `plugins/code-kg/.claude-plugin/plugin.json`

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

MCP, hooks, and skills are auto-discovered from their conventional locations
(`.mcp.json`, `hooks/hooks.json`, `skills/`), so they need no explicit path
fields in the manifest.

### 2. `plugins/code-kg/.mcp.json` (MCP server)

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

`cwd` pinned to `${CLAUDE_PROJECT_DIR}` so the server resolves the *current*
repo's `lat.md/` and `.code-kg/`. Exposes the daily query/validate tools in
every repo. If `code-kg` is not on PATH the server fails to start — acceptable
given the documented prerequisite; the skill surfaces the fix.

### 3. `plugins/code-kg/hooks/hooks.json` (hooks)

Two events:

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

- **PreToolUse** reuses the existing `hook-check`. Safe to enable globally: it
  is silent on unmapped repos and nudges (search-before-grep,
  context-before-read) on mapped repos.
- **SessionStart** runs a NEW `session-check` subcommand (see below) that emits
  a proactive "this repo isn't mapped — offer to bootstrap it" context when, and
  only when, the cwd is a real code project with no knowledge base yet.

### 4. NEW CLI subcommand: `code-kg session-check`

Purpose: power the proactive offer without nagging.

Behavior:

- Reads the SessionStart hook JSON on stdin (consistent with `hook-check`),
  resolves context from cwd.
- Emits `hookSpecificOutput.additionalContext` (a short instruction telling the
  agent to offer running `code-kg bootstrap --accept`) **only when both**:
  1. The repo is **unmapped** — missing `lat.md/` or the materialization
     manifest (reuse the existing `codeKgKnowledgeBaseInstalled` check, negated).
  2. The directory **looks like a real codebase** — there are source files
     code-kg would map. Reuse existing discovery (`src/codekg/discovery.ts` /
     `walk.ts`) rather than inventing a new heuristic.
- Otherwise prints nothing (mapped repos stay silent; empty/non-code dirs stay
  silent).

This lives in `src/codekg/agents.ts` alongside `hookCheckCommand`, wired into
`src/codekg/cli.ts` and covered by tests in `tests/codekg.test.ts` (mapped →
silent, unmapped-code-repo → offer, non-code-dir → silent).

The offer text is non-coercive, e.g.:

> Code-KG: this repo has no knowledge graph yet. If the user wants a persistent
> map for faster orientation, offer to run `code-kg bootstrap --accept` (then
> `code-kg semantic enable-local` and `code-kg semantic reindex`). Do not run it
> without the user's go-ahead.

### 5. `plugins/code-kg/skills/code-kg/SKILL.md` (guidance skill)

Frontmatter `description` triggers when the user is working in a code-kg-enabled
repo, asks how to use code-kg, or asks to set one up. Content sections:

- **Onboard a new repo:** `code-kg bootstrap --accept` →
  `semantic enable-local` → `semantic reindex` → `doctor`.
- **Daily workflow:** search (or MCP `codekg_search`, `backend: auto-semantic`)
  before grep; `code-kg context <file>` before opening raw source;
  `code-kg check` + `code-kg drift` after changing code or knowledge docs.
- **MCP tools vs CLI:** queries/validation via MCP tools; onboarding and
  maintenance (`bootstrap`, `doctor`, `semantic`, `context`, `gaps`, `changed`,
  `update`) via Bash, since those are not exposed over MCP.
- **Edit-safe contract:** never hand-edit source backlinks; use
  `code-kg apply-backlinks --preview` then `--write`, only for edit-safe
  sections. Never overwrite curated/edited knowledge sections.
- **Prerequisite reminder:** if `code-kg` is missing, run `code-kg
  install-global` (or `npm i -g`).

## Distribution & Install

`.claude-plugin/marketplace.json`:

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

User flow on any machine:

```
code-kg install-global                 # once per machine (prereq)
/plugin marketplace add Whaleylaw/code-kg
/plugin install code-kg@code-kg
```

## Testing

- Unit: `session-check` behavior in `tests/hook.test.ts` (three cases above);
  keep `hook-check` tests green.
- `pnpm build && pnpm test` stays green; `typecheck` and `prettier` checks pass.
- Manual: `claude --plugin-dir ./plugins/code-kg` in (a) a bootstrapped repo —
  tools appear in `/mcp`, PreToolUse nudges fire; (b) an unmapped code repo —
  SessionStart offers bootstrap; (c) a non-code dir — silent.
- Validate JSON: plugin.json, marketplace.json, .mcp.json, hooks.json parse.

## Risks / Notes

- **PATH dependency:** the MCP server and hooks all assume `code-kg` resolves on
  PATH. Mitigation: documented prereq + skill reminder. If this proves fragile,
  a later iteration can fall back to an absolute path or `npx`.
- **SessionStart cwd:** `session-check` relies on the hook running with the
  project as cwd (or `${CLAUDE_PROJECT_DIR}`); confirm during implementation and
  pass cwd explicitly if needed.
- **Hook event name casing** is case-sensitive (`PreToolUse`, `SessionStart`).
- **Docs:** add a short "Use as a Claude Code plugin" section to `README.md`.
```
