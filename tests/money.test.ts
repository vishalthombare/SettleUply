import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneySign } from '../src/app/core/money';
import { MoneyPipe } from '../src/app/shared/ui';

const money = new MoneyPipe();

test('net amounts retain explicit direction while receivable/payable totals stay unsigned', () => {
  assert.equal(money.transform('10000.0000', 'INR', true), 'INR +10,000.00');
  assert.equal(money.transform('-10000.0000', 'INR', true), 'INR -10,000.00');
  assert.equal(money.transform('10000.0000', 'INR'), 'INR 10,000.00');
  assert.equal(moneySign('10000.0000'), 1);
  assert.equal(moneySign('-10000.0000'), -1);
});

test('zero net amounts stay neutral, including negative zero from decimal arithmetic', () => {
  for (const value of ['0', '0.00', '-0.0000', '000.0000']) {
    assert.equal(moneySign(value), 0);
    assert.equal(money.transform(value, 'INR', true), 'INR 0.00');
  }
});

test('small balances preserve direction and precision instead of rounding to zero', () => {
  assert.equal(moneySign('-0.0001'), -1);
  assert.equal(moneySign('0.0001'), 1);
  assert.equal(money.transform('-0.0001', 'KWD', true), 'KWD -0.0001');
  assert.equal(money.transform('0.0001', 'KWD', true), 'KWD +0.0001');
  assert.equal(money.transform('-0.01', 'MYR', true), 'MYR -0.01');
});

test('large totals keep exact digits beyond JavaScript number precision', () => {
  assert.equal(
    money.transform('99999999999999999.9900', 'INR', true),
    'INR +99,999,999,999,999,999.99',
  );
  assert.equal(
    money.transform('-99999999999999999.9900', 'INR', true),
    'INR -99,999,999,999,999,999.99',
  );
});

test('currency formatting respects zero and three decimal currencies', () => {
  assert.equal(money.transform('10000.0000', 'JPY', true), 'JPY +10,000');
  assert.equal(money.transform('-10.1250', 'KWD', true), 'KWD -10.125');
  assert.equal(money.transform(undefined, 'INR', true), '—');
});
