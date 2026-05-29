import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { dirname } from 'node:path';
import { z } from 'zod';
import { expandCommand } from '../cli/expand.js';
import { locateCommand } from '../cli/locate.js';
import { refsCommand, type Scope } from '../cli/refs.js';
import { sectionCommand } from '../cli/section.js';
import { plainStyler, type CmdContext, type CmdResult } from '../context.js';
import { findLatticeDir } from '../lattice.js';
import { applyBacklinksCommand } from './backlinks.js';
import { codeKgCheckCommand } from './check.js';
import { confidenceCommand } from './confidence.js';
import { driftCommand } from './drift.js';
import { codeKgSearchCommand } from './search.js';
import { suppressCommand } from './suppress.js';

type BudgetOptions = {
  maxTokens?: number;
};

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function applyTokenBudget(text: string, opts: BudgetOptions = {}): string {
  const originalTokens = estimateTokens(text);
  const maxTokens = opts.maxTokens;
  let body = text;
  let truncated = false;

  if (maxTokens !== undefined && originalTokens > maxTokens) {
    const maxChars = Math.max(80, maxTokens * 4);
    body = text.slice(0, maxChars).trimEnd() + '\n\n[truncated by max_tokens]';
    truncated = true;
  }

  const returnedTokens = estimateTokens(body);
  const budgetRemaining =
    maxTokens === undefined
      ? 'unknown'
      : Math.max(0, maxTokens - returnedTokens);
  return [
    body,
    '',
    '## Budget',
    '',
    `- estimated_tokens: ${originalTokens}`,
    `- returned_tokens: ${returnedTokens}`,
    `- max_tokens: ${maxTokens ?? 'unspecified'}`,
    `- budget_remaining: ${budgetRemaining}`,
    `- truncated: ${truncated ? 'yes' : 'no'}`,
  ].join('\n');
}

function toMcp(result: CmdResult, opts?: BudgetOptions) {
  const text = opts ? applyTokenBudget(result.output, opts) : result.output;
  const content = [{ type: 'text' as const, text }];
  return result.isError ? { content, isError: true } : { content };
}

export function createCodeKgMcpServer(ctx: CmdContext): McpServer {
  const server = new McpServer({
    name: 'code-kg',
    version: '0.1.0',
  });

  server.tool(
    'codekg_locate',
    'Find sections by name, path, or heading before reading source files',
    { query: z.string().describe('Section name or id to search for') },
    async ({ query }) => toMcp(await locateCommand(ctx, query)),
  );

  server.tool(
    'codekg_section',
    'Show one section with outgoing and incoming references',
    {
      query: z.string().describe('Section id to look up, short or full form'),
      max_tokens: z
        .number()
        .optional()
        .describe('Approximate maximum tokens to return'),
    },
    async ({ query, max_tokens }) =>
      toMcp(await sectionCommand(ctx, query), { maxTokens: max_tokens }),
  );

  server.tool(
    'codekg_search',
    'Search across curated lat.md sections with local lexical search by default, semantic embedding search when requested, or auto-semantic fallback',
    {
      query: z.string().describe('Search query in natural language'),
      limit: z
        .number()
        .optional()
        .default(5)
        .describe('Max results, default 5'),
      backend: z
        .enum(['local', 'semantic', 'auto-semantic'])
        .optional()
        .default('local')
        .describe(
          'Search backend: local lexical, semantic embeddings, or auto-semantic fallback',
        ),
      max_tokens: z
        .number()
        .optional()
        .describe('Approximate maximum tokens to return'),
    },
    async ({ query, limit, backend, max_tokens }) =>
      toMcp(await codeKgSearchCommand(ctx, query, { backend, limit }), {
        maxTokens: max_tokens,
      }),
  );

  server.tool(
    'codekg_expand',
    'Expand [[refs]] in text to resolved lat.md section paths with bounded context',
    { text: z.string().describe('Text containing [[refs]] to expand') },
    async ({ text: input }) => toMcp(await expandCommand(ctx, input)),
  );

  server.tool(
    'codekg_check',
    'Validate markdown, links, source refs, and directory indexes in lat.md',
    {},
    async () => toMcp(await codeKgCheckCommand(ctx)),
  );

  server.tool(
    'codekg_refs',
    'Find sections that reference a given section via wiki links or @lat code comments',
    {
      query: z.string().describe('Section id to find references for'),
      scope: z
        .enum(['md', 'code', 'md+code'])
        .optional()
        .default('md+code')
        .describe('Where to search: md, code, or md+code'),
    },
    async ({ query, scope }) =>
      toMcp(await refsCommand(ctx, query, scope as Scope)),
  );

  server.tool(
    'codekg_confidence',
    'List, accept, reject, or reconcile manifest confidence review items',
    {
      action: z
        .enum(['list', 'accept', 'reject', 'reconcile'])
        .describe('Confidence action to perform'),
      relationship_id: z
        .string()
        .optional()
        .describe('Relationship id for accept or reject'),
      accept_promotions: z
        .boolean()
        .optional()
        .describe('For reconcile, mark removed annotations accepted'),
    },
    async ({ action, relationship_id, accept_promotions }) =>
      toMcp(
        await confidenceCommand(ctx, {
          action,
          relationshipId: relationship_id,
          acceptPromotions: accept_promotions,
        }),
      ),
  );

  server.tool(
    'codekg_suppress',
    'List, add, or clear Code-KG suppression tombstones',
    {
      action: z
        .enum(['list', 'node', 'relationship', 'clear'])
        .describe('Suppression action to perform'),
      id: z.string().optional().describe('Node, relationship, or tombstone id'),
    },
    async ({ action, id }) =>
      toMcp(
        await suppressCommand(ctx, {
          action,
          id,
        }),
      ),
  );

  server.tool(
    'codekg_drift',
    'Report drift between source code, lat.md sections, and Code-KG manifest state',
    {
      apply_safe: z
        .boolean()
        .optional()
        .describe('Apply narrow safe manifest metadata updates'),
    },
    async ({ apply_safe }) =>
      toMcp(await driftCommand(ctx, { applySafe: apply_safe === true })),
  );

  server.tool(
    'codekg_apply_backlinks',
    'Preview or insert edit-safe @lat source backlinks',
    {
      write: z
        .boolean()
        .optional()
        .describe('Set true to mutate source files; omitted means preview'),
    },
    async ({ write }) =>
      toMcp(await applyBacklinksCommand(ctx, { write: write === true })),
  );

  return server;
}

export async function startCodeKgMcpServer(): Promise<void> {
  const latDir = findLatticeDir();
  if (!latDir) {
    process.stderr.write('No lat.md directory found\n');
    process.exit(1);
  }
  const projectRoot = dirname(latDir);
  const ctx: CmdContext = {
    latDir,
    projectRoot,
    styler: plainStyler,
    mode: 'mcp',
  };

  const server = createCodeKgMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
