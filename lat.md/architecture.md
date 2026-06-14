# Architecture
<!-- code-kg:id architecture.overview -->

This section summarizes the repository shape discovered during the first Code-KG bootstrap.

## Project Signals

Detected project signals help orient agents before broad source reads.

- code-kg (Node/TypeScript)

## Entry Points

Entry points are candidate files to inspect first when source verification is needed.

- dist/src/codekg/cli.js
- index.js

## Entry Point Flow

No parsed entrypoint files were available for first-hop dependency flow during bootstrap.

- No entrypoint flow was detected.


## File Inventory

The initial inventory groups files by broad category so later extraction can focus on high-value paths.

- Code files: 83
- Test files: 8
- Documentation files: 76
- Config files: 2
- Asset files: 2
- Unsupported files: 12

## Structural Graph

Code-KG extracted a deterministic structural graph with 834 nodes, 844 edges, 4 communities using the multi-language-directory-fallback analysis path.

## Communities

Directory-based communities provide the first subsystem map until graph clustering is available.

- src: 58 files, 614 symbols, cohesion 1
- tests: 29 files, 117 symbols, cohesion 1
- templates: 2 files, 9 symbols, cohesion 1
- scripts: 1 files, 0 symbols, cohesion 1

## High-Degree Nodes

High-degree nodes may deserve review as important entry points, bridges, or utility hotspots.

- src (module)
- src/codekg/agents.ts (file)
- src/codekg/bootstrap.ts (file)
- src/cli/init.ts (file)
- src/source-parser.ts (file)
- src/cli/check.ts (file)
- tests (module)
- src/codekg/graph.ts (file)
- src/lattice.ts (file)
- src/codekg/cli.ts (file)

## Dependency Hotspots

No source files had incoming local imports during bootstrap.

- No dependency hotspots were detected.


## Source File Highlights

These generated highlights come from deterministic file, symbol, and import extraction so agents can search source-shaped concepts before opening raw files.

### src/codekg/agents.ts

Source file `src/codekg/agents.ts` contains source symbols. Key symbols: `SECTION_START`, `SECTION_END`, and 54 more.

- Symbols: `SECTION_START (const)`, `SECTION_END (const)`, `CODEX_HOOK_COMMAND (const)`, `CODEX_HOOK_MATCHER (const)`, `GENERIC_SEARCH_COMMAND (const)`, `HookCommandSelection (type)`, `AgentsOptions (type)`, `HookCheckOptions (type)`, and 48 more
- Imports: none detected
- Imported by: none detected

### src/codekg/bootstrap.ts

Source file `src/codekg/bootstrap.ts` contains source symbols. Key symbols: `MergeProposal`, `SECTION_HEADINGS`, and 50 more.

- Symbols: `MergeProposal (type)`, `SECTION_HEADINGS (const)`, `DEFAULT_GITIGNORE_LINES (const)`, `SOURCE_FILE_HIGHLIGHT_LIMIT (const)`, `TEST_FILE_HIGHLIGHT_LIMIT (const)`, `SOURCE_SYMBOL_LIMIT (const)`, `SOURCE_IMPORT_LIMIT (const)`, `hash (function)`, and 44 more
- Imports: none detected
- Imported by: none detected

### src/cli/init.ts

Source file `src/cli/init.ts` contains source symbols. Key symbols: `confirm`, `prompt`, and 36 more.

- Symbols: `confirm (function)`, `prompt (function)`, `loaderExecArgs (function)`, `resolveLatBin (function)`, `LatCommandStyle (type)`, `latBinString (function)`, `styledMcpCommand (function)`, `latHookCommand (function)`, and 30 more
- Imports: none detected
- Imported by: none detected

### src/source-parser.ts

Source file `src/source-parser.ts` contains source symbols. Key symbols: `SourceSymbol`, `parserReady`, and 28 more.

- Symbols: `SourceSymbol (type)`, `parserReady (const)`, `parserInstance (const)`, `languages (const)`, `wasmDir (function)`, `ensureParser (function)`, `grammarMap (const)`, `SOURCE_EXTENSIONS (const)`, and 22 more
- Imports: none detected
- Imported by: none detected

### src/cli/check.ts

Source file `src/cli/check.ts` contains source symbols. Key symbols: `CheckError`, `filePart`, and 26 more.

- Symbols: `CheckError (type)`, `filePart (function)`, `ambiguousMessage (function)`, `FileStats (type)`, `CheckResult (type)`, `countByExt (function)`, `isSourcePath (function)`, `tryResolveSourceRef (function)`, and 20 more
- Imports: none detected
- Imported by: none detected

