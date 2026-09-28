import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';

// Bundle application TS only; Angular runs its real validators and DI in Node.
const suites = ['auth', 'money', 'repayments', 'quick-actions', 'transaction-form', 'date-picker'];
await build({
  entryPoints: suites.map((name) => `tests/${name}.test.ts`),
  outdir: '.test-build',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  tsconfig: 'tsconfig.json',
});
// Preload JIT before bundled route imports evaluate Angular's partial declarations.
const result = spawnSync(
  process.execPath,
  [
    '--import',
    '@angular/compiler',
    '--test',
    ...suites.map((name) => `.test-build/${name}.test.mjs`),
  ],
  {
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
