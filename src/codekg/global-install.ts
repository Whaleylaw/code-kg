import { constants as fsConstants } from 'node:fs';
import { access, chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CmdResult } from '../context.js';

type InstallGlobalOptions = {
  binDir?: string;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function currentCliPath(): string {
  const current = fileURLToPath(import.meta.url);
  if (current.endsWith('/dist/src/codekg/global-install.js')) {
    return join(dirname(current), 'cli.js');
  }
  if (
    current.endsWith('/src/codekg/global-install.ts') ||
    current.endsWith('/src/codekg/global-install.js')
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

function defaultBinDir(): string {
  return join(homedir(), '.local', 'bin');
}

function pathContains(directory: string): boolean {
  const resolved = resolve(directory);
  return (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .some((entry) => resolve(entry) === resolved);
}

async function assertReadable(path: string): Promise<void> {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`CLI target is not readable: ${path}`);
  }
}

export async function installGlobalCommand(
  opts: InstallGlobalOptions = {},
): Promise<CmdResult> {
  const binDir = resolve(opts.binDir ?? defaultBinDir());
  const wrapperPath = join(binDir, 'code-kg');
  const cliPath = currentCliPath();
  await assertReadable(cliPath);
  await mkdir(binDir, { recursive: true });
  await writeFile(
    wrapperPath,
    [
      '#!/bin/sh',
      `exec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"`,
      '',
    ].join('\n'),
    'utf-8',
  );
  await chmod(wrapperPath, 0o755);

  const pathReady = pathContains(binDir);
  const lines = [
    '# Code-KG Global Install',
    '',
    `- installed wrapper: ${wrapperPath}`,
    `- target CLI: ${cliPath}`,
    pathReady
      ? '- PATH: ready'
      : `- PATH: add ${binDir} to PATH before using \`code-kg\` globally`,
  ];
  return { output: lines.join('\n') };
}
