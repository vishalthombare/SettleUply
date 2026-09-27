import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorMessage } from '../core/api';
import { Page, Activity } from '../core/models';
import { StateComponent, PaginationComponent, ActivityListComponent } from '../shared/ui';

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, StateComponent, PaginationComponent, ActivityListComponent],
  template: `<div class="page-heading">
      <div>
        <span class="eyebrow">EVERY LITTLE RECORD</span>
        <h1>Your money story.</h1>
        <p>Expenses, repayments, and moments shared.</p>
      </div>
      <a class="button primary" routerLink="/transactions/new">+ Add record</a>
    </div>
    <div class="toolbar wrap">
      <input
        class="search"
        [(ngModel)]="filters.search"
        placeholder="Search activity…"
        aria-label="Search activity"
      /><select [(ngModel)]="filters.kind" aria-label="Activity type">
        <option value="">Every type</option>
        <option value="PERSONAL_EXPENSE">Personal expense</option>
        <option value="MONEY_LENT">Money lent</option>
        <option value="MONEY_BORROWED">Money borrowed</option>
        <option value="SETTLEMENT">Settlement</option>
        <option value="GROUP_EXPENSE">Group expense</option></select
      ><select [(ngModel)]="filters.currency" aria-label="Currency">
        <option value="">All currencies</option>
        @for (c of currencies(); track c) {
          <option [value]="c">{{ c }}</option>
        }</select
      ><select [(ngModel)]="filters.status" aria-label="Status">
        <option value="">All statuses</option>
        @for (s of statuses; track s) {
          <option [value]="s">{{ s }}</option>
        }</select
      ><label class="inline-label">From<input type="date" [(ngModel)]="filters.from_date" /></label
      ><label class="inline-label">To<input type="date" [(ngModel)]="filters.to_date" /></label
      ><button class="primary" (click)="load(1)">Apply filters</button>
    </div>
    @if (loading() || error()) {
      <app-state [loading]="loading()" [error]="error()" (retry)="load()" />
    } @else {
      <section class="panel">
        <app-activity-list [items]="data()?.items || []" /><app-pagination
          [page]="data()?.page || 1"
          [totalPages]="data()?.total_pages || 0"
          (change)="load($event)"
        />
      </section>
    }`,
})
export class ActivityPage {
  private api = inject(Api);
  data = signal<Page<Activity> | null>(null);
  loading = signal(true);
  error = signal('');
  currencies = signal<string[]>([]);
  statuses = ['OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'OVERDUE', 'CANCELLED'];
  filters = { search: '', kind: '', currency: '', status: '', from_date: '', to_date: '' };
  constructor() {
    void this.load();
    void this.api
      .get<Record<string, number>>('/currencies')
      .then((c) => this.currencies.set(Object.keys(c)))
      .catch(() => {});
  }
  async load(page = 1) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.api.get('/activity', { page, ...this.filters }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
