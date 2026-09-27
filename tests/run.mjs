import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';

// Bundle application TS only; Angular runs its real validators and DI in Node.
await build({
  entryPoints: ['tests/auth.test.ts'],
  outfile: '.test-build/auth.test.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  tsconfig: 'tsconfig.json',
});
// Preload JIT before bundled route imports evaluate Angular's partial declarations.
const result = spawnSync(
  process.execPath,
  ['--import', '@angular/compiler', '--test', '.test-build/auth.test.mjs'],
  {
    stdio: 'inherit',
  },
);
process.exitCode = result.status ?? 1;
