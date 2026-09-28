import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEnvironmentInjector, runInInjectionContext } from '@angular/core';
import { FormControl } from '@angular/forms';
import { DatePickerComponent } from '../src/app/shared/date-picker';

test('calendar handles leap years, month navigation, and formatted selected dates', () => {
  const injector = createEnvironmentInjector([], null as any);
  try {
    const picker = runInInjectionContext(injector, () => new DatePickerComponent());
    const control = new FormControl('2024-02-29');
    picker.control = (() => control) as any;
    picker.today = (() => '2026-09-28') as any;
    picker.toggle();
    assert.equal(picker.display(), '29 Feb 2024');
    assert.equal(picker.days().filter(Boolean).length, 29);
    picker.move(1);
    assert.equal(picker.month(), 2);
    picker.month.set(11); picker.move(1);
    assert.equal(picker.year(), 2025);
    assert.equal(picker.month(), 0);
  } finally { injector.destroy(); }
});

test('due dates reject earlier days and allow clearing without timezone shifts', () => {
  const injector = createEnvironmentInjector([], null as any);
  try {
    const picker = runInInjectionContext(injector, () => new DatePickerComponent());
    const control = new FormControl('');
    picker.control = (() => control) as any;
    picker.today = (() => '2026-03-01') as any;
    picker.min = (() => '2026-03-01') as any;
    assert.equal(picker.yesterday(), '2026-02-28');
    picker.pick('2026-02-28');
    assert.equal(control.value, '');
    picker.pick('2026-03-05');
    assert.equal(control.value, '2026-03-05');
    assert.ok(control.dirty && control.touched);
    picker.pick('');
    assert.equal(control.value, '');
    assert.equal(picker.display(), 'Choose a date');
  } finally { injector.destroy(); }
});
