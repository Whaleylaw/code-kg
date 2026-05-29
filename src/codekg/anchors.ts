import type { ManifestSection, SourceSpan } from './types.js';

export function sourceAnchorPolicy(
  section: ManifestSection,
): 'coverage-only' | 'edit-safe' {
  return section.source_anchor_policy ?? 'coverage-only';
}

export function backlinkAnchorsForSection(
  section: ManifestSection,
): SourceSpan[] {
  if (sourceAnchorPolicy(section) !== 'edit-safe') return [];
  return section.source_spans ?? [];
}
