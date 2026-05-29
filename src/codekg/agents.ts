import { constants as fsConstants, existsSync } from 'node:fs';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CmdContext, CmdResult } from '../context.js';
import { discoverProject } from './discovery.js';
import { semanticDoctorStatus } from './semantic.js';

const SECTION_START = '<!-- code-kg:agents:start -->';
const SECTION_END = '<!-- code-kg:agents:end -->';
const CODEX_HOOK_COMMAND = 'code-kg hook-check';
const CODEX_HOOK_MATCHER =
  'Bash|Grep|Glob|Read|LS|List|read_file|list_directory';
const GENERIC_SEARCH_COMMAND =
  'code-kg search "<question>" --backend auto-semantic';

type HookCommandSelection = {
  hookCommand: string;
  fallbackInvocation?: string;
};

type AgentsOptions = {
  action: 'install' | 'uninstall' | 'status';
};

type HookCheckOptions = {
  input?: string;
};

type HookAction =
  | { kind: 'search'; query?: string; command?: string }
  | { kind: 'read'; target?: string };

type HookCommand = {
  type?: string;
  command?: string;
  [key: string]: unknown;
};

type HookEntry = {
  matcher?: string;
  hooks?: HookCommand[];
  [key: string]: unknown;
};

type CodexHooksConfig = {
  hooks?: {
    PreToolUse?: HookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type CodexHookDetails =
  | { installed: false }
  | {
      installed: true;
      matcher: string;
      command: string;
      commandKind: 'global PATH hook' | 'local absolute hook';
    };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function currentCliPath(): string {
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith('/dist/src/codekg/agents.js')) {
    return join(dirname(current), 'cli.js');
  }
  if (
    current.endsWith('/src/codekg/agents.ts') ||
    current.endsWith('/src/codekg/agents.js')
  ) {
    return join(
      dirname(dirname(dirname(current))),
      'dist',
      'src',
      'codekg',
      'cli.js',
    );
  }
  return join(dirname(current), 'cli.js');
}

async function commandExistsOnPath(command: string): Promise<boolean> {
  const path = process.env.PATH ?? '';
  const extensions =
    process.platform === 'win32'
      ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
      : [''];
  for (const directory of path.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        await access(candidate, fsConstants.X_OK);
        return true;
      } catch {
        // Keep scanning PATH entries.
      }
    }
  }
  return false;
}

async function selectHookCommand(): Promise<HookCommandSelection> {
  if (await commandExistsOnPath('code-kg')) {
    return { hookCommand: CODEX_HOOK_COMMAND };
  }
  const fallbackInvocation = `${shellQuote(process.execPath)} ${shellQuote(
    currentCliPath(),
  )}`;
  return {
    hookCommand: `${fallbackInvocation} hook-check`,
    fallbackInvocation,
  };
}

