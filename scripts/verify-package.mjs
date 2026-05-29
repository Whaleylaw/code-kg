import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';

function run(command, args, opts = {}) {
  return execFileSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

function assertIncludes(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(
      `${label} did not include ${JSON.stringify(expected)}\n${text}`,
    );
  }
}

function assertNotIncludes(text, unexpected, label) {
  if (text.includes(unexpected)) {
    throw new Error(
      `${label} unexpectedly included ${JSON.stringify(unexpected)}\n${text}`,
    );
  }
}

const root = process.cwd();
const work = mkdtempSync(join(tmpdir(), 'codekg-package-'));
const packDir = join(work, 'pack');
const consumer = join(work, 'consumer');
const sample = join(consumer, 'sample');
mkdirSync(packDir);
mkdirSync(consumer);
mkdirSync(sample);
mkdirSync(join(sample, 'src'), { recursive: true });
mkdirSync(join(sample, 'tests'), { recursive: true });
writeFileSync(
  join(consumer, 'package.json'),
  '{"private":true,"type":"module"}\n',
);
writeFileSync(
  join(sample, 'package.json'),
  JSON.stringify({ name: 'codekg-package-sample', type: 'module' }, null, 2) +
    '\n',
);
writeFileSync(
  join(sample, 'src', 'util.ts'),
  'export function makeValue() {\n  return 1;\n}\n',
);
writeFileSync(
  join(sample, 'src', 'index.ts'),
  'import { makeValue } from "./util";\n\nexport const value = makeValue();\n',
);
writeFileSync(
  join(sample, 'tests', 'index.test.ts'),
  'import "../src/index";\n',
);

run('pnpm', ['pack', '--pack-destination', packDir], { cwd: root });
const tarball = (await readdir(packDir)).find((name) => name.endsWith('.tgz'));
if (!tarball) throw new Error('pnpm pack did not create a .tgz file.');
const tarballPath = join(packDir, tarball);

const members = run('tar', ['-tzf', tarballPath]);
assertIncludes(members, 'package/dist/src/codekg/cli.js', 'tarball');
assertIncludes(members, 'package/templates/init/lat.md', 'tarball');
if (
  members.includes('package/lat.md/.cache/') ||
  members.includes('package/.code-kg/')
) {
  throw new Error('tarball includes local Code-KG runtime artifacts.');
}

run('pnpm', ['add', tarballPath], { cwd: consumer });
const bin = join(consumer, 'node_modules', '.bin', 'code-kg');
if (!existsSync(bin)) throw new Error('code-kg bin was not linked.');

const help = run(bin, ['--help'], { cwd: consumer });
assertIncludes(help, 'Usage: code-kg', 'code-kg --help');

const bootstrap = run(bin, ['bootstrap', '--accept'], { cwd: sample });
assertIncludes(bootstrap, 'created lat.md/lat.md', 'bootstrap');
assertIncludes(bootstrap, 'updated .gitignore', 'bootstrap');

const gitignore = await readFile(join(sample, '.gitignore'), 'utf-8');
assertIncludes(gitignore, '.code-kg/cache/', '.gitignore');
assertIncludes(gitignore, 'lat.md/.cache/', '.gitignore');

const doctor = run(bin, ['doctor'], { cwd: sample });
assertIncludes(doctor, 'code-kg check: passed', 'doctor');
assertIncludes(doctor, '.code-kg/cache/: ignored', 'doctor');
assertIncludes(doctor, 'lat.md/.cache/: ignored', 'doctor');

