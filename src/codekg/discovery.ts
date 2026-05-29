import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { walkEntries } from '../walk.js';
import type { DiscoveryResult, FileCategory, DiscoveredFile } from './types.js';

const CODE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.swift',
  '.ts',
  '.tsx',
]);

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);
const ASSET_EXTENSIONS = new Set([
  '.gif',
  '.jpeg',
  '.jpg',
  '.pdf',
  '.png',
  '.svg',
  '.webp',
]);

const CONFIG_FILES = new Set([
  'Cargo.toml',
  'go.mod',
  'package.json',
  'pyproject.toml',
  'requirements.txt',
  'tsconfig.json',
]);

function isIgnoredByCodeKg(path: string): boolean {
  return (
    path.startsWith('lat.md/') ||
    path.startsWith('.code-kg/') ||
    path.startsWith('node_modules/') ||
    path.startsWith('dist/') ||
    path.startsWith('build/') ||
    path.includes('/node_modules/') ||
    path.includes('/dist/') ||
    path.includes('/build/')
  );
}

function isTestPath(path: string): boolean {
  const name = path.split('/').pop()?.toLowerCase() ?? path.toLowerCase();
  const directorySegments = path.toLowerCase().split('/').slice(0, -1);
  return (
    /^test[_-].+\.[^.]+$/.test(name) ||
    /^.+[_-]test\.[^.]+$/.test(name) ||
    /^.+\.(test|spec)\.[^.]+$/.test(name) ||
    directorySegments.includes('__tests__')
  );
}

function categoryFor(path: string): FileCategory {
  const name = path.split('/').pop() ?? path;
  const ext = extname(path).toLowerCase();
  if (CONFIG_FILES.has(name)) return 'config';
  if (isTestPath(path)) return 'test';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DOC_EXTENSIONS.has(ext)) return 'document';
  if (ASSET_EXTENSIONS.has(ext)) return 'asset';
  return 'unsupported';
}

function emptyCounts(): Record<FileCategory, number> {
  return {
    code: 0,
    document: 0,
    test: 0,
    config: 0,
    asset: 0,
    unsupported: 0,
  };
}

async function packageHints(
  root: string,
  paths: Set<string>,
): Promise<string[]> {
  const hints: string[] = [];
  if (paths.has('package.json')) {
    try {
      const pkg = JSON.parse(await readFile(`${root}/package.json`, 'utf-8'));
      const name = typeof pkg.name === 'string' ? pkg.name : 'Node package';
      hints.push(`${name} (Node/TypeScript)`);
    } catch {
      hints.push('Node/TypeScript package');
    }
  }
  if (paths.has('pyproject.toml')) hints.push('Python project');
  if (paths.has('requirements.txt')) hints.push('Python requirements.txt');
  if (paths.has('go.mod')) hints.push('Go module');
  if (paths.has('Cargo.toml')) hints.push('Rust crate');
  return hints;
}

async function entrypoints(
  root: string,
  paths: Set<string>,
): Promise<string[]> {
  const result = new Set<string>();
  for (const candidate of [
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'src/main.ts',
    'src/main.js',
    'index.ts',
    'index.js',
    'main.py',
    'app.py',
    'server.py',
    'src/main.py',
    'src/app.py',
    'src/server.py',
  ]) {
    if (paths.has(candidate)) result.add(candidate);
  }

  for (const path of paths) {
    if (/^(apps|src)\/.+\/(main|app|server)\.py$/.test(path)) {
      result.add(path);
    }
    if (/^scripts\/(main|serve|server|smoke|start)\.py$/.test(path)) {
      result.add(path);
    }
  }

  if (paths.has('package.json')) {
    try {
      const pkg = JSON.parse(await readFile(`${root}/package.json`, 'utf-8'));
      if (typeof pkg.main === 'string') result.add(pkg.main);
      if (typeof pkg.bin === 'string') result.add(pkg.bin);
      if (pkg.bin && typeof pkg.bin === 'object') {
        for (const value of Object.values(pkg.bin)) {
          if (typeof value === 'string') result.add(value);
        }
      }
    } catch {
      // Ignore malformed package metadata during discovery.
    }
  }

  return [...result].sort();
}

export async function discoverProject(root: string): Promise<DiscoveryResult> {
  const entries = await walkEntries(root);
  const files: DiscoveredFile[] = [];
  const counts = emptyCounts();

  for (const path of entries.sort()) {
    if (isIgnoredByCodeKg(path)) continue;
    const category = categoryFor(path);
    counts[category]++;
    files.push({
      path,
      category,
      extension: extname(path).toLowerCase() || '(none)',
    });
  }

  const pathSet = new Set(files.map((f) => f.path));
  return {
    root,
    files,
    counts,
    packageHints: await packageHints(root, pathSet),
    entrypoints: await entrypoints(root, pathSet),
    testPaths: files.filter((f) => f.category === 'test').map((f) => f.path),
  };
}
