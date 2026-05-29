import type { CmdContext, CmdResult } from '../context.js';
import {
  flattenSections,
  loadAllSections,
  type Section,
  type SectionMatch,
} from '../lattice.js';
import { formatResultList } from '../format.js';
import { hasEmbeddingConfig } from '../config.js';

export type CodeKgSearchBackend = 'local' | 'semantic' | 'auto-semantic';
type ResolvedSearchBackend = 'local' | 'semantic';

export type CodeKgSearchOptions = {
  backend?: CodeKgSearchBackend;
  semantic?: boolean;
  limit?: number;
  reindex?: boolean;
};

type SearchBackendSelection = {
  backend: ResolvedSearchBackend;
  label: string;
};

function formatCodeKgNavHints(ctx: CmdContext): string {
  const s = ctx.styler;
  const hints =
    ctx.mode === 'cli'
      ? `${s.dim('*')} \`code-kg section "section#id"\` - show full content with outgoing/incoming refs\n` +
        `${s.dim('*')} \`code-kg search "new query"\` - search for something else`
      : `${s.dim('*')} \`codekg_section\` - show full content with outgoing/incoming refs\n` +
        `${s.dim('*')} \`codekg_search\` - search for something else`;
  return `\n## To navigate further:\n\n${hints}`;
}

function scoreSection(section: Section, query: string): number {
  const q = query.toLowerCase();
  const id = section.id.toLowerCase();
  const heading = section.heading.toLowerCase();
  const body = section.firstParagraph.toLowerCase();
  let score = 0;
  if (id.includes(q)) score += 8;
  if (heading.includes(q)) score += 6;
  if (body.includes(q)) score += 4;
  for (const token of q.split(/\s+/).filter(Boolean)) {
    if (id.includes(token)) score += 2;
    if (heading.includes(token)) score += 2;
    if (body.includes(token)) score += 1;
  }
  return score;
}

export async function localSearchCommand(
  ctx: CmdContext,
  query: string | undefined,
  limit: number,
): Promise<CmdResult> {
  if (!query?.trim()) {
    return { output: 'Provide a search query.', isError: true };
  }

  const sections = flattenSections(await loadAllSections(ctx.latDir));
  const matches: SectionMatch[] = sections
    .map((section) => ({
      section,
      score: scoreSection(section, query),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) => b.score - a.score || a.section.id.localeCompare(b.section.id),
    )
    .slice(0, limit)
    .map((entry) => ({
      section: entry.section,
      reason: 'local lexical match',
    }));

  if (matches.length === 0) {
    return {
      output: `No sections matched "${query}".`,
      isError: true,
    };
  }

  return {
    output:
      formatResultList(ctx, `Local search results for "${query}"`, matches) +
      formatCodeKgNavHints(ctx),
  };
}

export function selectCodeKgSearchBackend(
  opts: CodeKgSearchOptions = {},
): SearchBackendSelection {
  if (opts.semantic || opts.backend === 'semantic') {
    return { backend: 'semantic', label: 'semantic' };
  }
  if (opts.backend === 'auto-semantic') {
    if (hasEmbeddingConfig()) {
      return { backend: 'semantic', label: 'semantic (auto-semantic)' };
    }
    return {
      backend: 'local',
      label: 'local lexical (auto-semantic fallback)',
    };
  }
  return { backend: 'local', label: 'local lexical' };
}

function withBackendLabel(result: CmdResult, label: string): CmdResult {
  if (!result.output) return result;
  return {
    ...result,
    output: `Backend: ${label}\n${result.output}`,
  };
}

export async function codeKgSearchCommand(
  ctx: CmdContext,
  query: string | undefined,
  opts: CodeKgSearchOptions = {},
): Promise<CmdResult> {
  const selected = selectCodeKgSearchBackend(opts);
  const limit = opts.limit ?? 5;

  if (selected.backend === 'semantic') {
    const { searchCommand, cliProgress } = await import('../cli/search.js');
    return withBackendLabel(
      await searchCommand(
        ctx,
        query,
        { limit, reindex: opts.reindex },
        ctx.mode === 'cli'
          ? cliProgress(opts.reindex === true, ctx.styler)
          : undefined,
      ),
      selected.label,
    );
  }

  return withBackendLabel(
    await localSearchCommand(ctx, query, limit),
    selected.label,
  );
}
