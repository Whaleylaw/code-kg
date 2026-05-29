import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CmdContext, CmdResult } from '../context.js';
import { flattenSections, loadAllSections } from '../lattice.js';
import { extractProjectGraph } from './graph.js';
import type { MaterializationManifest } from './types.js';

async function readManifest(
  projectRoot: string,
): Promise<MaterializationManifest | null> {
  const path = join(projectRoot, '.code-kg', 'materialization-manifest.json');
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf-8')) as MaterializationManifest;
}

function bullet(items: string[], fallback: string): string[] {
  return items.length ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
}

export async function gapsCommand(ctx: CmdContext): Promise<CmdResult> {
  const manifest = await readManifest(ctx.projectRoot);
  if (!manifest) {
    return {
      output:
        '# Code-KG Gaps\n\n- Manifest missing. Run `code-kg bootstrap --accept` first.',
      isError: true,
    };
  }

  const graph = await extractProjectGraph(ctx.projectRoot);
  const sections = flattenSections(await loadAllSections(ctx.latDir));
  const sectionText = sections
    .map(
      (section) =>
        `${section.id}\n${section.heading}\n${section.firstParagraph}`,
    )
    .join('\n');
  const codeFiles = graph.nodes
    .filter((node) => node.kind === 'file' && node.source_file)
    .map((node) => ({ id: node.id, path: node.source_file! }))
    .filter(
      (entry) =>
        !entry.path.includes('.test.') && !entry.path.startsWith('tests/'),
    );
  const testedTargets = new Set(
    graph.edges
      .filter((edge) => edge.relation === 'tests')
      .map((edge) => edge.target),
  );
  const anchoredNodeIds = new Set(
    Object.values(manifest.sections).flatMap(
      (section) => section.source_node_ids,
    ),
  );

  const filesWithoutSections = codeFiles
    .filter((file) => !sectionText.includes(file.path))
    .map((file) => `\`${file.path}\``);
  const filesWithoutTestCoverage = codeFiles
    .filter((file) => !testedTargets.has(file.id))
    .map((file) => `\`${file.path}\``);
  const sectionsWithoutAnchors = Object.values(manifest.sections)
    .filter(
      (section) =>
        section.status !== 'suppressed' &&
        section.source_node_ids.length === 0 &&
        section.source_spans.length === 0,
    )
    .map((section) => `[[${section.public_section_id}]]`);
  const graphOnlyFiles = codeFiles
    .filter((file) => !anchoredNodeIds.has(file.id))
    .map((file) => `\`${file.path}\``);

  return {
    output: [
      '# Code-KG Gaps',
      '',
      '## Files Without Knowledge Sections',
      '',
      ...bullet(filesWithoutSections, 'none detected'),
      '',
      '## Files Without Test Coverage',
      '',
      ...bullet(filesWithoutTestCoverage, 'none detected'),
      '',
      '## Sections Without Source Anchors',
      '',
      ...bullet(sectionsWithoutAnchors, 'none detected'),
      '',
      '## Graph Nodes Missing Manifest Coverage',
      '',
      ...bullet(graphOnlyFiles, 'none detected'),
    ].join('\n'),
  };
}
