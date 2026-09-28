import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, Toast } from '../src/app/core/api';
import { Preferences } from '../src/app/core/preferences';
import { TransactionDraft } from '../src/app/core/transaction-draft';
import { TransactionForm } from '../src/app/features/transactions';

test('purpose, raw amount payload, and Add person draft survive the round trip', async () => {
  const query = new Map([['type', 'MONEY_LENT']]);
  const requests: any[] = [];
  const draft = new TransactionDraft();
  const injector = createEnvironmentInjector(
    [
      FormBuilder,
      { provide: TransactionDraft, useValue: draft },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: { get: () => null },
            queryParamMap: { get: (key: string) => query.get(key) || null },
          },
        },
      },
      {
        provide: Api,
        useValue: {
          all: async (path: string) => (path === '/categories' ? [{ id: 8, name: 'Rent' }] : []),
          get: async (path: string) =>
            path === '/currencies'
              ? { INR: 2 }
              : {
                  default_currency: 'INR',
                  email_transaction_notifications: false,
                  sms_transaction_notifications: false,
                },
          send: async (_method: string, _path: string, body: any) => {
            requests.push(body);
            return { id: 42 };
          },
        },
      },
      { provide: Router, useValue: { navigate: async () => true } },
      { provide: Toast, useValue: { show: () => {} } },
      { provide: Preferences, useValue: { currency: () => 'INR', today: () => '2026-09-28' } },
    ],
    null as any,
  );
  try {
    const form = runInInjectionContext(injector, () => new TransactionForm());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(form.purposes().includes('Short-term help'));
    form.choosePurpose('Rent support');
    assert.equal(form.form.controls.category_id.value, 8);
    form.choosePurpose('Other');
    assert.equal(form.form.controls.purpose.value, '');
    assert.equal(form.form.invalid, true);
    form.form.patchValue({ purpose: 'Custom friend help', amount: '100000.50' });
    assert.equal(form.formattedAmount(), '1,00,000.50');
    await form.addPerson();
    query.set('resume', 'true');
    query.set('contact', '9');
    const resumed = runInInjectionContext(injector, () => new TransactionForm());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(resumed.form.controls.amount.value, '100000.50');
    assert.equal(resumed.form.controls.purpose.value, 'Custom friend help');
    assert.equal(resumed.purposeChoice, 'Other');
    assert.equal(resumed.form.controls.contact_id.value, 9);
    assert.equal(draft.value, null);
    await resumed.save();
    assert.equal(requests[0].amount, '100000.50');
    assert.equal(requests[0].purpose, 'Custom friend help');
  } finally {
    injector.destroy();
  }
});
