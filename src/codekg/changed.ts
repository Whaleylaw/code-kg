import { execFileSync } from 'node:child_process';
import type { CmdContext, CmdResult } from '../context.js';
import { buildContextInfo } from './context.js';

function gitChangedFiles(projectRoot: string): string[] {
  const commands = [
    ['diff', '--name-only', 'HEAD', '--'],
    ['diff', '--name-only', '--cached', '--'],
    ['ls-files', '--modified', '--others', '--exclude-standard'],
  ];
  const files = new Set<string>();
  for (const args of commands) {
    try {
      const output = execFileSync('git', args, {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      for (const line of output.split('\n')) {
        const file = line.trim();
        if (file) files.add(file);
      }
    } catch {
      return [];
    }
  }
  return [...files].sort();
}

export async function changedCommand(ctx: CmdContext): Promise<CmdResult> {
  const files = gitChangedFiles(ctx.projectRoot);
  const lines = ['# Code-KG Changed', ''];
  if (files.length === 0) {
    lines.push('- No git working-tree changes detected.');
    return { output: lines.join('\n') };
  }

  for (const file of files) {
    const info = await buildContextInfo(ctx, file);
    lines.push(`## ${file}`, '');
    if (!info) {
      lines.push('- No Code-KG context found.', '');
      continue;
    }
    lines.push(
      `- Sections: ${
        info.sections.length
          ? info.sections
              .slice(0, 5)
              .map((section) => `[[${section.id}]]`)
              .join(', ')
          : 'none detected'
      }`,
    );
    lines.push(
      `- Tests: ${
        info.testedBy.length
          ? info.testedBy.map((test) => `\`${test}\``).join(', ')
          : 'none detected'
      }`,
    );
    lines.push(`- Command: \`code-kg context ${file}\``, '');
  }

  return { output: lines.join('\n').trimEnd() };
}