const context = run(bin, ['context', 'src/index.ts'], { cwd: sample });
assertIncludes(context, '# Code-KG Context', 'context');
assertIncludes(context, 'tested by: `tests/index.test.ts`', 'context');
const gaps = run(bin, ['gaps'], { cwd: sample });
assertIncludes(gaps, '# Code-KG Gaps', 'gaps');
assertIncludes(gaps, 'src/util.ts', 'gaps');
run('git', ['init'], { cwd: sample });
run('git', ['add', '.'], { cwd: sample });
run(
  'git',
  [
    '-c',
    'user.email=codekg@example.test',
    '-c',
    'user.name=Code KG',
    'commit',
    '-m',
    'baseline',
  ],
  { cwd: sample },
);
writeFileSync(
  join(sample, 'src', 'index.ts'),
  'import { makeValue } from "./util";\n\nexport const value = makeValue() + 1;\n',
);
const changed = run(bin, ['changed'], { cwd: sample });
assertIncludes(changed, '# Code-KG Changed', 'changed');
assertIncludes(changed, 'src/index.ts', 'changed');
const update = run(bin, ['update'], {
  cwd: sample,
  env: {
    ...process.env,
    XDG_CONFIG_HOME: join(work, 'update-config'),
    LAT_EMBEDDING_PROVIDER: '',
    LAT_LLM_KEY: '',
    LAT_LLM_KEY_FILE: '',
    LAT_LLM_KEY_HELPER: '',
  },
});
assertIncludes(update, '# Code-KG Update', 'update');
assertIncludes(update, 'code-kg check: passed', 'update');

const agentsStatusBeforeInstall = run(bin, ['agents', 'status'], {
  cwd: sample,
});
assertIncludes(
  agentsStatusBeforeInstall,
  '# Code-KG Agents Status',
  'agents status',
);
assertIncludes(
  agentsStatusBeforeInstall,
  'AGENTS.md guidance: missing',
  'agents status',
);
assertIncludes(
  agentsStatusBeforeInstall,
  'Codex hook: missing',
  'agents status',
);

const hookNudge = execFileSync(bin, ['hook-check'], {
  cwd: sample,
  encoding: 'utf-8',
  input: JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'rg "entry points" src tests' },
  }),
  stdio: ['pipe', 'pipe', 'pipe'],
});
assertIncludes(hookNudge, 'hookSpecificOutput', 'hook-check nudge');
const hookContext = JSON.parse(hookNudge).hookSpecificOutput.additionalContext;
assertIncludes(
  hookContext,
  'code-kg search "entry points" --backend auto-semantic',
  'hook-check nudge',
);
const structuredGrepNudge = execFileSync(bin, ['hook-check'], {
  cwd: sample,
  encoding: 'utf-8',
  input: JSON.stringify({
    tool_name: 'Grep',
    tool_input: { pattern: 'test coverage', path: 'src' },
  }),
  stdio: ['pipe', 'pipe', 'pipe'],
});
assertIncludes(
  JSON.parse(structuredGrepNudge).hookSpecificOutput.additionalContext,
  'code-kg search "test coverage" --backend auto-semantic',
  'structured Grep hook-check nudge',
);
const structuredReadNudge = execFileSync(bin, ['hook-check'], {
  cwd: sample,
  encoding: 'utf-8',
  input: JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: 'src/index.ts' },
  }),
  stdio: ['pipe', 'pipe', 'pipe'],
});
assertIncludes(
  JSON.parse(structuredReadNudge).hookSpecificOutput.additionalContext,
  'raw source read',
  'structured Read hook-check nudge',
);
const hookSilent = execFileSync(bin, ['hook-check'], {
  cwd: sample,
  encoding: 'utf-8',
  input: JSON.stringify({
    tool_name: 'Bash',
    tool_input: { command: 'code-kg search "entry points"' },
  }),
  stdio: ['pipe', 'pipe', 'pipe'],
});
if (hookSilent.trim()) {
  throw new Error(`hook-check was expected to stay silent:\n${hookSilent}`);
}

