import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../src/app/core/auth';
import { Preferences } from '../src/app/core/preferences';
import { Shell } from '../src/app/layouts/shell';

for (const outcome of ['success', 'cancelled', 'failed'] as const) {
  test(`Personal expense menu handles ${outcome} navigation without disappearing early`, async () => {
    let resolve!: (value: boolean) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<boolean>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const calls: unknown[] = [];
    const injector = createEnvironmentInjector(
      [
        { provide: Auth, useValue: { isAdmin: signal(false) } },
        { provide: Preferences, useValue: { load: async () => ({}) } },
        {
          provide: Router,
          useValue: {
            navigate: (...args: unknown[]) => {
              calls.push(args);
              return pending;
            },
          },
        },
      ],
      null as any,
    );
    try {
      const shell = runInInjectionContext(injector, () => new Shell());
      shell.actions.set(true);
      let prevented = 0;
      const event = { button: 0, preventDefault: () => prevented++ } as MouseEvent;
      const opening = shell.openAction(event, shell.quickActions[0]);
      await shell.openAction(event, shell.quickActions[0]);
      assert.equal(prevented, 2);
      assert.equal(calls.length, 1, 'duplicate click must not navigate twice');
      assert.deepEqual(calls[0], [
        ['/transactions/new'],
        { queryParams: { type: 'PERSONAL_EXPENSE' } },
      ]);
      assert.equal(shell.actions(), true, 'menu remains visible while the page loads');
      if (outcome === 'failed') reject(new Error('Chunk failed'));
      else resolve(outcome === 'success');
      await opening;
      assert.equal(shell.actions(), outcome !== 'success');
      assert.equal(!!shell.actionError(), outcome !== 'success');
      assert.equal(shell.openingAction(), '');
    } finally {
      injector.destroy();
    }
  });
}
