import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api, Toast } from '../src/app/core/api';
import { Preferences } from '../src/app/core/preferences';
import { SettlementForm } from '../src/app/features/transactions';

const loans = [
  {
    id: 1,
    transaction_type: 'MONEY_LENT',
    outstanding_amount: '2000.00',
    status: 'OPEN',
    currency: 'INR',
  },
  {
    id: 2,
    transaction_type: 'MONEY_BORROWED',
    outstanding_amount: '1000.00',
    status: 'OPEN',
    currency: 'MYR',
  },
  {
    id: 3,
    transaction_type: 'MONEY_LENT',
    outstanding_amount: '0.00',
    status: 'SETTLED',
    currency: 'INR',
  },
  {
    id: 4,
    transaction_type: 'MONEY_LENT',
    outstanding_amount: '100.00',
    status: 'CANCELLED',
    currency: 'INR',
  },
];

async function setup(direction: string) {
  const requests: { url: string; body: any }[] = [];
  const reads: string[] = [];
  const injector = createEnvironmentInjector(
    [
      FormBuilder,
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: {
            paramMap: { get: () => null },
            queryParamMap: { get: (key: string) => (key === 'contact' ? '7' : direction) },
          },
        },
      },
      {
        provide: Api,
        useValue: {
          all: async (url: string) => {
            reads.push(url);
            return url.startsWith('/transactions') ? loans : [];
          },
          get: async (url: string) => loans.find((t) => url.endsWith('/' + t.id)),
          send: async (_method: string, url: string, body: any) => {
            requests.push({ url, body });
          },
        },
      },
      { provide: Preferences, useValue: { today: () => '2026-09-28' } },
      { provide: Toast, useValue: { show: () => {} } },
      { provide: Router, useValue: { navigate: async () => true } },
    ],
    null as any,
  );
  const form = runInInjectionContext(injector, () => new SettlementForm());
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { injector, form, requests, reads };
}

for (const [direction, id] of [
  ['receive', 1],
  ['pay', 2],
] as const) {
  test(`${direction} repayment selects only eligible loans for the selected person`, async () => {
    const { injector, form, requests, reads } = await setup(direction);
    try {
      assert.deepEqual(
        form.choices().map((t) => t.id),
        [id],
      );
      assert.ok(reads.includes('/transactions?contact_id=7'));
      await form.choose(id);
      await form.save();
      assert.equal(requests.length, 0, 'empty amount must not submit');
      form.form.controls.amount.setValue('9999');
      await form.save();
      assert.equal(requests.length, 0, 'overpayment must not submit');
      form.form.controls.amount.setValue('500');
      await Promise.all([form.save(), form.save()]);
      assert.equal(requests.length, 1, 'double click must not submit twice');
      assert.equal(requests[0].url, `/transactions/${id}/settlements`);
      assert.equal(requests[0].body.amount, '500');
      assert.equal(requests[0].body.currency, id === 1 ? 'INR' : 'MYR');
    } finally {
      injector.destroy();
    }
  });
}