function managedAgentsSection(fallbackInvocation?: string): string {
  const lines = [
    SECTION_START,
    '## code-kg',
    '',
    'This project may have a reviewable knowledge base in `lat.md/` and Code-KG metadata in `.code-kg/`.',
    '',
  ];
  if (fallbackInvocation) {
    lines.push(
      `Local CLI fallback: if \`code-kg\` is not on PATH, run \`${fallbackInvocation} <command>\`.`,
      '',
    );
  }
  lines.push(
    'Rules:',
    '- Before broad source reads, grep/glob searches, or answering codebase-structure questions, use `code-kg search "<question>"` or MCP `codekg_search` first.',
    '- For conceptual queries, prefer `code-kg search "<question>" --backend auto-semantic` or `codekg_search` with `backend: "auto-semantic"` so semantic search is used when configured and lexical search is used as a fallback.',
    '- Use `code-kg section "<section-id>"` or MCP `codekg_section` to read full sections with outgoing and incoming relationships before opening raw source.',
    '- Treat `lat.md/` as the primary map and raw source as the implementation detail to inspect after the relevant knowledge sections are known.',
    '- After modifying code or knowledge docs, run `code-kg check` and use `code-kg drift` to compare source and the knowledge base.',
    '- Do not manually add source backlinks; use `code-kg apply-backlinks --preview` and then `code-kg apply-backlinks --write` only for sections marked edit-safe.',
    SECTION_END,
    '',
  );
  return lines.join('\n');
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function replaceManagedSection(
  content: string,
  section: string,
): string | null {
  const start = content.indexOf(SECTION_START);
  if (start === -1) return null;
  const end = content.indexOf(SECTION_END, start);
  if (end === -1) return null;
  const after = content.slice(end + SECTION_END.length).replace(/^\n/, '');
  return content.slice(0, start) + section + after;
}

function removeManagedSection(content: string): string | null {
  const start = content.indexOf(SECTION_START);
  if (start === -1) return null;
  const end = content.indexOf(SECTION_END, start);
  if (end === -1) return null;
  const before = content.slice(0, start).replace(/\n{0,2}$/, '\n');
  const after = content.slice(end + SECTION_END.length).replace(/^\n+/, '');
  const next = before + after;
  return next.trim() ? next : '';
}

async function installAgentsMd(
  projectRoot: string,
  fallbackInvocation?: string,
): Promise<string> {
  const agentsPath = join(projectRoot, 'AGENTS.md');
  const section = managedAgentsSection(fallbackInvocation);
  const existing = await readText(agentsPath);
  if (existing === null) {
    await writeFile(agentsPath, section);
    return 'installed AGENTS.md guidance';
  }

  const replaced = replaceManagedSection(existing, section);
  const next =
    replaced ??
    (existing.trimEnd() ? `${existing.trimEnd()}\n\n${section}` : section);
  if (next !== existing) {
    await writeFile(agentsPath, next);
  }
  return replaced === null
    ? 'installed AGENTS.md guidance'
    : 'updated AGENTS.md guidance';
}

async function uninstallAgentsMd(projectRoot: string): Promise<string> {
  const agentsPath = join(projectRoot, 'AGENTS.md');
  const existing = await readText(agentsPath);
  if (existing === null) return 'AGENTS.md guidance was not installed';

  const next = removeManagedSection(existing);
  if (next === null) return 'AGENTS.md guidance was not installed';
  if (next === '') {
    await rm(agentsPath);
    return 'removed AGENTS.md guidance';
  }
  await writeFile(agentsPath, next);
  return 'removed AGENTS.md guidance';
}

function isCodeKgHook(hook: HookCommand): boolean {
  if (typeof hook.command !== 'string') return false;
  const command = hook.command.replace(/\\/g, '/');
  return (
    command.includes(CODEX_HOOK_COMMAND) ||
    (command.includes('codekg/cli.js') && /\bhook-check\b/.test(command))
  );
}

function codeKgHookCommandKind(
  command: string,
): 'global PATH hook' | 'local absolute hook' | null {
  const normalized = command.replace(/\\/g, '/');
  if (normalized.includes(CODEX_HOOK_COMMAND)) return 'global PATH hook';
  if (
    normalized.includes('codekg/cli.js') &&
    /\bhook-check\b/.test(normalized)
  ) {
    return 'local absolute hook';
  }
  return null;
}

function removeCodeKgHookEntries(entries: HookEntry[]): HookEntry[] {
  const cleaned: HookEntry[] = [];
  for (const entry of entries) {
    const hooks = Array.isArray(entry.hooks)
      ? entry.hooks.filter((hook) => !isCodeKgHook(hook))
      : entry.hooks;
    if (Array.isArray(hooks) && hooks.length === 0) continue;
    cleaned.push({ ...entry, hooks });
  }
  return cleaned;
}

async function readCodexHooks(path: string): Promise<CodexHooksConfig> {
  const existing = await readText(path);
  if (existing === null) return {};
  try {
    return JSON.parse(existing) as CodexHooksConfig;
  } catch {
    return {};
  }
}

async function installCodexHook(
  projectRoot: string,
  hookCommand: string,
): Promise<string> {
  const codexDir = join(projectRoot, '.codex');
  const hooksPath = join(codexDir, 'hooks.json');
  await mkdir(codexDir, { recursive: true });
  const config = await readCodexHooks(hooksPath);
  const hooks = config.hooks ?? {};
  const preToolUse = Array.isArray(hooks.PreToolUse)
    ? removeCodeKgHookEntries(hooks.PreToolUse)
    : [];
  preToolUse.push({
    matcher: CODEX_HOOK_MATCHER,
    hooks: [{ type: 'command', command: hookCommand }],
  });
  const next: CodexHooksConfig = {
    ...config,
    hooks: {
      ...hooks,
      PreToolUse: preToolUse,
    },
  };
  await writeFile(hooksPath, JSON.stringify(next, null, 2) + '\n');
  return 'installed Codex hook';
}

async function uninstallCodexHook(projectRoot: string): Promise<string> {
  const hooksPath = join(projectRoot, '.codex', 'hooks.json');
  const existing = await readText(hooksPath);
  if (existing === null) return 'Codex hook was not installed';

  let config: CodexHooksConfig;
  try {
    config = JSON.parse(existing) as CodexHooksConfig;
  } catch {
    return 'Codex hook was not installed';
  }

  const hooks = config.hooks ?? {};
  const preToolUse = Array.isArray(hooks.PreToolUse)
    ? removeCodeKgHookEntries(hooks.PreToolUse)
    : [];
  const nextHooks = { ...hooks };
  if (preToolUse.length > 0) {
    nextHooks.PreToolUse = preToolUse;
  } else {
    delete nextHooks.PreToolUse;
  }
  const next: CodexHooksConfig = { ...config, hooks: nextHooks };
  await writeFile(hooksPath, JSON.stringify(next, null, 2) + '\n');
  return 'removed Codex hook';
}

async function agentsGuidanceInstalled(projectRoot: string): Promise<boolean> {
  return (
    (await readText(join(projectRoot, 'AGENTS.md')))?.includes(SECTION_START) ??
    false
  );
}

async function codexHookDetails(
  projectRoot: string,
): Promise<CodexHookDetails> {
  const hooksPath = join(projectRoot, '.codex', 'hooks.json');
  const config = await readCodexHooks(hooksPath);
  const preToolUse = config.hooks?.PreToolUse;
  if (!Array.isArray(preToolUse)) return { installed: false };

  for (const entry of preToolUse) {
    for (const hook of entry.hooks ?? []) {
      if (typeof hook.command !== 'string') continue;
      const commandKind = codeKgHookCommandKind(hook.command);
      if (!commandKind) continue;
      return {
        installed: true,
        matcher: entry.matcher ?? '(missing)',
        command: hook.command,
        commandKind,
      };
    }
  }
  return { installed: false };
}

async function agentsStatusCommand(ctx: CmdContext): Promise<CmdResult> {
  const hook = await codexHookDetails(ctx.projectRoot);
  const lines = [
    '# Code-KG Agents Status',
    '',
    existsSync(ctx.latDir) ? '- lat.md/: found' : '- lat.md/: missing',
    (await agentsGuidanceInstalled(ctx.projectRoot))
      ? '- AGENTS.md guidance: installed'
      : '- AGENTS.md guidance: missing',
  ];

  if (hook.installed) {
    lines.push(`- Codex hook: installed (${hook.commandKind})`);
    lines.push(`- Codex matcher: ${hook.matcher}`);
    lines.push(`- Codex command: ${hook.command}`);
  } else {
    lines.push('- Codex hook: missing');
  }

  lines.push(semanticDoctorStatus(ctx));
  lines.push('- MCP command: code-kg mcp');
  lines.push('- Install command: code-kg agents install');
  return { output: lines.join('\n') };
}

export async function agentsCommand(
  ctx: CmdContext,
  opts: AgentsOptions,
): Promise<CmdResult> {
  if (opts.action === 'status') return agentsStatusCommand(ctx);

  const changes =
    opts.action === 'install'
      ? await (async () => {
          const hookSelection = await selectHookCommand();
          return [
            await installAgentsMd(
              ctx.projectRoot,
              hookSelection.fallbackInvocation,
            ),
            await installCodexHook(ctx.projectRoot, hookSelection.hookCommand),
          ];
        })()
      : [
          await uninstallAgentsMd(ctx.projectRoot),
          await uninstallCodexHook(ctx.projectRoot),
        ];

  return {
    output: [
      '# Code-KG Agents',
      '',
      ...changes.map((change) => `- ${change}`),
    ].join('\n'),
  };
}

function codeKgKnowledgeBaseInstalled(ctx: CmdContext): boolean {
  return (
    existsSync(ctx.latDir) &&
    existsSync(
      join(ctx.projectRoot, '.code-kg', 'materialization-manifest.json'),
    )
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  obj: Record<string, unknown> | null,
  fields: string[],
): string | undefined {
  if (!obj) return undefined;
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function isKnowledgePath(path: string | undefined): boolean {
  if (!path) return false;
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  return (
    normalized === 'lat.md' ||
    normalized.startsWith('lat.md/') ||
    normalized === '.code-kg' ||
    normalized.startsWith('.code-kg/')
  );
}

function isStructuredSearchTool(toolName: string): boolean {
  return /\b(grep|glob|search|ripgrep|rg|fd|find|ack|ag)\b/i.test(toolName);
}

function isStructuredReadTool(toolName: string): boolean {
  return /\b(read|read_file|list|ls|list_directory)\b/i.test(toolName);
}

function parseStructuredHookAction(
  parsed: Record<string, unknown>,
): HookAction | null {
  const toolInput =
    objectValue(parsed.tool_input) ??
    objectValue(parsed.input) ??
    objectValue(parsed.arguments) ??
    parsed;
  const command =
    stringField(toolInput, ['command']) ?? stringField(parsed, ['command']);
  if (command) {
    return isSearchStyleCommand(command)
      ? { kind: 'search', command, query: queryFromSearchCommand(command) }
      : null;
  }

  const toolName =
    stringField(parsed, ['tool_name', 'tool', 'name', 'toolName']) ?? '';
  if (isStructuredSearchTool(toolName)) {
    return {
      kind: 'search',
      query: stringField(toolInput, [
        'pattern',
        'query',
        'search',
        'regexp',
        'regex',
      ]),
    };
  }

  if (isStructuredReadTool(toolName)) {
    const target = stringField(toolInput, [
      'file_path',
      'path',
      'directory',
      'dir',
    ]);
    if (isKnowledgePath(target)) return null;
    return { kind: 'read', target };
  }

  return null;
}

function parseHookAction(input: string | undefined): HookAction | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith('{')) {
    return isSearchStyleCommand(trimmed)
      ? {
          kind: 'search',
          command: trimmed,
          query: queryFromSearchCommand(trimmed),
        }
      : null;
  }

  try {
    const parsed = objectValue(JSON.parse(trimmed));
    return parsed ? parseStructuredHookAction(parsed) : null;
  } catch {
    return null;
  }
}

function isSearchStyleCommand(command: string): boolean {
  const normalized = command.trim();
  if (!normalized) return false;
  if (/\bcode-kg\b/.test(normalized)) return false;
  if (/\blat\.md\b|\.code-kg\b/.test(normalized)) return false;

  return [
    /(^|[;&|()]\s*)git\s+grep\b/,
    /(^|[;&|()]\s*|xargs\s+)(rg|grep|ripgrep|find|fd|ack|ag)\b/,
  ].some((pattern) => pattern.test(normalized));
}

function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (char === '\\' && index + 1 < command.length) {
        index += 1;
        current += command[index];
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      index += 1;
      current += command[index];
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

function searchCommandStart(tokens: string[]): number | null {
  const commands = new Set([
    'rg',
    'ripgrep',
    'grep',
    'find',
    'fd',
    'ack',
    'ag',
  ]);
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === 'git' && tokens[index + 1] === 'grep') {
      return index + 1;
    }
    if (commands.has(tokens[index])) return index;
  }
  return null;
}

