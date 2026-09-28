import { Component, input, signal } from '@angular/core';
import { FormControl } from '@angular/forms';

@Component({
  selector: 'app-date-picker',
  standalone: true,
  styles: `
    :host {
      display: block;
      min-width: 0;
      margin-bottom: 18px;
      align-self: start;
    }
    .caption {
      display: block;
      font-weight: 550;
      font-size: 12px;
      margin-bottom: 8px;
    }
    .trigger {
      width: 100%;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      background: white;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 14px;
      color: var(--ink, #19392f);
      text-align: left;
      min-height: 44px;
    }
    .calendar {
      width: min(100%, 280px);
      box-sizing: border-box;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
      margin-top: 6px;
      background: white;
      box-shadow: 0 6px 20px #183d3010;
    }
    .heading {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) 76px 28px;
      gap: 4px;
      align-items: center;
      margin-bottom: 8px;
    }
    .heading select:not([multiple]):not([size]) {
      min-width: 0;
      width: 100%;
      min-height: 32px;
      height: 32px;
      margin: 0;
      padding: 4px 23px 4px 7px;
      background-position: right 6px center;
      background-size: 12px;
      font-size: 13px;
      border-radius: 6px;
    }
    .heading button {
      min-width: 0;
      min-height: 32px;
      padding: 0;
      border: 0;
      border-radius: 6px;
      font-size: 20px;
      background: transparent;
      color: inherit;
    }
    .days {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 2px;
      text-align: center;
    }
    .weekday {
      font-size: 10px;
      color: var(--muted);
      padding-bottom: 4px;
    }
    .day {
      padding: 0;
      min-height: 30px;
      min-width: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font-size: 12px;
    }
    .day:hover:not(:disabled) {
      background: #edf3e5;
    }
    .day.selected {
      background: #173f32;
      color: white;
    }
    .day.today {
      outline: 1px solid #719557;
      outline-offset: -2px;
    }
    .day:disabled {
      opacity: 0.3;
    }
    .shortcuts {
      display: flex;
      gap: 4px 10px;
      flex-wrap: wrap;
      margin-top: 6px;
    }
    .shortcuts button {
      padding: 5px 0;
      min-height: 30px;
      font-size: 11px;
    }
    @media (max-width: 600px) {
      .heading select:not([multiple]):not([size]) {
        font-size: 16px;
      }
      .trigger {
        font-size: 16px;
      }
      .caption {
        font-size: 12px;
      }
    }
  `,
  template: `
    <span class="caption">{{ label() }}{{ optional() ? ' (optional)' : '' }}</span>
    <button
      #trigger
      type="button"
      class="trigger"
      [attr.aria-label]="label() + ': ' + display()"
      [attr.aria-expanded]="opened()"
      [disabled]="control().disabled"
      (click)="toggle()"
    >
      <span>{{ display() }}</span
      ><span aria-hidden="true">▦</span>
    </button>
    @if (opened()) {
      <section
        class="calendar"
        [attr.aria-label]="label() + ' calendar'"
        (keydown.escape)="opened.set(false); trigger.focus(); $event.stopPropagation()"
      >
        <div class="heading">
          <button type="button" aria-label="Previous month" (click)="move(-1)">‹</button>
          <select
            aria-label="Month"
            [value]="month()"
            (change)="month.set(+$any($event.target).value)"
          >
            @for (name of months; track name; let i = $index) {
              <option [value]="i">{{ name.slice(0, 3) }}</option>
            }
          </select>
          <select
            aria-label="Year"
            [value]="year()"
            (change)="year.set(+$any($event.target).value)"
          >
            @for (y of years(); track y) {
              <option [value]="y">{{ y }}</option>
            }
          </select>
          <button type="button" aria-label="Next month" (click)="move(1)">›</button>
        </div>
        <div class="days">
          @for (name of weekdays; track name) {
            <span class="weekday">{{ name }}</span>
          }
          @for (day of days(); track $index) {
            @if (day) {
              <button
                type="button"
                class="day"
                [class.selected]="iso(day) === control().value"
                [class.today]="iso(day) === today()"
                [attr.aria-label]="day + ' ' + months[month()] + ' ' + year()"
                [attr.aria-pressed]="iso(day) === control().value"
                [disabled]="!!min() && iso(day) < min()"
                (click)="pick(iso(day)); trigger.focus()"
              >
                {{ day }}
              </button>
            } @else {
              <span></span>
            }
          }
        </div>
        <div class="shortcuts">
          <button
            type="button"
            class="text-button"
            [disabled]="!!min() && today() < min()"
            (click)="pick(today()); trigger.focus()"
          >
            Today
          </button>
          @if (!optional()) {
            <button
              type="button"
              class="text-button"
              [disabled]="!!min() && yesterday() < min()"
              (click)="pick(yesterday()); trigger.focus()"
            >
              Yesterday
            </button>
          }
          @if (optional()) {
            <button type="button" class="text-button" (click)="pick(''); trigger.focus()">
              Clear date
            </button>
          }
          <button type="button" class="text-button" (click)="opened.set(false); trigger.focus()">
            Close
          </button>
        </div>
      </section>
    }
  `,
})
export class DatePickerComponent {
  control = input.required<FormControl<string | null>>();
  label = input('Date');
  optional = input(false);
  min = input('');
  today = input.required<string>();
  opened = signal(false);
  month = signal(0);
  year = signal(2026);
  months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  weekdays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  display() {
    const value = this.control().value;
    if (!value) return 'Choose a date';
    const [y, m, d] = value.split('-').map(Number);
    return `${d} ${this.months[m - 1].slice(0, 3)} ${y}`;
  }
  toggle() {
    if (!this.opened()) {
      const [y, m] = (this.control().value || this.min() || this.today()).split('-').map(Number);
      this.year.set(y);
      this.month.set(m - 1);
    }
    this.opened.update((value) => !value);
  }
  years() {
    const current = Number(this.today().slice(0, 4));
    const start = Math.min(current - 100, this.year());
    const end = Math.max(current + 20, this.year());
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }
  iso(day: number) {
    return `${this.year()}-${String(this.month() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  days() {
    const offset = (new Date(Date.UTC(this.year(), this.month(), 1)).getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(this.year(), this.month() + 1, 0)).getUTCDate();
    return [...Array(offset).fill(0), ...Array.from({ length: count }, (_, i) => i + 1)];
  }
  move(delta: number) {
    const date = new Date(Date.UTC(this.year(), this.month() + delta, 1));
    this.year.set(date.getUTCFullYear());
    this.month.set(date.getUTCMonth());
  }
  yesterday() {
    const date = new Date(this.today() + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }
  pick(value: string) {
    if (value && this.min() && value < this.min()) return;
    this.control().setValue(value);
    this.control().markAsDirty();
    this.control().markAsTouched();
    this.opened.set(false);
  }
}