### src/codekg/graph.ts

Source file `src/codekg/graph.ts` contains source symbols. Key symbols: `LOCAL_IMPORT_EXTENSIONS`, `GRAPH_CACHE_PATH`, and 25 more.

- Symbols: `LOCAL_IMPORT_EXTENSIONS (const)`, `GRAPH_CACHE_PATH (const)`, `ImportSpec (type)`, `stableId (function)`, `moduleLabel (function)`, `fileNode (function)`, `moduleNode (function)`, `symbolNode (function)`, and 19 more
- Imports: none detected
- Imported by: none detected

### src/lattice.ts

Source file `src/lattice.ts` contains source symbols. Key symbols: `Section`, `Ref`, and 21 more.

- Symbols: `Section (type)`, `Ref (type)`, `LatFrontmatter (type)`, `parseFrontmatter (function)`, `findLatticeDir (function)`, `findProjectRoot (function)`, `listLatticeFiles (function)`, `headingText (function)`, and 15 more
- Imports: none detected
- Imported by: none detected

### src/codekg/cli.ts

Source file `src/codekg/cli.ts` contains source symbols. Key symbols: `PreviewAcceptOptions`, `ExtractOptions`, and 20 more.

- Symbols: `PreviewAcceptOptions (type)`, `ExtractOptions (type)`, `DriftOptions (type)`, `ReconcileOptions (type)`, `ConfidenceReconcileOptions (type)`, `ApplyBacklinksOptions (type)`, `SearchCliOptions (type)`, `InstallGlobalOptions (type)`, and 14 more
- Imports: none detected
- Imported by: none detected

### src/codekg/drift.ts

Source file `src/codekg/drift.ts` contains source symbols. Key symbols: `DriftSeverity`, `DriftFinding`, and 19 more.

- Symbols: `DriftSeverity (type)`, `DriftFinding (type)`, `DriftOptions (type)`, `manifestPath (function)`, `readManifest (function)`, `manifestSourceNodeIds (function)`, `manifestGraphHashes (function)`, `findMissingSourceNodes (function)`, and 13 more
- Imports: none detected
- Imported by: none detected

### src/cli/hook.ts

Source file `src/cli/hook.ts` contains source symbols. Key symbols: `outputClaudePromptSubmit`, `outputClaudeStop`, and 16 more.

- Symbols: `outputClaudePromptSubmit (function)`, `outputClaudeStop (function)`, `outputCursorStop (function)`, `readStdin (function)`, `hasWikiLinks (function)`, `makeHookCtx (function)`, `searchAndExpand (function)`, `handleUserPromptSubmit (function)`, and 10 more
- Imports: none detected
- Imported by: none detected

### scripts/cook-test-rag.ts

Source file `scripts/cook-test-rag.ts` contains source symbols. Key symbols: none detected.

- Symbols: none detected
- Imports: none detected
- Imported by: none detected

### src/cli/checklist-menu.ts

Source file `src/cli/checklist-menu.ts` contains source symbols. Key symbols: `ChecklistOption`, `checklistMenu`.

- Symbols: `ChecklistOption (interface)`, `checklistMenu (function)`
- Imports: none detected
- Imported by: none detected

### src/cli/context.ts

Source file `src/cli/context.ts` contains source symbols. Key symbols: `makeStyler`, `resolveContext`.

- Symbols: `makeStyler (function)`, `resolveContext (function)`
- Imports: none detected
- Imported by: none detected

### src/cli/expand.ts

Source file `src/cli/expand.ts` contains source symbols. Key symbols: `WIKI_LINK_RE`, `formatLocation`, and 3 more.

- Symbols: `WIKI_LINK_RE (const)`, `formatLocation (function)`, `ResolvedRef (type)`, `expandPrompt (function)`, `expandCommand (function)`
- Imports: none detected
- Imported by: none detected

### src/cli/gen.ts

Source file `src/cli/gen.ts` contains source symbols. Key symbols: `readAgentsTemplate`, `readCursorRulesTemplate`, and 4 more.

- Symbols: `readAgentsTemplate (function)`, `readCursorRulesTemplate (function)`, `readPiExtensionTemplate (function)`, `readOpenCodePluginTemplate (function)`, `readSkillTemplate (function)`, `genCmd (function)`
- Imports: none detected
- Imported by: none detected