function optionConsumesNext(option: string): boolean {
  return [
    '-A',
    '-B',
    '-C',
    '-e',
    '-f',
    '-g',
    '-m',
    '-t',
    '-T',
    '--after-context',
    '--before-context',
    '--context',
    '--glob',
    '--max-count',
    '--regexp',
    '--type',
    '--type-not',
  ].includes(option);
}

function firstSearchPattern(tokens: string[], start: number): string | null {
  const command = tokens[start];
  for (let index = start + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '--') continue;
    if (token === '-e' || token === '--regexp') {
      return tokens[index + 1] ?? null;
    }
    if (token.startsWith('-e') && token.length > 2) {
      return token.slice(2);
    }
    if (token.startsWith('--regexp=')) {
      return token.slice('--regexp='.length);
    }
    if (token.startsWith('-')) {
      if (optionConsumesNext(token)) index += 1;
      continue;
    }
    if (command === 'find') {
      if (
        (token === '-name' || token === '-iname' || token === '-path') &&
        tokens[index + 1]
      ) {
        return tokens[index + 1];
      }
      continue;
    }
    return token;
  }
  return null;
}

function escapeSearchQuery(query: string): string {
  return query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function queryFromSearchCommand(command: string): string | undefined {
  const tokens = shellTokens(command);
  const start = searchCommandStart(tokens);
  return start === null
    ? undefined
    : (firstSearchPattern(tokens, start) ?? undefined);
}

function suggestedSearchCommand(query: string | undefined): string {
  if (!query?.trim()) return GENERIC_SEARCH_COMMAND;
  return `code-kg search "${escapeSearchQuery(query.trim())}" --backend auto-semantic`;
}

function hookAdditionalContext(action: HookAction): string {
  if (action.kind === 'read') {
    const target = action.target ? ` of \`${action.target}\`` : '';
    const contextCommand = action.target
      ? `code-kg context "${escapeSearchQuery(action.target)}"`
      : 'code-kg context <file-or-symbol>';
    return `Code-KG: this repo has a reviewable knowledge graph. Before raw source read${target}, run \`${contextCommand}\` to see relevant sections, relationships, and tests. Use \`code-kg section "<section-id>"\` when you already have a section id.`;
  }

  const searchCommand = suggestedSearchCommand(action.query);
  return `Code-KG: this repo has a reviewable knowledge graph. Before broad raw-source search, run \`${searchCommand}\` or MCP \`codekg_search\` with backend \`auto-semantic\`, then use \`code-kg section "<section-id>"\` before opening raw files.`;
}

function hookNudgeOutput(action: HookAction): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: hookAdditionalContext(action),
    },
  });
}

export async function hookCheckCommand(
  ctx: CmdContext,
  opts: HookCheckOptions = {},
): Promise<CmdResult> {
  if (!codeKgKnowledgeBaseInstalled(ctx)) return { output: '' };
  const action = parseHookAction(opts.input);
  if (!action) return { output: '' };

  return { output: hookNudgeOutput(action) };
}

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
