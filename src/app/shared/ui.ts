import { Component, Pipe, PipeTransform, input, output, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Activity, Balances, Page } from '../core/models';
import { Preferences } from '../core/preferences';

@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(value: string | null | undefined, currency = 'MYR'): string {
    if (value === undefined || value === null) return '—';
    const [whole, fraction = ''] = value.split('.');
    const digits = Math.max(
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2,
      fraction.replace(/0+$/, '').length,
    );
    const grouped = (whole === '-0' ? '-' : '') + BigInt(whole || '0').toLocaleString('en');
    return `${currency} ${grouped}${digits ? '.' + fraction.padEnd(digits, '0').slice(0, digits) : ''}`;
  }
}

@Pipe({ name: 'pretty', standalone: true })
export class PrettyPipe implements PipeTransform {
  transform(value: string): string {
    return value
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase());
  }
}

@Pipe({ name: 'localDate', standalone: true, pure: false })
export class LocalDatePipe implements PipeTransform {
  private preferences = inject(Preferences);
  transform(value: string | null | undefined): string {
    if (!value) return '—';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    return new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeZone: dateOnly ? 'UTC' : this.preferences.timezone(),
    }).format(new Date(dateOnly ? value + 'T00:00:00Z' : value));
  }
}

@Component({
  selector: 'app-state',
  standalone: true,
  template: `@if (loading()) {
      <div class="state" role="status"><span class="spinner"></span> Loading your records…</div>
    } @else if (error()) {
      <div class="state error" role="alert">
        <strong>We couldn’t load this</strong>
        <p>{{ error() }}</p>
        <button class="secondary" (click)="retry.emit()">Try again</button>
      </div>
    } @else {
      <div class="state">
        <span class="empty-symbol">◇</span><strong>{{ title() }}</strong>
        <p>{{ message() }}</p>
      </div>
    }`,
})
export class StateComponent {
  loading = input(false);
  error = input('');
  title = input('A fresh start');
  message = input('Your records will appear here.');
  retry = output<void>();
}

@Component({
  selector: 'app-pagination',
  standalone: true,
  template: `@if (totalPages() > 1) {
    <nav class="pagination" aria-label="Pagination">
      <button class="secondary" [disabled]="page() <= 1" (click)="change.emit(page() - 1)">
        ← Previous</button
      ><span>{{ page() }} / {{ totalPages() }}</span
      ><button
        class="secondary"
        [disabled]="page() >= totalPages()"
        (click)="change.emit(page() + 1)"
      >
        Next →
      </button>
    </nav>
  }`,
})
export class PaginationComponent {
  page = input(1);
  totalPages = input(0);
  change = output<number>();
}

@Component({
  selector: 'app-balances',
  standalone: true,
  imports: [MoneyPipe],
  template: `<div class="balance-card" [class.dark]="dark()">
    <span class="eyebrow">{{ label() }}</span>
    @for (entry of entries(); track entry[0]) {
      <strong>{{ entry[1] | money: entry[0] }}</strong>
    } @empty {
      <strong>All clear</strong><span class="muted">No balance yet</span>
    }
  </div>`,
})
export class BalancesComponent {
  values = input<Balances>({});
  label = input('Balance');
  dark = input(false);
  entries() {
    return Object.entries(this.values());
  }
}

@Component({
  selector: 'app-activity-list',
  standalone: true,
  imports: [RouterLink, MoneyPipe, PrettyPipe, LocalDatePipe],
  template: `@for (item of items(); track item.kind + ':' + item.id) {
      <a
        class="record"
        [routerLink]="
          item.group_id ? ['/groups', item.group_id] : ['/transactions', item.transaction_id]
        "
        ><span class="record-icon" [class.lent]="item.kind === 'MONEY_LENT'">{{
          icon(item.kind)
        }}</span
        ><span class="record-main"
          ><strong>{{ item.title }}</strong
          ><small>{{ item.kind | pretty }} · {{ item.date | localDate }}</small></span
        ><span class="record-end"
          ><strong>{{ item.amount | money: item.currency }}</strong
          ><small>{{ item.status | pretty }}</small></span
        ></a
      >
    } @empty {
      <p class="muted padded">No activity to show yet.</p>
    }`,
})
export class ActivityListComponent {
  items = input<Activity[]>([]);
  icon(kind: string) {
    return (
      (
        { MONEY_LENT: '↗', MONEY_BORROWED: '↙', SETTLEMENT: '✓', GROUP_EXPENSE: '◎' } as Record<
          string,
          string
        >
      )[kind] || '−'
    );
  }
}
