import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CmdContext, CmdResult } from '../context.js';
import { codeKgCheckCommand } from './check.js';
import type { MaterializationManifest, ManifestSection } from './types.js';
import { semanticDoctorStatus } from './semantic.js';

const AGENTS_MARKER = '<!-- code-kg:agents:start -->';
const CODEX_HOOK_COMMAND = 'code-kg hook-check';

function codeKgHookCommandKind(
  command: string | undefined,
): 'global PATH hook' | 'local absolute hook' | null {
  if (typeof command !== 'string') return null;
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

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function readManifest(
  projectRoot: string,
): Promise<MaterializationManifest | null | Error> {
  const path = join(projectRoot, '.code-kg', 'materialization-manifest.json');
  const content = await readText(path);
  if (content === null) return null;
  try {
    return JSON.parse(content) as MaterializationManifest;
  } catch (error) {
    return error as Error;
  }
}

function sectionStatusSummary(
  sections: Record<string, ManifestSection>,
): string {
  const counts: Record<ManifestSection['status'], number> = {
    generated: 0,
    edited: 0,
    curated: 0,
    suppressed: 0,
    orphaned: 0,
  };
  for (const section of Object.values(sections)) {
    counts[section.status] += 1;
  }
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${status}=${count}`)
    .join(', ');
}

function ignoreLineMatchesCache(
  line: string,
  scope: 'root' | 'codekg' | 'lat',
): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return false;
  const normalized = trimmed.replace(/^\//, '').replace(/\/+$/, '');
  if (scope === 'codekg') {
    return normalized === 'cache' || normalized === 'cache/**';
  }
  if (scope === 'lat') {
    return normalized === 'lat.md/.cache' || normalized === 'lat.md/.cache/**';
  }
  return normalized === '.code-kg/cache' || normalized === '.code-kg/cache/**';
}

async function cacheIgnored(projectRoot: string): Promise<boolean> {
  const rootIgnore = await readText(join(projectRoot, '.gitignore'));
  if (
    rootIgnore?.split('\n').some((line) => ignoreLineMatchesCache(line, 'root'))
  ) {
    return true;
  }

  const codeKgIgnore = await readText(
    join(projectRoot, '.code-kg', '.gitignore'),
  );
  return (
    codeKgIgnore
      ?.split('\n')
      .some((line) => ignoreLineMatchesCache(line, 'codekg')) ?? false
  );
}

async function latCacheIgnored(projectRoot: string): Promise<boolean> {
  const rootIgnore = await readText(join(projectRoot, '.gitignore'));
  return (
    rootIgnore
      ?.split('\n')
      .some((line) => ignoreLineMatchesCache(line, 'lat')) ?? false
  );
}

async function agentsGuidanceInstalled(projectRoot: string): Promise<boolean> {
  const content = await readText(join(projectRoot, 'AGENTS.md'));
  return content?.includes(AGENTS_MARKER) ?? false;
}

async function codexHookStatus(projectRoot: string): Promise<string> {
  const content = await readText(join(projectRoot, '.codex', 'hooks.json'));
  if (!content) return '- Codex hook: missing';
  try {
    const parsed = JSON.parse(content) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    for (const entry of parsed.hooks?.PreToolUse ?? []) {
      for (const hook of entry.hooks ?? []) {
        const kind = codeKgHookCommandKind(hook.command);
        if (kind) return `- Codex hook: installed (${kind})`;
      }
    }
    return '- Codex hook: missing';
  } catch {
    return '- Codex hook: missing';
  }
}

export async function doctorCommand(ctx: CmdContext): Promise<CmdResult> {
  const lines = ['# Code-KG Doctor', ''];
  let hasCriticalIssue = false;

  const latExists = existsSync(ctx.latDir);
  lines.push(latExists ? '- lat.md/: found' : '- lat.md/: missing');
  if (!latExists) hasCriticalIssue = true;

  if (latExists) {
    const check = await codeKgCheckCommand(ctx);
    lines.push(
      check.isError ? '- code-kg check: failed' : '- code-kg check: passed',
    );
    if (check.isError) hasCriticalIssue = true;
  } else {
    lines.push('- code-kg check: skipped');
  }

  const manifest = await readManifest(ctx.projectRoot);
  if (manifest === null) {
    lines.push('- materialization-manifest.json: missing');
    hasCriticalIssue = true;
  } else if (manifest instanceof Error) {
    lines.push(
      `- materialization-manifest.json: invalid (${manifest.message})`,
    );
    hasCriticalIssue = true;
  } else {
    lines.push('- materialization-manifest.json: found');
    lines.push(
      `- manifest sections: ${sectionStatusSummary(manifest.sections)}`,
    );
    lines.push(
      `- manifest relationships: ${Object.keys(manifest.relationships).length}`,
    );
    const suppressed =
      manifest.suppressed.nodes.length +
      manifest.suppressed.relationships.length;
    lines.push(`- suppressions: ${suppressed}`);
  }

  lines.push(
    (await cacheIgnored(ctx.projectRoot))
      ? '- .code-kg/cache/: ignored'
      : '- .code-kg/cache/: not ignored',
  );
  lines.push(semanticDoctorStatus(ctx));
  lines.push(
    (await latCacheIgnored(ctx.projectRoot))
      ? '- lat.md/.cache/: ignored'
      : '- lat.md/.cache/: not ignored',
  );
  lines.push(
    (await agentsGuidanceInstalled(ctx.projectRoot))
      ? '- AGENTS.md guidance: installed'
      : '- AGENTS.md guidance: missing',
  );
  lines.push(await codexHookStatus(ctx.projectRoot));
  lines.push('- MCP command: code-kg mcp');
  lines.push(
    '- Drift: run `code-kg drift` after source or architecture changes',
  );

  return {
    output: lines.join('\n'),
    isError: hasCriticalIssue,
  };
}