const semanticConfig = join(work, 'semantic-config');
const semanticEnv = {
  ...process.env,
  XDG_CONFIG_HOME: semanticConfig,
  LAT_EMBEDDING_PROVIDER: '',
  LAT_LLM_KEY: '',
  LAT_LLM_KEY_FILE: '',
  LAT_LLM_KEY_HELPER: '',
};
const semanticStatus = run(bin, ['semantic', 'status'], {
  cwd: sample,
  env: semanticEnv,
});
assertIncludes(semanticStatus, 'provider: missing', 'semantic status');
const semanticEnable = run(bin, ['semantic', 'enable-local'], {
  cwd: sample,
  env: semanticEnv,
});
assertIncludes(
  semanticEnable,
  'local embeddings enabled',
  'semantic enable-local',
);
const semanticConfigJson = JSON.parse(
  await readFile(join(semanticConfig, 'lat', 'config.json'), 'utf-8'),
);
if (semanticConfigJson.embedding_provider !== 'local') {
  throw new Error('semantic enable-local did not persist local provider.');
}

const packagedCli = join(
  consumer,
  'node_modules',
  'code-kg',
  'dist',
  'src',
  'codekg',
  'cli.js',
);
run(process.execPath, [packagedCli, 'agents', 'install'], {
  cwd: sample,
  env: { ...process.env, PATH: '' },
});
const fallbackAgentsStatus = run(
  process.execPath,
  [packagedCli, 'agents', 'status'],
  {
    cwd: sample,
    env: { ...process.env, PATH: '' },
  },
);
assertIncludes(
  fallbackAgentsStatus,
  'AGENTS.md guidance: installed',
  'agents status fallback',
);
assertIncludes(
  fallbackAgentsStatus,
  'Codex hook: installed (local absolute hook)',
  'agents status fallback',
);
assertIncludes(
  fallbackAgentsStatus,
  'Codex matcher:',
  'agents status fallback',
);
const hooks = JSON.parse(
  await readFile(join(sample, '.codex', 'hooks.json'), 'utf-8'),
);
const hookCommand = hooks.hooks.PreToolUse[0].hooks[0].command;
assertIncludes(hookCommand, process.execPath, 'installed Codex hook');
assertIncludes(hookCommand, 'dist/src/codekg/cli.js', 'installed Codex hook');
assertIncludes(hookCommand, 'hook-check', 'installed Codex hook');
const agents = await readFile(join(sample, 'AGENTS.md'), 'utf-8');
assertIncludes(agents, 'Local CLI fallback', 'AGENTS.md');
assertIncludes(agents, 'dist/src/codekg/cli.js', 'AGENTS.md');

const globalBin = join(work, 'global-bin');
mkdirSync(globalBin);
const globalInstall = run(bin, ['install-global', '--bin-dir', globalBin], {
  cwd: consumer,
});
assertIncludes(globalInstall, '# Code-KG Global Install', 'install-global');
assertIncludes(
  globalInstall,
  `installed wrapper: ${join(globalBin, 'code-kg')}`,
  'install-global',
);
const globalEnv = {
  ...process.env,
  PATH: `${globalBin}${delimiter}${process.env.PATH ?? ''}`,
};
const globalHelp = run('code-kg', ['--help'], {
  cwd: consumer,
  env: globalEnv,
});
assertIncludes(globalHelp, 'Usage: code-kg', 'global code-kg --help');

run('code-kg', ['agents', 'install'], { cwd: sample, env: globalEnv });
const globalHooks = JSON.parse(
  await readFile(join(sample, '.codex', 'hooks.json'), 'utf-8'),
);
const globalHookCommand = globalHooks.hooks.PreToolUse[0].hooks[0].command;
if (globalHookCommand !== 'code-kg hook-check') {
  throw new Error(
    `global PATH install wrote unexpected hook command:\n${globalHookCommand}`,
  );
}
const globalAgents = await readFile(join(sample, 'AGENTS.md'), 'utf-8');
assertNotIncludes(globalAgents, 'Local CLI fallback', 'AGENTS.md');

console.log(`Package smoke test passed: ${tarballPath}`);
